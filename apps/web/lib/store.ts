import catalog from "../data/products.json";
import { money, priceRange } from "../../../packages/store/src/basket";
import type { CatalogProduct } from "../../../packages/store/src/basket";

/**
 * The store's data contract.
 *
 * Same rules as the archive: read at BUILD time, rendered to static HTML, no
 * runtime fetch. Twenty-three products is not a database's problem.
 *
 * **What changed on 2026-07-29, and why the old version of this file is gone.**
 * It described products as drawings — a `Silhouette` to render and a `Design` to
 * put in the print area, so a colour swatch could recolour an SVG garment rather
 * than swap a photograph. That was the honest thing to do when the shop held six
 * products and no manufacturer had ever printed one. It is the wrong thing now:
 * there are twenty-three products across nine marks, every one exists on a real
 * shop, and the provider has rendered it on the real garment. A drawing of a
 * hoodie is a picture of what we hope arrives. The provider's mockup is a
 * picture of the thing.
 *
 * The old taxonomy also named marks — `crest-logo`, `monogram-logo` — that were
 * retired with `logo_one`. Reviving it would have meant reviving those.
 *
 * **The one rule that carries over is not negotiable: the site does not
 * pretend.** It used to state that plainly by refusing to imply it could take
 * money, because it could not. It can now — `workers/checkout` is a real
 * server and the money is real — so the rule turns into: no price on this page
 * is written here. Every figure comes from the catalog, which comes from the
 * verified read-back of the shop, and the checkout re-resolves all of it server
 * side before it charges anybody.
 */

export type Product = CatalogProduct;

const raw = catalog as { shopId: number; products: unknown[] };

export const products: Product[] = raw.products as Product[];

export const productById = (id: string): Product | undefined =>
  products.find((p) => p.id === id);

/**
 * The order the shop is read in, and it is deliberate rather than alphabetical.
 *
 * The tee is the hero — it carries six of the nine marks and it is what somebody
 * came for. The hoodie is the considered purchase. The cap and the beanie are
 * the things worn at the rink. The mug and the stickers are what gets added to
 * a basket on the way out, and the sticker is last because it is the only thing
 * here that cannot be bought on its own.
 */
export const ITEM_ORDER: readonly string[] = [
  // Clothing, heaviest commitment last within it…
  "tee", "longsleeve", "crewneck", "hoodie", "youth",
  // …then things worn on the head…
  "cap", "beanie",
  // …then everything that is not worn at all.
  "mug", "sticker",
];

export type ItemGroup = { itemId: string; label: string; products: Product[] };

/** Plural, because these head a group rather than name one thing. */
const ITEM_LABELS: Record<string, string> = {
  tee: "Tees",
  longsleeve: "Long Sleeve Tees",
  crewneck: "Crewnecks",
  youth: "Youth Tees",
  hoodie: "Hoodies",
  cap: "Caps",
  beanie: "Beanies",
  mug: "Mugs",
  sticker: "Stickers",
};

/**
 * The shop, grouped the way it is read.
 *
 * An item the catalog carries but `ITEM_ORDER` does not name still appears, at
 * the end, under its own id. A product that exists and is not listed is the one
 * failure this page must not have — it is on the shop, somebody can be sent a
 * link to it, and a grouping that silently drops it is worse than an ugly
 * heading.
 */
export const groups: ItemGroup[] = (() => {
  const byItem = new Map<string, Product[]>();
  for (const product of products) {
    const bucket = byItem.get(product.itemId);
    if (bucket) bucket.push(product);
    else byItem.set(product.itemId, [product]);
  }
  const known = ITEM_ORDER.filter((id) => byItem.has(id));
  const rest = [...byItem.keys()].filter((id) => !ITEM_ORDER.includes(id)).sort();
  return [...known, ...rest].map((itemId) => ({
    itemId,
    label: ITEM_LABELS[itemId] ?? itemId,
    products: byItem.get(itemId) ?? [],
  }));
})();

