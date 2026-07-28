/**
 * AMBIENT RINK — what a reading page is allowed to spend on weather.
 *
 * The aerial world was built as a hero: 35,000 additive points, seven skaters,
 * a snow column and a live cut ledger, at dpr 2, filling the frame. That is the
 * right budget for /aerial, where the scene IS the page. Behind a statistics
 * table it is not — the reader came for the numbers and the GPU is theirs.
 *
 * Everything here cuts cost from OUTSIDE `aerial/world.ts`, which stays the
 * tournament-approved original: budgets come down by editing the built
 * geometry, not by editing the world that built it.
 */
import * as THREE from "three";
import { prefersReducedMotion, qualityScale } from "../quality";

export type AmbientPlan = {
  /** Render at all? A device that cannot afford a world gets the sky as paint. */
  mount: boolean;
  /** Device-pixel-ratio clamp. The upscale IS the blur; see AmbientRink. */
  dpr: [number, number];
  /** Fraction of the 25k world scatter kept. */
  keepScatter: number;
  /** Fraction of the 7k snow column kept. */
  keepSnow: number;
  /** Snowfall speed multiplier — a shower reads as a hero, a drift as weather. */
  snowSpeed: number;
  /** Re-uploads a second of the 4 MB skate-cut ledger. See throttleTextureUploads. */
  ledgerHz: number;
  /** Reader asked for less movement: the whole thing is a still photograph. */
  still: boolean;
};

/** 1440x900 at its own 0.85 — the frame every number in this file was read in. */
const APPROVED_FRAME_PX = 1224 * 765;

const NONE = (still: boolean): AmbientPlan =>
  ({ mount: false, dpr: [1, 1], keepScatter: 0, keepSnow: 0, snowSpeed: 1, ledgerHz: 0, still });

/**
 * The decision, taken once at mount.
 *
 * THE FLOOR IS ABOUT CAPABILITY. It used to be about form factor as well —
 * `!coarse && !narrow` sat in the same test as the core and memory counts, and
 * a phone got a flat gradient no matter what silicon was under it. The captain
 * asked for the pond on a phone, so the form-factor half is now a TIER rather
 * than a refusal, in the shape `home/budget.ts` uses: the composition is the
 * same picture, and what changes is the price.
 *
 * What is NOT cut, because the gradient exists for it: four cores, four
 * gigabytes, a metered connection, no WebGL2. Those are unchanged.
 */
