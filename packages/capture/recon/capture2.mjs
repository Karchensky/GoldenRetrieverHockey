/**
 * Extended recon: multiple checkpoints in one session, plus a high-DPI
 * cropped close-up of the dog for geometry inspection. Read-only, dev-only.
 * Temporary — added by a review pass, safe to delete.
 */
import { chromium } from "playwright";

const outDir = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:3001", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1200);

await page.screenshot({ path: `${outDir}/A_spawn.png` });

// throw: click far side of ice so he has real distance to run
await page.mouse.move(1150, 640);
await page.mouse.click(1150, 640);

await page.waitForTimeout(350);
await page.screenshot({ path: `${outDir}/B_chase_early.png` });

await page.waitForTimeout(550);
await page.screenshot({ path: `${outDir}/C_chase_full.png` }); // ~900ms post-click

await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/D_pickup.png` }); // ~1.8s post-click

await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/E_carrying_return.png` }); // ~3s post-click

// let him finish returning, drop, bow, and settle into a sit
await page.waitForTimeout(3500);
await page.screenshot({ path: `${outDir}/F_settle.png` }); // ~6.5s post-click

await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/G_sit.png` }); // ~9.5s post-click, should be sitting

// Close-up crop for geometry/head detail, centered where the dog usually
// ends up sitting near mid-rink. We don't know exact pixel coords, so grab
// a generous box around rink-center-left where he tends to settle.
await page.screenshot({
  path: `${outDir}/H_closeup_crop.png`,
  clip: { x: 480, y: 300, width: 480, height: 380 },
});

const late = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const gl = c ? (c.getContext("webgl2") || c.getContext("webgl")) : null;
  return { canvas: !!c, lost: gl ? gl.isContextLost() : null };
});

await browser.close();
console.log("late:", JSON.stringify(late));
console.log(`errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(" ", e.slice(0, 200));
