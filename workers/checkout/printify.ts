/**
 * Submitting a paid order to Printify.
 *
 * A second, much smaller Printify client than `packages/store/src/api.ts`, and
 * it exists rather than importing that one because that one is Node: it reads
 * the token off disk with `node:fs`, which does not exist in a Worker.
 *
 * **The shop guard is copied here on purpose, not shared.** The account this
 * token belongs to has two shops, and the second one — 13449786, "another shop   " —
 * is a live storefront for an unrelated business. A guard against posting
 * somebody else's customers a hockey shirt is not a thing to leave on the other
 * side of a module boundary that might get refactored. The constant is here, the
 * assertion is here, and no function in this file takes a shop id.
 */

/** The only shop this Worker may write to. Not configurable, deliberately. */
export const SHOP_ID = 28277243;

const FORBIDDEN_SHOPS = new Map<number, string>([
  [13449786, "a live storefront for an unrelated business"],
]);

function assertShopPath(path: string): void {
  for (const m of path.matchAll(/\/shops\/(\d+)/g)) {
    const id = Number(m[1]);
    if (id === SHOP_ID) continue;
    const why = FORBIDDEN_SHOPS.get(id);
    throw new Error(
      `Refusing to address shop ${id}${why ? ` (${why})` : ""}. ` +
        `This Worker only writes to ${SHOP_ID} (GoldenRetrieverHockey).`,
    );
  }
}

export type OrderLine = { product_id: string; variant_id: number; quantity: number };

/**
 * `POST /v1/shops/28277243/orders/shipping.json` — what this exact basket costs
 * to post. Creates nothing.
 *
 * **This is why shipping can be passed through at cost rather than guessed at.**
 * Printify's postage does not merge across product types but DOES merge within
 * one, and the two rates are unrelated: a second tee adds $2.40 to a $4.75
 * first, a second mug adds $3.09 to a $6.99 first, and a tee next to a mug pays
 * both first-item rates in full. No pricing rule expressible in a product's own
 * retail figure can say that. Baking a first-item rate into every price is the
 * only approximation available, and it overcharges every multi-item basket —
 * measured on 2026-07-29, two mugs carried $17.98 of assumed postage against
 * $10.08 of real postage. The customer was paying $7.90 for nothing.
 *
 * **The address is not needed, and that is a measurement rather than a hope.**
 * Printify quotes per COUNTRY: the same tee-and-mug basket returned $11.74 to
 * Buffalo, Los Angeles, Anchorage and Miami. So a representative address in the
 * destination country is enough to get the real figure, which is what lets this
 * be called BEFORE Stripe collects an address. If that ever stops being true the
 * symptom is a quote that disagrees with the invoice, and the fix is Stripe's
 * address-collection webhook rather than a fudge factor here.
 *
 * Returns integer cents for each method Printify offers.
 */
export async function quoteShipping(
  token: string,
  lineItems: OrderLine[],
  country: string,
): Promise<{ standard: number; express?: number }> {
  const path = `/shops/${SHOP_ID}/orders/shipping.json`;
  assertShopPath(path);

  const sample = SAMPLE_ADDRESS[country];
  if (!sample) throw new Error(`No sample address for ${country}; cannot quote postage.`);

  const res = await fetch(`https://api.printify.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "golden-retrievers-archive (checkout)",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      line_items: lineItems,
      address_to: {
        first_name: "Golden",
        last_name: "Retrievers",
        email: "store@goldenretrieverhockey.com",
        phone: "7160000000",
        ...sample,
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Printify POST ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as { standard: number; express?: number };
}

/**
 * One real address per country we post to, used only to ask what postage costs.
 * Nothing is ordered to it. Add a country here and to ALLOWED_COUNTRIES in
 * index.ts together — a country in one and not the other either cannot be
 * quoted or cannot be bought.
 */
const SAMPLE_ADDRESS: Record<string, { country: string; region: string; address1: string; city: string; zip: string }> = {
  US: { country: "US", region: "NY", address1: "1 Main St", city: "Buffalo", zip: "14201" },
};

export type ShipTo = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  country: string;
  region: string;
  address1: string;
  address2?: string;
  city: string;
  zip: string;
};

/**
 * `POST /v1/shops/28277243/orders.json`
 *
 * `external_id` is the Stripe Checkout Session id. It is the one field that ties
 * a printed parcel back to the payment that bought it, and it is what makes a
 * duplicate submission recognisable in the Printify dashboard if one ever gets
 * through the KV guard in index.ts.
 *
 * `shipping_method: 1` is standard. Every price in this shop has the standard US
 * first-item rate priced into it, so anything else would be selling one service
 * and buying another.
 *
 * **This creates the order; it does not send it to production.** Printify holds
 * a submitted order for a configurable window before charging and printing, and
 * `POST /orders/{id}/send_to_production.json` is deliberately not implemented
 * here — the same reasoning as `publishProduct` in packages/store. The first
 * orders of a shop's life should be looked at by a person.
 */
export async function submitOrder(
  token: string,
  order: { external_id: string; label: string; line_items: OrderLine[]; address_to: ShipTo },
): Promise<{ id: string }> {
  const path = `/shops/${SHOP_ID}/orders.json`;
  assertShopPath(path);

  const res = await fetch(`https://api.printify.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "golden-retrievers-archive (checkout)",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: order.external_id,
      label: order.label,
      line_items: order.line_items,
      shipping_method: 1,
      send_shipping_notification: true,
      address_to: order.address_to,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Printify POST ${path} → ${res.status}: ${text.slice(0, 600)}`);
  }
  return JSON.parse(text) as { id: string };
}

/**
 * Split "Ada Lovelace" into a first and last name.
 *
 * Printify requires both and Stripe collects one string. A single-token name
 * gets it in BOTH fields rather than an empty last name, because an empty
 * required field is rejected outright and a parcel that cannot be posted is a
 * worse outcome than a slightly odd label. Everything after the first space is
 * the surname, so "Jean Claude Van Damme" keeps three quarters of itself.
 */
export function splitName(full: string | null | undefined): { first: string; last: string } {
  const cleaned = (full ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) return { first: "Golden", last: "Retrievers" };
  const gap = cleaned.indexOf(" ");
  if (gap < 0) return { first: cleaned, last: cleaned };
  return { first: cleaned.slice(0, gap), last: cleaned.slice(gap + 1) };
}
