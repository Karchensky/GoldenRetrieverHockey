import type { Frame } from "./overlay.ts";

/**
 * Where the camera is looking, and so where the play is. The rink's camera
 * sits beside centre ice and turns to follow the puck; the lines on the ice
 * say which way it points.
 *
 * The blue lines are the only long blue stripes on the ice, and from beside
 * centre ice the two lean opposite ways: the one to the camera's right runs
 * down to the right, the one to its left down to the left. Which one is in the
 * picture, and on which side of the middle, says the zone. Deep in a zone
 * neither is in the picture; how far the camera has turned since it last saw
 * one says how deep. The red line, upright, is centre ice. Both rinks draw
 * their lines faint on video — a few levels bluer or redder than the ice and
 * a little darker — so a line is a long straight run of such pixels, found by
 * a vote (a Hough transform), never a colour alone.
 *
 * Measured on 2026-10-18, against the Rink 1 board's 64 shots on goal at
 * Tioga on 22 July and by eye on two whole games: at a shot the camera was in
 * the shooting side's zone four times in five; 26 of that game's 28 whistles
 * came in a zone, 20 of them straight after a shot, and neither in the neutral
 * zone did. The goal net itself was tried and given up: its red frame is two
 * pixels wide and, under some lights, nearly black.
 */

export const VIEW_W = 320, VIEW_H = 180;
/** Frames a second the camera is followed at: a turn between two is small enough to measure. */
export const VIEW_FPS = 4;

export type Zone = "left" | "neutral" | "right";
/** A line on the ice: `x = x0 + k (y - 120)` in a 320x180 picture. */
export type Line = { k: number; x0: number; votes: number };
/**
 * One frame's view: the camera's turn since the last frame (pixels, the
 * picture moving right is positive), its zone — null where it cannot tell —
 * whether a line was in the picture or the zone carried from the last one, and
 * how deep into the zone the middle of the picture is, in pixels from the blue
 * line (0 outside a zone).
 */
export type View = { t: number; turn: number; zone: Zone | null; seen: boolean; depth: number };

const YC = 120;
/** The row the camera's middle is read at: below the boards, where the play is. */
const MIDDLE_ROW = 90, MIDDLE = VIEW_W / 2;
const KS: number[] = [];
for (let k = -60; k <= 60; k++) KS.push(k / 20);
const X0_MIN = -500, X0_MAX = 820, X0_STEP = 2, NX = (X0_MAX - X0_MIN) / X0_STEP;

/** The blue and the red lines on the ice in a 320x180 picture, strongest first. */
export function iceLines(rgb: Uint8Array, top = 20): { blue: Line[]; red: Line[] } {
  const L = new Float32Array(VIEW_W * VIEW_H);
  for (let i = 0; i < L.length; i++) L[i] = (rgb[i * 3]! + rgb[i * 3 + 1]! + rgb[i * 3 + 2]!) / 3;
  const blue: number[] = [], red: number[] = [];
  const R = 12;
  for (let y = top; y < VIEW_H - 2; y++) {
    const row = y * VIEW_W;
    let sum = 0;
    for (let x = 0; x <= R; x++) sum += L[row + x]!;
    for (let x = 0; x < VIEW_W; x++) {
      if (x > 0) { if (x + R < VIEW_W) sum += L[row + x + R]!; if (x - R - 1 >= 0) sum -= L[row + x - R - 1]!; }
      const n = Math.min(VIEW_W - 1, x + R) - Math.max(0, x - R) + 1;
      const ice = sum / n, v = L[row + x]!;
      // On the ice, a little darker than the ice either side of it — and not a player's dark kit.
      if (ice < 120 || ice - v < 10 || ice - v > 70) continue;
      const i = (row + x) * 3, r = rgb[i]!, g = rgb[i + 1]!, b = rgb[i + 2]!;
      if (b - r >= 4 && b - g >= 2) blue.push(x, y);
      else if (r - g >= 7 && r - b >= 3) red.push(x, y);
    }
  }
  return { blue: vote(blue), red: vote(red) };
}

