// Fidelity harness — scores a WebGL page against igloo.inc-derived targets.
//   node scripts/fidelity.mjs <url> [--label name]
//   node scripts/fidelity.mjs https://www.igloo.inc/ --label igloo --settle 14000
//   node scripts/fidelity.mjs http://localhost:3000/opener --label beat-4 --scroll 0.8
//   node scripts/fidelity.mjs <url> --runs 5        -> median of 5, spread printed
//   node scripts/fidelity.mjs <url> --json          -> machine-readable, for a loop
//
// Six metrics, from docs/superpowers/specs/2026-07-24-igloo-parity-opener-design.md §2.
// Frames land in docs/fidelity/<label>/ so every number is reviewable.
// Exit 0 = all in band, 1 = a metric out of band, 2 = the harness could not score
// (bad renderer, page failure) — which is NOT the same as a failing score.
//
// ---------------------------------------------------------------------------
// TWO TRAPS THIS REPO HAS ALREADY PAID FOR
//
// 1. SWIFTSHADER. Playwright's chromium defaults to CPU rasterisation at ~9fps
//    (measured: SwiftShader 9fps -> RTX 3080 43fps on the same page). Every
//    visual verdict this project made before commit cd0d24c was formed through
//    that lie. Three ANGLE flags hand it the actual card; this harness asserts
//    UNMASKED_RENDERER_WEBGL and refuses to score a software frame.
//
// 2. SCREENSHOT COST. A screenshot of a live WebGL page costs 1-50s here and the
//    scene animates through it. A requested timestamp is a REQUEST, not a fact.
//    Every capture reads the page's own clock immediately before and after, and
//    the real elapsed clock is printed beside every measurement. In particular
//    the "500ms apart" of metric 1 is reported as the gap that actually happened.
// ---------------------------------------------------------------------------
//
// CALIBRATION — every constant below was chosen by making the harness reproduce
// this repo's own prior measurement of igloo.inc (commit f1fc52d, plus the 15
// reference captures in tmp/ref-study/). What each choice cost is recorded at
// the constant. Do not move a constant to make a score look better; that is the
// exact failure the spec §8 names ("a critic caught an earlier agent optimising
// the metric rather than the thing").
//
//   metric        baseline   this harness on igloo.inc      verdict
//   ------------  ---------  -----------------------------  ---------------------
//   aliveness      ~60%      63.7% at rest (61-67 by beat)   reproduced
//   dark placement  0.63     0.700 live; 0.631 as the mean   reproduced (the
//                            over tmp/ref-study, 0.627 over  baseline is a
//                            a 31-point sweep of the journey set mean)
//   flat region     1.2%     1.09% live; 1.20% exactly on    reproduced
//                            tmp/ref-study/s00, the hero
//   pointer IoU    0.33-0.42 0.471 registered                close (and the
//                                                            published pair was
//                                                            un-registered)
//   pointer        none      0.152 median over 3 keys x 3    NEW 2026-07-24, no
//   response                 runs, range 0.129-0.193         prior baseline to
//                                                            reproduce — see
//                                                            POINTER_RESPONSE_MIN
//   blown           6.9%     0.34% at rest; 7.96% at the     NOT at rest — see
//                            glow apex of the journey        note below
//   parallax        ~10%     0.00%, dx removes 0.0% of the   NOT reproducible —
//                            difference                      see note below
//
// TWO BASELINES THAT DO NOT REPRODUCE, AND WHY — recorded rather than tuned away.
//
//   Blown highlights. igloo.inc is a WHITE world but it is not a blown one: at
//   rest it measures 0.34%, and no frame in tmp/ref-study exceeds 1.73% (set
//   mean 0.77%). 6.9% is reached only at the shattered-ring glow apex, where a
//   31-point sweep of the journey peaks at 7.96%. So the 6.9% baseline is the
//   reference's WORST frame, not its resting state, which is coherent for a
//   ceiling metric — it says "even at its brightest the reference stays under
//   8%". Scored here on the at-rest frame, as the other five are.
//
//   Parallax. Not reproducible against igloo.inc as it ships today, and the
//   build is unchanged from the one the spec describes (App3D-f554a111.js, byte
//   for byte). Best-alignment finds dx=0 on every beat tried — hero, shattered
//   ring, creature — and the MAD curve has a sharp single minimum at dx=0, so
//   this is an absence, not a failed search. Its App3D bundle contains no
//   pointer-to-camera coupling at all: the only uMousePos uniform feeds a local
//   ground glow (vMouseGlow), and the one "parallax" identifier in the bundle is
//   a vertical scene-transition shader term. The -82px in f1fc52d was measured
//   on the footer mark, a different subject, and is not visible from here.
//   The metric is kept and scored; the reference simply does not pass it.
//
// ---------------------------------------------------------------------------
// TWO MEASUREMENT DEFECTS FIXED 2026-07-24, both the same class of error as the
// parallax one above: a metric that was passing on something other than the
// thing it names. Full evidence lives at POINTER_RESPONSE_MIN and DEFAULT_RUNS.
//
//   1. The IoU was scoring ELAPSED TIME, not pointer response. It compared two
//      frames at two pointer positions ~1.4s apart and called the difference
//      reactivity. scripts/iou-control.mjs took the same pair AND a same-pointer
//      pair over the same interval: on /icehouse at its hero, 0.043 two-pointer
//      against 0.051 same-pointer — the particle field drifting accounted for
//      almost all of it and roughly 0.008 was the cursor. Aliveness had been
//      raised on both candidate builds by adding animated particle density,
//      which inflated the IoU pass as a side effect. The control is now folded
//      into the harness and the SCORED number is the gap between the two.
//
//   2. A single run was being treated as a verdict on a live scene. Same build,
//      no code change, /journey returned dark placement 0.334 then 0.694 at
//      t=0.45 and 0.331 then 0.672 at t=0.80; aliveness swings ~15 points.
//      --runs N (default 3) now repeats the cycle and reports median/min/max,
//      verdict on the median, spread printed so a cell on its bar is visible.
// ---------------------------------------------------------------------------
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// --- calibration constants -------------------------------------------------

