/**
 * THE FAR SHORE — how the approved frame survives a viewport it was not drawn
 * for.
 *
 * `PerspectiveCamera.fov` IS THE VERTICAL ONE. Every vertical relationship in
 * this picture therefore holds on any window without being asked: the horizon
 * at 0.58 of frame, the crest heights, the doors' 12vh above the ridge, and the
 * retriever's height in pixels. What a tall narrow viewport does instead is
 * close the HORIZONTAL field around the lens axis — 57.7 degrees wide at
 * 1440x900, and 21.9 on an iPhone SE. The dog stands 13.3 degrees off that
 * axis, so on every phone he was outside the picture entirely: measured
 * -70..-38 px on a 375-wide frame, -148..-103 on a Pixel 8. The sun, the col,
 * the gold column and the snowfall all survive the crop, so the page looked
 * finished with its subject missing, which is why nobody caught it.
 *
 * WIDENING THE LENS IS THE WRONG FIX, and the arithmetic says so plainly.
 * Locking the horizontal field instead of the vertical needs a 91-degree
 * VERTICAL fov at 0.56 aspect to hold him where the landscape frame holds him,
 * and at that fov he is 29 pixels tall. An animal too small to read as a golden
 * retriever is a worse failure than an absent one — and the same move drops the
 * horizon to the middle of the frame, flattens three ranges of mountains into a
 * strip and unpicks the doors' fixed relationship to the crests, all of which
 * are the composition the captain approved.
 *
 * So the LENS NEVER CHANGES AND THE CAMERA MOVES. One scale does it:
 *
 *     k = min(1, aspect / REF_ASPECT)
 *
 * is the frame's width as a fraction of the width it was composed at, and every
 * LATERAL quantity is multiplied by it. The camera stands (1 - k) of the way
 * from the origin toward the dog's own line, which puts him at the same NDC x
 * the landscape frame puts him at — 0.28 of the way across, on every viewport
 * there is. Its lateral drift and its yaw drift are damped by the same k, so he
 * also travels the same FRACTION of the frame he travels on a laptop (3 per
 * cent of the width, against 8.5 undamped) and the sun and the col sweep by the
 * share of the frame the captain signed off rather than by five times it.
 * Nothing vertical is touched: the pitch drift, the eye height and its bob are
 * the authored numbers on every device.
 *
 * At the reference aspect k is exactly 1, every term below reduces to the
 * authored one and the landscape frame is untouched to the bit.
 *
 * Why moving the camera and not the dog: everything in this world except the
 * mountains is drawn relative to the lens — the glitter column runs from the
 * sun to the camera, the mist bands and the snow box ride with it, the
 * materialisation ring opens under it — so a lateral camera move re-anchors the
 * whole near field as one piece and leaves the ranges, which are 1.2 to 14.5 km
 * out, shifted by six hundredths of a degree. Moving the subject instead would
 * slide him across a column that stayed put.
 */
import { DOG_POS } from "./constants";

/**
 * The aspect the frame was composed and measured at — 1440x900, the window
 * every judgement on this page was made in.
 */
export const REF_ASPECT = 1.6;

/** The frame's width as a fraction of the authored width. 1 on a wide window. */
export function lateralScale(aspect: number): number {
  if (!(aspect > 0)) return 1;
  return Math.min(1, aspect / REF_ASPECT);
}

/**
 * Where the lens stands, before the drift. Zero at and above the reference
 * aspect; on a narrower frame it walks toward the dog's line so his place in
 * the frame is the one that was approved.
 */
export function frameOffsetX(aspect: number): number {
  return DOG_POS.x * (1 - lateralScale(aspect));
}
