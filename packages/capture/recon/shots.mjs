/**
 * Screenshot several routes at once and report what each one actually does.
 * The single-page version of this exists for the rink; this is for reviewing
 * the site. DEV-ONLY.
 */
import { chromium } from "playwright";

// Routes arrive WITHOUT a leading slash. Git Bash on Windows rewrites any
// argument that looks like a POSIX path, so "/store" arrives as
// "D:/Program Files/Git/store" — and MSYS_NO_PATHCONV=1 fixes that but then
// mangles the output directory instead. Taking bare names sidesteps both.
const routes = process.argv.slice(3).map((r) => (r.startsWith("/") ? r : `/${r}`));
const dir = process.argv[2] ?? ".";
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

for (const r of routes) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  page.on("pageerror", (e) => errs.push(`PAGEERROR: ${e.message}`));
  const name = r === "/" ? "home" : r.replace(/\W+/g, "-").replace(/^-|-$/g, "");
  try {
    await page.goto(`${process.env.SITE_ORIGIN ?? "http://localhost:3001"}${r}`, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${dir}/${name}.png` });
    const t = await page.title();
    console.log(`${r.padEnd(12)} ok  errors:${errs.length}  "${t.slice(0, 46)}"`);
    for (const e of errs.slice(0, 2)) console.log(`     ! ${e.slice(0, 130)}`);
  } catch (e) {
    console.log(`${r.padEnd(12)} FAILED  ${e.message.slice(0, 90)}`);
  }
  await page.close();
}
await browser.close();
