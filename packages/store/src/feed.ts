import type { CatalogProduct } from "./basket.ts";
import { photographsOf } from "./gallery.ts";
import {
  BRAND_NAME,
  amount,
  excludedBecause,
  imageForColor,
  mockupHref,
  postageOf,
  variantName,
  variantsOf,
} from "./schema.ts";

/**
 * Re-exported so the runner and the tests have one import for the feed, while
 * the rule itself lives beside the markup it also governs. It was defined here
 * once and that let the page markup and the feed disagree about the stickers.
 */
export { excludedBecause };

/**
 * The Google Merchant Center feed, as data.
 *
 * **The rows are built here and serialised here, but nothing is written here.**
 * `scripts/build-product-feed.mjs` is the runner that reads `products.json`,
 * calls this and writes the file; keeping the decisions in a module means
 * `npm test` can assert every one of them without executing a build step or
 * touching the disk.
 *
 * Everything a row states resolves out of `products.json`. The price comes
 * through `variantsOf`, which prices each variant with `unitPriceFor` — the
 * same function the Worker charges from — so a row cannot quote a figure the
 * checkout would not honour.
 */

/**
 * WHAT GOOGLE DEMANDS PER GARMENT, AND NONE OF IT IS IN THE DATA.
 *
 * `google_product_category`, `age_group`, `gender`, `size_system` and
 * `size_type` are required for apparel and derivable from nothing in
 * `products.json`. They are stated here, keyed on `itemId`, and an item with no
 * entry THROWS rather than falling through to a guess — filing hoodies as
 * homeware is the failure that prevents, and it is silent in every other
 * design: the feed uploads clean and the listings are wrong.
 *
 * So a new garment in `MATRIX` fails `npm test` until somebody decides what it
 * is. That is the intended cost, and it is the cheapest place to pay it.
 *
 * **These are Google's taxonomy TEXT PATHS, not the numeric ids.** Both are
 * accepted. A wrong path is legible on sight; a wrong number is invisible.
 * Verify against Google's current taxonomy file when the Merchant Center
 * account is opened — the taxonomy is revised from time to time.
 */
const TOPS = "Apparel & Accessories > Clothing > Shirts & Tops";

export type GoogleAttributes = {
  category: string;
  productType: string;
  apparel: boolean;
  ageGroup?: string;
};

export const GOOGLE: Record<string, GoogleAttributes> = {
  tee: { category: TOPS, productType: "Tees", apparel: true, ageGroup: "adult" },
  longsleeve: { category: TOPS, productType: "Long Sleeve Tees", apparel: true, ageGroup: "adult" },
  crewneck: { category: TOPS, productType: "Crewnecks", apparel: true, ageGroup: "adult" },
  hoodie: { category: TOPS, productType: "Hoodies", apparel: true, ageGroup: "adult" },
  // S/M/L on a children's garment. Google's `kids` band is 5–13 years.
  youth: { category: TOPS, productType: "Youth Tees", apparel: true, ageGroup: "kids" },
  mug: {
    category: "Home & Garden > Kitchen & Dining > Tableware > Drinkware",
    productType: "Mugs",
    // Not apparel: no age group, no gender, no size system. `size` still
    // carries 11 oz / 15 oz, because Google needs one attribute to tell two
    // rows sharing an `item_group_id` apart.
    apparel: false,
  },
};

export type FeedRow = {
  id: string;
  itemGroupId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  price: string;
  googleProductCategory: string;
  productType: string;
  color: string;
  size: string;
  ageGroup?: string;
  gender?: string;
  sizeSystem?: string;
  sizeType?: string;
  shippingPrice: string;
};

export type FeedResult = {
  rows: FeedRow[];
  /** One line per product left out, and why. Printed by the runner. */
  skipped: string[];
};

