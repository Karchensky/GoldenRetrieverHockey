/**
 * High-DPI crop at the most reproducible checkpoint (1.2s settle, before any
 * click/throw — only autonomous drift has happened, so dog position varies
 * little run to run). Temporary — added by a review pass, safe to delete.
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

await page.screenshot({ path: `${outDir}/crop_spawn_full.png` });
await page.screenshot({ path: `${outDir}/crop_spawn_zoom.png`, clip: { x: 150, y: 280, width: 300, height: 300 } });

await browser.close();
console.log("done");