export function ambientPlan(): AmbientPlan {
  if (typeof window === "undefined") return NONE(true);

  const still = prefersReducedMotion();
  const cores = navigator.hardwareConcurrency || 8;
  // navigator.deviceMemory is Chromium-only; absent means "do not assume small".
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (cores < 4 || mem < 4 || saveData || !hasWebGL2()) return NONE(still);

  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  // 700 is qualityScale()'s own threshold, and there is no case for two
  // different opinions about what "small" means in one codebase.
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 700;
  // qualityScale() is the existing device budget and stays the single source of
  // how much less, on both sides of the line.
  const q = qualityScale();

  if (!coarse && !narrow) {
    // One more step for a mid laptop. Untouched.
    const strong = q >= 0.95 && cores >= 8;
    return {
      mount: true,
      // Capped BELOW 1 on purpose. The scene is behind a scrim and a vignette,
      // and the compositor's bilinear upscale is a free depth-of-field blur —
      // cheaper and better looking here than any post pass, and it takes the
      // fill cost of a retina panel out of the budget entirely.
      dpr: strong ? [0.7, 0.85] : [0.6, 0.7],
      keepScatter: strong ? 0.44 : 0.30,
      keepSnow: strong ? 0.26 : 0.16,
      snowSpeed: 0.55,
      ledgerHz: 8,
      still,
    };
  }

  // A touch device already sits at 0.55; the further multipliers qualityScale()
  // applies are for four cores or fewer and for a retina panel, so anything
  // under 0.42 has taken the core cut and is a genuinely slow phone rather than
  // a fast one with a dense screen. Same constant as home/budget.ts, same
  // reason.
  const weak = q < 0.42;

  // A CEILING IN PIXELS, NOT IN RATIO. `coarse` is not the same question as
  // `small`: a touch laptop at 2560x1440 answers yes to it, and a ratio alone
  // would hand that screen a 3.3-megapixel frame — three and a half times the
  // approved laptop's — for being touched. The frame never draws more pixels
  // than the frame this was signed off in, whatever the viewport.
  const area = Math.max(1, window.innerWidth * window.innerHeight);
  const capped = (r: number): [number, number] => {
    const v = Math.min(r, Math.sqrt(APPROVED_FRAME_PX / area));
    return [v, v];
  };

  return {
    mount: true,
    // RESOLUTION GOES UP ON A PHONE, NOT DOWN, AND THE REASON IS THE ONE TRAP
    // THIS PROJECT HAS PAID FOR TWICE.
    //
    // A mote's size is `aSize * uSize * uScale/dist` with uScale the drawing
    // buffer's HEIGHT — so a smaller buffer draws smaller points, and there is
    // deliberately no floor under them. The hardware has one anyway:
    // ALIASED_POINT_SIZE_RANGE starts at 1, so a point that computes to 0.4 of
    // a pixel still rasterises as a WHOLE pixel, at gl_PointCoord 0.5, which is
    // the middle of the sprite and its brightest sample. Below one buffer pixel
    // the world stops dimming with distance and starts speckling — and this
    // canvas is then magnified back to the panel, so each of those pixels
    // arrives as a soft blob several device pixels across.
    //
    // A portrait phone is already close to that line, because AmbientRink backs
    // the camera off up to 2.2x to keep the pond in a narrow frame and every
    // mote shrinks with it. Measured on a 393x852 frame, as the 99.9th
    // percentile of the light the world adds across the whole frame: 69 levels
    // at 0.6, 60 at 0.95, 57 at 1.5, against 55-58 for the approved laptop.
    // Thinning over the same range does nothing to it at all — 0.30 to 0.12
    // moved the mean by seven HUNDREDTHS of a level — because taking motes away
    // leaves the survivors exactly as bright.
    //
    // 0.95 is where that curve flattens. Past it the speckle is bought back one
    // level at a time for a quarter more fill each, and behind the frosted
    // panels — where the reading actually happens — it buys nothing measurable
    // at all: 0.95, 1.15 and 1.4 all land on the same six levels there, because
    // inside a card the figure is set by how much of a narrow frame the pond
    // fills and not by how finely it is drawn.
    //
    // Held under 1 either way: a background is never worth a device pixel per
    // CSS pixel, and the blur of the upscale is the point.
    dpr: capped(weak ? 0.8 : 0.95),
    // The pull-back that saves the framing also lands the whole world in about
    // a fifth of the screen area it covers on a laptop, with all 25,000 motes
    // still in it. Thinned to the area it is drawn into, this is the same
    // density of ice rather than a thinner one. The snow is cut harder again
    // for the reason it always is: it is the layer that moves across what
    // somebody is reading.
    keepScatter: weak ? 0.12 : 0.18,
    keepSnow: weak ? 0.06 : 0.09,
    snowSpeed: 0.55,
    // Four megabytes of canvas snapshot per upload. Eight a second is a quarter
    // of a gigabyte a second over a shared memory bus, for hairlines that take
    // about a minute to visibly change behind this grade. The marks still land
    // exactly where the simulation put them; they arrive half as often.
    ledgerHz: weak ? 3 : 4,
    still,
  };
}

function hasWebGL2(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    // A browser only allows a handful of live contexts; a probe that keeps one
    // is a probe that can cost the page the context it was probing for.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Thin the built point clouds in place, without disturbing what they depict.
 *
 * `aSize` drives `gl_PointSize` in both the mote and the snow shader, and a
 * point of size 0 is culled before rasterisation — so zeroing a size removes
 * the fragment cost, which is the cost that matters here, while leaving the
 * vertex buffer and the draw call alone.
 *
 * The selection is a Bresenham stride rather than a random draw or a
 * `setDrawRange` truncation, both of which would be wrong: the world scatter
 * is REGION-PARTITIONED BY INDEX (ice 0..9k, drift 9..14k, hills 14..18k,
 * peaks 18..25k), so truncating it deletes the mountains and a random draw
 * gives an uneven ice field. An even stride keeps every region's share exact.
 *
 * Only clouds above `minCount` are touched: the dog is 640 points and the
 * skaters 256 each, and thinning a subject is not a budget cut, it is damage.
 * The snow column is told apart from the scatter by its `aSpeed` attribute —
 * it is the only cloud in the world that has one — and gets its own, harder
 * cut, because falling snow is the layer that moves across everything a reader
 * is trying to read.
 */
export function thinPointClouds(
  root: THREE.Object3D,
  keepScatter: number,
  keepSnow: number,
  minCount = 3000,
): { before: number; after: number } {
  let before = 0, after = 0;
  root.traverse((obj) => {
    const pts = obj as THREE.Points;
    if (!(pts as Partial<THREE.Points>).isPoints) return;
    const attr = pts.geometry?.getAttribute("aSize") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const n = attr.count;
    before += n;
    const keep = pts.geometry.getAttribute("aSpeed") ? keepSnow : keepScatter;
    if (n < minCount || keep >= 1) { after += n; return; }
    const arr = attr.array as Float32Array;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      // keep when the running quota ticks over — exactly round(n*keep) points,
      // spread evenly across the index range
      if (Math.floor((i + 1) * keep) > Math.floor(i * keep)) kept++;
      else arr[i] = 0;
    }
    attr.needsUpdate = true;
    after += kept;
  });
  return { before, after };
}