/** Metric 1. Luma steps below this do not count as motion.
 *
 *  MEASURED CAPTURE NOISE FLOOR IS ZERO. Two screenshots of a static WebGL page
 *  500ms apart differ on 0.0000% of pixels at every step from 0 up; max
 *  per-pixel luma delta 0.000. So this constant is not defending against sensor
 *  or capture noise — there is none — it is defending against SUB-PERCEPTUAL
 *  change: a live scene's temporal dither and AA jitter move pixels by 1/255,
 *  which is invisible and would let a still frame score as alive.
 *
 *  2/255 is the smallest step that is a real change, and it is where the
 *  reference reproduces: igloo hero 61.3%, ring 60.9%, creature 67.3% against
 *  the ~60% baseline. (At >1: 68.6%. At >4: 49.5%, which would put igloo itself
 *  below igloo's own >=50% target — evidence the step belongs at 2, not higher.) */
const ALIVE_LUMA_STEP = 2;

/** Metric 5. Flood-fill tolerance, per RGB channel, measured against the SEED
 *  colour (not the neighbour — neighbour-relative growth follows gradients and
 *  floods the whole sky). tol=2 puts igloo's hero frame at 1.20%, dead on the
 *  1.2% baseline. tol=1 -> 0.54%, tol=3 -> 1.24%, tol=4 -> 2.03%. */
const FLAT_TOL = 2;

/** Metric 4. Below this share of frame, the <25L population is too small for a
 *  stable centroid and the adaptive definition takes over — see darkPlacement(). */
const DARK_MIN_POP = 0.0005; // 0.05% of frame

/** Metric 4 adaptive. The darkest slice of the frame, used when <25L is empty.
 *  Mean over the 15 tmp/ref-study captures = 0.631, i.e. the 0.63 baseline. */
const DARK_ADAPTIVE_Q = 0.05;

/** Metric 6. A dx only counts as a pan if aligning on it actually removes
 *  difference. Registering out igloo's real pointer parallax removed 74% of the
 *  frame difference (f1fc52d); the best dx on a scene with NO pan removes
 *  0.0-3.4% (measured: igloo today, and docs/home-scroll/v2.html, which returns
 *  a plausible-looking 44px that is pure noise). Without this gate a page with
 *  no parallax at all can roll a dx inside the 8-12% band and pass. */
const PARALLAX_MIN_REMOVED = 10;

/** Metric 2. The silhouette must be a subject, not a sliver and not the whole
 *  frame. Otsu picks the cut; these clamp it into a range where an IoU means
 *  something. Below 3% and two frames of drifting sparkle score a meaningless
 *  IoU; above 60% the "subject" is the background. */
const SIL_MIN_COVER = 3;
const SIL_MAX_COVER = 60;

/** Metric 2, REPLACED 2026-07-24. The bar the POINTER-ATTRIBUTABLE reshape must
 *  clear — not the raw two-pointer IoU, which was the defect.
 *
 *  WHAT WAS WRONG. The old metric compared a frame at pointer-35% with a frame
 *  at pointer-65% and called the silhouette difference reactivity. Those frames
 *  are ~1.4s apart, and on a scene with a live particle field most of the
 *  difference is the field having drifted. scripts/iou-control.mjs measured it:
 *  a same-pointer pair over the same interval scores about as low as the
 *  two-pointer pair, so the metric was passing on ELAPSED TIME. Worse, both
 *  candidate builds had raised aliveness by adding animated particle density,
 *  which inflated the IoU pass as a side effect — the metric was rewarding the
 *  thing that broke it. Same class of error as the parallax note above.
 *
 *  WHAT IS SCORED NOW. Three captures: pointer at 35%, pointer at 65%, then
 *  pointer HELD at 65% for one more identical dwell. Both pairs get the same
 *  registration treatment and the same Otsu cut, so the only difference between
 *  them is whether the pointer moved. The score is the GAP:
 *
 *      response = IoU(held pair) - IoU(moved pair)
 *
 *  i.e. how much MORE of the silhouette the cursor displaced than the scene
 *  displaced on its own. All three numbers are printed; only the gap is scored.
 *
 *  CALIBRATED AGAINST igloo.inc, exactly as the original bands were — three
 *  keys (hero, wheel 3200, wheel 6400), three runs each, --settle 14000,
 *  --subject particle, 2026-07-24:
 *
 *    key          two-pointer  same-pointer  response (3 runs)      median
 *    -----------  -----------  ------------  ---------------------  ------
 *    hero              0.489        0.655    0.193 0.166 0.148       0.166
 *    wheel 3200        0.523        0.677    0.152 0.146 0.155       0.152
 *    wheel 6400        0.530        0.675    0.129 0.145 0.180       0.145
 *
 *  So the reference's response is REAL and reproducible: nine measurements in
 *  [0.129, 0.193], median 0.152, and it does not collapse between beats. The
 *  claim did not have to be softened — igloo genuinely reshapes ~15% of its
 *  silhouette union under the cursor, on top of whatever it was doing anyway.
 *  (Note the same-pointer control is 0.65-0.68, NOT near zero: two igloo frames
 *  1.4s apart already disagree on a third of the silhouette with the pointer
 *  parked. That third is exactly what the old metric was counting as response.)
 *
 *  THE BAR: 0.12 for particle. Below all nine reference measurements, so the
 *  reference passes on its worst run, and 0.12/0.152 = 79% of the reference
 *  median — the same headroom the aliveness row takes from igloo's 63.7% with
 *  its >=50% bar. A bar at the reference's median headroom on the dark-placement
 *  row (87%) would have landed at 0.133 and failed one of igloo's own nine runs,
 *  which is the disqualifying test.
 *
 *  0.067 for solid is NOT independently calibrated and must not be quoted as if
 *  it were: there is no solid reference — igloo ships no rigged animal. It is
 *  0.12 scaled by the ratio the retired IoU bands set between the two subject
 *  kinds (solid had to change >=25% of the silhouette, particle >=45%, so
 *  0.12 x 25/45 = 0.067). That relaxation was signed off on the reasoning in the
 *  SUBJECT KIND note below, and it is inherited here unchanged rather than
 *  re-argued. If a solid reference ever exists, calibrate against it and delete
 *  this paragraph. */
const POINTER_RESPONSE_MIN = { particle: 0.12, solid: 0.067 };

/** How many times the capture-and-score cycle repeats. See the note at RUNS. */
const DEFAULT_RUNS = 3;

/** A REAL GPU. Without these, chromium renders through SwiftShader. */
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];