function vote(pts: number[]): Line[] {
  if (pts.length < 40) return [];
  const acc = new Uint16Array(KS.length * NX);
  for (let p = 0; p < pts.length; p += 2) {
    const x = pts[p]!, y = pts[p + 1]!;
    for (let j = 0; j < KS.length; j++) {
      const b = Math.round((x - KS[j]! * (y - YC) - X0_MIN) / X0_STEP);
      if (b >= 0 && b < NX) acc[j * NX + b]!++;
    }
  }
  // The strongest line, then the strongest not beside it, three at most.
  const out: Line[] = [];
  for (let n = 0; n < 3; n++) {
    let best = -1, most = 0;
    for (let i = 0; i < acc.length; i++) if (acc[i]! > most) { most = acc[i]!; best = i; }
    if (best < 0 || most < 25) break;
    const j = Math.floor(best / NX), b = best % NX;
    out.push({ k: KS[j]!, x0: X0_MIN + b * X0_STEP, votes: most });
    for (let jj = Math.max(0, j - 8); jj <= Math.min(KS.length - 1, j + 8); jj++) {
      for (let bb = Math.max(0, b - 15); bb <= Math.min(NX - 1, b + 15); bb++) acc[jj * NX + bb] = 0;
    }
  }
  return out;
}

/**
 * The zone a picture's lines say, and how deep — or null where they say
 * nothing. A blue line leaning less than this is not one of the two.
 */
const LEAN = 0.6;
export function zoneOf(lines: { blue: Line[]; red: Line[] }): { zone: Zone; depth: number } | null {
  const at = (l: Line) => l.x0 + l.k * (MIDDLE_ROW - YC);
  // A line far weaker than the strongest is something else: the blue foot of the near boards, on Rink 1.
  const top = Math.max(0, ...lines.blue.map((l) => l.votes));
  const real = lines.blue.filter((l) => l.votes >= 40 && l.votes >= top * 0.4);
  const right = real.find((l) => l.k >= LEAN), left = real.find((l) => l.k <= -LEAN);
  if (right && left) return { zone: "neutral", depth: 0 };
  if (right) { const x = at(right); return x < MIDDLE ? { zone: "right", depth: MIDDLE - x } : { zone: "neutral", depth: 0 }; }
  if (left) { const x = at(left); return x > MIDDLE ? { zone: "left", depth: x - MIDDLE } : { zone: "neutral", depth: 0 }; }
  if (lines.red.some((l) => Math.abs(l.k) < 0.8 && l.votes >= 60)) return { zone: "neutral", depth: 0 };
  return null;
}

const gray = (f: Frame) => {
  const g = new Uint8Array(f.width * f.height);
  for (let i = 0; i < g.length; i++) g[i] = (f.rgb[i * 3]! + f.rgb[i * 3 + 1]! + f.rgb[i * 3 + 2]!) / 3;
  return g;
};

/** How far the picture moved between two frames, sideways: the camera's turn. Read on the ice, below the boards. */
export function turnBetween(a: Uint8Array, b: Uint8Array): number {
  let best = 0, least = Infinity;
  for (let dx = -40; dx <= 40; dx++) {
    for (const dy of [-3, 0, 3]) {
      let e = 0, c = 0;
      for (let y = 60; y < 170; y += 3) for (let x = 44; x < VIEW_W - 44; x += 3) { e += Math.abs(a[y * VIEW_W + x]! - b[(y + dy) * VIEW_W + x + dx]!); c++; }
      e /= c;
      if (e < least) { least = e; best = dx; }
    }
  }
  return best;
}

/**
 * Follows the camera through a game, frame by frame in order (320x180, about
 * four a second). Where no line is in the picture the zone carries on from
 * the last one seen, and the depth with the camera's turn.
 */
export function cameraFollower() {
  const views: View[] = [];
  let prev: Uint8Array | null = null, lastT = -Infinity, zone: Zone | null = null, depth = 0;
  return {
    views,
    add(t: number, frame: Frame) {
      const g = gray(frame);
      // A frame more than a second after the last is not the next one: no turn is measured across the gap.
      const turn = prev && t - lastT < 1 ? turnBetween(prev, g) : 0;
      prev = g; lastT = t;
      const said = zoneOf(iceLines(frame.rgb));
      if (said) { zone = said.zone; depth = said.depth; }
      else if (zone === "right") depth -= turn;
      else if (zone === "left") depth += turn;
      else zone = null;
      views.push({ t, turn, zone, seen: said !== null, depth: zone === "left" || zone === "right" ? depth : 0 });
    },
  };
}