const LIFT_CEILING = 1.15;

/**
 * COLD GROUND, ONE WARM SUBJECT — the home page's rule, applied here.
 *
 * The grade crushes the whole frame equally, and equally is wrong: the ice is
 * twenty-five thousand points of scenery and the game is nine figures. Crushed
 * together the pond still reads and the game stops existing, which loses the
 * one thing the captain asked for by name.
 *
 * So the figures are lifted before the veil goes on. `aColor` feeds an additive
 * shader, so this is a gain on what each mote contributes, and it is applied
 * ONLY to the small systems — dog (640 points), skaters (256), goalies (232),
 * watchers (480). The 25,000-point world scatter is left where it is; that is
 * the ground, and the ground is meant to lose.
 */
export function liftSubjects(root: THREE.Object3D, gain: number, maxCount = 1000): number {
  let lifted = 0;
  root.traverse((obj) => {
    const pts = obj as THREE.Points;
    if (!(pts as Partial<THREE.Points>).isPoints) return;
    const col = pts.geometry?.getAttribute("aColor") as THREE.BufferAttribute | undefined;
    if (!col || col.count > maxCount) return;
    const arr = col.array as Float32Array;
    // Clamped per POINT, not per channel. A channel-wise clamp shifts hue
    // toward whichever channel hit the ceiling, and on a gold retriever that
    // channel is red — the coat goes lemon. Scaling the whole triple by the
    // same factor keeps the colour and only gives up the brightness.
    for (let i = 0; i < arr.length; i += 3) {
      const r = arr[i]!, g = arr[i + 1]!, b = arr[i + 2]!;
      const k = Math.min(gain, LIFT_CEILING / Math.max(r, g, b, 1e-4));
      arr[i] = r * k; arr[i + 1] = g * k; arr[i + 2] = b * k;
    }
    col.needsUpdate = true;
    lifted++;
  });
  return lifted;
}

/** Slow the snow column down. Weather, not a shower. */
export function slowSnowfall(root: THREE.Object3D, factor: number): void {
  root.traverse((obj) => {
    const pts = obj as THREE.Points;
    if (!(pts as Partial<THREE.Points>).isPoints) return;
    const spd = pts.geometry?.getAttribute("aSpeed") as THREE.BufferAttribute | undefined;
    if (!spd) return;                                  // only the snowfall has one
    const arr = spd.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] *= factor;
    spd.needsUpdate = true;
  });
}

/**
 * THE MOST EXPENSIVE THING IN THIS WORLD IS NOT A PARTICLE.
 *
 * The skate-cut ledger is a 1024x1024 canvas that the world fades by one
 * `fillRect` every frame and then flags dirty — so three re-uploads four
 * megabytes of texture, snapshotted out of a 2D canvas, sixty times a second.
 * That is a quarter of a gigabyte a second of upload traffic to draw some
 * hairlines that, behind this grade, take about a minute to visibly change.
 *
 * Throttling the upload leaves every mark exactly where the simulation put it
 * and simply stops paying for the ones nobody can see arrive. The instance
 * property shadows `Texture.prototype.needsUpdate`; the real setter is kept and
 * called on schedule, so nothing here depends on how three implements it.
 */
export function throttleTextureUploads(tex: THREE.Texture, hz: number): void {
  const proto = Object.getPrototypeOf(tex) as object;
  let desc: PropertyDescriptor | undefined;
  for (let p: object | null = proto; p && !desc; p = Object.getPrototypeOf(p) as object | null) {
    desc = Object.getOwnPropertyDescriptor(p, "needsUpdate");
  }
  if (!desc?.set) return;                        // three changed shape; leave it alone
  const set = desc.set;
  const interval = 1000 / hz;
  let last = -Infinity;
  Object.defineProperty(tex, "needsUpdate", {
    configurable: true,
    set(v: boolean) {
      if (v !== true) return;
      const now = performance.now();
      if (now - last < interval) return;
      last = now;
      set.call(tex, true);
    },
    get() { return false; },
  });
}
