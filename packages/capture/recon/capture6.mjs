/**
 * Generous-margin close-up (wide clip box to tolerate position uncertainty)
 * at the 1.2s settle checkpoint, plus a same-margin crop of a sitting pose.
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

// generous box, wide margin for run-to-run drift
await page.screenshot({ path: `${outDir}/zoom_settle.png`, clip: { x: 50, y: 200, width: 600, height: 600 } });

// throw, then let him fully return/bow/sit, then a same-technique wide crop
await page.mouse.move(1150, 640);
await page.mouse.click(1150, 640);
await page.waitForTimeout(9000);
await page.screenshot({ path: `${outDir}/clean_sit_full.png` });

await browser.close();
console.log("done");
