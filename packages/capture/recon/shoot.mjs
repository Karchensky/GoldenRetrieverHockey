/**
 * Screenshot the rink and report what actually happens — console errors,
 * WebGL failures, and whether the canvas is still alive after settling.
 *
 * DEV-ONLY. This is the critic's eyes; without it, feedback on a 3D scene is
 * just opinion about code that may not even be running.
 *
 * Usage: node packages/capture/recon/shoot.mjs <out.png> [waitMs] [action]
 *   action: "throw" clicks the ice; "idle" waits for him to get bored.
 */
import { chromium } from "playwright";

const out = process.argv[2] ?? "shot.png";
const wait = Number(process.argv[3] ?? 3500);
const action = process.argv[4] ?? "none";

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

const browser = await chromium.launch({ args: GPU });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
const logs = [];
page.on("console", (m) => {
  const t = m.text();
  logs.push(`${m.type()}: ${t}`);
  if (m.type() === "error") errors.push(t);
});
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:3001", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1200);

// early frame — does it come up at all?
const early = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { canvas: false };
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  return { canvas: true, w: c.width, h: c.height, gl: !!gl, lost: gl ? gl.isContextLost() : null };
});

await page.waitForTimeout(wait);

if (action === "throw") {
  await page.mouse.move(1100, 620);
  await page.mouse.click(1100, 620);
  await page.waitForTimeout(1400);
  await page.mouse.move(360, 500, { steps: 20 });
  await page.waitForTimeout(1600);
} else if (action === "idle") {
  await page.mouse.move(720, 450);
  await page.waitForTimeout(9000);
}

// late frame — is it STILL there?
const late = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { canvas: false };
  const r = c.getBoundingClientRect();
  const st = getComputedStyle(c);
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  return {
    canvas: true, w: c.width, h: c.height,
    rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
    display: st.display, opacity: st.opacity, visibility: st.visibility,
    gl: !!gl, lost: gl ? gl.isContextLost() : null,
  };
});

await page.screenshot({ path: out });
await browser.close();

console.log("=== early (1.2s) ===");
console.log(" ", JSON.stringify(early));
console.log("=== late (after settle) ===");
console.log(" ", JSON.stringify(late));
console.log(`=== console errors: ${errors.length} ===`);
for (const e of errors.slice(0, 8)) console.log("  ", e.slice(0, 220));
if (!errors.length) {
  for (const l of logs.slice(0, 6)) console.log("   log:", l.slice(0, 140));
}
console.log(`\nwrote ${out}`);
