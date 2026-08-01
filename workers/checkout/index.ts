import { resolveBasket } from "../../packages/store/src/basket";
import type { BasketLine, CatalogProduct } from "../../packages/store/src/basket";
import catalogJson from "../../apps/web/data/products.json";
import { createSession, getSessionWithLineItems, verifySignature } from "./stripe";
import { quoteShipping, splitName, submitOrder } from "./printify";
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
 * Where Stripe sends the buyer once they have paid.
 *
 * PRODUCTION IS HARDCODED AND NOT TAKEN FROM THE REQUEST. `success_url` is a
 * URL we hand Stripe and Stripe sends a paying customer to it; deriving it from
 * the incoming Host would let anyone who can reach this Worker with a forged
 * header point that redirect at a page of their choosing, which is a phishing
 * primitive attached to a real payment. The canonical domain is a constant for
 * that reason.
 *
 * `wrangler dev` is the one exception, and it has to be. It serves on
 * 127.0.0.1, so a local test paid a real test-mode payment and was then sent to
 * `https://goldenretrieverhockey.com/store/thanks` — a page that is not
 * deployed yet, which answered with the export's own 404, "Not on file". The
 * payment had already succeeded; only the trip home was wrong. Localhost is
 * matched exactly, so nothing that is not a loopback address can select it.
 */
function siteFor(request: Request): string {
  const origin = new URL(request.url).origin;
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin) ? origin : SITE;
}

/**
 * Where this shop will post to.
 *
 * Still the United States only, but no longer for the reason it used to be.
 * Postage is now quoted live from Printify for the actual basket, so the
 * arithmetic that blocked international is solved — what is left is having a
 * sample address per country (see `SAMPLE_ADDRESS` in printify.ts) and the
 * captain deciding he wants the parcels going that far. Add a country to both
 * lists and it works.
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
  const site = siteFor(request);
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

  /* POSTAGE, QUOTED RATHER THAN ASSUMED.
     Every retail price used to carry a first-item postage rate so shipping
     could read as free. That could not express what Printify actually charges
     — a second tee adds $2.40 to a $4.75 first, a second mug adds $3.09 to a
     $6.99 first, and nothing merges across product types — so every multi-item
     basket overpaid. Two mugs carried $17.98 of assumed postage against $10.08
     of real postage.
     This asks. If Printify will not answer, the order does NOT proceed at a
     guessed rate: a wrong postage figure is a loss on every unit of a basket
     nobody can see afterwards. */
  let postageCents: number;
  try {
    const quote = await quoteShipping(
      env.PRINTIFY_API_TOKEN,
      resolved.lines.map((l) => ({
        product_id: l.product.printify?.productId ?? "",
        variant_id: l.variantId,
        quantity: l.line.quantity,
      })),
      "US",
    );
    postageCents = quote.standard;
  } catch (error) {
    console.error("postage quote", error instanceof Error ? error.message : error);
    return json(
      { error: "Could not work out postage just now. Nothing has been charged — try again in a minute." },
      502,
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
    // Printify's own figure for THIS basket, passed through at cost. Not a
    // guess, not a flat rate, and not baked into the retail prices — see
    // `quoteShipping`. Shipping is not taxable as a separate service here; it
    // carries the same treatment as the goods, which is what `tax_behavior`
    // and the shipping tax code below tell Stripe.
    shipping_options: [{
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: postageCents, currency: "usd" },
        display_name: "Standard shipping",
        tax_behavior: "exclusive",
        tax_code: "txcd_92010001",
        delivery_estimate: {
          minimum: { unit: "business_day", value: 4 },
          maximum: { unit: "business_day", value: 10 },
        },
      },
    }],

    // Printify requires a phone number on every order and rejects the submission
    // without one. Collecting it here is not a preference.
    phone_number_collection: { enabled: true },

    /* PROMOTION CODES, so the captain can hand teammates a code that takes the
       club's margin off and sells them the thing at cost.
       Stripe owns the codes; nothing about them is in this repository. Create a
       coupon in the dashboard, give it a code, share the code. Stripe validates
       it, so an expired or unknown one is refused at the till rather than
       trusted from the browser.
       USE 30%. Measured against the live shop on 2026-08-01 by
       `npm run store:report`, which prints the whole table: 30% leaves every
       garment between $1.72 and $3.16, and 35% is exact break-even on the
       hoodie. Above that a sale costs money to make.
       The obvious guess is wrong and this comment used to make it. The margin
       is MARGIN_TARGET of the WHOLE CHARGE, goods plus postage; a coupon comes
       off the shelf price alone, so there is more headroom than the margin
       looks like it allows. A supplier moving its prices moves that figure and
       nothing warns you — re-run the report after any sync that changed a
       cost. */
    allow_promotion_codes: true,

    /* CARDS ONLY, WHICH IS A DELIBERATE NARROWING.
       Left unset, Stripe uses automatic payment methods and Link comes with
       them. Link recognised the captain's own email at his own checkout on
       2026-08-01, started texting his phone to verify him, and got in the way
       of testing a card — and what it is for, a saved card for a returning
       buyer, is worth nothing to a shop whose customers each buy once.
       Apple Pay and Google Pay ride the card rail and survive this. Adding a
       method back is one string. */
    payment_method_types: ["card"],

    billing_address_collection: "required",
    success_url: `${site}/store/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/store`,
  };

  try {
    /* FINGERPRINT THE WHOLE REQUEST, NOT A HAND-PICKED SUBSET.
       The point is unchanged: a double-clicked button replays one session
       instead of opening two, and if Printify's postage moves between two
       clicks the second opens a NEW session rather than replaying the old
       total.
       It used to hash the basket lines and the postage only. That is every
       input somebody remembered to list, which is a different thing from every
       input — and Stripe rejects a key reused with ANY changed parameter:
       `idempotency_error`, a 400, and a customer told the checkout would not
       open. It bit twice on 2026-08-01, both times because success_url had
       changed while a basket stayed the same. Hashing `params` means the key
       cannot fall behind the request again, whatever anybody adds to it. */
    const key = await basketFingerprint([JSON.stringify(params)]);
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
