/**
 * DRIVE THE PROLOGUE AND WATCH IT HAPPEN.
 *
 * shoot.mjs answers "is the rink alive". This answers "is the sequence any
 * good", which is a different question and needs a different instrument: the
 * prologue is a TIMELINE, so it has to be sampled on one, and the melt is a
 * POINTER GESTURE, so something has to actually rub the ice.
 *
 * DEV-ONLY. Nothing here ships.
 *
 * Usage: node packages/capture/recon/prologue.mjs <ABS_DIR> [mode]
 *   mode "fall"  — sample the drop and the strike, hands off
 *   mode "melt"  — land it, then scrub the cursor over the block and watch it go
 *   mode "both"  — the default
 *
 * SITE_ORIGIN overrides the target (default http://localhost:3001).
 */
import { chromium } from "playwright";

const dir = process.argv[2] ?? ".";
const mode = process.argv[3] ?? "both";
const origin = process.env.SITE_ORIGIN ?? "http://localhost:3001";

/**
 * THE VIEWPORT IS A PERFORMANCE DIAL, AND FOR THE MELT IT HAS TO BE.
 *
 * Headless chromium rasterises WebGL on the CPU, and this scene is a fur-shell
 * dog behind a transparent block: at 1440x900 it runs at 3fps. That is not a
 * warning about the real site — it is a fact about this harness — but it makes
 * the MELT untestable, because dt is clamped to 1/30 for physics stability and
 * a 3fps frame therefore advances the world by a thirtieth of a second. Ten
 * seconds of rubbing lands as one. I chased that as a bug in the brush before
 * noticing it was arithmetic.
 *
 * So the melt is driven at quarter area, where the same code runs ~4x faster
 * and a scrub is a scrub. Composition is still shot at 1440x900, because that
 * is the frame anyone will actually see.
 */
/**
 * A REAL GPU, AND IT CHANGES WHAT THIS HARNESS IS FOR.
 *
 * Playwright's chromium defaults to SwiftShader — WebGL rasterised on the CPU —
 * and this scene runs at 2-9fps under it. Every round of this project has
 * reviewed its own work through that, and it quietly corrupts three things:
 *
 *   - TIMING. dt is clamped to 1/30 for physics stability, so a 2fps frame
 *     advances the world by a thirtieth of a second. Every eased camera, every
 *     lerp and the melt itself run at a fifteenth of wall-clock speed. I spent
 *     a round reading "the camera has not swung down yet" as a bug in the camera.
 *   - PERFORMANCE. A software rasteriser weights fragment work brutally and
 *     tells you nothing about the machine anyone will use.
 *   - THE PICTURE. Nothing sharpens a judgement like watching it at 2fps and
 *     concluding the design is slow.
 *
 * These three flags hand it the actual card (measured: SwiftShader 9fps ->
 * RTX 3080 43fps at 1440x900). Same page, same build, twenty times the truth.
 */
const GPU = [
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
];

const small = mode === "melt";
const browser = await chromium.launch({ args: GPU });
const page = await browser.newPage({
  viewport: small ? { width: 760, height: 480 } : { width: 1440, height: 900 },
});

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

/** What the scene thinks is going on, straight from the singletons. Reading the
 *  state rather than guessing at it from pixels is the only way to know whether
 *  a frame is the frame you meant to catch. */
const probe = () =>
  page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
    return {
      lost: gl ? gl.isContextLost() : null,
      canvas: c ? `${c.width}x${c.height}` : null,
      p: window.__prologue ?? null,
      // The two things that can free the dog behind my back. When a phase
      // changes and I cannot say why, guessing is how this repo ships nets
      // inside-out.
      scrollY: Math.round(window.scrollY),
      age: Math.round(performance.now()),
    };
  });

await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });

/* ---- the drop. Sampled tight, because the whole thing is over in 2.5s. ---- */
if (mode === "fall" || mode === "both") {
  const marks = [500, 1000, 1250, 1700, 2600];
  let last = 0;
  for (const t of marks) {
    await page.waitForTimeout(t - last);
    last = t;
    await page.screenshot({ path: `${dir}/p-${String(t).padStart(4, "0")}.png` });
    const s = await probe();
    console.log(`t=${String(t).padStart(4)}ms  phase=${String(s.p?.phase).padEnd(8)} light=${(s.p?.light ?? 0).toFixed(2)}  y=${(s.p?.y ?? 0).toFixed(2)}  melt=${(s.p?.melt ?? 0).toFixed(2)}  lost=${s.lost}`);
  }
}

/* ---- the melt. Rub the block like a human would: a scrub, not a teleport. --- */
if (mode === "melt" || mode === "both") {
  if (mode === "melt") await page.waitForTimeout(3200);
  // The block lands dead centre of the frame by construction (see BLOCK_Z in
  // Rink.tsx), so its screen box is knowable without asking the page.
  const vp = page.viewportSize();
  const cx = Math.round(vp.width / 2);
  const cy = Math.round(vp.height * 0.52);
  const RX = Math.round(vp.width * 0.135);
  const RY = Math.round(vp.height * 0.17);
  await page.mouse.move(cx - RX, cy - RY);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${dir}/m-00-touch.png` });

  let shot = 1;
  for (let pass = 0; pass < 14; pass++) {
    const y = cy - RY + (pass % 5) * Math.round(RY / 2);
    await page.mouse.move(cx - RX, y, { steps: 3 });
    await page.mouse.move(cx + RX, y, { steps: 22 });
    await page.mouse.move(cx + RX, y + 18, { steps: 3 });
    await page.mouse.move(cx - RX, y + 18, { steps: 22 });
    const s = await probe();
    console.log(`pass ${String(pass).padStart(2)}  t=${String(s.age).padStart(6)}ms phase=${String(s.p?.phase).padEnd(8)} melt=${(s.p?.melt ?? 0).toFixed(3)}  light=${(s.p?.light ?? 0).toFixed(2)}  scrollY=${s.scrollY}  lost=${s.lost}`);
    if (pass % 3 === 0) {
      await page.screenshot({ path: `${dir}/m-${String(shot).padStart(2, "0")}-melt.png` });
      shot++;
    }
  }
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${dir}/m-90-free.png` });
  const s = await probe();
  console.log(`after break: phase=${s.p?.phase} free=${s.p?.free} light=${(s.p?.light ?? 0).toFixed(2)} lost=${s.lost}`);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${dir}/m-99-settled.png` });
}

/* ---- fps, measured rather than asserted ---- */
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else res(Math.round((n / (performance.now() - t0)) * 1000));
      };
      requestAnimationFrame(tick);
    }),
);
const end = await probe();
console.log(`\nfps=${fps}  canvas=${end.canvas}  contextLost=${end.lost}`);
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log("  !", e.slice(0, 200));

await browser.close();
