import { mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "image.png");
const outputDir = join(root, "apps", "web", "public", "brand");
const output = join(outputDir, "golden-retrievers-crest.png");
const size = 256;

const circularMask = Buffer.from(`
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="white" />
  </svg>
`);

await mkdir(outputDir, { recursive: true });
await sharp(source)
  .resize(size, size, { fit: "cover", position: "centre" })
  .composite([{ input: circularMask, blend: "dest-in" }])
  .png({ compressionLevel: 9, palette: true, quality: 100 })
  .toFile(output);

console.log(`Wrote ${relative(root, output)} from image.png`);

/* ------------------------------------------------------------------ */
/* THE SOCIAL CARD                                                     */
/* ------------------------------------------------------------------ */
/*
 * Every link this site has ever had shared previewed as a 256px circle, or as
 * nothing at all: the layout declared `twitter:card = summary_large_image` and
 * then handed it the favicon. A large card wants 1200x630 and a 1.91:1 crop, so
 * platforms either letterboxed the crest into a corner or dropped the image.
 * That is the whole channel a team store spreads through — one player sending
 * another a link — so it is worth an asset of its own.
 *
 * DRAWN FROM THE VECTOR MASTER, not from image.png. The crest above is a
 * 560x560 raster and would be soft at this size. `45-rink-board-lockup` is the
 * right mark for a landscape card for the same reason it is the right mark for
 * a tee: it is the widest thing drawn here, built to be read sideways, and it
 * carries the club name inside the artwork.
 *
 * NO TYPE IS SET HERE. The year on this site is counted from the earliest
 * session on file and never typed, and a year baked into a PNG regenerates only
 * when somebody remembers to run this. The unfurl's headline already carries
 * "Golden Retrievers — Buffalo, est. 2011" from the layout's own metadata,
 * where it is derived.
 */
const cardSource = join(root, "docs", "logos", "vector", "master-svg", "45-rink-board-lockup.svg");
const cardOut = join(outputDir, "golden-retrievers-card.png");
const CARD_W = 1200;
const CARD_H = 630;
// The lockup's own field is #0D0D0E, so the canvas matches it exactly rather
// than sitting the mark on #0a0a0c and drawing a faint rectangle edge round it.
const GROUND = { r: 13, g: 13, b: 14 };
const markWidth = Math.round(CARD_W * 0.9);

const mark = await sharp(cardSource, { density: 300 })
  .resize({ width: markWidth })
  .png()
  .toBuffer();

await sharp({
  create: { width: CARD_W, height: CARD_H, channels: 4, background: GROUND },
})
  .composite([{ input: mark, gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toFile(cardOut);

const { size: cardBytes } = await (await import("node:fs/promises")).stat(cardOut);
console.log(
  `Wrote ${relative(root, cardOut)} ${CARD_W}x${CARD_H} (${(cardBytes / 1024).toFixed(1)} KB) ` +
    `from ${relative(root, cardSource)}`,
);
