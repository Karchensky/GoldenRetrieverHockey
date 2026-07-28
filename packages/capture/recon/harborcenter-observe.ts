/**
 * Recon: observe how HarborCenter's SPA authenticates to the DigitalShift API.
 *
 * DEV-ONLY. Not part of the capture pipeline and not imported by it — the
 * capture package stays zero-runtime-dependency. This exists solely to answer
 * one question that static analysis could not: which service issues the ticket
 * that `stats.api.digitalshift.ca` accepts.
 *
 * Run: node packages/capture/recon/harborcenter-observe.ts
 */
import { chromium } from "playwright";

const TEAM_URL =
  process.argv[2] ?? "https://www.rinksatharborcenter.com/stats#/1367/team/681628/stats";

type Seen = {
  method: string;
  url: string;
  auth: string | null;
  status: number | null;
  bodyPreview: string | null;
};

const seen: Seen[] = [];

const browser = await chromium.launch();
const page = await browser.newPage();

// Record every DigitalShift API request and its auth header.
page.on("request", (req) => {
  const url = req.url();
  if (!url.includes("digitalshift")) return;
  seen.push({
    method: req.method(),
    url,
    auth: req.headers()["authorization"] ?? null,
    status: null,
    bodyPreview: req.method() === "POST" ? (req.postData() ?? null) : null,
  });
});

page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("digitalshift")) return;
  const rec = seen.find((s) => s.url === url && s.status === null);
  if (!rec) return;
  rec.status = res.status();
  try {
    const t = await res.text();
    rec.bodyPreview = t.slice(0, 220);
  } catch {
    /* body not available (e.g. preflight) */
  }
});

await page.goto(TEAM_URL, { waitUntil: "networkidle", timeout: 60_000 });
// Hash-routed SPA: give the in-app router time to fire its data calls.
await page.waitForTimeout(4000);

// The ticket the app obtained for itself.
const ticket = await page.evaluate(() =>
  window.localStorage.getItem("website_api_ticket"),
);

await browser.close();

console.log("=== DigitalShift calls the SPA actually made ===");
for (const s of seen) {
  const host = new URL(s.url).host;
  const path = new URL(s.url).pathname + new URL(s.url).search;
  console.log(`\n  ${s.method} ${host}${path}`);
  console.log(`    status : ${s.status}`);
  console.log(`    auth   : ${s.auth ? s.auth.slice(0, 28) + "..." : "(none)"}`);
  if (s.bodyPreview) {
    console.log(`    body   : ${s.bodyPreview.replace(/\s+/g, " ").slice(0, 180)}`);
  }
}

console.log("\n=== localStorage.website_api_ticket ===");
console.log(`  ${ticket ? `present, length ${ticket.length}` : "absent"}`);

const statsCalls = seen.filter((s) => new URL(s.url).host.startsWith("stats."));
console.log("\n=== stats.api auth headers observed ===");
if (statsCalls.length === 0) {
  console.log("  none — the SPA never called stats.api on this route");
} else {
  for (const s of statsCalls) {
    console.log(`  ${new URL(s.url).pathname} -> ${s.auth ?? "(no auth header)"}`);
  }
}
