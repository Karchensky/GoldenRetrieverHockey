import type { Product } from "./store";

/**
 * Where a buy link goes.
 *
 * Checkout is a Printify Pop-Up store: a hosted storefront Printify runs, which
 * owns the basket, the sizes, the shipping and the money. This site is a static
 * export with no server, so it could not take an order even if it wanted to, and
 * it does not pretend otherwise. Every buy link leaves.
 *
 * There are three states and the store renders all three differently:
 *
 *   1. the Pop-Up exists and this product has its own page there  -> product link
 *   2. the Pop-Up exists but this product is not in it yet        -> shop link
 *   3. there is no Pop-Up yet                                     -> no link
 *
 * State 3 is the honest default. A button that goes nowhere is worse than no
 * button, and a store that quietly links its whole catalog to one landing page
 * is how a customer ends up buying the wrong thing.
 */

const configuredUrl = process.env.NEXT_PUBLIC_PRINTIFY_STOREFRONT_URL?.trim();

function hostedUrl(value: string | undefined): string | null {
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_PRINTIFY_STOREFRONT_URL must be an absolute HTTPS URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_PRINTIFY_STOREFRONT_URL must use HTTPS.");
  }

  return parsed.toString();
}

/** Inlined into the static export at build time; null keeps the preview honest. */
export const hostedStorefrontUrl = hostedUrl(configuredUrl);

export type BuyLink =
  | { kind: "product"; href: string }
  | { kind: "shop"; href: string }
  | { kind: "none" };

/**
 * A product's own Pop-Up page if it has one, the shop if it does not, and
 * nothing if there is no shop. `popUpUrl` is validated the same way as the
 * shop URL: a bad value throws at build time rather than shipping a broken
 * link to a customer.
 */
export function buyLink(product: Product): BuyLink {
  const own = product.popUpUrl?.trim();
  if (own) {
    const href = hostedUrl(own);
    if (href) return { kind: "product", href };
  }
  if (hostedStorefrontUrl) return { kind: "shop", href: hostedStorefrontUrl };
  return { kind: "none" };
}

/** How many products can actually be bought right now. Counted, never claimed. */
export function buyableCount(products: Product[]): number {
  return products.filter((p) => buyLink(p).kind !== "none").length;
}
