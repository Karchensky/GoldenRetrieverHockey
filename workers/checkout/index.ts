import { resolveBasket } from "../../packages/store/src/basket";
import type { BasketLine, CatalogProduct } from "../../packages/store/src/basket";
import catalogJson from "../../apps/web/data/products.json";
import { createSession, getSessionWithLineItems, verifySignature } from "./stripe";
import { splitName, submitOrder } from "./printify";
import type { OrderLine } from "./printify";

/**
 * The checkout.
 *
 * Everything that is not `/api/*` falls through to the static export, which is
 * the whole site. This Worker exists for two routes and holds no state beyond
 * one KV key per completed order.
 *
 *   POST /api/checkout        basket in, Stripe Checkout URL out
 *   POST /api/stripe-webhook  Stripe says it was paid, Printify is told to print
 *
 * **The catalog is compiled in.** It is the same `apps/web/data/products.json`
 * the storefront renders from, written by the sync out of the verified read-back
 * of the shop, and it is the ONLY source of prices and variant ids this Worker
 * will honour. A browser posts a product id, a colour name, a size and a
 * quantity. It does not post a price, and there is no code path here that would
 * read one if it did.
 *
 * **`packages/store/src/basket.ts` is imported, not reimplemented.** The cart in the browser
 * runs that exact module so it can tell somebody about the sticker minimum in
 * the drawer; this runs it again because the browser is the customer's computer.
 * One implementation, checked twice.
 */

export type Env = {
  /** `sk_live_…`. Set with `wrangler secret put STRIPE_SECRET_KEY`. */
  STRIPE_SECRET_KEY: string;
  /** `whsec_…`, from the webhook endpoint's own page in the Stripe dashboard. */
  STRIPE_WEBHOOK_SECRET: string;
  /** The Printify personal access token. Never the one in .secrets on disk. */
  PRINTIFY_API_TOKEN: string;
  /** One key per fulfilled order. The replay guard — see `handleWebhook`. */
  ORDERS: KVNamespace;
  /** The static export. Bound by wrangler.jsonc; serves everything else. */
  ASSETS: Fetcher;
};

const catalog = (catalogJson as { products: unknown[] }).products as CatalogProduct[];

const SITE = "https://goldenretrieverhockey.com";

/**
 * United States only, for now, and this is a real limitation rather than an
 * oversight.
 *
 * Every retail price in this shop has the US standard first-item postage priced
 * into it, which is what makes "free shipping" true rather than a discount. The
 * captain asked for international at cost, and at cost means quoted: Printify's
 * international rates are per blueprint, per provider and per country, and they
 * do not merge across product types, so a flat "international" rate would be
 * either a loss or an overcharge on most baskets.
 *
 * Doing it honestly means quoting `POST /shops/{id}/orders/shipping.json` for
 * the actual destination before the session is created, which needs the country
 * collected BEFORE checkout rather than inside it. That is the next piece of
 * work and it is written up in STORE.md. Until it exists this refuses the order
 * rather than guessing at the postage, because guessing is how a $36 shirt is
 * posted to Australia at a $22 loss.
 */
const ALLOWED_COUNTRIES = ["US"];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/checkout") {
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      return handleCheckout(request, env);
    }

    if (url.pathname === "/api/stripe-webhook") {
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      return handleWebhook(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

/* ------------------------------------------------------------------ */
/* Basket -> Stripe Checkout                                           */
/* ------------------------------------------------------------------ */

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  let lines: BasketLine[];
  try {
    const body = (await request.json()) as { lines?: unknown };
    if (!Array.isArray(body.lines)) return json({ error: "No basket." }, 400);
    // A basket is bounded before anything iterates it. Twenty distinct lines is
    // already an implausible order for a beer-league team shop, and an unbounded
    // array here is an unbounded number of Stripe line items.
    if (body.lines.length > 20) return json({ problems: ["That is too many different things for one order."] }, 400);
    lines = body.lines as BasketLine[];
  } catch {
    return json({ error: "Could not read that basket." }, 400);
  }

  const resolved = resolveBasket(lines, catalog);
  if (!resolved.ok) return json({ problems: resolved.problems }, 400);

  const missing = resolved.lines.filter((l) => !l.product.printify?.productId);
  if (missing.length) {
    return json(
      { problems: [`${missing.map((m) => m.product.title).join(", ")} cannot be ordered right now.`] },
      409,
    );
  }

  const params = {
    mode: "payment",
    // The Printify ids ride on the PRODUCT rather than in session metadata:
    // metadata caps each value at 500 characters and a large basket would run
    // past it silently. The webhook expands these back out. See stripe.ts.
    line_items: resolved.lines.map((l) => ({
      quantity: l.line.quantity,
      price_data: {
        currency: "usd",
        unit_amount: l.unitCents,
        // EXCLUSIVE: the price is the price and tax is added on top. Inclusive
        // would mean the $36 tee absorbs New York's 4.75% and the shop eats it.
        tax_behavior: "exclusive",
        product_data: {
          name: `${l.product.title} — ${l.line.color} / ${l.line.size}`,
          // What decides whether the buyer is charged. New York exempts clothing
          // under $110 from the state's 4%; ship everything as general tangible
          // goods and every garment is overcharged. See matrix.ts `taxCode`.
          tax_code: l.product.taxCode,
          metadata: {
            productId: l.product.id,
            printifyProductId: l.product.printify?.productId ?? "",
            variantId: String(l.variantId),
          },
        },
      },
    })),

    // Stripe works out what is owed, per jurisdiction, from the address the
    // customer enters and the registrations declared in the dashboard. With no
    // registration for a state, nothing is charged for it — which is correct:
    // there is no nexus outside New York.
    automatic_tax: { enabled: true },

    shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
    shipping_options: [{
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: 0, currency: "usd" },
        display_name: "Free shipping",
      },
    }],

    // Printify requires a phone number on every order and rejects the submission
    // without one. Collecting it here is not a preference.
    phone_number_collection: { enabled: true },

    billing_address_collection: "required",
    success_url: `${SITE}/store/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/store`,
  };

  try {
    // Derived from the basket, so a double-clicked button replays one session
    // instead of opening two.
    const key = await basketFingerprint(resolved.lines.map((l) => `${l.product.id}:${l.variantId}:${l.line.quantity}`));
    const session = await createSession(env.STRIPE_SECRET_KEY, params, key);
    return json({ url: session.url });
  } catch (error) {
    console.error("checkout", error instanceof Error ? error.message : error);
    // The Stripe error text can carry account detail. The customer gets a
    // sentence; the operator gets the log.
    return json({ error: "Checkout could not be opened. Nothing has been charged." }, 502);
  }
}