/**
 * REVISION 2026-07-24, on measurement rather than on convenience.
 *
 * Two rows changed after this harness was calibrated against igloo.inc itself.
 * Recording why here, because one of them makes scoring EASIER and that is
 * exactly the kind of change that has to carry its evidence with it.
 *
 * parallax — DEMOTED to informational, no longer part of the pass/fail band.
 *   The spec asserted the reference pans ~10% away from the pointer. It does
 *   not, on the journey we are matching. Four independent lines: best-alignment
 *   returns dx=0 on the hero, the ring and the creature; the MAD curve has a
 *   single sharp minimum at dx=0 with no secondary structure over +-100px; a
 *   same-pointer control pair 0.6s apart differs about as much as the two
 *   pointer positions do, so elapsed time explains it; and the shipped bundle
 *   contains no pointer-to-camera coupling at all — its only uMousePos drives a
 *   local ground glow. The -82px in commit f1fc52d was the FOOTER MARK, a
 *   different subject on a different screen, and the spec generalised it to the
 *   whole site. The band also carried a unit error: ~10% there meant 10% of
 *   POINTER TRAVEL, which at the sampled positions is 3.0% of frame width, so
 *   "8-12% of frame width" demanded roughly 3.3x what the reference ever did.
 *   Scoring against it would have pushed the build away from the reference, not
 *   toward it. Still measured and printed — just not scored.
 *
 * blown — TIGHTENED from <=8% to <=2%, which is the compensating direction.
 *   6.9% is the reference's WORST frame (a glow apex), not its resting state.
 *   At rest it measures 0.34%, its 15-capture study mean is 0.77% and its
 *   maximum is 1.73%. Since every other row is scored on the at-rest frame,
 *   this one has to be too, and 8% at rest is not a bar the reference sets.
 */
/**
 * SUBJECT KIND, 2026-07-24. Signed off by the captain, and written here rather
 * than left implicit because it relaxes a target for one class of beat.
 *
 * The IoU band of <=0.55 was derived from igloo's PARTICLE objects, which
 * genuinely part around the cursor — the measured reference sits at 0.46-0.47.
 * Our ball and our mote-bodied players are the same kind of thing and are held
 * to the same number.
 *
 * The retriever is not. He is a solid, rigged animal by explicit design
 * ("a dog is the subject or he is set dressing"), and a solid body cannot
 * dissolve around a pointer without contradicting the direction that put a
 * real mesh back in this project in the first place. Driving a quadruped to
 * 0.55 means turning him far enough that he stops reading as an animal and
 * starts reading as a turntable — which is the "metronome" failure this repo
 * has already named once.
 *
 * So solid subjects are scored on RESPONSE AMPLITUDE instead: at least a
 * quarter of the silhouette must change between pointer positions (IoU <=
 * 0.75). That is the measurable half. The other half — whether the motion
 * looks like an animal rather than a rig — is not measurable here and belongs
 * to the critic pass. Both halves are required; neither alone passes a beat.
 *
 * SUPERSEDED 2026-07-24 as a PASS/FAIL BAND — see POINTER_RESPONSE_MIN. Both
 * numbers below turned out to be reachable without a pointer, by a scene that
 * simply animates between the two captures. They are still measured and still
 * printed, as the raw two-pointer IoU, because the ratio between the two
 * subject kinds is the thing the calibrated response bars inherit. They are no
 * longer what decides a beat.
 */
const SUBJECT_IOU = { particle: [0, 0.55], solid: [0, 0.75] };
const SUBJECT = (() => {
  const i = process.argv.indexOf("--subject");
  const v = i >= 0 ? process.argv[i + 1] : "particle";
  if (!SUBJECT_IOU[v]) {
    console.error(`  unknown --subject "${v}" (expected: particle | solid)`);
    process.exit(2);
  }
  return v;
})();

const RESP_MIN = POINTER_RESPONSE_MIN[SUBJECT];

const TARGETS = [
  { key: "aliveness",  label: "Aliveness at rest",  unit: "%",  band: [50, 100], text: ">= 50%" },
  { key: "response",   label: `Pointer response (${SUBJECT})`, unit: "",
    band: [RESP_MIN, 1], text: `>= ${RESP_MIN.toFixed(3)}` },
  { key: "blown",      label: "Blown highlights",   unit: "%",  band: [0, 2],    text: "<= 2%" },
  { key: "darkY",      label: "Dark placement",     unit: "",   band: [0.55, 1], text: ">= 0.55" },
  { key: "flat",       label: "Largest flat region",unit: "%",  band: [0, 3],    text: "<= 3%" },
  // Informational: measured and printed, never scored. The two IoUs are the
  // halves the response is the difference of; parallax is demoted (see header).
  { key: "iouStill",   label: "  IoU same-pointer", unit: "",   band: null,      text: "control" },
  { key: "iouMoved",   label: "  IoU two-pointer",  unit: "",   band: null,
    text: `was <= ${SUBJECT_IOU[SUBJECT][1]}` },
  { key: "parallax",   label: "Parallax (info)",    unit: "%",  band: null,      text: "not scored" },
];

// --- CLI -------------------------------------------------------------------

const VALUE_FLAGS = ["label", "settle", "scroll", "wheel", "viewport", "alive-thr", "flat-tol", "out", "silhouette-thr", "runs"];
const argv = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) { positional.push(a); continue; }
  const name = a.slice(2);
  if (VALUE_FLAGS.includes(name)) opts[name] = argv[++i];
  else opts[name] = true;
}
const flag = (name, dflt) => (opts[name] === undefined ? dflt : opts[name]);
const has = (name) => opts[name] === true;
const url = positional[0];

if (!url) {
  console.error("usage: node scripts/fidelity.mjs <url> [--label name] [--json]");
  console.error("       [--runs N]   (default 3; median scored, min-max printed)");
  console.error("       [--settle ms] [--scroll 0..1] [--wheel px] [--viewport WxH]");
  console.error("       [--alive-thr n] [--flat-tol n] [--silhouette-thr n] [--out dir]");
  console.error("       [--no-gpu]  (self-test: proves the SwiftShader guard fires)");
  process.exit(2);
}

const JSON_OUT = has("json");
const label = flag("label", (() => {
  const u = new URL(url);                     // file:// pages have no hostname
  const stem = u.hostname || path.basename(u.pathname, path.extname(u.pathname));
  return (stem.replace(/^www\./, "") || "frame").replace(/\W+/g, "-");
})());
const settle = Number(flag("settle", 6000));
const scrollFrac = flag("scroll", null);
const wheel = Number(flag("wheel", 0));
const [VW, VH] = String(flag("viewport", "1440x900")).split("x").map(Number);
const aliveStep = Number(flag("alive-thr", ALIVE_LUMA_STEP));
const flatTol = Number(flag("flat-tol", FLAT_TOL));
const outDir = path.resolve(flag("out", path.join("docs/fidelity", label)));

