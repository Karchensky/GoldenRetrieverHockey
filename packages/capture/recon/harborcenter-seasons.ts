/**
 * Recon: enumerate the seasons of Seneca HAHL (league 1367) at HarborCenter,
 * and locate every Golden Retrievers team instance across them.
 *
 * DEV-ONLY. Not part of the capture pipeline.
 *
 * Uses the page's own fetch so the request is byte-identical to what the SPA
 * sends (curl normalises `/partials/stats/?x` to `/partials/stats?x`, which
 * the API 404s).
 *
 * Run: node packages/capture/recon/harborcenter-seasons.ts
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("https://www.rinksatharborcenter.com/stats#/1367", {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await page.waitForTimeout(2500);

// Call the API from inside the page: same origin, same ticket, same headers.
const raw = await page.evaluate(async () => {
  const ticket = window.localStorage.getItem("website_api_ticket");
  const res = await fetch(
    "https://web.api.digitalshift.ca/partials/stats/?league_id=1367",
    { headers: { Authorization: `ticket="${ticket}"` } },
  );
  return { status: res.status, body: await res.text() };
});

await browser.close();

console.log("status:", raw.status, "| bytes:", raw.body.length);
const content = JSON.parse(raw.body).content as string;

// The Angular partial carries its data as JSON inside ng-init attributes.
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");

console.log("\n=== JSON payloads embedded in the league partial ===");
for (const m of content.matchAll(/ng-init="[^"=]*=\s*(\[[\s\S]*?\])"/g)) {
  let val: unknown;
  try {
    val = JSON.parse(decode(m[1]!));
  } catch {
    continue;
  }
  if (!Array.isArray(val) || val.length === 0) continue;
  console.log(`\n  [${val.length} entries]`);
  for (const v of val.slice(0, 60)) {
    console.log("   ", JSON.stringify(v).slice(0, 130));
  }
}

// Fallback: visible text, in case seasons render as plain markup.
const text = content
  .replace(/<[^>]+>/g, "\n")
  .split("\n")
  .map((l) => decode(l).trim())
  .filter(Boolean);
console.log("\n=== visible text (first 40 lines) ===");
console.log(text.slice(0, 40).map((l) => "  " + l).join("\n"));
