import { test } from "node:test";
import assert from "node:assert/strict";
import { overtimeOf } from "../src/recap.ts";
import { cameraFollower, chances, DEEP, iceLines, RUSH_SWING, VIEW_H, VIEW_W, zoneBefore, zoneOf, type View } from "../src/view.ts";

/**
 * Where the camera looks, on pictures drawn here the way the rink's look: pale
 * grey ice, its lines a few levels darker and bluer — or redder — than it.
 */

type Stripe = { k: number; at90: number; rgb: [number, number, number]; from?: number };
function picture(stripes: Stripe[], ice: (x: number, y: number) => number = () => 165): Uint8Array {
  const px = new Uint8Array(VIEW_W * VIEW_H * 3);
  for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) { const i = (y * VIEW_W + x) * 3, v = ice(x, y); px[i] = v; px[i + 1] = v; px[i + 2] = v; }
  for (const s of stripes) {
    for (let y = s.from ?? 20; y < VIEW_H; y++) {
      const c = Math.round(s.at90 + s.k * (y - 90));
      for (let x = c - 1; x <= c + 1; x++) if (x >= 0 && x < VIEW_W) { const i = (y * VIEW_W + x) * 3; px[i] = s.rgb[0]; px[i + 1] = s.rgb[1]; px[i + 2] = s.rgb[2]; }
    }
  }
  return px;
}
const BLUE: [number, number, number] = [138, 140, 146], RED: [number, number, number] = [160, 140, 144];

test("a blue line leaning down to the right is the right one: the middle past it is the right zone, short of it the neutral zone", () => {
  // The vote places a line to within a pixel or two.
  const near = (z: ReturnType<typeof zoneOf>, zone: string, depth: number) => { assert.equal(z?.zone, zone); assert.ok(Math.abs(z!.depth - depth) <= 2, `depth ${z!.depth}`); };
  near(zoneOf(iceLines(picture([{ k: 1.5, at90: 100, rgb: BLUE }]))), "right", 60);
  assert.equal(zoneOf(iceLines(picture([{ k: 1.5, at90: 220, rgb: BLUE }])))?.zone, "neutral");
  near(zoneOf(iceLines(picture([{ k: -1.5, at90: 230, rgb: BLUE }]))), "left", 70);
  assert.equal(zoneOf(iceLines(picture([{ k: -1.5, at90: 100, rgb: BLUE }])))?.zone, "neutral");
  // Both blue lines in the picture is centre ice; so is the red line, standing upright.
  assert.equal(zoneOf(iceLines(picture([{ k: 1.2, at90: 260, rgb: BLUE }, { k: -1.2, at90: 60, rgb: BLUE }])))?.zone, "neutral");
  assert.equal(zoneOf(iceLines(picture([{ k: 0.1, at90: 160, rgb: RED }])))?.zone, "neutral");
  // Bare ice says nothing.
  assert.equal(zoneOf(iceLines(picture([]))), null);
});

test("a short blue run far weaker than the line, as the foot of Rink 1's near boards is, is not a second blue line", () => {
  const z = zoneOf(iceLines(picture([{ k: 1.3, at90: 80, rgb: BLUE }, { k: -2.6, at90: 330, rgb: BLUE, from: 150 }])));
  assert.equal(z?.zone, "right");
});

test("with no line in the picture, the zone carries on, and the depth with the camera's turn", () => {
  // Ice with grain, so a turn can be measured: the same grain moved left is the camera turned right.
  const grain = (x: number, y: number) => 140 + ((Math.imul(x * 7919 + y * 104729, 2654435761) >>> 24) % 40);
  const camera = cameraFollower();
  const frame = (rgb: Uint8Array) => ({ width: VIEW_W, height: VIEW_H, rgb });
  camera.add(0, frame(picture([{ k: 1.5, at90: 100, rgb: BLUE }], grain)));
  camera.add(0.25, frame(picture([], (x, y) => grain(x + 10, y))));
  camera.add(0.5, frame(picture([], (x, y) => grain(x + 22, y))));
  const [a, b, c] = camera.views;
  assert.deepEqual([a!.zone, a!.seen], ["right", true]);
  assert.deepEqual([b!.zone, b!.seen, b!.turn, b!.depth - a!.depth], ["right", false, -10, 10]);
  assert.deepEqual([c!.zone, c!.turn, c!.depth - a!.depth], ["right", -12, 22]);
  // Seconds missing between two frames: no turn is measured across them.
  camera.add(5, frame(picture([], (x, y) => grain(x + 40, y))));
  assert.equal(camera.views[3]!.turn, 0);
});

