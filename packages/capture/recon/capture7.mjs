/**
 * Throw toward screen-center (not off toward the edge) so the fetch cycle,
 * including the carry, stays in frame. Multiple checkpoints. No hero text.
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

await page.mouse.move(860, 560);
await page.mouse.click(860, 560);

for (const t of [500, 1000, 1500, 2000, 2600, 3200, 4000]) {
  await page.waitForTimeout(t === 500 ? 500 : 500);
  await page.screenshot({ path: `${outDir}/near_t${t}.png` });
}

await browser.close();
console.log("done");
