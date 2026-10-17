import type { Frame } from "./overlay.ts";
import { segmentAt, segmentFrames, type Stream } from "./stream.ts";

/**
 * The second check on a downloaded clip, against the recording itself.
 *
 * `verifyClip` reads the clip's own scoreboard. This reads the same stretch of
 * the recording the clip was asked for — the way the player scrubs it, a few
 * segments, nothing kept — and compares the two picture by picture. A clip is
 * published only when
 *
 *   - it IS that stretch of the recording: every frame matches one there, at a
 *     single offset; and
 *   - the goal is where the recording put it: the moment the clip's clock
 *     reaches the goal's time is the moment the search through the recording
 *     found, to within a second and a half.
 *
 * So two separate readings — the recording's, which chose where to clip, and
 * the clip's, which the box score shows — have to agree before a goal gets a
 * clip. Nothing here is stored or published; it is a check, and only of the
 * seconds that were downloaded.
 *
 * Measured on the five clips of 2026-10-07 and 2026-10-15: the right stretch
 * matches at 1.000 on average and no frame below 0.999. The same clips against
 * the recording 12, 30 and 120 seconds either side, and against the other
 * game, never averaged above 0.833, with frames as low as -0.15. The goal
 * moments agreed to within half a second.
 */

const W = 1280, H = 720, TW = 64, TH = 36;

/** What a frame must match the recording by, on average and at worst. */
export const SAME = { mean: 0.97, min: 0.9 };
/** How far the clip's clock may put the goal from where the recording did. */
export const GOAL_TOLERANCE = 1.5;
/** How far from where it was asked for the rink may have cut the clip. Measured: 0 to 0.5 s. */
const SEARCH = 5;

export type Thumb = { t: number; v: Float64Array };

/**
 * A 64x36 grey thumbnail, less its mean, scaled to length 1 — so two
 * encodings of one picture, at different sizes and bitrates, come out alike,
 * and the product of two is their correlation.
 */
export function thumbnail(frame: Frame): Float64Array {
  if (frame.width !== W || frame.height !== H) throw new Error(`thumbnail of a ${frame.width}x${frame.height} frame — ${W}x${H} expected`);
  const out = new Float64Array(TW * TH), bx = W / TW, by = H / TH, rgb = frame.rgb;
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / by) * TW;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      out[row + Math.floor(x / bx)]! += 0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!;
    }
  }
  return normalise(out);
}

export function normalise(v: Float64Array): Float64Array {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let size = 0;
  for (let i = 0; i < v.length; i++) { v[i]! -= mean; size += v[i]! ** 2; }
  size = Math.sqrt(size) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= size;
  return v;
}

const dot = (a: Float64Array, b: Float64Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/** The recording from `start` to `start + seconds`, with a segment to spare each side, two thumbnails a second. */
export async function recordingThumbs(stream: Stream, start: number, seconds: number): Promise<Thumb[]> {
  const out: Thumb[] = [];
  for (let i = segmentAt(stream, start - SEARCH - 1); i <= segmentAt(stream, start + seconds + SEARCH + 1); i++) {
    for (const { t, frame } of await segmentFrames(stream, i, 2)) out.push({ t, v: thumbnail(frame) });
  }
  return out;
}

export type Alignment = { offset: number; mean: number; min: number };

/**
 * Where in the recording the clip is: the offset from `start`, within a few
 * seconds either way, at which its frames match the recording's best — and how
 * well, on average and at worst. Null when the recording read does not cover it.
 */
export function align(clip: Thumb[], recording: Thumb[], start: number): Alignment | null {
  if (!clip.length || !recording.length) return null;
  const nearest = (t: number) => {
    let best: Thumb | null = null;
    for (const r of recording) if (Math.abs(r.t - t) < 0.3 && (!best || Math.abs(r.t - t) < Math.abs(best.t - t))) best = r;
    return best;
  };
  let best: Alignment | null = null;
  for (let offset = -SEARCH; offset <= SEARCH; offset += 0.5) {
    const scores: number[] = [];
    for (const c of clip) {
      const r = nearest(start + c.t + offset);
      if (r) scores.push(dot(c.v, r.v));
    }
    // Most of the clip has to be in what was read, or a small overlap could look like a match.
    if (scores.length < clip.length * 0.9) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (!best || mean > best.mean) best = { offset, mean, min: Math.min(...scores) };
  }
  return best;
}

export type CrossCheck = { ok: true; offset: number } | { ok: false; problem: string };

/**
 * Does the downloaded clip agree with the recording? `goals` pairs, for each
 * goal in it, where the search through the recording found it (`at`, seconds
 * into the recording) with where the clip's own clock reaches its time
 * (`goalAt`, seconds into the clip).
 */
export function crossCheck(clip: Thumb[], recording: Thumb[], start: number, goals: { label: string; at: number; goalAt: number }[]): CrossCheck {
  const a = align(clip, recording, start);
  if (!a) return { ok: false, problem: "the recording around the clip could not be read to compare it with" };
  if (a.mean < SAME.mean || a.min < SAME.min) {
    return { ok: false, problem: `the clip does not match the recording where it was asked for (similarity ${a.mean.toFixed(3)}, worst frame ${a.min.toFixed(3)})` };
  }
  for (const g of goals) {
    const expected = g.at - start - a.offset;
    if (Math.abs(g.goalAt - expected) > GOAL_TOLERANCE) {
      return { ok: false, problem: `the clip's clock reaches ${g.label} at ${g.goalAt.toFixed(1)}s, but the recording put that goal at ${expected.toFixed(1)}s` };
    }
  }
  return { ok: true, offset: a.offset };
}