/**
 * The zone the play was in over the `seconds` before `t` — the most frames'
 * — or null where the camera could not tell. A whistle in the neutral zone is
 * an offside or an icing, not a chance.
 */
export function zoneBefore(views: View[], t: number, seconds = 3): Zone | null {
  const n = { left: 0, neutral: 0, right: 0 };
  for (const v of views) if (v.zone && v.t >= t - seconds && v.t <= t + 0.5) n[v.zone]++;
  const [zone, count] = (Object.entries(n) as [Zone, number][]).sort((a, b) => b[1] - a[1])[0]!;
  return count > 0 ? zone : null;
}

/**
 * A scoring chance the clock did not stop for. A rush: the camera swung hard
 * across the ice into a zone and was deep in it within seconds — a breakaway,
 * an odd-man rush. Pressure: the camera stayed deep in a zone, the play
 * around the net. `t` is the rush's entry or the pressure's start; the play
 * shown is `lead` before it to `tail` after, and `strength` ranks chances of
 * a kind (the swing's pixels, the pressure's seconds).
 */
export type Chance = { t: number; kind: "rush" | "pressure"; zone: "left" | "right"; strength: number; lead: number; tail: number };

/**
 * Measured on the 22 July game's shots on goal (the shot a second and a half
 * before the board counts it), with the clock running, against 24% of any 13
 * seconds holding one: rushes of a swing of 160 pixels, 19 of 46; spells of
 * pressure of 12 seconds and more, 2 of 6 (and 4 of 9 in a first measure
 * that let stoppages in). Shorter swings did worse than any 13 seconds, so
 * they are not chances. The swing is the most the camera turned one way in
 * the 2 to 5 seconds before the entry: a 3-on-1 on 15 October began with it
 * turning back, a rush the same night crossed the neutral zone in five. A
 * rush's shot came 0 to 9 seconds after the entry; pressure's, a median 7
 * seconds in. The board counts shots on net only: a rush that missed the
 * net, or never got its shot away, is a chance it did not count.
 */
export const RUSH_SWING = 160, RUSH_SECONDS = 5, DEEP = 120, REACH = 3, PRESSURE_SECONDS = 12;
export const RUSH_LEAD = 4, RUSH_TAIL = 9, PRESSURE_LEAD = 2, PRESSURE_TAIL = 12;

export function chances(views: View[], inPlay: (t: number) => boolean): Chance[] {
  const out: Chance[] = [];
  const zoned = (z: Zone | null): z is "left" | "right" => z === "left" || z === "right";
  for (let i = 1; i < views.length; i++) {
    const v = views[i]!, z = v.zone;
    if (!zoned(z) || views[i - 1]!.zone !== "neutral" || !inPlay(v.t)) continue;
    let turned = 0, swing = 0;
    for (let j = i; j >= 0 && views[j]!.t >= v.t - RUSH_SECONDS; j--) {
      turned += views[j]!.turn;
      if (v.t - views[j]!.t >= 2) swing = Math.max(swing, Math.abs(turned));
    }
    if (swing < RUSH_SWING) continue;
    let deep = false;
    for (let j = i; j < views.length && views[j]!.zone === z && views[j]!.t - v.t <= REACH; j++) if (views[j]!.depth >= DEEP) { deep = true; break; }
    if (deep) out.push({ t: v.t, kind: "rush", zone: z, strength: swing, lead: RUSH_LEAD, tail: RUSH_TAIL });
  }
  let start: View | null = null, last: View | null = null;
  const close = () => {
    if (start && last && zoned(start.zone) && last.t - start.t >= PRESSURE_SECONDS) {
      out.push({ t: start.t, kind: "pressure", zone: start.zone, strength: last.t - start.t, lead: PRESSURE_LEAD, tail: PRESSURE_TAIL });
    }
  };
  for (const v of views) {
    const deep = inPlay(v.t) && zoned(v.zone) && v.depth >= DEEP;
    // Out of it for a second and a half at most, in the same zone, is the camera wobbling, not the puck leaving.
    const held = start && last && v.zone === start.zone && v.t - last.t <= 1.5;
    if (held && deep) { last = v; continue; }
    if (held) continue;
    close();
    start = deep ? v : null; last = deep ? v : null;
  }
  close();
  return out.sort((a, b) => a.t - b.t);
}