/**
 * Where a product's mockups live once they are mirrored into the export.
 *
 * They are NOT served from Printify's CDN. Three reasons, in order: a static
 * archive that survives its sources should not put its shop behind somebody
 * else's uptime; a CDN URL carries a shop id and an image id into the page
 * source for no benefit; and the export is served from Cloudflare, which is
 * already the fastest thing in the path. `scripts/mirror-mockups.mjs` fills
 * this directory and `npm run store:mockups` runs it.
 */
export const mockupPath = (productId: string, index: number): string =>
  `/store/${productId}-${index}.webp`;

/**
 * The same mockup at 400 and 800, for a card that draws it at 220–314 CSS px.
 *
 * **The grid used to ship 1.68 MB before a single product was on screen** — 38
 * files at 1280, 35 at 360 — because every card carried the same 1200px source
 * the lightbox needs. At 360 with DPR 2 that is 1200 shipped for 440 needed,
 * 7.4x the pixels, on the connection least able to carry them.
 *
 * `scripts/mirror-mockups.mjs` writes the derivatives beside the original. The
 * 1200 stays in `srcset` and is what the lightbox loads once someone asks for
 * it, which is the only place it was ever the right file.
 */
export const mockupSrcSet = (productId: string, index: number): string =>
  [400, 800].map((w) => `/store/${productId}-${index}-${w}.webp ${w}w`).join(", ") +
  `, /store/${productId}-${index}.webp 1200w`;

/** The first mockup, which is the provider's default view. */
export const heroMockup = (product: Product): string | null =>
  product.mockups.length ? mockupPath(product.id, 0) : null;

/**
 * The description is built in matrix.ts as paragraphs joined by blank lines —
 * the mark, the garment, the colours and the closing. Split rather than
 * rendered as one block, so the detail page can set them as real paragraphs.
 */
export const paragraphs = (product: Product): string[] =>
  product.description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

/** The opening line only, for a card that has room for one sentence. */
export const blurb = (product: Product): string => paragraphs(product)[0] ?? "";

export {
  money,
  priceRange,
  unitPriceFor,
  variantIdFor,
} from "../../../packages/store/src/basket";

/**
 * "Golden Retrievers Crossed Shield" out of "…Crossed Shield — Tee".
 *
 * The catalogue carries `markId` but not the mark's title — `matrix.ts` has it
 * and `products.json` does not, because nothing needed it until the product
 * page grew a "this crest on everything else" section. The title is composed as
 * `${mark.title} — ${item.title}` in `buildLine()`, so the em dash is a
 * reliable seam, and the fallback is the whole title rather than an empty
 * heading.
 */
export const markTitle = (product: Product): string =>
  product.title.split(" — ")[0] ?? product.title;

/**
 * "$17.00" or "$17.00 – $23.50".
 *
 * Every size is priced off its own cost so that a 3XL and a small earn the same
 * margin, which means most products no longer have A price. A card that printed
 * one would be quoting the small at the 3XL, or the other way about.
 */
export function priceLabel(product: Product): string {
  const { from, to } = priceRange(product);
  const each = product.sale?.minQuantity ?? 1;
  if (each > 1) {
    // A price nobody can pay is worse than no price. See `fromLabel`.
    return from === to
      ? `${money(from * each)} for ${each}`
      : `${money(from * each)} – ${money(to * each)} for ${each}`;
  }
  return from === to ? money(from) : `${money(from)} – ${money(to)}`;
}

/**
 * For a card, where the range is too much: "from $17.00".
 *
 * **A MINIMUM QUANTITY IS PART OF THE PRICE.** A sticker card read "from $3.50"
 * and the only button that could be pressed read "Add 3 — $10.50", so the
 * shopper's anchor was a third of the real one until they reached the basket.
 * Ten of the 59 products are stickers — a sixth of the catalogue quoting a
 * number that cannot be bought. One sticker genuinely does cost $3.50 to make
 * and $4.59 to post, which is exactly why the minimum exists; the fix is to say
 * what it costs to buy, not to pretend the minimum is not there.
 */
export const fromLabel = (product: Product): string => {
  const { from, to } = priceRange(product);
  const each = product.sale?.minQuantity ?? 1;
  if (each > 1) return `${money(from * each)} for ${each}`;
  return from === to ? money(from) : `from ${money(from)}`;
};