/** DEFECT 2, 2026-07-24. HOW MANY TIMES THE WHOLE CYCLE RUNS.
 *
 *  A single run is not a verdict on a page that contains a live simulation.
 *  MEASURED on /journey, same build, no code change, two consecutive runs:
 *  dark placement 0.334 then 0.694 at t=0.45, and 0.331 then 0.672 at t=0.80 —
 *  a 0.36 swing on a metric whose bar is 0.55, i.e. the same build both passes
 *  and fails depending on which run you quote. Aliveness swings ~15 points on
 *  the same page. The cause is legitimate and is the thing being measured: six
 *  skaters make random decisions, the puck goes where the game takes it, and
 *  the harness therefore never captures the same frame twice.
 *
 *  So the cycle repeats and the verdict is taken on the MEDIAN, with min and
 *  max printed beside it. Three is the smallest N that has a true middle value
 *  (no interpolation between two runs that could both be outliers) and it costs
 *  ~3x an already slow capture; raise it with --runs when a cell sits on its bar
 *  and the answer matters.
 *
 *  The repeats share one page load. That is deliberate: the variance being
 *  characterised is the scene animating between captures, which a same-session
 *  repeat reproduces exactly, and a reload would add 6-14s of settle per run
 *  plus first-frame warm-up that is not part of what we are measuring. It does
 *  NOT characterise load-to-load variance (shader compile, asset decode order);
 *  if that is ever suspected, run the harness itself N times instead. */
const RUNS = Math.max(1, Math.round(Number(flag("runs", DEFAULT_RUNS))));

const say = JSON_OUT ? () => {} : (...a) => console.log(...a);

/** Verdict statistics. median() on an even N is the mean of the two middles,
 *  which is a value no run produced — fine for a verdict, which is why the
 *  runs themselves are always printed alongside it. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// --- image maths -----------------------------------------------------------

/** Rec.709 luma, kept as Float32 so the alignment search is not quantised. */
async function readFrame(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, W = info.width, H = info.height, n = W * H;
  const L = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += ch) {
    L[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return { rgb: data, ch, L, W, H, n };
}

/** METRIC 1 — share of pixels whose luma moved by more than `step`. */
function aliveness(a, b, step) {
  let c = 0;
  for (let i = 0; i < a.n; i++) if (Math.abs(a.L[i] - b.L[i]) > step) c++;
  return (c / a.n) * 100;
}

/** METRIC 3 — share of pixels above 250 luma. */
function blownHighlights(f) {
  let c = 0;
  for (let i = 0; i < f.n; i++) if (f.L[i] > 250) c++;
  return (c / f.n) * 100;
}

/** METRIC 4 — where the dark sits, as centroid y / frame height.
 *
 *  The spec defines dark as < 25L. That is right for the near-black world this
 *  project is building, and undefined for the reference, which is a WHITE world:
 *  igloo's hero frame has 0.01% of pixels under 25L and most of its frames have
 *  none at all. So when that population is too small to place a centroid, the
 *  metric falls back to the darkest DARK_ADAPTIVE_Q of the frame — whatever
 *  "dark" means for this image. That fallback is what reproduces the baseline:
 *  mean 0.631 over the 15 reference captures against the 0.63 published figure.
 *  Which definition was used is reported, never silently swapped. */
function darkPlacement(f) {
  let c = 0, sy = 0;
  for (let p = 0; p < f.n; p++) if (f.L[p] < 25) { c++; sy += (p / f.W) | 0; }
  if (c >= f.n * DARK_MIN_POP) {
    return { y: sy / c / f.H, mode: "absolute <25L", pop: (c / f.n) * 100, cut: 25 };
  }
  const hist = new Uint32Array(256);
  for (let p = 0; p < f.n; p++) hist[Math.min(255, Math.round(f.L[p]))]++;
  let acc = 0, cut = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= f.n * DARK_ADAPTIVE_Q) { cut = v; break; } }
  let c2 = 0, sy2 = 0;
  for (let p = 0; p < f.n; p++) if (f.L[p] <= cut) { c2++; sy2 += (p / f.W) | 0; }
  return { y: sy2 / c2 / f.H, mode: `adaptive darkest ${DARK_ADAPTIVE_Q * 100}% (<=${cut}L)`, pop: (c2 / f.n) * 100, cut };
}

/** METRIC 5 — biggest 4-connected run of near-identical colour, as % of frame.
 *  Seed-relative tolerance: a pixel joins only if it is within `tol` of the
 *  colour the region STARTED from. Every pixel is visited once, so this is a
 *  single O(n) sweep over the frame rather than a fill per seed. */
function largestFlatRegion(f, tol) {
  const { rgb, ch, W, H, n } = f;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const si = s * ch, sr = rgb[si], sg = rgb[si + 1], sb = rgb[si + 2];
    let top = 0, size = 0;
    stack[top++] = s; seen[s] = 1;
    while (top > 0) {
      const p = stack[--top]; size++;
      const x = p % W, y = (p / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (seen[q]) continue;
        const qi = q * ch;
        if (Math.abs(rgb[qi] - sr) <= tol && Math.abs(rgb[qi + 1] - sg) <= tol && Math.abs(rgb[qi + 2] - sb) <= tol) {
          seen[q] = 1; stack[top++] = q;
        }
      }
    }
    if (size > best) best = size;
  }
  return (best / n) * 100;
}

function boxDown(f, k) {
  const W = Math.floor(f.W / k), H = Math.floor(f.H / k);
  const L = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += f.L[(y * k + dy) * f.W + x * k + dx];
    L[y * W + x] = s / (k * k);
  }
  return { L, W, H, n: W * H };
}

/** Mean absolute difference of `b` shifted by (dx,dy) onto `a`, over the overlap. */
function mad(a, b, dx, dy, stride = 1) {
  let s = 0, c = 0;
  const y0 = Math.max(0, -dy), y1 = Math.min(a.H, a.H - dy);
  const x0 = Math.max(0, -dx), x1 = Math.min(a.W, a.W - dx);
  for (let y = y0; y < y1; y += stride) {
    const ay = y * a.W, by = (y + dy) * b.W + dx;
    for (let x = x0; x < x1; x += stride) s += Math.abs(a.L[ay + x] - b.L[by + x]), c++;
  }
  return c ? s / c : Infinity;
}

