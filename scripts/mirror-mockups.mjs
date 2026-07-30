import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

/**
 * Pull every product mockup off Printify's CDN and into the export.
 *
 * The storefront does not hotlink. A static archive whose whole argument is that
 * it outlives the platforms it was recovered from should not serve its shop from
 * somebody else's CDN, and a Printify image URL carries a shop id and an image
 * id into the page source for nothing in return.
 *
 * The mockups themselves come from the provider — they are the garment the maker
 * rendered, not a drawing of it — and they are regenerated whenever a product's
 * artwork or placement changes. So this is idempotent and destructive in the
 * right direction: it writes what the catalog currently names and deletes what
 * it no longer names, because a stale mockup of a placement that was corrected
 * is a picture of a shirt nobody can buy.
 *
 * **It re-fetches on a CHANGED URL, not just a missing file.** The first version
 * skipped anything already on disk, on the reasoning that the sync deletes and
 * recreates a product rather than editing one. That stopped being true the day
 * the sync learned to PUT: correcting octagon-patch-tee's placement and every
 * description in the line regenerated the mockups on Printify's side, and a
 * filename-only check would have kept serving pictures of the old print. So the
 * source URL is recorded beside the file and compared.
 *
 * Run after a sync:  npm run store:mockups
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CATALOG = join(ROOT, "apps/web/data/products.json");
const OUT = join(ROOT, "apps/web/public/store");

/** Wide enough for a 2x hero on a laptop; past that the garment is not the point. */
const WIDTH = 1200;

const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
await mkdir(OUT, { recursive: true });

const wanted = new Set();
let fetched = 0;
let skipped = 0;

const existing = new Set(
  (await readdir(OUT).catch(() => [])).filter((f) => f.endsWith(".webp")),
);

/** filename -> the CDN URL it was fetched from. Gitignored; a cache key, not data. */
const SOURCES = join(OUT, ".sources.json");
const sources = await readFile(SOURCES, "utf8").then(JSON.parse).catch(() => ({}));

/**
 * Order a product's mockups DARKEST GARMENT FIRST before they are written.
 *
 * Printify returns the white colourway first for almost everything, so a grid of
 * twenty products was twenty white shirts on a near-black page — the captain:
 * "don't use the default white for each item in the main store thumbnail".
 *
 * The decision lives here rather than in the storefront because the storefront
 * cannot see a colour: it has a list of URLs and no idea what is in them. Here
 * the pixels are already in hand. Mean luminance over the middle of the frame is
 * enough — that region is garment on every mockup in this shop, and the ranking
 * only has to be right relative to the other views of the SAME product.
 *
 * The app stays dumb: `mockups[0]` is the hero, and it is now the black hoodie
 * rather than the white one.
 */
/**
 * Choose and order a product's mockups: no people, and a different body colour
 * from the product next to it.
 *
 * TWO THINGS GO WRONG IF THIS IS LEFT TO PRINTIFY.
 *
 * **Models are no longer this file's problem.** They are filtered in sync.ts,
 * off Printify's own `camera_label=person-…` marker, so the catalog never lists
 * one and this script never sees one. The skin-tone heuristic that used to live
 * here was wrong twice over: it dropped clean sticker shots because a golden
 * retriever's fur reads as skin, and it filtered AFTER the catalog was written,
 * so the storefront was left pointing at eleven files that were never saved.
 *
 * **Sameness.** The first version of this sorted DARKEST FIRST, which fixed
 * "everything is white" by creating "everything is black": every hoodie navy,
 * every tee black, an entire category in one colour. Sorting is the wrong tool —
 * any total order over a set of near-identical products produces a uniform row.
 *
 * So the list is sorted by luminance and then ROTATED by the product's position
 * in its own category. Neighbouring products therefore lead with different
 * colourways by construction, it is deterministic (the same catalog always
 * produces the same grid), and no product ever leads with a colour it does not
 * come in.
 */
async function chooseAndOrder(urls, rotation) {
  const kept = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const { channels } = await sharp(buf).extract(await centreBox(buf)).stats();
    const [r, g, b] = channels;
    kept.push({ url, lum: (0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean) / 255 });
  }
  kept.sort((a, b) => a.lum - b.lum);
  if (!kept.length) return [];
  const at = ((rotation % kept.length) + kept.length) % kept.length;
  return [...kept.slice(at), ...kept.slice(0, at)].map((k) => k.url);
}

async function centreBox(buf) {
  const { width, height } = await sharp(buf).metadata();
  const w = Math.max(1, Math.round(width * 0.34));
  const h = Math.max(1, Math.round(height * 0.34));
  return { left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h };
}

// Rotation counted PER CATEGORY, so it is the products sitting next to each
// other in a row that differ, which is the only place sameness is visible.
const seenInCategory = new Map();

for (const product of catalog.products) {
  const category = product.itemId ?? "other";
  const rank = seenInCategory.get(category) ?? 0;
  seenInCategory.set(category, rank + 1);
  const mockups = await chooseAndOrder(product.mockups ?? [], rank);
  for (const [index, url] of mockups.entries()) {
    const name = `${product.id}-${index}.webp`;
    wanted.add(name);

    // Already mirrored FROM THIS URL. A regenerated mockup gets a new URL and
    // is re-fetched; an unchanged one is left alone.
    if (existing.has(name) && sources[name] === url) { skipped += 1; continue; }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `${product.id} mockup ${index}: ${res.status} ${res.statusText}\n${url}\n` +
          `The catalog names a mockup the CDN will not serve. Re-run the sync.`,
      );
    }
    const source = Buffer.from(await res.arrayBuffer());
    const webp = await sharp(source)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    await writeFile(join(OUT, name), webp);
    sources[name] = url;
    fetched += 1;
    console.log(`${name.padEnd(44)} ${(webp.length / 1024).toFixed(0)} KB`);
  }
}

let removed = 0;
for (const file of existing) {
  if (wanted.has(file)) continue;
  await unlink(join(OUT, file));
  delete sources[file];
  removed += 1;
  console.log(`removed ${file}`);
}

await writeFile(SOURCES, `${JSON.stringify(sources, null, 2)}\n`);

console.log(
  `\n${wanted.size} mockups for ${catalog.products.length} products — ` +
    `${fetched} fetched, ${skipped} already had, ${removed} removed.`,
);

if (!wanted.size) {
  console.warn(
    "\nNo mockups in the catalog. products.json carries them only after a sync " +
      "that read the products back — run `npm run store:sync` first.",
  );
}
