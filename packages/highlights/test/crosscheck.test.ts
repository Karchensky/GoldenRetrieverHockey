import { test } from "node:test";
import assert from "node:assert/strict";
import { align, crossCheck, normalise, SAME, type Thumb } from "../src/crosscheck.ts";

/**
 * A recording in miniature: a picture that drifts, two thumbnails a second, the
 * way a broadcast camera follows play. A clip is a stretch of it with a little
 * noise on top — another encoding of the same frames.
 */
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
}
const SIZE = 64 * 36;
function recording(seconds: number, seed = 1): Thumb[] {
  const r = random(seed), out: Thumb[] = [];
  let v = new Float64Array(SIZE).map(() => r());
  for (let t = 0; t <= seconds; t += 0.5) {
    v = v.map((x) => 0.9 * x + 0.3 * r());
    out.push({ t, v: normalise(new Float64Array(v)) });
  }
  return out;
}
function cut(rec: Thumb[], from: number, seconds: number, noise = 0.005, seed = 9): Thumb[] {
  const r = random(seed);
  return rec.filter((x) => x.t >= from && x.t < from + seconds)
    .map((x) => ({ t: x.t - from, v: normalise(x.v.map((y) => y + noise * r())) }));
}

const rec = recording(200);

test("a clip is found where it was cut from, to the half second", () => {
  // Asked for at 100, cut by the rink half a second later — as it was on 2026-10-15.
  const a = align(cut(rec, 100.5, 23), rec, 100)!;
  assert.equal(a.offset, 0.5);
  assert.ok(a.mean >= SAME.mean && a.min >= SAME.min, `${a.mean} ${a.min}`);
});

test("the clip and the recording agree on the goal: published", () => {
  const v = crossCheck(cut(rec, 100.5, 23), rec, 100, [{ label: "1st 06:42", at: 115, goalAt: 14.5 }]);
  assert.deepEqual(v, { ok: true, offset: 0.5 });
});

test("a clip of another stretch, or another game, is refused", () => {
  const elsewhere = crossCheck(cut(rec, 140, 23), rec, 100, [{ label: "1st 06:42", at: 115, goalAt: 15 }]);
  assert.match((elsewhere as { problem: string }).problem, /does not match the recording/);
  const another = crossCheck(cut(recording(200, 7), 100, 23), rec, 100, [{ label: "1st 06:42", at: 115, goalAt: 15 }]);
  assert.match((another as { problem: string }).problem, /does not match the recording/);
});

test("the right stretch with its clock somewhere else is refused", () => {
  // The clip IS the recording at 100, but its own clock reaches 06:42 four seconds from where the recording did.
  const v = crossCheck(cut(rec, 100, 23), rec, 100, [{ label: "1st 06:42", at: 115, goalAt: 19 }]);
  assert.match((v as { problem: string }).problem, /reaches 1st 06:42 at 19\.0s, but the recording put that goal at 15\.0s/);
});

test("a recording read that does not cover the clip is no answer", () => {
  const v = crossCheck(cut(rec, 100, 23), rec.filter((x) => x.t < 90), 100, []);
  assert.match((v as { problem: string }).problem, /could not be read/);
});
