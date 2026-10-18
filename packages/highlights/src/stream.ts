import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Frame } from "./overlay.ts";

/**
 * The rink's recording, read the way its player scrubs it: a segment at a
 * time, a frame or two from each, and the segment gone straight after. Nothing
 * is kept but what the scoreboard said — except by `cutClip`, the backup to the
 * rink's downloads — and the address is never printed.
 */

export type Segment = { uri: string; start: number; duration: number };
export type Stream = {
  segments: Segment[];
  /** The playlist says it is complete. Both rinks' recordings, once posted, do; one still growing is not searched. */
  ended: boolean;
  /** Which of the recording's variants this is: "1920x1080, 6.0 Mb/s", or "the only one". */
  variant: string;
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

/**
 * Every segment of one variant, with where it starts: the lightest for reading
 * the board — 720p is what the boards were measured on — or the best, for a
 * clip cut from the recording.
 */
export async function openStream(streamUrl: string, pick: "lightest" | "best" = "lightest"): Promise<Stream> {
  const master = await text(streamUrl);
  const variants: { bandwidth: number; resolution: string | undefined; url: string }[] = [];
  const lines = master.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXT-X-STREAM-INF:.*BANDWIDTH=(\d+)/.exec(lines[i]!);
    if (m && lines[i + 1] && !lines[i + 1]!.startsWith("#")) {
      variants.push({ bandwidth: Number(m[1]), resolution: /RESOLUTION=(\d+x\d+)/.exec(lines[i]!)?.[1], url: new URL(lines[i + 1]!, streamUrl).href });
    }
  }
  variants.sort((a, b) => (pick === "best" ? b.bandwidth - a.bandwidth : a.bandwidth - b.bandwidth));
  const chosen = variants[0];
  const playlistUrl = chosen?.url ?? streamUrl;
  const segments: Segment[] = [];
  const playlist = await text(playlistUrl);
  let at = 0, duration = 0;
  for (const line of playlist.split("\n").map((l) => l.trim())) {
    const m = /^#EXTINF:([\d.]+)/.exec(line);
    if (m) duration = Number(m[1]);
    else if (line && !line.startsWith("#")) { segments.push({ uri: new URL(line, playlistUrl).href, start: at, duration }); at += duration; }
  }
  if (!segments.length) throw new Error("recording playlist: no segments");
  const variant = chosen ? `${chosen.resolution ?? "unknown size"}, ${(chosen.bandwidth / 1e6).toFixed(1)} Mb/s, ${pick} of ${variants.length}` : "the only one";
  return { segments, ended: /^#EXT-X-ENDLIST/m.test(playlist), variant, fetched: { segments: 0, bytes: 0 } };
}

/**
 * For looking into games by hand: with GRH_SEGMENT_CACHE set to a directory,
 * every segment read is kept there, named by a hash of its address, so a
 * second look at a game fetches nothing. Never set in the workflow.
 */
const CACHE = process.env.GRH_SEGMENT_CACHE;

/** The segment read last, per recording: the recap reads each one twice over, for the board and for the camera. */
const lastRead = new WeakMap<Stream, { index: number; bytes: Buffer }>();

async function segmentBytes(stream: Stream, index: number): Promise<Buffer> {
  const held = lastRead.get(stream);
  if (held?.index === index) return held.bytes;
  const bytes = await fetchSegment(stream, index);
  lastRead.set(stream, { index, bytes });
  return bytes;
}

async function fetchSegment(stream: Stream, index: number): Promise<Buffer> {
  const uri = stream.segments[index]!.uri;
  const cached = CACHE && path.join(CACHE, crypto.createHash("sha256").update(uri.split("?")[0]!).digest("hex").slice(0, 32) + ".ts");
  if (cached && fs.existsSync(cached)) return fs.readFileSync(cached);
  // One stalled segment once cost a whole game's search: it is asked for twice before that.
  const get = async () => {
    const r = await fetch(uri, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!r.ok) throw new Error(`recording segment ${index}: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const bytes = await get().catch(get);
  stream.fetched.segments++;
  stream.fetched.bytes += bytes.length;
  if (cached) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cached, bytes); }
  return bytes;
}

function run(cmd: string, args: string[]): Buffer {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr.toString().slice(-400)}`);
  return r.stdout;
}

/**
 * Frames from one segment, `perSecond` a second — or its first frame only, for
 * 0 — picked by frame number and scaled to 1280x720, or to `size`. `t` is
 * seconds into the recording, on the playlist's own clock, which is the clock
 * the rink's clips are cut on: measured on 2026-10-15, a clip asked for at
 * 3600s began within about a second of the frame this read at 3600s.
 */
export async function segmentFrames(stream: Stream, index: number, perSecond: number, size: [number, number] = [W, H]): Promise<{ t: number; frame: Frame }[]> {
  const [w, h] = size;
  const seg = stream.segments[index];
  if (!seg) return [];
  const bytes = await segmentBytes(stream, index);
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
      "-vf", `select='not(mod(n\\,${every}))',scale=${w}:${h}`, "-vsync", "0", ...(perSecond > 0 ? [] : ["-frames:v", "1"]),
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]);
    const one = w * h * 3, out: { t: number; frame: Frame }[] = [];
    for (let i = 0; (i + 1) * one <= raw.length; i++) {
      out.push({ t: seg.start + (i * (perSecond > 0 ? every : 0)) / fps, frame: { width: w, height: h, rgb: new Uint8Array(raw.buffer, raw.byteOffset + i * one, one) } });
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

/**
 * The backup to the rink's downloads: `seconds` of the recording from `start`,
 * cut to `out` without asking the rink for anything, so it spends no download.
 * The segments that hold it are joined as they came — MPEG-TS joins end to
 * end — and cut on the playlist's clock, the one `segmentFrames` reads and the
 * rink cuts its own clips on. Encoded near-losslessly: `encodeForWeb` encodes
 * it again for the site, after the same two checks a download gets.
 *
 * ffmpeg is only ever given local files, so nothing it prints can carry the
 * recording's address.
 */
export async function cutClip(stream: Stream, start: number, seconds: number, out: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grh-cut-"));
  try {
    const joined = path.join(dir, "cut.ts");
    const offset = await joinSegments(stream, start, seconds, joined);
    run(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      // Seeking on the output, not the input: an input seek into joined segments kept their
      // start offset and lost the first 1.7 s of a test cut. Decoding a few segments to throw some away is cheap.
      "-i", joined, "-ss", offset.toFixed(3), "-t", seconds.toFixed(3),
      "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The segments holding `seconds` of the recording from `start`, joined end to
 * end into `file` as they came, and where in that file `start` falls — for a
 * cut made in one pass with others, as the recap's are. Trim from the
 * returned offset on the file's own timeline, never by an input seek.
 */
export async function joinSegments(stream: Stream, start: number, seconds: number, file: string): Promise<number> {
  const first = segmentAt(stream, start), last = segmentAt(stream, start + seconds);
  const end = stream.segments[last]!.start + stream.segments[last]!.duration;
  if (start < 0 || start + seconds > end + 0.5) throw new Error(`the recording does not reach ${start}s +${seconds}s`);
  fs.rmSync(file, { force: true });
  for (let i = first; i <= last; i++) fs.appendFileSync(file, await segmentBytes(stream, i));
  return start - stream.segments[first]!.start;
}