const views = (spec: [number, View["zone"], number, number][]): View[] => spec.map(([t, zone, turn, depth]) => ({ t, zone, turn, depth, seen: true }));
/** Frames four a second from `from` for `seconds`, each the same. */
const run = (from: number, seconds: number, zone: View["zone"], turn: number, depth: number) =>
  Array.from({ length: seconds * 4 }, (_, i) => [from + i / 4, zone, turn, depth] as [number, View["zone"], number, number]);

test("a rush is a hard swing into a zone, deep in it within seconds; a slow one, or one that stays shallow, is not", () => {
  const always = () => true;
  const swing = RUSH_SWING / 16 + 1;   // per frame, over four seconds
  const rush = views([...run(0, 4, "neutral", -swing, 0), ...run(4, 1, "right", -swing, 60), ...run(5, 3, "right", 0, DEEP + 10), ...run(8, 3, "neutral", 0, 0)]);
  const found = chances(rush, always);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0]!.kind, found[0]!.zone, found[0]!.t], ["rush", "right", 4]);
  assert.ok(found[0]!.strength >= RUSH_SWING);
  // Half the swing: a line change, a dump-in.
  assert.equal(chances(views([...run(0, 4, "neutral", -swing / 2, 0), ...run(4, 4, "right", 0, DEEP + 10)]), always).length, 0);
  // Into the zone hard, but never deep: the puck went to the boards, not the net.
  assert.equal(chances(views([...run(0, 4, "neutral", -swing, 0), ...run(4, 4, "right", 0, DEEP - 40)]), always).length, 0);
  // With the clock stopped it is no play at all.
  assert.equal(chances(rush, () => false).length, 0);
});

test("pressure is the camera deep in a zone for twelve seconds and more, a frame or two out not breaking it", () => {
  const always = () => true;
  const long = views([...run(0, 2, "neutral", 0, 0), ...run(2, 7, "left", 0, DEEP + 20), [9, "left", 0, DEEP - 50], ...run(9.25, 7, "left", 0, DEEP + 20), ...run(16.25, 2, "neutral", 0, 0)]);
  const found = chances(long, always);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0]!.kind, found[0]!.zone, found[0]!.t], ["pressure", "left", 2]);
  assert.ok(found[0]!.strength >= 12);
  assert.equal(chances(views([...run(0, 8, "left", 0, DEEP + 20), ...run(8, 2, "neutral", 0, 0)]), always).length, 0);
});

test("a whistle's zone is the one the play was in over the seconds before it", () => {
  const v = views([...run(0, 4, "right", 0, 150), ...run(4, 3, "neutral", 0, 0), [7, null, 0, 0]]);
  assert.equal(zoneBefore(v, 3.9), "right");
  assert.equal(zoneBefore(v, 7), "neutral");
  assert.equal(zoneBefore(v, 60), null);
});

test("an overtime no goal was scored in is the first run of the clock within six minutes of the 3rd's end", () => {
  const third = { from: 4000, to: 5000, first: 1080, last: 0, samples: 160, period: "3rd" };
  const ticks = (from: number, to: number, clock: number) => Array.from({ length: Math.floor((to - from) / 6) + 1 }, (_, i) => ({ t: from + i * 6, clock: clock - i * 6 }));
  assert.deepEqual(overtimeOf([...ticks(5000, 5100, 0).map((r) => ({ ...r, clock: 0 })), ...ticks(5200, 5400, 420)], third)?.from, 5200);
  assert.equal(overtimeOf([...ticks(5000, 5100, 0).map((r) => ({ ...r, clock: 0 })), ...ticks(5400, 5600, 420)], third), null);
  // A ten-minute warm-up countdown is not an overtime.
  assert.equal(overtimeOf(ticks(5200, 5500, 840), third), null);
});
