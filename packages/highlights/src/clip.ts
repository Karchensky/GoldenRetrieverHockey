import { spawnSync } from "node:child_process";
import { thumbnail, type Thumb } from "./crosscheck.ts";
import { loadLayouts, readOverlay, type Frame, type Layout, type OverlayReading } from "./overlay.ts";
import { parseClock, type Score, type ScoredGoal } from "./locate.ts";

/**
 * A downloaded clip, checked before it goes anywhere near the site.
 *
 * The rink renders the clip from the start and length it was asked for, and
 * the request was made from a location the scoreboard already confirmed — but
 * the file is read again anyway, because a clip of the wrong goal on a box
 * score is exactly the mistake this whole package exists not to make.
 */

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const W = 1280, H = 720;

function run(cmd: string, args: string[], maxBuffer = 1 << 30): Buffer {
  const r = spawnSync(cmd, args, { maxBuffer });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr.toString().slice(-600)}`);
  return r.stdout;
}

export function frameRate(video: string): number {
  const out = run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", video]).toString().trim();
  const [n, d] = out.split("/").map(Number);
  if (!n || !d) throw new Error(`No frame rate for ${video}: "${out}"`);
  return n / d;
}

export type ClipReading = OverlayReading & { t: number };

/**
 * The overlay, `perSecond` times a second, at 1280x720 — what the layouts were
 * measured on. Frames are chosen BY NUMBER, not by timestamp: on the first clip
 * a timestamp-based pick ran some stretches fast and others frozen and read a
 * clock that was not on the screen.
 */
export function readClip(video: string, layout: Layout, perSecond = 2): ClipReading[] {
  return clipFrames(video, perSecond, (t, frame) => ({ t, ...readOverlay(frame, layout) }));
}

/** The clip as thumbnails, two a second, for comparing with the recording — see `crosscheck.ts`. */
export function clipThumbs(video: string, perSecond = 2): Thumb[] {
  return clipFrames(video, perSecond, (t, frame) => ({ t, v: thumbnail(frame) }));
}

function clipFrames<T>(video: string, perSecond: number, each: (t: number, frame: Frame) => T): T[] {
  const fps = frameRate(video);
  const every = Math.max(1, Math.round(fps / perSecond));
  const raw = run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-i", video,
    "-vf", `select='not(mod(n\\,${every}))',scale=${W}:${H}`, "-vsync", "0",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  const size = W * H * 3, out: T[] = [];
  for (let i = 0; (i + 1) * size <= raw.length; i++) {
    out.push(each((i * every) / fps, { width: W, height: H, rgb: new Uint8Array(raw.buffer, raw.byteOffset + i * size, size) }));
  }
  return out;
}

/** Of the known boards, the one this video's clock reads cleanly on — or null, a board not seen before. */
export function chooseLayout(read: (l: Layout) => ClipReading[], layouts = loadLayouts()): { layout: Layout; readings: ClipReading[] } | null {
  let best: { layout: Layout; readings: ClipReading[]; score: number } | null = null;
  for (const layout of layouts) {
    const readings = read(layout);
    const score = readings.filter((r) => r.clock !== null).length / Math.max(1, readings.length);
    if (!best || score > best.score) best = { layout, readings, score };
  }
  // Half the frames with a clock read cleanly, or this is not a board we know.
  return best && best.score >= 0.5 ? { layout: best.layout, readings: best.readings } : null;
}

export type Verdict =
  | { ok: true; goalAt: number; layout: string }
  | { ok: false; problem: string };

/**
 * Is this the goal? The clock must reach the scoresheet's time partway in —
 * from above it, so the build-up is there, with play after it — and the score
 * on the board must be the one either side of this goal, so it is this game at
 * this point and not a practice or a different goal at the same time.
 *
 * The period is not compared by name: the Rink 2 tile labelled the 3rd period
 * "OT2" all through 2026-10-15. The clock and the score are what pin it.
 */
export function verifyClip(
  readings: ClipReading[], goal: ScoredGoal, before: Score, after: Score, layout: string, duration: number,
): Verdict {
  const clock = parseClock(goal.time);
  const timed = readings.filter((r) => r.clock !== null);
  if (timed.length < readings.length / 2) return { ok: false, problem: `the clock reads in only ${timed.length} of ${readings.length} frames` };
  // Two readings in a row at or below the time, after two above it: one misread is not a crossing.
  let goalAt: number | null = null;
  for (let i = 2; i + 1 < timed.length; i++) {
    const [a, b, c, d] = [timed[i - 2]!, timed[i - 1]!, timed[i]!, timed[i + 1]!];
    if (a.clock! > clock && b.clock! > clock && c.clock! <= clock && d.clock! <= clock) { goalAt = c.t; break; }
  }
  if (goalAt === null) {
    const seen = timed.map((r) => r.clockText);
    return { ok: false, problem: `the clock never reaches ${goal.time}; it shows ${seen[0]} to ${seen.at(-1)}` };
  }
  if (goalAt < 3 || goalAt > duration - 3) return { ok: false, problem: `the goal is at ${goalAt.toFixed(1)}s of ${duration.toFixed(1)}s — no build-up or no finish` };
  const scored = readings.filter((r) => r.home !== null && r.away !== null);
  const is = (r: ClipReading, s: Score) => r.home === s.home && r.away === s.away;
  const fits = scored.filter((r) => is(r, before) || is(r, after)).length;
  if (scored.length === 0) return { ok: false, problem: "no score readable on the board" };
  if (fits < scored.length * 0.9) {
    const other = scored.find((r) => !is(r, before) && !is(r, after))!;
    return { ok: false, problem: `the board shows ${other.home}-${other.away}, not ${before.home}-${before.away} or ${after.home}-${after.away}` };
  }
  return { ok: true, goalAt, layout };
}

export function duration(video: string): number {
  return Number(run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString().trim());
}

/**
 * For the box score: 720p at 30 fps, web-optimised so it starts playing
 * before it has finished arriving, and a poster from the build-up — two
 * seconds before the goal, so the still does not give it away.
 */
export function encodeForWeb(video: string, out: { mp4: string; jpg: string }, goalAt: number): void {
  run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", video,
    "-map", "0:v:0", "-map", "0:a:0?", "-vf", `scale=${W}:${H},fps=30`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", out.mp4,
  ]);
  run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", Math.max(0, goalAt - 2).toFixed(2), "-i", out.mp4,
    "-frames:v", "1", "-q:v", "4", out.jpg,
  ]);
}