/** METRIC 6 — the whole-scene translation between two pointer positions.
 *  Coarse-to-fine best-alignment search: quarter scale over a wide window, then
 *  full scale in a +/-6px neighbourhood. Reported alongside the difference it
 *  removes, because a dx that removes nothing is not a pan — it is noise. The
 *  same (dx,dy) is what metric 2 registers out. */
function findTranslation(a, b) {
  const K = 4;
  const da = boxDown(a, K), db = boxDown(b, K);
  const maxDx = Math.round((a.W * 0.20) / K), maxDy = Math.round((a.H * 0.10) / K);
  let best = { dx: 0, dy: 0, v: Infinity };
  for (let dy = -maxDy; dy <= maxDy; dy++) {
    for (let dx = -maxDx; dx <= maxDx; dx++) {
      const v = mad(da, db, dx, dy);
      if (v < best.v) best = { dx, dy, v };
    }
  }
  let fine = { dx: best.dx * K, dy: best.dy * K, v: Infinity };
  for (let dy = fine.dy - 6; dy <= fine.dy + 6; dy++) {
    for (let dx = fine.dx - 6; dx <= fine.dx + 6; dx++) {
      const v = mad(a, b, dx, dy, 2);
      if (v < fine.v) fine = { dx, dy, v };
    }
  }
  const at0 = mad(a, b, 0, 0, 2);
  return { dx: fine.dx, dy: fine.dy, mad: fine.v, mad0: at0, removed: at0 > 0 ? (1 - fine.v / at0) * 100 : 0 };
}

/** Background level, taken from a border ring — the subject is not on the edge. */
function backgroundLevel(f) {
  const ring = [];
  const m = Math.max(4, Math.round(Math.min(f.W, f.H) * 0.05));
  for (let y = 0; y < f.H; y += 2) for (let x = 0; x < f.W; x += 2) {
    if (x < m || y < m || x >= f.W - m || y >= f.H - m) ring.push(f.L[y * f.W + x]);
  }
  ring.sort((p, q) => p - q);
  const med = ring[ring.length >> 1];
  const dev = ring.map((v) => Math.abs(v - med)).sort((p, q) => p - q);
  return { med, mad: dev[dev.length >> 1] };
}

/** Where to cut the subject away from the background, on |L - background|.
 *  Otsu (maximum between-class variance) rather than a hand-set number, so the
 *  cut follows the image instead of the author's expectations, then clamped to
 *  a coverage band so the "silhouette" is neither a sparkle nor the whole sky. */
function subjectCut(f, bgMed) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < f.n; i++) hist[Math.min(255, Math.round(Math.abs(f.L[i] - bgMed)))]++;
  let total = f.n, sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = -1, cut = 16;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += v * hist[v];
    const between = wB * wF * Math.pow(sumB / wB - (sum - sumB) / wF, 2);
    if (between > best) { best = between; cut = v; }
  }
  const coverAt = (t) => { let c = 0; for (let v = t + 1; v < 256; v++) c += hist[v]; return (c / total) * 100; };
  while (cut > 1 && coverAt(cut) < SIL_MIN_COVER) cut--;
  while (cut < 254 && coverAt(cut) > SIL_MAX_COVER) cut++;
  return cut;
}

/** Silhouette IoU between two frames, AFTER the whole-scene translation is
 *  registered out.
 *
 *  Registering first is the whole point. igloo's apparent "cursor field" was 74%
 *  whole-scene pan (f1fc52d); an IoU that has not had the pan removed is scoring
 *  camera travel and calling it deformation. Deformation is what we are after.
 *
 *  The cut is |L - background| rather than the spec's bare "above background":
 *  they are identical for a glowing subject in a near-black world (our beats),
 *  and absolute deviation is the only version that also works on a subject that
 *  is DARKER than its background, which is most of the reference.
 *
 *  `anchor` is {med, thr}, computed ONCE from the left frame and handed to both
 *  the two-pointer pair and the same-pointer control. Letting each pair derive
 *  its own Otsu cut would let a threshold difference of a fraction of a luma
 *  step show up as pointer response, which is precisely the confound this
 *  revision exists to remove. scripts/iou-control.mjs had that flaw — it cut
 *  the moved pair on frame a and the still pair on frame b. */
function silhouetteIoU(a, b, dx, dy, anchor) {
  const bg = { med: anchor.med };
  const thr = anchor.thr;
  const y0 = Math.max(0, -dy), y1 = Math.min(a.H, a.H - dy);
  const x0 = Math.max(0, -dx), x1 = Math.min(a.W, a.W - dx);
  let inter = 0, union = 0, aOn = 0, bOn = 0;
  for (let y = y0; y < y1; y++) {
    const ay = y * a.W, by = (y + dy) * b.W + dx;
    for (let x = x0; x < x1; x++) {
      const A = Math.abs(a.L[ay + x] - bg.med) > thr;
      const B = Math.abs(b.L[by + x] - bg.med) > thr;
      if (A) aOn++;
      if (B) bOn++;
      if (A && B) inter++;
      if (A || B) union++;
    }
  }
  const area = (y1 - y0) * (x1 - x0);
  return {
    iou: union ? inter / union : 1,
    thr, bg: bg.med,
    aPct: (aOn / area) * 100, bPct: (bOn / area) * 100,
  };
}

// --- capture ---------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });
const notes = [];
// --no-gpu exists for one reason: to prove the guard below actually fires. A
// safety check that is never exercised is a check you do not know you have.
const browser = await chromium.launch({ args: has("no-gpu") ? [] : GPU });
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.setDefaultTimeout(60000);
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

/** The page's own clock, in seconds. A scene that exposes __sceneClock is
 *  believed over performance.now(), because it knows what it has simulated. */
const CLOCK = `(() => {
  const c = window.__sceneClock;
  if (typeof c === "number") return c;
  if (typeof c === "function") { try { return c(); } catch { /* fall through */ } }
  if (c && typeof c.t === "number") return c.t;
  return performance.now() / 1000;
})()`;
const clock = () => page.evaluate(CLOCK).catch(() => null);
const clockKind = async () =>
  page.evaluate(() => (window.__sceneClock === undefined ? "performance.now()" : "window.__sceneClock")).catch(() => "?");

const shots = [];
async function snap(tag) {
  const before = await clock();
  const t0 = Date.now();
  const buf = await page.screenshot({ path: path.join(outDir, `${tag}.png`), timeout: 120000 });
  const after = await clock();
  const rec = { tag, before, after, wallMs: Date.now() - t0 };
  shots.push(rec);
  const f = await readFrame(buf);
  f.clock = rec;
  return f;
}
const at = (f) => `clock ${f.clock.before?.toFixed(2)}s->${f.clock.after?.toFixed(2)}s (shot ${(f.clock.wallMs / 1000).toFixed(1)}s)`;

