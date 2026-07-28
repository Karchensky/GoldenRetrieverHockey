// Harvest print-ready art from the built store.
//
// The site IS the design source: every product page renders its design as an SVG
// through `ProductFigure`. Rather than keep a second copy of that art in a script
// (which would drift), this walks the built export, lifts each design's SVG out of
// the DOM, strips the garment silhouette so only the artwork remains, and writes a
// transparent PNG at print resolution plus the SVG itself.
//
//   npm run build:site            # produces apps/web/out
//   node scripts/build-print-files.mjs [--dpi 300] [--port 8231]
//
// Output: dist/print/<design>.png  (transparent, DPI-tagged)
//         dist/print/<design>.svg  (vector master)
//         dist/print/manifest.json (what exists + pixel dims + which products use it)
import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "apps/web/out");
const DEST = path.join(ROOT, "dist/print");

const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DPI = parseInt(argVal("--dpi", "300"), 10);
const PORT = parseInt(argVal("--port", "8231"), 10);

if (!fs.existsSync(OUT_DIR)) {
  console.error("no build at apps/web/out — run `npm run build:site` first");
  process.exit(1);
}
fs.mkdirSync(DEST, { recursive: true });

const products = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/data/products.json"), "utf8"));
const items = Array.isArray(products) ? products : products.products || [];

// Printify wants the art sized to the blueprint's print area. These are the
// print areas quoted in each product's own spec; inches -> pixels at --dpi.
const PRINT_INCHES = {
  tee: [12, 16], "tee-back": [12, 16], hoodie: [12, 14], jersey: [12, 14],
  cap: [4.5, 2.25], beanie: [4.5, 2.25], sticker: [8.5, 11], puck: [3, 3], mug: [8.5, 3.5],
};

// serve the static export (file:// blocks the page's own asset loads)
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.join(OUT_DIR, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
  if (!fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// Rasterise in the browser, not through a second SVG renderer: the site's own
// typography IS the artwork, and librsvg would substitute different fonts.
// deviceScaleFactor multiplies CSS pixels into device pixels, so CSS = DPI/SCALE
// inches gives an exact --dpi file.
const browser = await chromium.launch();
const written = [];

// PHASE 1 — harvest the vector art. The store pages each mount the site's live
// WebGL world; holding one open starves later captures, so this page is closed
// before a single pixel is rendered.
const harvested = [];
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const seen = new Set();
  for (const product of items) {
    await page.goto(`http://127.0.0.1:${PORT}/store/${product.id}.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const present = new Set(await page.evaluate(() => [...document.querySelectorAll("[data-art]")].map((n) => n.getAttribute("data-art"))));

    // Two passes. The site flips the print colour to stay legible on the garment
    // (inkOn), so a shirt catalogue needs both inks: one file for light bodies,
    // one for dark. Pick the darkest and lightest colourway this product offers.
    const swatches = await page.$$("[aria-pressed][aria-label]");
    const lum = (product.colors || []).map((c) => {
      const h = (c.hex || "#888").replace("#", "");
      const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
      return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
    });
    const passes = [];
    if (swatches.length && lum.length === swatches.length) {
      const lightIdx = lum.indexOf(Math.max(...lum));
      const darkIdx = lum.indexOf(Math.min(...lum));
      passes.push({ idx: lightIdx, suffix: "" });
      if (darkIdx !== lightIdx && lum[darkIdx] < 0.45) passes.push({ idx: darkIdx, suffix: "-on-dark" });
    } else {
      passes.push({ idx: -1, suffix: "" });
    }

    for (const pass of passes) {
    if (pass.idx >= 0 && swatches[pass.idx]) {
      await swatches[pass.idx].click().catch(() => {});
      await page.waitForTimeout(220);
    }
    for (const image of product.images || []) {
      const design = (image.design || "") + pass.suffix;
      const silhouette = image.silhouette || product.kind;
      if (!image.design || seen.has(design) || !present.has(image.design)) continue;

      // Lift ONLY the artwork group (`data-art`) — the garment silhouette is the
      // store's presentation and never belongs in the file a printer receives.
      const svg = await page.evaluate((wanted) => {
        const g = document.querySelector(`[data-art="${wanted}"]`);
        if (!g) return null;
        const b = g.getBBox();
        const pad = Math.max(b.width, b.height) * 0.02;
        const clone = g.cloneNode(true);
        clone.removeAttribute("transform"); // the group's own box is the canvas now
        const cs = getComputedStyle(document.documentElement);
        // XMLSerializer, not outerHTML: the print file must be well-formed XML
        let inner = new XMLSerializer().serializeToString(clone);
        for (const v of ["--mono", "--disp", "--ink", "--ball", "--ball-pure", "--gold"]) {
          // font stacks carry double quotes; they would break the attribute they land in
          const val = cs.getPropertyValue(v).trim().replace(/"/g, "'");
          if (val) inner = inner.split(`var(${v})`).join(val);
        }
        const vb = [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2].map((n) => Math.round(n * 100) / 100).join(" ");
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${inner}</svg>`;
      }, image.design);
      if (!svg) { console.warn(`  ! ${product.id}: no [data-art] for "${design}"`); continue; }

      seen.add(design);
      fs.writeFileSync(path.join(DEST, `${design}.svg`), svg, "utf8");
      harvested.push({ design, silhouette, svg, kind: product.kind, base: image.design });
    }
    }
  }
  await page.close();
}

