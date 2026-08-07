import type { CatalogProduct } from "./basket.ts";
import { unitPriceFor, variantIdFor } from "./basket.ts";
import { photographsOf } from "./gallery.ts";

/**
 * The shop, as structured data.
 *
 * **This lives in `packages/store` and not in `apps/web` deliberately.** The
 * root `tsconfig.json` excludes `apps/web` and the test glob is
 * `packages/*​/test/*.test.ts`, so anything with money in it that sits over
 * there is checked by neither `npm run typecheck` nor `npm test` — only by
 * `next build`. It also belongs beside `prices`, `unitPriceFor` and
 * `variantIdFor`, because the whole point is that the price a crawler reads is
 * the price the Worker charges, resolved by the same function.
 *
 * **What Google is given, and why it is a `ProductGroup`.** A tee is one page
 * with up to 36 buyable combinations behind a swatch and a size list, and
 * `ProductGroup` + `hasVariant` + `variesBy` is the type built for exactly
 * that. `productGroupID` here is the same string the Merchant Center feed
 * writes as `item_group_id`, so the page and the feed describe one object
 * rather than two — see `scripts/build-product-feed.mjs`.
 *
 * **Nothing here is invented.** No rating, no review count, no
 * `priceValidUntil` — there are no reviews and no expiry, and a shop this size
 * inventing either is the one failure structured data must not have. Every
 * figure below resolves out of `products.json`.
 */

export const SCHEMA = "https://schema.org";

/** The club, as the seller. */
export const BRAND_NAME = "Golden Retrievers";

/**
 * Made to order, and the two halves of the wait are stated separately.
 *
 * Handling is Printify's own `handlingTime` for the standard plan — 2 to 5
 * business days, read from the API on 2026-07-29 and identical across every
 * item, which is the figure `/store/help` prints. Transit is what is left of
 * the checkout's own delivery estimate: `workers/checkout/index.ts` quotes the
 * customer 4 to 10 business days end to end, so 2 to 5 of that is the post.
 *
 * Change either of these and change it in all three places: here, the help
 * page, and the Worker's `delivery_estimate`.
 */
const HANDLING_DAYS = { min: 2, max: 5 };
const TRANSIT_DAYS = { min: 2, max: 5 };

const SHIPS_TO = "US";

const days = (range: { min: number; max: number }) => ({
  "@type": "QuantitativeValue",
  minValue: range.min,
  maxValue: range.max,
  unitCode: "DAY",
});

/** Cents to the string Google wants: "19.75", never "19.8" and never a number. */
export const amount = (cents: number): string => (cents / 100).toFixed(2);

/**
 * Postage, per product, at cost.
 *
 * `postageCents` is that maker's real first-item US rate, measured by the sync
 * and already on every product — the same figure the checkout passes through.
 * It is the first item's rate, so a basket of two is dearer here than the
 * shopper will actually be charged; that is the honest direction to be wrong in
 * and it is what a single-item listing means.
 */
export function postageOf(product: CatalogProduct): number {
  // NOT `?? 0`. A missing figure defaulting to zero would advertise free
  // postage on Google and in the markup, on a shop whose margin is the postage
  // — and it would read as a deliberate offer rather than as a gap in the data.
  // Every product in the catalogue carries this; if one ever does not, that is
  // a broken sync and it should stop the build.
  if (typeof product.postageCents !== "number") {
    throw new Error(
      `${product.id} has no postageCents. The sync writes it for every product, so this ` +
        `catalogue is incomplete — re-run \`npm run store:sync\` rather than shipping a ` +
        `listing that claims free delivery.`,
    );
  }
  return product.postageCents;
}

const shippingDetails = (product: CatalogProduct) => ({
  "@type": "OfferShippingDetails",
  shippingRate: {
    "@type": "MonetaryAmount",
    value: amount(postageOf(product)),
    currency: "USD",
  },
  shippingDestination: {
    "@type": "DefinedRegion",
    addressCountry: SHIPS_TO,
  },
  deliveryTime: {
    "@type": "ShippingDeliveryTime",
    handlingTime: days(HANDLING_DAYS),
    transitTime: days(TRANSIT_DAYS),
  },
});

/*
 * NO `hasMerchantReturnPolicy`, AND THAT IS A DECISION RATHER THAN AN OMISSION.
 *
 * `/store/help` states no returns policy on the captain's explicit
 * instruction — restating a supplier's terms as our own commits a one-person
 * shop to honouring them out of a margin that cannot absorb it. What the page
 * says instead is: write to him and he will work it out.
 *
 * `MerchantReturnNotPermitted` is the obvious tag to reach for and it would be
 * a HARDER claim than the page makes, machine-readable, and quite possibly
 * surfaced beside the listing as "no returns". Structured data that disagrees
 * with the visible page is worse than none, and that includes disagreeing by
 * being more definite than it.
 *
 * The return policy belongs in Merchant Center's account settings, chosen by
 * the captain, once. It is not derivable from anything in this repository.
 */

