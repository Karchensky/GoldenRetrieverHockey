/**
 * THE FAR SHORE — what a phone is asked to pay for the hero.
 *
 * This page is the one place on the site where the world IS the content, so
 * unlike `ambient/budget.ts` — which refuses to mount at all on a touch device,
 * because behind a statistics table the GPU belongs to the reader — nothing
 * here is ever withheld. The dog, the three ranges, the col, the column of
 * gold, the mist, the snow and the whole seven-pass composite run on every
 * device. What changes is the price.
 *
 * It was measured, and it was the same everywhere: 646,660 vertices, 18 draw
 * calls and 8 framebuffer binds per frame on an iPhone SE, an iPhone 15 Pro and
 * an iPad alike, with 190,000 snow points and 30,000 dog points compiled in as
 * constants and `dpr={[1, 2]}` as the only concession. `qualityScale()` — this
 * project's device budget, and the one `ambient/budget.ts` defers to — had
 * never been called from this page.
 *
 * THE FIRST LEVER IS RESOLUTION, NOT COUNT. The frame is seven offscreen
 * passes over an ice shader carrying some thirty octaves of noise, so almost
 * everything this page costs a phone is fragments, and a phone at dpr 2 is
 * paying four times a laptop's price per CSS pixel for them. Coming down to
 * 1.5 removes 44 per cent of every fragment in the frame and leaves the
 * geometry, the grade and the composition untouched.
 *
 * And it is SAFE HERE for a reason worth writing down: point sizes on this page
 * are `radius / distance * uH`, where uH is the drawing buffer's HEIGHT, so a
 * phone at dpr 1.5 still draws every flake and every dog point LARGER in buffer
 * pixels than the approved 1440x900 laptop frame does — 1278 rows against 900.
 * Lowering dpr therefore cannot push flakes onto the `gl_PointSize` floor that
 * the laptop frame does not already sit on, and the starfield this project lost
 * a build to stays where it was killed. NOTHING HERE PUTS A FLOOR UNDER A POINT
 * SIZE; the floors in the shaders are the authored ones and are not touched.
 *
 * THE SNOW IS NOT ON THIS DIAL AT ALL, and belongs on none: its 190,000 points
 * scatter a 30-metre box because the authored frame is 22 metres across where
 * the flakes are killed, so the count that a frame needs is a property of the
 * FRAME and not of the device. It follows the same lateral scale the camera
 * does, at exactly the authored density, and it is live so that turning a phone
 * on its side opens it back to all 190,000. See snowfall.ts, `setSpan`.
 *
 * WHAT IS NOT CUT, and why:
 *  - The MOUNTAINS are 379,440 of the 646,660 vertices, and they stay. Their
 *    620 angular columns over a 150-degree sector land about six drawing-buffer
 *    pixels apart on a phone at dpr 1.5 — the same spacing they land at on the
 *    laptop, because a narrow frame spends its pixels on fewer degrees. There
 *    is no slack in them. Building a narrower sector would work until the phone
 *    is turned on its side, and that is a picture with the ranges sliced off.
 *  - The POST CHAIN keeps all seven passes. The two-scale bloom and the one
 *    filmic curve are the grade, not a garnish, and its cost is fill, which the
 *    resolution lever has already taken.
 *  - TONE MAPPING stays `NoToneMapping` on the renderer with the curve in the
 *    composite. Mapping twice lifts the blacks to grey.
 */
import { qualityScale } from "../quality";
import { DOG_N } from "./constants";

export type HomePlan = {
  /** Device-pixel-ratio clamp handed to the Canvas. */
  dpr: [number, number];
  /** Points in the retriever's cloud. He is the subject; this moves last. */
  dogPoints: number;
  /**
   * The reflection is ADDITIVE, so its brightness is the sum of its points and
   * thinning it dims it. This gain puts back exactly what the thinning took:
   * authored count over built count, so the smear under him is the same
   * brightness at any budget.
   */
  reflectionGain: number;
};

const AUTHORED: HomePlan = {
  dpr: [1, 2],
  dogPoints: DOG_N,
  reflectionGain: 1,
};

/**
 * The decision, taken once at mount, exactly as the ambient world takes its
 * own. Nothing resizes afterwards: the counts are geometry and the dpr is the
 * buffer the whole chain is sized from.
 */
export function homePlan(): HomePlan {
  if (typeof window === "undefined") return AUTHORED;

  // qualityScale()'s own two tests for "small", kept verbatim rather than
  // re-litigated: there is no case for two different opinions in one codebase
  // about what a small device is.
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 700;
  if (!coarse && !narrow) return AUTHORED;

  // Above that line qualityScale() is the single source of how much less. A
  // touch device already sits at 0.55; the further multipliers it applies are
  // for four cores or fewer and for a retina panel, so anything under 0.42 has
  // taken the core cut and is a genuinely slow phone rather than a fast one
  // with a dense screen.
  const q = qualityScale();
  const weak = q < 0.42;

  const dogPoints = Math.round(DOG_N * (weak ? 0.65 : 0.8));
  return {
    // 1.5 and 1.25 are both above the 1440x900 frame's own point-size scale, so
    // the snow reads as snow at either.
    dpr: weak ? [1, 1.25] : [1, 1.5],
    // The retriever is the subject, so he moves last and least. His cloud is an
    // area-weighted sample of the posed mesh, and the number that decides
    // whether it reads as an animal or as a swarm is COVERAGE — count times
    // sprite area over his silhouette — which is the same on every device,
    // because the sprite scales with the buffer exactly as he does. The
    // authored 30,000 is about nineteen sprites deep over every pixel of him;
    // 24,000 is fifteen and 19,500 is twelve, which put the chance of a hole in
    // the near surface at 3 in 10 million and 5 in a million. Under about ten
    // the coat starts to open, and that is a different animal.
    dogPoints,
    reflectionGain: DOG_N / dogPoints,
  };
}
