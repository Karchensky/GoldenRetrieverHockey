// Compress Blender bake output for the web.
//   node scripts/compress-bakes.mjs [--quality 82] [--keep-png]
//
// Blender writes bakes as full-colour PNG. Two kinds arrive here and they want
// opposite treatment:
//
//   SINGLE-CHANNEL bakes — ambient occlusion, curvature. Smoothly-varying data
//   in one channel, written as RGB, so the PNG is roughly ten times the bytes
//   it needs. Greyscale WebP carries it at a fraction of the size with no
//   visible difference at the size it is sampled.
//
//   COLOUR bakes — the terrain lightmaps. These are COMBINED Cycles renders and
//   the colour IS the content: a snow crest catching a dawn sun is amber and
//   the hollow behind it is blue, and greyscaling them would throw away the
//   single thing a GI bake is for. They take a colour path with chroma
//   subsampling off, because a lightmap's chroma is low-frequency but a 4:2:0
//   decimation of it puts colour fringes along every ridge line.
//
// The classification is by CONTENT, not by filename: an image whose channels
// differ by less than a percent of the range is monochrome whoever wrote it.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
// 92, not the 82 a photograph would take. A lightmap is multiplied down by a
// factor of twenty on the way to the screen and then pushed back up by ACES and
// a contrast-lifting post chain, so a compression artefact that is invisible in
// the source is not necessarily invisible in the frame. It costs nothing worth
// having here: the terrain atlas is 4096 square and lands at a quarter of a
// megabyte either way, because a GI bake of snow is mostly low frequency.
const QUALITY = Number(flag("quality", "92"));
const KEEP = args.includes("--keep-png");
/**
 * `--only <substring>` narrows what is converted, and it is not a convenience.
 * This directory is shared: the retriever bake writes into it too, and several
 * agents have worked in it at once. A pass that converts and then DELETES every
 * PNG it finds will happily eat an intermediate somebody else is halfway
 * through writing. Name what you own.
 */
const ONLY = flag("only", null);

const TEX = path.resolve("apps/web/public/textures");

const targets = fs.readdirSync(TEX)
  .filter((f) => f.endsWith(".png"))
  .filter((f) => (ONLY ? f.includes(ONLY) : true));
if (!targets.length) {
  console.log("  nothing to compress in", TEX);
  process.exit(0);
}

/** True when the three channels carry the same signal — an AO or curvature map. */
async function isMonochrome(src) {
  const { channels } = await sharp(src).stats();
  if (channels.length < 3) return true;
  const [r, g, b] = channels;
  const spread = Math.max(
    Math.abs(r.mean - g.mean), Math.abs(g.mean - b.mean), Math.abs(r.mean - b.mean),
  );
  return spread < 2.0;
}

let before = 0, after = 0;
for (const f of targets) {
  const src = path.join(TEX, f);
  const dst = src.replace(/\.png$/, ".webp");
  const bIn = fs.statSync(src).size;
  const mono = await isMonochrome(src);

  const pipe = sharp(src);
  if (mono) {
    await pipe.greyscale().webp({ quality: 88, effort: 6 }).toFile(dst);
  } else {
    await pipe
      .webp({
        quality: QUALITY,
        effort: 6,
        // A lightmap is sampled as data. 4:2:0 chroma on a bake puts colour
        // fringes along every ridge, where the hue changes fastest.
        smartSubsample: false,
        chromaSubsampling: "4:4:4",
      })
      .toFile(dst);
  }

  const bOut = fs.statSync(dst).size;
  before += bIn; after += bOut;
  const dim = await sharp(dst).metadata();
  console.log(
    `  ${f} ${dim.width}x${dim.height} ${mono ? "grey" : "colour"}`
    + `  ${(bIn / 1024).toFixed(0)}KB -> ${(bOut / 1024).toFixed(0)}KB`,
  );
  if (!KEEP) fs.unlinkSync(src);   // the PNG is intermediate, not an asset
}
console.log(`\n  total ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024 / 1024).toFixed(2)}MB\n`);

// Payload report, because the budget is a number and not a feeling.
const shipped = fs.readdirSync(TEX)
  .filter((f) => f.endsWith(".webp"))
  .map((f) => [f, fs.statSync(path.join(TEX, f)).size]);
const MODELS = path.resolve("apps/web/public/models");
for (const f of fs.readdirSync(MODELS).filter((f) => f.endsWith(".glb"))) {
  shipped.push([`models/${f}`, fs.statSync(path.join(MODELS, f)).size]);
}
shipped.sort((a, b) => b[1] - a[1]);
console.log("  shipped assets:");
for (const [f, n] of shipped) console.log(`    ${(n / 1024).toFixed(0).padStart(6)} KB  ${f}`);
console.log(`    ${(shipped.reduce((a, x) => a + x[1], 0) / 1024 / 1024).toFixed(2)} MB total\n`);
