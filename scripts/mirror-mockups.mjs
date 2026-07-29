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

for (const product of catalog.products) {
  const mockups = product.mockups ?? [];
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
