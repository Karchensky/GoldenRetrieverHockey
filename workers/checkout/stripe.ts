/**
 * Stripe, over `fetch`, with no SDK.
 *
 * The SDK is built for Node and drags in a large dependency tree for what is,
 * here, two POSTs and one GET against a form-encoded API. A Worker that takes
 * money should be small enough to read in one sitting, and this is the half of
 * it that matters.
 *
 * Everything Stripe accepts is `application/x-www-form-urlencoded` with bracket
 * notation for anything nested — `line_items[0][price_data][unit_amount]`. That
 * is what `form()` builds.
 */

/** Pinned. A version that changes under a running shop changes what it charges. */
const API_VERSION = "2025-09-30.clover";
const BASE = "https://api.stripe.com/v1";

type Params = Record<string, unknown>;

/**
 * Flatten a nested object into Stripe's bracket notation.
 *
 * `undefined` is dropped rather than sent as the string "undefined", which is
 * what a naive encoder does and which Stripe accepts as a value. `null` is kept,
 * because clearing a field is a real thing to want.
 */
export function form(params: Params, prefix = ""): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (value: unknown, key: string): void => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry, i) => { walk(entry, `${key}[${i}]`); });
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Params)) walk(v, key ? `${key}[${k}]` : k);
      return;
    }
    out.append(key, String(value));
  };
  walk(params, prefix);
  return out;
}

async function call<T>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  params?: Params,
  idempotencyKey?: string,
): Promise<T> {
  const body = params ? form(params) : undefined;
  const url = method === "GET" && body ? `${BASE}${path}?${body.toString()}` : `${BASE}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      // Stripe replays a request that carries the same key rather than running
      // it twice. On session creation the key is derived from the basket, so a
      // double-clicked Checkout button produces one session, not two.
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(method === "POST" && body ? { body: body.toString() } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    // The key is in the request headers, never the response, so the body is
    // safe to surface into a log. It is NOT surfaced to the browser.
    throw new Error(`Stripe ${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
  }
  return JSON.parse(text) as T;
}

export type CheckoutSession = {
  id: string;
  url: string;
  payment_status: string;
  customer_details?: {
    email?: string | null;
    phone?: string | null;
    name?: string | null;
  } | null;
  shipping_details?: {
    name?: string | null;
    address?: {
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
      country?: string | null;
    } | null;
  } | null;
  /** Present only when the caller expanded it. */
  line_items?: { data: SessionLineItem[] };
};

export type SessionLineItem = {
  quantity: number | null;
  price: {
    product: {
      id: string;
      name: string;
      /** Where the Printify ids ride. See `createSession`. */
      metadata: Record<string, string>;
    };
  };
};

export const createSession = (
  secretKey: string,
  params: Params,
  idempotencyKey: string,
): Promise<CheckoutSession> =>
  call<CheckoutSession>(secretKey, "POST", "/checkout/sessions", params, idempotencyKey);

/**
 * Re-read a completed session WITH its line items and their products expanded.
 *
 * This is how fulfilment learns what to print, and it is deliberately not the
 * webhook payload: the event carries a session without line items, and the
 * alternative — packing the basket into `metadata` — has a 500 character ceiling
 * per value that a large basket would silently blow through. Expanding here has
 * no such limit and reads the ids back off Stripe's own record of what was
 * actually charged.
 */
export const getSessionWithLineItems = (
  secretKey: string,
  sessionId: string,
): Promise<CheckoutSession> =>
  call<CheckoutSession>(secretKey, "GET", `/checkout/sessions/${sessionId}`, {
    "expand[0]": "line_items.data.price.product",
  });

/**
 * Verify a `Stripe-Signature` header against the raw body.
 *
 * **This is the door.** Without it, `/api/stripe-webhook` is an open endpoint
 * that submits print orders to anybody who posts a plausible JSON body at it.
 *
 * Two properties matter and both are easy to get wrong:
 *
 *   1. The signed payload is `${timestamp}.${rawBody}` — the RAW bytes, not a
 *      re-serialised object. `JSON.parse` then `JSON.stringify` changes key
 *      order and whitespace and the signature stops matching for a reason that
 *      looks like a Stripe bug.
 *   2. The comparison is constant time. A fast `===` on hex leaks how much of a
 *      forged signature was right, one byte at a time.
 *
 * The timestamp tolerance stops a valid, captured request being replayed
 * forever. Five minutes is Stripe's own recommendation.
 */
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const parts = new Map(
    signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k?.trim() ?? "", rest.join("=").trim()];
    }),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