async function basketFingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.sort().join("|")),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Stripe says it was paid -> Printify prints it                       */
/* ------------------------------------------------------------------ */

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // The RAW body. Parsing and re-serialising changes key order and whitespace,
  // and the signature is over the bytes Stripe sent.
  const raw = await request.text();

  const ok = await verifySignature(raw, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: "Bad signature." }, 400);

  const event = JSON.parse(raw) as { id: string; type: string; data: { object: { id: string } } };
  if (event.type !== "checkout.session.completed") return json({ received: true });

  const sessionId = event.data.object.id;

  // THE REPLAY GUARD. Stripe delivers at least once and will redeliver on any
  // non-2xx, so without this a slow response prints the order twice and charges
  // us for both. The claim is written BEFORE the order is placed: a crash
  // between the two leaves a claimed key and no parcel, which needs a person,
  // and that is the failure worth having. The reverse — print first, record
  // after — duplicates real money.
  const already = await env.ORDERS.get(sessionId);
  if (already) return json({ received: true, note: "already fulfilled" });
  await env.ORDERS.put(sessionId, "claimed", { expirationTtl: 60 * 60 * 24 * 90 });

  // Stripe's delivery timeout is short and Printify is not always quick. Ack
  // now, finish in the background; the guard above means the redelivery that
  // would otherwise race this is a no-op.
  ctx.waitUntil(fulfil(sessionId, env));
  return json({ received: true });
}

async function fulfil(sessionId: string, env: Env): Promise<void> {
  try {
    const session = await getSessionWithLineItems(env.STRIPE_SECRET_KEY, sessionId);

    if (session.payment_status !== "paid") {
      console.error(`${sessionId}: payment_status is ${session.payment_status}, not printing`);
      return;
    }

    const items = session.line_items?.data ?? [];
    const lineItems: OrderLine[] = [];
    for (const item of items) {
      const meta = item.price.product.metadata;
      const productId = meta.printifyProductId;
      const variantId = Number(meta.variantId);
      if (!productId || !Number.isInteger(variantId) || !item.quantity) {
        throw new Error(`${sessionId}: line "${item.price.product.name}" carries no Printify ids`);
      }
      lineItems.push({ product_id: productId, variant_id: variantId, quantity: item.quantity });
    }
    if (!lineItems.length) throw new Error(`${sessionId}: no line items came back`);

    const address = session.shipping_details?.address;
    const email = session.customer_details?.email;
    const phone = session.customer_details?.phone;
    if (!address?.line1 || !address.city || !address.postal_code || !address.country || !email) {
      throw new Error(`${sessionId}: the session has no usable shipping address`);
    }

    const { first, last } = splitName(session.shipping_details?.name ?? session.customer_details?.name);

    const order = await submitOrder(env.PRINTIFY_API_TOKEN, {
      external_id: sessionId,
      label: `goldenretrieverhockey.com ${sessionId.slice(-8)}`,
      line_items: lineItems,
      address_to: {
        first_name: first,
        last_name: last,
        email,
        phone: phone ?? "",
        country: address.country,
        region: address.state ?? "",
        address1: address.line1,
        ...(address.line2 ? { address2: address.line2 } : {}),
        city: address.city,
        zip: address.postal_code,
      },
    });

    await env.ORDERS.put(sessionId, order.id, { expirationTtl: 60 * 60 * 24 * 90 });
    console.log(`${sessionId} -> printify order ${order.id}, ${lineItems.length} lines`);
  } catch (error) {
    // The money is taken and the parcel is not ordered. Loud, and left claimed
    // so a redelivery does not pile a second attempt on top of a half-done one.
    console.error(`FULFILMENT FAILED ${sessionId}:`, error instanceof Error ? error.message : error);
  }
}
