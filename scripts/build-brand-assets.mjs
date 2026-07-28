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
