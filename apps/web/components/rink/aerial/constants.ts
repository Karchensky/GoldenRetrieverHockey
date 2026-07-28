/**
 * AERIAL OPEN — world constants, palette and pond/drift geometry, ported
 * verbatim from docs/aerial-tournament/final.html. These numbers ARE the look;
 * keep them byte-for-byte unless the captain re-judges the tournament.
 */
import * as THREE from "three";
import { hex, smooth } from "./math";

// ---- assembly timing -------------------------------------------------------
export const ASM_START = 0.85;
export const ASM_END = 5.0;
export const STAGGER = 0.45;

// ---- world dimensions ------------------------------------------------------
export const POND_R = 140;
export const GROUND_R = 720;
export const CHAOS_C = new THREE.Vector3(0, 56, 0);

// ---- irregular pond edge ---------------------------------------------------
const PW = [0.80, 2.35, 5.10];
export function pondR(ang: number): number {
  return POND_R * (1
    + 0.110 * Math.sin(3 * ang + PW[0]!)
    + 0.062 * Math.sin(5 * ang + PW[1]!)
    + 0.034 * Math.sin(8 * ang + PW[2]!)
    + 0.020 * Math.sin(2 * ang + 1.10));
}

/** Reusable clamp-to-pond result (no allocation per call). */
export type IceClamp = { x: number; z: number; hit: boolean };
const _cl: IceClamp = { x: 0, z: 0, hit: false };
export function clampIce(x: number, z: number, margin?: number): IceClamp {
  const ang = Math.atan2(z, x);
  const lim = pondR(ang) - (margin === undefined ? 6 : margin);
  const r = Math.hypot(x, z);
  if (r > lim) { const s = lim / (r || 1); _cl.x = x * s; _cl.z = z * s; _cl.hit = true; }
  else { _cl.x = x; _cl.z = z; _cl.hit = false; }
  return _cl;
}

// ---- dawn sun --------------------------------------------------------------
export const SUN_AZ = new THREE.Vector2(0.34, -0.94).normalize();
export const sunDir3 = new THREE.Vector3(SUN_AZ.x, 0.165, SUN_AZ.y).normalize();

// ---- palette ---------------------------------------------------------------
export const PAL = {
  iceA: hex(0x6fa6d8), iceB: hex(0xa9d3f2), spark: hex(0xeaf6ff),
  bank: hex(0xdcebff), hill: hex(0x9ab9d8),
  mtnLo: hex(0x6d89ab), mtnHi: hex(0xe6f0ff),
  dawn: hex(0xffcf9b),
  dogGold: hex(0xe89540), dogLight: hex(0xffc27a), dogCream: hex(0xffe6bc), dogEar: hex(0xc9772e),
  ball: hex(0xcaf24a), ballHot: hex(0xeeffb0),
  teamA: hex(0x1a9ade), teamAHot: hex(0x7fd4ff),
  teamB: hex(0x7e50f0), teamBHot: hex(0xc4b0ff),
  neutral: hex(0xd9e6f2),
  gear: hex(0xcfe2f2), headSkin: hex(0xffd9a8),
  puck: hex(0xdfefff),
  watch: hex(0xa7c0da),
  snow: hex(0xdbeaff),
} as const;

// ---- BIG SNOW DRIFTS — sculpted ring around the shore ----------------------
export const DRIFT_W = 94;
export function driftLobes(a: number): number {
  return Math.max(0.06, 0.62 + 0.38 * Math.sin(a * 3.1 + 1.4) + 0.22 * Math.sin(a * 5.3 + 0.6)
    + 0.12 * Math.sin(a * 9.1 + 3.1) + 0.09 * Math.sin(a * 13.7 + 1.7) + 0.06 * Math.sin(a * 21.3 + 4.4));
}
/** t in 0..1 across the ring width. */
export function driftH(a: number, t: number): number {
  const prof = smooth(0.0, 0.34, t) * smooth(1.0, 0.5, t);
  const backB = 0.5 - 0.5 * Math.sin(a);
  const hMax = 4.5 + 9.5 * backB;
  // big smooth lobes only — fine ripples read as artifacts at this grazing angle
  return prof * driftLobes(a) * hMax;
}

// ---- falling snow column ---------------------------------------------------
export const SNOW_H = 340;
export const SNOW_R = 240;

// ---- goals -----------------------------------------------------------------
export const netAx = -pondR(Math.PI) + 26;
export const netBx = pondR(0) - 26;
export const GOAL_HW = 3.6;
export const GOAL_H = 4.6;
export const GOAL_D = 3.8;
