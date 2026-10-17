import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Frame } from "./overlay.ts";

/**
 * The rink's recording, read the way its player scrubs it: a segment at a
 * time, a frame or two from each, and the segment gone straight after. Nothing
 * is kept but what the scoreboard said, and the address is never printed.
 */

export type Segment = { uri: string; start: number; duration: number };
export type Stream = {
  segments: Segment[];
  /** The playlist says it is complete. Both rinks' recordings, once posted, do; one still growing is not searched. */
  ended: boolean;
  fetched: { segments: number; bytes: number };
};

const W = 1280, H = 720;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";

/** A segment is a few megabytes: a minute is a stalled connection, not a slow one. */
const TIMEOUT = 60_000;

async function text(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`recording playlist: ${r.status}`);
  return r.text();
}

/** Every segment of the lightest variant, with where it starts. 720p is what the boards were measured on. */
export async function openStream(streamUrl: string): Promise<Stream> {
  const master = await text(streamUrl);
  const variants: { bandwidth: number; url: string }[] = [];
  const lines = master.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXT-X-STREAM-INF:.*BANDWIDTH=(\d+)/.exec(lines[i]!);
    if (m && lines[i + 1] && !lines[i + 1]!.startsWith("#")) variants.push({ bandwidth: Number(m[1]), url: new URL(lines[i + 1]!, streamUrl).href });
  }
  const playlistUrl = variants.sort((a, b) => a.bandwidth - b.bandwidth)[0]?.url ?? streamUrl;
  const segments: Segment[] = [];
  const playlist = await text(playlistUrl);
  let at = 0, duration = 0;
  for (const line of playlist.split("\n").map((l) => l.trim())) {
    const m = /^#EXTINF:([\d.]+)/.exec(line);
    if (m) duration = Number(m[1]);
    else if (line && !line.startsWith("#")) { segments.push({ uri: new URL(line, playlistUrl).href, start: at, duration }); at += duration; }
  }
  if (!segments.length) throw new Error("recording playlist: no segments");
  return { segments, ended: /^#EXT-X-ENDLIST/m.test(playlist), fetched: { segments: 0, bytes: 0 } };
}

function run(cmd: string, args: string[]): Buffer {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr.toString().slice(-400)}`);
  return r.stdout;
}

/**
 * Frames from one segment, `perSecond` a second — or its first frame only, for
 * 0 — picked by frame number and scaled to 1280x720. `t` is seconds into the
 * recording, on the playlist's own clock, which is the clock the rink's clips
 * are cut on: measured on 2026-10-15, a clip asked for at 3600s began within
 * about a second of the frame this read at 3600s.
 */
export async function segmentFrames(stream: Stream, index: number, perSecond: number): Promise<{ t: number; frame: Frame }[]> {
  const seg = stream.segments[index];
  if (!seg) return [];
  const r = await fetch(seg.uri, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`recording segment ${index}: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  stream.fetched.segments++;
  stream.fetched.bytes += bytes.length;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grh-seg-"));
  try {
    const file = path.join(dir, "s.ts");
    fs.writeFileSync(file, bytes);
    const rate = run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", file]).toString().trim();
    const [n, d] = rate.split("/").map(Number);
    const fps = n && d ? n / d : 30;
    const every = perSecond > 0 ? Math.max(1, Math.round(fps / perSecond)) : Number.MAX_SAFE_INTEGER;
    const raw = run(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-i", file,
      "-vf", `select='not(mod(n\\,${every}))',scale=${W}:${H}`, "-vsync", "0", ...(perSecond > 0 ? [] : ["-frames:v", "1"]),
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]);
    const size = W * H * 3, out: { t: number; frame: Frame }[] = [];
    for (let i = 0; (i + 1) * size <= raw.length; i++) {
      out.push({ t: seg.start + (i * (perSecond > 0 ? every : 0)) / fps, frame: { width: W, height: H, rgb: new Uint8Array(raw.buffer, raw.byteOffset + i * size, size) } });
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Which segment holds `t`. */
export function segmentAt(stream: Stream, t: number): number {
  let lo = 0, hi = stream.segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (stream.segments[mid]!.start <= t + 1e-6) lo = mid; else hi = mid - 1;
  }
  return lo;
}