// PHASE 2 — render each design alone on a blank stage, one page at a time.
for (const { design, silhouette, svg, kind, base } of harvested) {
  const [wIn, hIn] = PRINT_INCHES[silhouette] || PRINT_INCHES[kind] || [12, 16];
  // Chromium refuses very large captures. Rather than fail (or upscale, which
  // fakes resolution), drop this design's DPI to what renders honestly and
  // record it — a 12×16in front lands at 240dpi, above Printify's floor.
  const BUDGET = 9.2e6;
  let dpi = DPI;
  if (wIn * hIn * dpi * dpi > BUDGET) dpi = Math.floor(Math.sqrt(BUDGET / (wIn * hIn)) / 10) * 10;
  const wPx = Math.round(wIn * dpi), hPx = Math.round(hIn * dpi);

  let stagePage;
  // The first capture after the harvest pages sometimes comes back empty while
  // the compositor settles; one retry is enough and costs a few hundred ms.
  for (let attempt = 0; attempt < 2; attempt++) {
  try {
    stagePage = await browser.newPage({ viewport: { width: wPx, height: hPx }, deviceScaleFactor: 1 });
    await stagePage.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}` +
      `svg{display:block;width:${wPx}px;height:${hPx}px}</style>` +
      svg.replace("<svg ", `<svg preserveAspectRatio="xMidYMid meet" width="${wPx}" height="${hPx}" `),
      { waitUntil: "load" },
    );
    await stagePage.waitForTimeout(120);
    const buf = await stagePage.screenshot({ omitBackground: true });
    const st = await sharp(buf).stats();
    if (st.isOpaque) console.warn(`  ~ ${design}: rendered without transparency`);
    await sharp(buf).withMetadata({ density: dpi }).png({ compressionLevel: 9 }).toFile(path.join(DEST, `${design}.png`));
  } catch (e) {
    if (stagePage) { await stagePage.close().catch(() => {}); stagePage = undefined; }
    if (attempt === 0) { await new Promise((r) => setTimeout(r, 500)); continue; }
    console.warn(`  ! ${design}: raster failed — ${String(e).slice(0, 90)}`);
  } finally {
    if (stagePage) await stagePage.close().catch(() => {});
  }
  break;
  }

  written.push({
    design,
    silhouette,
    usedBy: items.filter((p) => (p.images || []).some((i) => i.design === base)).map((p) => p.id),
    ink: design.endsWith("-on-dark") ? "for dark garments" : "for light garments",
    printInches: [wIn, hIn],
    pixels: [wPx, hPx],
    dpi,
    png: `dist/print/${design}.png`,
    svg: `dist/print/${design}.svg`,
  });
  console.log(`  ✓ ${design}  ${wPx}×${hPx}px @${dpi}dpi  (${silhouette})`);
}

fs.writeFileSync(
  path.join(DEST, "manifest.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), dpi: DPI, designs: written }, null, 2),
);

await browser.close();
server.close();
console.log(`\n${written.length} print files -> dist/print/  (manifest.json alongside)`);
