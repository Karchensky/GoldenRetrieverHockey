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

/**
 * Card-sized derivatives, written beside the original.
 *
 * **The grid shipped 1.68 MB before a single product was on screen**, because
 * every card carried this same 1200px file. Measured: a card draws 314 CSS px
 * at 1280 and 220 at 360 — where DPR 2 makes it 440 device pixels, so 1200 was
 * 7.4x what was needed on the connection least able to carry it.
 *
 * The 1200 stays: it is what the lightbox loads, which is the one place it was
 * ever the right file, and `srcset` only fetches it when something asks.
 */
const DERIVATIVES = [400, 800];

const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
await mkdir(OUT, { recursive: true });

const wanted = new Set();
let fetched = 0;
let skipped = 0;

/**
 * The social card is 1200x630 and the mockups are 1200x1200.
 *
 * `summary_large_image` wants 1.91:1, and a square handed to it is letterboxed
 * by the platform or dropped. Cropping a square garment shot to 1.91:1 would cut
 * the sleeves off, so the garment is CONTAINED and the remainder filled white —
 * which is the mockups' own studio background, so there is no visible seam.
 *
 * **JPEG, not WebP, and that is the whole reason this file exists rather than
 * `og:image` pointing at the mockup already on disk.** The unfurl is rendered by
 * whatever crawler the link was pasted into, and that is the one audience here
 * whose format support cannot be measured from this machine. A WebP that one
 * chat client will not draw is the same failure as the 256px favicon this
 * replaced: a link that previews as nothing.
 */
const CARD = { width: 1200, height: 630, quality: 82 };

const existing = new Set(
  (await readdir(OUT).catch(() => [])).filter((f) => f.endsWith(".webp") || f.endsWith(".jpg")),
);

/** filename -> the CDN URL it was fetched from. Gitignored; a cache key, not data. */
const SOURCES = join(OUT, ".sources.json");
const sources = await readFile(SOURCES, "utf8").then(JSON.parse).catch(() => ({}));

/**
 * THIS SCRIPT NO LONGER CHOOSES OR ORDERS ANYTHING. It mirrors.
 *
 * It used to do both, and both moved out on 2026-08-01:
 *
 * **Choosing** — which renders are shown, and which are people — is
 * `chooseGallery` in packages/store/src/gallery.ts, because the catalog is what
 * the storefront renders from and a filter applied after the catalog is written
 * leaves the catalog promising files that were never saved. That already
 * happened once: a skin-tone pixel heuristic lived here, dropped clean sticker
 * shots because a golden retriever's fur reads as skin, and left eleven broken
 * image links behind.
 *
 * **Ordering** — which colourway a `/store` card leads with, so the grid is not
 * twenty white shirts — is `heroIndexFor`, and the answer is now a `heroIndex`
 * field rather than a rotation of the array. The old version sorted this list by
 * measured pixel luminance and rotated it per category, which was the right idea
 * in the wrong place: the file on disk is named `<id>-<index>.webp`, so
 * reordering the array silently renames every photograph. It also downloaded
 * every mockup purely to find out how dark it was, when `colors[].hex` has been
 * in the matrix the whole time. The justification given here — "the storefront
 * cannot see a colour: it has a list of URLs and no idea what is in them" — was
 * true, and is the exact thing that got fixed.
 *
 * So: fetch what the catalog names, in the order it names it, and write it.
 */

for (const product of catalog.products) {
  const mockups = (product.mockups ?? []).map((m) => (typeof m === "string" ? m : m.src));
  for (const [index, url] of mockups.entries()) {
    const name = `${product.id}-${index}.webp`;
    wanted.add(name);
    // The derivatives are claimed BEFORE the skip below, not after it. Claiming
    // them inside the fetch branch would leave them unclaimed on every run that
    // skipped an unchanged mockup, and the sweep at the bottom of this file
    // deletes whatever is not claimed — so a second run would have removed
    // every card-sized image and the srcset would 404 across the whole grid.
    const derivatives = DERIVATIVES.map((w) => `${product.id}-${index}-${w}.webp`);
    for (const d of derivatives) wanted.add(d);

    const currentOriginal = existing.has(name) && sources[name] === url;
    const missing = derivatives.filter((d) => !existing.has(d));
    if (currentOriginal && !missing.length) { skipped += 1; continue; }

    /**
     * WHEN ONLY THE DERIVATIVES ARE MISSING, RESIZE THE FILE WE ALREADY HAVE.
     *
     * The card sizes were added after 59 products had already been mirrored, so
     * the first run under the new code found every original current and every
     * derivative absent. Re-fetching 200 files from a CDN to produce downscales
     * of images sitting on disk is work for nothing, and it is the branch that
     * runs every time a size is added to DERIVATIVES.
     */
    let source;
    if (currentOriginal) {
      source = await readFile(join(OUT, name));
    } else {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `${product.id} mockup ${index}: ${res.status} ${res.statusText}\n${url}\n` +
            `The catalog names a mockup the CDN will not serve. Re-run the sync.`,
        );
      }
      source = Buffer.from(await res.arrayBuffer());
      const webp = await sharp(source)
        .resize({ width: WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      await writeFile(join(OUT, name), webp);
      sources[name] = url;
      fetched += 1;
    }

    // The card sizes. Named `<id>-<index>-<width>.webp`, which is what
    // `mockupSrcSet` in apps/web/lib/store.ts builds — change one, change both.
    let derived = "";
    for (const width of DERIVATIVES) {
      const small = `${product.id}-${index}-${width}.webp`;
      const buf = await sharp(source)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      await writeFile(join(OUT, small), buf);
      sources[small] = url;
      derived += ` ${width}:${(buf.length / 1024).toFixed(0)}KB`;
    }
    if (currentOriginal) {
      console.log(`${name.padEnd(44)} derivatives only —${derived}`);
      continue;
    }
    console.log(`${name.padEnd(44)} ${(source.length / 1024).toFixed(0)} KB fetched —${derived}`);
  }

  /**
   * THE CARD A SHARED LINK UNFURLS AS — one per product, from its hero mockup.
   *
   * Until 2026-08-07 every one of the 505 pages on this site unfurled as the
   * club lockup with the site's own blurb, product pages included, so the link
   * a player sent a teammate showed the crest and never the shirt. See
   * `apps/web/lib/meta.ts` for the metadata half of that fix; this is the
   * picture half.
   *
   * Keyed on the hero mockup's own source URL, so a re-rendered placement
   * regenerates the card as well as the photograph.
   */
  const mockupCount = mockups.length;
  if (!mockupCount) continue;
  const at = Number.isInteger(product.heroIndex) && product.heroIndex >= 0 && product.heroIndex < mockupCount
    ? product.heroIndex
    : 0;
  const cardName = `${product.id}-card.jpg`;
  const heroName = `${product.id}-${at}.webp`;
  const heroUrl = mockups[at];
  wanted.add(cardName);
  if (existing.has(cardName) && sources[cardName] === heroUrl) continue;

  const card = await sharp(await readFile(join(OUT, heroName)))
    .resize(CARD.width, CARD.height, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: CARD.quality, mozjpeg: true })
    .toBuffer();
  await writeFile(join(OUT, cardName), card);
  sources[cardName] = heroUrl;
  console.log(`${cardName.padEnd(44)} social card — ${(card.length / 1024).toFixed(0)}KB`);
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
