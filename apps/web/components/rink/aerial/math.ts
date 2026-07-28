/**
 * AERIAL OPEN — small math + point-cloud shaping helpers, ported verbatim from
 * docs/aerial-tournament/final.html (the captain-approved champion). Do not
 * "improve" numeric behaviour here; the look was tuned against these exact fns.
 */

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** smootherstep between edges a..b (final.html's `smooth`). */
export function smooth(a: number, b: number, x: number): number {
  x = clamp((x - a) / (b - a), 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}
export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
/** 0xRRGGBB -> [r,g,b] in 0..1 */
export function hex(h: number): [number, number, number] {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
export function angLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * clamp(t, 0, 1);
}
export function angDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ---- shaping helpers for the figure point clouds ---------------------------
export type Vec3Arr = [number, number, number] | number[];

export function sampleEllipsoid(
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
  out: Vec3Arr,
): void {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const r = Math.cbrt(Math.random());
  const s = Math.sqrt(1 - u * u);
  out[0] = cx + rx * r * s * Math.cos(th);
  out[1] = cy + ry * r * u;
  out[2] = cz + rz * r * s * Math.sin(th);
}

export function lineSeg(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  jitter: number, out: Vec3Arr,
): void {
  const t = Math.random();
  out[0] = lerp(x0, x1, t) + rand(-jitter, jitter);
  out[1] = lerp(y0, y1, t) + rand(-jitter, jitter);
  out[2] = lerp(z0, z1, t) + rand(-jitter, jitter);
}

export function bez2(p0: Vec3Arr, p1: Vec3Arr, p2: Vec3Arr, t: number, out: Vec3Arr): void {
  const u = 1 - t;
  out[0] = u * u * p0[0]! + 2 * u * t * p1[0]! + t * t * p2[0]!;
  out[1] = u * u * p0[1]! + 2 * u * t * p1[1]! + t * t * p2[1]!;
  out[2] = u * u * p0[2]! + 2 * u * t * p1[2]! + t * t * p2[2]!;
}