export function feedRows(products: CatalogProduct[], origin: string): FeedResult {
  const rows: FeedRow[] = [];
  const skipped: string[] = [];

  for (const product of products) {
    const why = excludedBecause(product);
    if (why) {
      skipped.push(`${product.id}: ${why}`);
      continue;
    }

    const g = GOOGLE[product.itemId];
    if (!g) {
      throw new Error(
        `No Google attributes for itemId "${product.itemId}" (product ${product.id}).\n` +
          `Add it to GOOGLE in packages/store/src/feed.ts: a category, a product type,\n` +
          `whether it is apparel, and for apparel an age group. Nothing here can guess a\n` +
          `product category, and a wrong one is invisible once the feed is accepted.`,
      );
    }

    const link = `${origin}/store/${product.id}`;

    for (const v of variantsOf(product)) {
      rows.push({
        // The variant id is the id Printify knows, the id the Worker prices
        // against, and the sku in the page's own JSON-LD. One identifier all
        // the way through, which is what lets Google reconcile the two.
        id: String(v.variantId),
        itemGroupId: product.id,
        title: variantName(product, v.color, v.size),
        description: product.description,
        link,
        imageLink: imageForColor(product, v.color, origin),
        // Up to two more angles of the SAME colourway; the first is the
        // image_link above.
        additionalImageLinks: photographsOf(product.mockups, v.color)
          .slice(1, 3)
          .map((index) => `${origin}${mockupHref(product.id, index)}`),
        price: `${amount(v.priceCents)} USD`,
        googleProductCategory: g.category,
        productType: `${BRAND_NAME} > ${g.productType}`,
        color: v.color,
        size: v.size,
        ...(g.apparel
          ? {
              ageGroup: g.ageGroup,
              // Every garment in the line is a unisex blank. None is cut
              // separately for men and women, so saying otherwise would
              // describe a product that does not exist.
              gender: "unisex",
              sizeSystem: "US",
              sizeType: "regular",
            }
          : {}),
        // That maker's real first-item US rate, as the sync measured it and as
        // the checkout passes it through at cost. It is the FIRST item's rate,
        // so a basket of two is dearer here than the shopper is charged — the
        // honest direction to be wrong in for a single-item listing.
        shippingPrice: `${amount(postageOf(product))} USD`,
      });
    }
  }

  return { rows, skipped };
}

const xml = (s: string | number): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const tag = (name: string, value: string | number, indent = "      "): string =>
  `${indent}<${name}>${xml(value)}</${name}>`;

/** Google's RSS 2.0 product feed. */
export function renderFeed(rows: FeedRow[], origin: string): string {
  const items = rows.map((r) =>
    [
      "    <item>",
      tag("g:id", r.id),
      tag("g:item_group_id", r.itemGroupId),
      tag("title", r.title),
      tag("description", r.description),
      tag("link", r.link),
      tag("g:image_link", r.imageLink),
      ...r.additionalImageLinks.map((url) => tag("g:additional_image_link", url)),
      // Printed after it is bought, so there is no stock to be out of.
      tag("g:availability", "in_stock"),
      tag("g:price", r.price),
      tag("g:condition", "new"),
      tag("g:brand", BRAND_NAME),
      // No GTIN and no MPN: these are made to order and carry neither.
      // Still supported for custom and print-on-demand goods.
      tag("g:identifier_exists", "no"),
      tag("g:google_product_category", r.googleProductCategory),
      tag("g:product_type", r.productType),
      tag("g:color", r.color),
      tag("g:size", r.size),
      ...(r.ageGroup ? [tag("g:age_group", r.ageGroup)] : []),
      ...(r.gender ? [tag("g:gender", r.gender)] : []),
      ...(r.sizeSystem ? [tag("g:size_system", r.sizeSystem)] : []),
      ...(r.sizeType ? [tag("g:size_type", r.sizeType)] : []),
      "      <g:shipping>",
      tag("g:country", "US", "        "),
      tag("g:service", "Standard", "        "),
      tag("g:price", r.shippingPrice, "        "),
      "      </g:shipping>",
      "    </item>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    `    <title>${xml(BRAND_NAME)}</title>`,
    `    <link>${origin}/store</link>`,
    "    <description>The Golden Retrievers team store — Buffalo men's-league hockey.</description>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
