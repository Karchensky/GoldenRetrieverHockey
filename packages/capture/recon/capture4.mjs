/**
 * Tight crops on the dog at the same "mid-chase, facing camera" checkpoint
 * used in capture3, for close inspection of head/ear/tail geometry.
 * Temporary — added by a review pass, safe to delete.
 */
import { chromium } from "playwright";

const outDir = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 3,
});

await page.goto("http://localhost:3001", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const el = document.querySelector(".content");
  if (el) el.style.display = "none";
});

await page.mouse.move(1150, 640);
await page.mouse.click(1150, 640);
await page.waitForTimeout(900);

await page.screenshot({ path: `${outDir}/crop_body.png`, clip: { x: 196, y: 182, width: 500, height: 500 } });
await page.screenshot({ path: `${outDir}/crop_head.png`, clip: { x: 336, y: 322, width: 220, height: 220 } });

// also grab a clean broadside-ish silhouette a bit later, once he's mid-run
// further from spawn (different facing angle than straight-at-camera)
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/clean_chase2_full.png` });

await browser.close();
console.log("done");