/**
 * WHERE A MIRRORED MOCKUP LIVES, AND THE INDEX IS THE FILENAME.
 *
 * `scripts/mirror-mockups.mjs` writes `<id>-<index>.webp`, so `mockups[]`'s
 * order is load-bearing and this convention is shared by the storefront, this
 * markup and the Merchant Center feed. It sits here because the feed generator
 * is a script that cannot reach into `apps/web/lib`, and three copies of a
 * filename pattern is two too many. `apps/web/lib/store.ts` delegates to it.
 */
export const mockupHref = (productId: string, index: number): string =>
  `/store/${productId}-${index}.webp`;

/** The 1200×630 JPEG a shared product link unfurls as. */
export const cardHref = (productId: string): string => `/store/${productId}-card.jpg`;

/**
 * WHY A PRODUCT MIGHT NOT BE DESCRIBED TO A SEARCH ENGINE AT ALL.
 *
 * Stickers sell in threes — one costs more to post ($4.59) than to make ($2.00)
 * — so a per-unit price is not a price anybody can pay. `priceLabel` on the
 * page already knows this and renders "$10.50 for 3".
 *
 * **It lives here rather than in `feed.ts` because it governs BOTH halves.** It
 * was written for the feed alone at first, and the build then produced ten
 * sticker pages whose markup offered $3.50 while the page beside it sold three
 * for $10.50 — the exact bug `apps/web/lib/store.ts` documents fixing on the
 * store card, reintroduced in JSON-LD. Structured data that disagrees with the
 * visible page is worse than none, so a product with a minimum gets none.
 *
 * A rule rather than `itemId !== "sticker"`, so the next product to get a
 * minimum drops out of both on its own.
 */
export function excludedBecause(product: CatalogProduct): string | null {
  const min = product.sale?.minQuantity ?? 1;
  if (min > 1) return `sold in ${min}s — a single-unit price could not be paid`;
  if (product.sale?.addOnOnly) return "add-on only — cannot be bought on its own";
  return null;
}

/** Every buyable colour-and-size pair, resolved the way a basket resolves one. */
export function variantsOf(product: CatalogProduct): {
  variantId: number;
  color: string;
  size: string;
  priceCents: number;
}[] {
  const out = [];
  for (const color of product.colors) {
    for (const size of product.sizes) {
      const variantId = variantIdFor(product, color.name, size);
      // A colourway is a complete size run or it is not offered — `variantIdFor`
      // returns null where the positional lookup finds nothing, and a row that
      // cannot be resolved is a row that cannot be bought.
      if (variantId === null) continue;
      out.push({
        variantId,
        color: color.name,
        size,
        priceCents: unitPriceFor(product, variantId),
      });
    }
  }
  return out;
}

/**
 * The colour's own first photograph, absolute.
 *
 * `photographsOf` falls back to EVERY index when it does not recognise the
 * colour, rather than to none — so this always resolves to a real file.
 */
export function imageForColor(
  product: CatalogProduct,
  color: string,
  origin: string,
): string {
  const [first] = photographsOf(product.mockups, color);
  return `${origin}${mockupHref(product.id, first ?? product.heroIndex ?? 0)}`;
}

/**
 * The name a variant is sold under.
 *
 * Identical to the line item the Worker sends Stripe — see
 * `workers/checkout/index.ts`. The customer sees this string on the checkout
 * page and on the receipt, so a crawler reading a different one would be
 * describing a different thing.
 */
export const variantName = (product: CatalogProduct, color: string, size: string): string =>
  `${product.title} — ${color} / ${size}`;

/**
 * The product's markup, or `null` where it should not be described at all.
 *
 * Null is a real answer and the caller must handle it: see `excludedBecause`.
 * The page still carries its breadcrumb — what is withheld is the price claim,
 * not the page's place in the site.
 */
export function productSchema(
  product: CatalogProduct,
  origin: string,
): Record<string, unknown> | null {
  if (excludedBecause(product)) return null;

  const url = `${origin}/store/${product.id}`;
  const variants = variantsOf(product);
  const shipping = shippingDetails(product);

  return {
    "@context": SCHEMA,
    "@type": "ProductGroup",
    "@id": `${url}#product`,
    name: product.title,
    description: product.description,
    url,
    productGroupID: product.id,
    brand: { "@type": "Brand", name: BRAND_NAME },
    variesBy: [`${SCHEMA}/color`, `${SCHEMA}/size`],
    image: product.mockups.length
      ? [`${origin}${mockupHref(product.id, product.heroIndex ?? 0)}`]
      : undefined,
    hasVariant: variants.map((v) => ({
      "@type": "Product",
      sku: String(v.variantId),
      name: variantName(product, v.color, v.size),
      color: v.color,
      size: v.size,
      image: imageForColor(product, v.color, origin),
      offers: {
        "@type": "Offer",
        url,
        price: amount(v.priceCents),
        priceCurrency: "USD",
        // Printed after it is bought, so there is no stock to be out of.
        availability: `${SCHEMA}/InStock`,
        itemCondition: `${SCHEMA}/NewCondition`,
        shippingDetails: shipping,
      },
    })),
  };
}
