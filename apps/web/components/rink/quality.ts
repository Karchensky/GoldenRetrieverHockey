/**
 * What this device can afford, and what its owner asked for.
 *
 * The journey mounts three particle worlds at once. On a laptop that is free; on
 * a phone with four cores and a shared GPU it is the difference between a place
 * you move through and a slideshow. Both numbers are read once at mount — the
 * scenes size their buffers from them and never resize.
 */

/** 1 on a desktop, ~0.45 on a small/low-core device. Multiply particle budgets by it. */
export function qualityScale(): number {
  if (typeof window === "undefined") return 1;
  const cores = navigator.hardwareConcurrency || 8;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 700;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  let s = 1;
  if (narrow || coarse) s *= 0.55;   // phones and tablets
  if (cores <= 4) s *= 0.8;
  // A retina phone already pays 2-3x per pixel; do not also pay it per point.
  if ((window.devicePixelRatio || 1) > 2 && (narrow || coarse)) s *= 0.85;
  return Math.max(0.3, Math.min(1, s));
}

/** True when the reader has asked the system for less movement. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