let exitCode = 0;
let result = null;

try {
  say(`\n=== FIDELITY: ${label} ===`);
  say(`  url      ${url}`);
  say(`  viewport ${VW}x${VH}   settle ${settle}ms   frames -> ${path.relative(process.cwd(), outDir)}`);

  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);

  // TRAP 1 — assert the renderer before anything is believed. The page's own
  // canvas may be inside a closed shadow root (igloo.inc is), so this asks a
  // throwaway canvas of our own: same GPU process, same ANGLE backend.
  const gpu = await page.evaluate(() => {
    const cv = document.createElement("canvas");
    const gl = cv.getContext("webgl2") || cv.getContext("webgl");
    if (!gl) return { renderer: null, vendor: null, err: "no WebGL context" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      unmasked: !!ext,
    };
  });
  if (!gpu.renderer) throw new Error(`no WebGL renderer to assert: ${gpu.err}`);
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu.renderer)) {
    throw new Error(
      `SOFTWARE RENDERER — refusing to score.\n` +
      `      got: ${gpu.renderer}\n` +
      `      This is CPU rasterisation at ~9fps. Every visual verdict this project\n` +
      `      made before commit cd0d24c was formed through it. Launch chromium with\n` +
      `      ${GPU.join(" ")} and try again.`
    );
  }
  const clockSource = await clockKind();
  say(`  renderer ${gpu.renderer}`);
  say(`  clock    ${clockSource}`);

  await page.waitForTimeout(settle);
  if (scrollFrac !== null) {
    await page.evaluate((f) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * f);
    }, Number(scrollFrac));
    await page.waitForTimeout(1800);
  }
  if (wheel) {
    // Virtual scrollers (igloo.inc: window.scrollY is ALWAYS 0, a wheel drives
    // the camera) only move for wheel events. Arrival is momentum-dependent, so
    // this is dispatched in one shove and then given time to come to rest.
    await page.mouse.move(VW / 2, VH / 2);
    await page.mouse.wheel(0, wheel);
    await page.waitForTimeout(4000);
  }

  /** TRAP 3 — A DEV ERROR OVERLAY IS NOT A SCENE.
   *
   *  MEASURED 2026-07-24, and the reason this exists: a sweep of /journey was
   *  running while another agent saved a broken `grade.js`. The route had
   *  already returned 200, so the HTTP check at goto() passed; Next then pushed
   *  its compile error over HMR and the overlay replaced the canvas mid-run. The
   *  harness scored the overlay and returned a row that looks like data —
   *  aliveness 14.93%, blown 9.33%, flat 21.35%, dark 0.586 — with the giveaway
   *  being an IoU of exactly 1.000 on BOTH the moved and the held pair, i.e. a
   *  page that is not animating at all. Four of five metrics "failed"; none of
   *  it was a measurement of the build.
   *
   *  A 500 at navigation is already refused. This refuses the harder case: a
   *  page that loaded clean and broke underneath us. Checked at both ends of
   *  every cycle, so a break is attributed to the run it happened in rather
   *  than silently averaged into a median. Exit 2, never a score. */
  const BUILD_ERROR_RE = /Failed to compile|Module build failed|Module not found|^\.\/[^\n]+\r?\nError:/m;
  async function assertPageHealthy(where) {
    const overlay = await page.evaluate(() => {
      for (const host of document.querySelectorAll("nextjs-portal")) {
        const root = host.shadowRoot;
        if (!root) continue;
        const el = root.querySelector(
          "[data-nextjs-dialog], [data-nextjs-error-overlay], #nextjs__container_errors_label, .nextjs-container-errors-header"
        );
        if (el) return (el.textContent || "dev error overlay").trim().slice(0, 160);
      }
      return null;
    }).catch(() => null);
    const compile = errors.find((e) => BUILD_ERROR_RE.test(e));
    if (overlay || compile) {
      throw new Error(
        `PAGE BROKE UNDER THE HARNESS (${where}) — refusing to score.\n` +
        `      ${overlay ? `dev error overlay: ${overlay}` : `compile error on the console:\n      ${compile.split("\n").slice(0, 2).join(" ")}`}\n` +
        `      The route served 200 and then failed to compile, so any frame captured\n` +
        `      after that point is the Next.js error overlay, not the scene. Fix the\n` +
        `      page and re-run; do not quote numbers from a run that hit this.`
      );
    }
  }

  // --- the cycle, repeated RUNS times ---------------------------------------
  //
  // Pointer stations. PARK is off-subject, bottom-left. The pair is 35% and 65%
  // of width at mid-height, and HOLD is a third capture at 65% — the same
  // pointer position as the second, one more dwell later. That third frame is
  // DEFECT 1's fix and it is why the cycle is five captures, not four.
  const PARK = [Math.round(VW * 0.05), Math.round(VH * 0.93)];
  const PL = [Math.round(VW * 0.35), Math.round(VH * 0.5)];
  const PR = [Math.round(VW * 0.65), Math.round(VH * 0.5)];
  const DWELL = 1400;
  const travel = Math.abs(PR[0] - PL[0]);
  const silOverride = opts["silhouette-thr"] === undefined ? null : Number(opts["silhouette-thr"]);

  async function captureCycle(run) {
    const shot = (t) => snap(`r${run}-${t}`);
    await assertPageHealthy(`start of run ${run}`);
    // rest pair: pointer parked off-subject, two frames ~500ms apart
    await page.mouse.move(PARK[0], PARK[1], { steps: 6 });
    await page.waitForTimeout(1500);
    const restA = await shot("rest-a");
    await page.waitForTimeout(500);
    const restB = await shot("rest-b");
    // pointer pair: 35% width vs 65% width
    await page.mouse.move(PL[0], PL[1], { steps: 14 });
    await page.waitForTimeout(DWELL);
    const left = await shot("pointer-35");
    await page.mouse.move(PR[0], PR[1], { steps: 14 });
    await page.waitForTimeout(DWELL);
    const right = await shot("pointer-65");
    // CONTROL: pointer HELD where it already is, one more identical dwell. Same
    // elapsed interval, same registration, same cut — so the only difference
    // between this pair and the one above is whether the pointer moved.
    await page.mouse.move(PR[0], PR[1], { steps: 2 });
    await page.waitForTimeout(DWELL);
    const hold = await shot("pointer-65-hold");
    await assertPageHealthy(`end of run ${run}`);
    return { restA, restB, left, right, hold };
  }

  function scoreCycle({ restA, restB, left, right, hold }) {
    const m1 = aliveness(restA, restB, aliveStep);
    const m3 = blownHighlights(restA);
    const m4 = darkPlacement(restA);
    const m5 = largestFlatRegion(restA, flatTol);
    const tr = findTranslation(left, right);
    const trHold = findTranslation(right, hold);
    const m6 = (Math.abs(tr.dx) / VW) * 100;

    // One background level and one Otsu cut, taken from the left frame, used by
    // BOTH pairs. See the note on silhouetteIoU().
    const bg = backgroundLevel(left);
    const anchor = { med: bg.med, thr: silOverride ?? subjectCut(left, bg.med) };
    const moved = silhouetteIoU(left, right, tr.dx, tr.dy, anchor);
    const still = silhouetteIoU(right, hold, trHold.dx, trHold.dy, anchor);

    // TRAP 2 again, applied to the control: "the same elapsed interval" is a
    // request until it is read off the page's own clock. Both gaps are carried
    // out so the comparison can be checked rather than asserted.
    const restGap = restB.clock.before - restA.clock.after;
    const movedGap = right.clock.before - left.clock.after;
    const stillGap = hold.clock.before - right.clock.after;

    return {
      measured: {
        aliveness: m1,
        response: still.iou - moved.iou,
        blown: m3,
        darkY: m4.y,
        flat: m5,
        iouMoved: moved.iou,
        iouStill: still.iou,
        parallax: m6,
      },
      detail: {
        dark: m4, tr, trHold, moved, still, anchor,
        restGap, movedGap, stillGap,
        parallaxPctTravel: (Math.abs(tr.dx) / travel) * 100,
      },
    };
  }

  const runs = [];
  for (let r = 1; r <= RUNS; r++) {
    if (RUNS > 1) say(`  run ${r}/${RUNS} ...`);
    const frames = await captureCycle(r);
    runs.push(scoreCycle(frames));
  }

  await page.close();
  await browser.close();

  // --- aggregate ------------------------------------------------------------
  // Verdict on the MEDIAN, spread printed. See the note at RUNS.
  const stat = {};
  for (const t of TARGETS) {
    const vals = runs.map((r) => r.measured[t.key]);
    stat[t.key] = { median: median(vals), min: Math.min(...vals), max: Math.max(...vals), runs: vals };
  }

  // The frames kept under the legacy unprefixed names are the run closest to
  // the median across every scored metric — i.e. the run the verdict describes,
  // so scripts/flat-locate.mjs and a human eye are looking at the same frame
  // the table does. Every run's frames stay on disk under their r<n>- prefix.
  const scoredKeys = TARGETS.filter((t) => t.band).map((t) => t.key);
  let repIdx = 0, repCost = Infinity;
  runs.forEach((r, i) => {
    let c = 0;
    for (const k of scoredKeys) {
      const s = stat[k], span = s.max - s.min;
      c += span > 0 ? Math.abs(r.measured[k] - s.median) / span : 0;
    }
    if (c < repCost) { repCost = c; repIdx = i; }
  });
  const repRun = repIdx + 1;
  for (const t of ["rest-a", "rest-b", "pointer-35", "pointer-65", "pointer-65-hold"]) {
    try { fs.copyFileSync(path.join(outDir, `r${repRun}-${t}.png`), path.join(outDir, `${t}.png`)); } catch {}
  }

  const rep = runs[repIdx].detail;
  if (rep.dark.mode.startsWith("adaptive")) {
    notes.push("dark placement used the adaptive definition — this frame has almost nothing under 25L");
  }
  if (rep.tr.removed < PARALLAX_MIN_REMOVED) {
    notes.push(`the best dx removes only ${rep.tr.removed.toFixed(1)}% of the frame difference (a real pan removes ~74%), ` +
      `so this dx is idle-animation noise, not a translation — parallax is scored as absent whatever the number reads`);
  }
  // DEFECT 1, made loud. If the raw two-pointer IoU would have passed the
  // retired band while the pointer accounts for almost none of it, say so.
  if (stat.iouMoved.median <= SUBJECT_IOU[SUBJECT][1] && stat.response.median < RESP_MIN) {
    notes.push(`the raw two-pointer IoU ${stat.iouMoved.median.toFixed(3)} clears the RETIRED ` +
      `<=${SUBJECT_IOU[SUBJECT][1]} band, but holding the pointer still over the same interval gives ` +
      `${stat.iouStill.median.toFixed(3)} — only ${stat.response.median.toFixed(3)} of the reshape is the cursor. ` +
      `This cell passed the old metric on elapsed time`);
  }
  if (stat.response.median < 0) {
    notes.push("negative response: the same-pointer pair overlapped LESS than the two-pointer pair, " +
      "which means the scene's own animation dominates both and no pointer signal is separable here");
  }

  const credible = rep.tr.removed >= PARALLAX_MIN_REMOVED;
  const rows = TARGETS.map((t) => {
    const s = stat[t.key];
    // band: null means informational — measured and printed, never scored.
    if (!t.band) return { ...t, ...s, pass: null, onBar: false };
    const pass = s.median >= t.band[0] && s.median <= t.band[1];
    // A cell whose SPREAD straddles its bar is sitting on it: the verdict is a
    // coin-flip the median happens to have won or lost. Printed, not implied.
    const onBar = (s.min < t.band[0] && s.max >= t.band[0]) || (s.min <= t.band[1] && s.max > t.band[1]);
    if (!pass) exitCode = 1;
    return { ...t, ...s, pass, onBar };
  });
  const scored = rows.filter((r) => r.pass !== null);

  const asMetric = (key, extra = {}) => {
    const t = TARGETS.find((x) => x.key === key);
    const s = stat[key];
    return {
      value: s.median, median: s.median, min: s.min, max: s.max, runs: s.runs,
      target: t.band ? t.text : "not scored",
      pass: t.band ? s.median >= t.band[0] && s.median <= t.band[1] : true,
      scored: !!t.band,
      ...extra,
    };
  };

  result = {
    label, url, ok: exitCode === 0,
    renderer: gpu.renderer, vendor: gpu.vendor, glVersion: gpu.version,
    viewport: { w: VW, h: VH },
    knobs: { aliveStep, flatTol, settle, scroll: scrollFrac, wheel, runs: RUNS, subject: SUBJECT },
    verdictOn: "median", representativeRun: repRun,
    clock: {
      source: clockSource,
      restGapSec: rep.restGap, movedGapSec: rep.movedGap, stillGapSec: rep.stillGap,
      shots,
    },
    metrics: {
      aliveness: asMetric("aliveness", { lumaStep: aliveStep, realGapSec: rep.restGap }),
      response: asMetric("response", {
        subject: SUBJECT, definition: "IoU(same-pointer pair) - IoU(two-pointer pair), same interval, same cut",
        iouMoved: stat.iouMoved, iouStill: stat.iouStill,
        threshold: rep.anchor.thr, background: rep.anchor.med,
        registeredDx: rep.tr.dx, registeredDy: rep.tr.dy,
        holdRegisteredDx: rep.trHold.dx, holdRegisteredDy: rep.trHold.dy,
        coverageLeftPct: rep.moved.aPct, coverageRightPct: rep.moved.bPct,
        movedGapSec: rep.movedGap, stillGapSec: rep.stillGap,
      }),
      blown: asMetric("blown"),
      darkY: asMetric("darkY", { mode: rep.dark.mode, populationPct: rep.dark.pop }),
      flat: asMetric("flat", { tolerance: flatTol }),
      // Informational: see the TARGETS note. Reported, never scored.
      iouMoved: asMetric("iouMoved", { retiredBand: `<=${SUBJECT_IOU[SUBJECT][1]}`,
        wouldHavePassedRetiredBand: stat.iouMoved.median <= SUBJECT_IOU[SUBJECT][1] }),
      iouStill: asMetric("iouStill"),
      parallax: asMetric("parallax", { credible,
        dxPx: rep.tr.dx, dyPx: rep.tr.dy, pctPointerTravel: rep.parallaxPctTravel,
        pointerTravelPx: travel, madAtZero: rep.tr.mad0, madAtBest: rep.tr.mad,
        differenceRemovedPct: rep.tr.removed }),
    },
    consoleErrors: errors.slice(0, 10),
    frames: outDir,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const fmt = (v, unit) => (unit === "%" ? `${v.toFixed(2)}%` : v.toFixed(3));
    say("");
    say(`  metric                  median      ${RUNS > 1 ? "min - max          " : "                   "}target`);
    say("  " + "-".repeat(72));
    for (const r of rows) {
      const spread = RUNS > 1 ? `${fmt(r.min, r.unit)} - ${fmt(r.max, r.unit)}` : "";
      const mark = r.pass === null ? "----" : r.pass ? "PASS" : "FAIL";
      say(`  ${r.label.padEnd(23)} ${fmt(r.median, r.unit).padEnd(11)} ${spread.padEnd(19)}` +
          `${r.text.padEnd(11)} ${mark}${r.onBar ? "  <- ON BAR (spread straddles it)" : ""}`);
    }
    say("");
    if (RUNS > 1) {
      say(`  runs        ${RUNS} cycles, one page load; verdict on the median, run ${repRun} kept as the unprefixed frames`);
      for (const r of scored) {
        say(`              ${r.label.padEnd(23)} ${r.runs.map((v) => fmt(v, r.unit)).join("  ")}`);
      }
    }
    say(`  aliveness   luma step >${aliveStep}/255, real gap ${rep.restGap?.toFixed(2)}s (requested 0.50s)`);
    say(`  dark        ${rep.dark.mode}, ${rep.dark.pop.toFixed(2)}% of frame`);
    say(`  flat        seed tolerance +/-${flatTol} per channel`);
    say(`  parallax    dx=${rep.tr.dx}px dy=${rep.tr.dy}px over ${travel}px of pointer travel ` +
        `= ${stat.parallax.median.toFixed(1)}% of frame width, ${rep.parallaxPctTravel.toFixed(1)}% of travel`);
    say(`              MAD ${rep.tr.mad0.toFixed(2)} at dx=0 -> ${rep.tr.mad.toFixed(2)} aligned ` +
        `(${rep.tr.removed.toFixed(1)}% of the difference removed — ${credible ? "credible pan" : `below the ${PARALLAX_MIN_REMOVED}% credibility gate`})`);
    say(`  response    two-pointer IoU ${stat.iouMoved.median.toFixed(3)} vs same-pointer ${stat.iouStill.median.toFixed(3)} ` +
        `= ${stat.response.median.toFixed(3)} attributable to the cursor`);
    say(`              intervals ${rep.movedGap?.toFixed(2)}s moved / ${rep.stillGap?.toFixed(2)}s held; ` +
        `cut |L-${rep.anchor.med.toFixed(0)}| > ${rep.anchor.thr.toFixed(1)}; ` +
        `covers ${rep.moved.aPct.toFixed(1)}% / ${rep.moved.bPct.toFixed(1)}% of frame; ` +
        `registered (${rep.tr.dx},${rep.tr.dy}) moved / (${rep.trHold.dx},${rep.trHold.dy}) held`);
    say("");
    say("  real capture clocks: " + shots.map((s) => `${s.tag}@${s.before?.toFixed(1)}-${s.after?.toFixed(1)}s`).join("  "));
    if (errors.length) {
      say(`  console errors (${errors.length}):`);
      for (const e of errors.slice(0, 5)) say("    - " + e);
    }
    for (const n of notes) say("  note: " + n);
    say("");
    const failed = scored.filter((r) => !r.pass);
    const onBar = scored.filter((r) => r.onBar);
    say(`  VERDICT: ${exitCode === 0
      ? `IN BAND on all ${scored.length} scored metrics (median of ${RUNS})`
      : `OUT OF BAND (${failed.length}/${scored.length}) — ${failed.map((r) => r.label).join(", ")}`}`);
    if (onBar.length) say(`  ON BAR:  ${onBar.map((r) => r.label).join(", ")} — the spread crosses the target, so this cell is a coin-flip`);
    say(`  (one metric out of band is a failing score, however good the others look)`);
    say("");
  }
} catch (e) {
  try { await browser.close(); } catch {}
  // do not leave an empty results directory behind for a run that never scored
  try { if (fs.readdirSync(outDir).length === 0) fs.rmdirSync(outDir); } catch {}
  if (JSON_OUT) console.log(JSON.stringify({ label, url, ok: false, error: String(e.message || e) }, null, 2));
  else {
    console.error(`\n=== FIDELITY: ${label} — CANNOT SCORE ===`);
    console.error("  " + String(e.message || e));
    console.error("");
  }
  process.exit(2);
}

process.exit(exitCode);
