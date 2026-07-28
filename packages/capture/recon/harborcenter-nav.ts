/**
 * Recon: find how HarborCenter's stats UI navigates between seasons, by
 * reading the rendered DOM rather than guessing endpoints.
 *
 * DEV-ONLY. Not part of the capture pipeline.
 *
 * Run: node packages/capture/recon/harborcenter-nav.ts [url]
 */
import { chromium } from "playwright";

const url =
  process.argv[2] ?? "https://www.rinksatharborcenter.com/stats#/1367/team/681628/stats";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(3500);

console.log("=== page title / header ===");
console.log("  ", (await page.title()) || "(none)");
const hero = await page.locator("header .title, header .bh").allTextContents();
console.log("  hero:", hero.join(" | "));

console.log("\n=== every in-app link (#/... routes) ===");
const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map((a) => ({
      href: (a as HTMLAnchorElement).getAttribute("href") ?? "",
      text: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((l) => l.href.includes("#/"))
    .slice(0, 60),
);
for (const l of links) console.log(`  ${l.href.padEnd(46)} ${l.text.slice(0, 40)}`);

console.log("\n=== select / dropdown controls (season pickers live here) ===");
const selects = await page.evaluate(() =>
  Array.from(document.querySelectorAll("select")).map((s) => ({
    name: s.getAttribute("name") ?? s.getAttribute("ng-model") ?? "?",
    options: Array.from(s.options).map((o) => `${o.value}=${o.text.trim()}`),
  })),
);
for (const s of selects) {
  console.log(`  <select ${s.name}> ${s.options.length} options`);
  for (const o of s.options.slice(0, 40)) console.log("     ", o);
}

console.log("\n=== dropdown-wrap / menu widgets (Angular custom pickers) ===");
const menus = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".dropdown-wrap, .menu, [ng-click*='show_']"))
    .map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && t.length < 400)
    .slice(0, 12),
);
for (const m of menus) console.log("  -", m.slice(0, 160));

await browser.close();
