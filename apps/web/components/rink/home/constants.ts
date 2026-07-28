/**
 * THE FAR SHORE — constants, CPU noise and the shared GLSL preamble.
 *
 * Ported verbatim from docs/openers/o-2.html (the opener tournament winner).
 * Everything is metres, and every colour is LINEAR and literal — the renderer
 * runs NoToneMapping / LinearSRGB and the composite in post.ts applies the one
 * exposure and the one filmic curve. Mapping twice lifts the blacks to grey and
 * costs exactly the near-black background this page is built on.
 *
 * Nothing in this file may be re-tuned. The grade, the sun bearing, the col,
 * the glitter column, the mist band and the point sampling are the measured,
 * captain-picked frame.
 */
import * as THREE from "three";

/* ---------------------------------------------------------------- constants */
export const SUN_AZ = 0.045;                  // radians; a touch off the lens axis
export const SUN_EL = (3.35 * Math.PI) / 180; // just cresting the col
export const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_AZ) * Math.cos(SUN_EL),
  Math.sin(SUN_EL),
  -Math.cos(SUN_AZ) * Math.cos(SUN_EL),
).normalize();

/* The grade is near-black on purpose and every value here is LINEAR, before a
   1.24 exposure and an ACES curve. As a rule of thumb at this exposure a linear
   luma of 0.003 lands near 20/255 and 0.09 near 90/255, so a tenth here is a
   large move on screen. */
export const SUN_COL = new THREE.Color(1.0, 0.6, 0.222); // dawn disc
/* The SKY is the lightest thing in the frame and the LAND is the near-black —
   which is both what a backlit dawn actually does and what puts the dark mass
   of the picture low, where it belongs. */
export const SKY_ZEN = new THREE.Color(0.0021, 0.0044, 0.0125);
export const SKY_HOR = new THREE.Color(0.009, 0.018, 0.039);
export const SKY_WARM = new THREE.Color(0.62, 0.255, 0.08);
export const HAZE = new THREE.Color(0.0105, 0.0145, 0.0225);

export const EYE_Y = 1.62;
export const CAM_FOV = 38;
export const CAM_NEAR = 0.32;
export const CAM_FAR = 34000;
export const CAM_PITCH = (3.2 * Math.PI) / 180; // nose up: pushes the horizon to 0.58 of frame

export const DOG_H = 0.735;                       // ground to the top of the skull, metres
export const DOG_POS = new THREE.Vector3(-1.98, 0, -8.4);
export const DOG_YAW = (-104 * Math.PI) / 180;    // mesh forward is -X; this turns him up-lake
export const DOG_N = 30000;

/** The materialisation runs 3.4s from mount; the doors arrive at 2.6s. */
export const REVEAL_SECONDS = 3.4;
export const DOORS_AT = 2.6;

/* ------------------------------------------------------------------ helpers */
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* value noise on the CPU, for terrain — same shape as the GLSL one below */
export function h21(x: number, y: number): number {
  let px = (x * 123.34) % 1;
  let py = (y * 456.21) % 1;
  if (px < 0) px += 1;
  if (py < 0) py += 1;
  const d = px * px + py * py + px * 34.56 + py * 34.56;
  px = (px + d) % 1;
  py = (py + d) % 1;
  return (px * py * 1.0) % 1;
}
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy);
  const b = h21(ix + 1, iy);
  const c = h21(ix, iy + 1);
  const d = h21(ix + 1, iy + 1);
  return a + (b - a) * ux + (c + (d - c) * ux - (a + (b - a) * ux)) * uy;
}
export function ridged(x: number, y: number, oct: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    let n = vnoise(x * f + i * 31.7, y * f + i * 17.1) * 2 - 1;
    n = 1 - Math.abs(n);
    n *= n;
    s += n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return s / norm;
}

/* ------------------------------------------------------ shared GLSL preamble */
export const GLSL_NOISE = /* glsl */ `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 34.56); return fract(p.x * p.y); }
  float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  vec3 noised(vec2 x){
    vec2 i = floor(x), f = fract(x);
    vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
    vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
    float a = h21(i), b = h21(i+vec2(1.0,0.0)), c = h21(i+vec2(0.0,1.0)), d = h21(i+vec2(1.0,1.0));
    float k1 = b-a, k2 = c-a, k3 = a-b-c+d;
    return vec3(a + k1*u.x + k2*u.y + k3*u.x*u.y,
                du.x*(k1 + k3*u.y),
                du.y*(k2 + k3*u.x));
  }
  float vnoise(vec2 x){ return noised(x).x; }
  float fbm(vec2 p, int oct){
    float s = 0.0, amp = 0.5, norm = 0.0;
    vec2 q = p;
    for (int i = 0; i < 7; i++){
      if (i >= oct) break;
      s += amp * vnoise(q); norm += amp;
      q = q * 2.03 + vec2(31.7, 17.1); amp *= 0.5;
    }
    return s / max(norm, 1e-4);
  }
`;
