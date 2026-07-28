/**
 * Clean (no hero-text overlay) checkpoints: hide the DOM content layer so
 * only the canvas shows, for judging the model itself. Read-only, dev-only.
 * Temporary — added by a review pass, safe to delete.
 */
import { chromium } from "playwright";

const outDir = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

await page.goto("http://localhost:3001", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const el = document.querySelector(".content");
  if (el) el.style.display = "none";
});

await page.screenshot({ path: `${outDir}/clean_spawn.png` });

await page.mouse.move(1150, 640);
await page.mouse.click(1150, 640);

await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/clean_chase.png` });

await page.waitForTimeout(1800);
await page.screenshot({ path: `${outDir}/clean_carry.png` });

await page.waitForTimeout(4500);
await page.screenshot({ path: `${outDir}/clean_settle.png` });

await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/clean_sit.png` });

await browser.close();
console.log("done");
