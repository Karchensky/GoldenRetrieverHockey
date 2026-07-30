import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Blueprint,
  BlueprintDetail,
  CreateProductBody,
  PrintProvider,
  PrintifyProduct,
  Shop,
  ShippingMethodIndex,
  ShippingProfilesV1,
  ShippingRates,
  UploadImageBody,
  UploadedImage,
  VariantsResponse,
} from "./types.ts";

/**
 * A Printify client for one shop and one shop only.
 *
 * The account this token belongs to has two shops:
 *
 *   28277243  GoldenRetrieverHockey  (custom_integration)  ← this project
 *   13449786  another shop                (etsy)                ← a different business
 *
 * The second one is a live storefront that has nothing to do with a beer
 * league hockey team. Writing to it would push team merchandise into a real
 * shop in front of real customers.
 *
 * So no function in this file takes a shop id. There is no argument to get
 * wrong, no config to mistype, no variable to shadow. The id is a constant, and
 * every request additionally asserts its own URL before it is sent — belt and
 * braces, because the failure is not recoverable by apologising.
 */

const BASE = "https://api.printify.com/v1";
/**
 * Only the shipping subtree lives here. Every other v2 catalog path — blueprints,
 * print_providers, variants — 404s, checked on 2026-07-28. Nothing is being
 * migrated; v2 is simply where the labelled shipping rates are.
 */
const BASE_V2 = "https://api.printify.com/v2";

/** The only shop this repo may write to. Not configurable, deliberately. */
export const SHOP_ID = 28277243;

/**
 * Shops on this account that must never be touched, and why. Present so that a
 * failure prints the reason rather than a number, and so the reason lives in
 * code rather than in someone's memory of a conversation.
 */
export const FORBIDDEN_SHOPS: ReadonlyMap<number, string> = new Map([
  [13449786, "a live storefront for an unrelated business"],
]);

/**
 * Every request passes through here. A path that addresses a shop must address
 * OUR shop; anything else throws before a socket is opened.
 *
 * EVERY occurrence, not the first one. This used to `exec` once and return the
 * moment it saw our id, and every path here BEGINS with our id because the
 * constant is what builds it — so the check was always satisfied by the prefix
 * before it reached the part a caller supplied. A second `/shops/{id}` further
 * along was never looked at. Demonstrated on 2026-07-28: a product id of
 * `x.json?redirect=/shops/13449786/products` produced
 * `/shops/28277243/products/x.json?redirect=/shops/13449786/products`, the old
 * check read 28277243 and allowed it, and the request went out. `matchAll` does
 * not have that hole, and it fires on exactly that string now.
 *
 * Nothing in this package can reach the hole through its own API — no exported
 * function takes a shop id and the only caller-supplied path segment is a
 * product id this repo reads back off the shop. It is closed anyway, because a
 * guard whose whole subject is a live storefront belonging to somebody else does
 * not get to depend on nobody ever passing it a bad string.
 */
function assertShopPath(path: string): void {
  // Catalog and upload endpoints are not shop-scoped; they match nothing here.
  for (const m of path.matchAll(/\/shops\/(\d+)/g)) {
    const id = Number(m[1]);
    if (id === SHOP_ID) continue;
    const why = FORBIDDEN_SHOPS.get(id);
    throw new Error(
      `Refusing to address shop ${id}${why ? ` (${why})` : ""}. ` +
        `This client only writes to ${SHOP_ID} (GoldenRetrieverHockey).`,
    );
  }
}

/** Documented limits. Not enforced here — the CLI makes single calls. */
export const RATE_LIMITS = {
  globalPerMinute: 600,
  catalogPerMinute: 100,
  publishesPer30Min: 200,
} as const;

/**
 * The token, from the environment or from the repo's existing secrets
 * convention. It is a credential: never logged, never printed, never committed.
 * `.secrets/` is gitignored.
 */
export async function token(): Promise<string> {
  const fromEnv = process.env.PRINTIFY_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  try {
    const file = join(process.env.GR_SECRETS_DIR ?? ".secrets", "printify_token.txt");
    const fromFile = (await readFile(file, "utf8")).trim();
    if (fromFile) return fromFile;
  } catch {
    // Falls through to the error below, which is the useful one.
  }

  throw new Error(
    "No Printify token. Set PRINTIFY_API_TOKEN, or put it in .secrets/printify_token.txt.\n" +
      "There is no default and there is no committed token.",
  );
}

const UA = "golden-retrievers-archive (store sync)";

/**
 * Documented limits are 600/min overall and 200 product creations per 30
 * minutes. This line is small enough that neither is close, so rather than a
 * token bucket there is a flat pause between writes: slower than necessary,
 * and impossible to get wrong.
 */
const WRITE_PAUSE_MS = 1200;
const pause = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

async function request<T>(method: string, path: string, body?: unknown, base: string = BASE): Promise<T> {
  assertShopPath(path);

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      // Printify's docs require a User-Agent identifying the client.
      "User-Agent": UA,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    // The body often carries the actual reason. The token is in the request
    // headers, not the response, so echoing the body leaks nothing.
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status} ${res.statusText}${text ? `\n${text.slice(0, 900)}` : ""}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T,>(path: string): Promise<T> => request<T>("GET", path);
const getV2 = <T,>(path: string): Promise<T> => request<T>("GET", path, undefined, BASE_V2);

/** `GET /v1/shops.json` — which shops the token can see. */
export const listShops = (): Promise<Shop[]> => get<Shop[]>("/shops.json");

/**
 * `GET /v1/catalog/blueprints.json` — every garment model Printify offers.
 *
 * UNVERIFIED: whether this endpoint paginates. The docs show a bare array. If a
 * live call returns an object instead of an array, that is the reason, and this
 * signature is what needs fixing.
 */
export const listBlueprints = (): Promise<Blueprint[]> => get<Blueprint[]>("/catalog/blueprints.json");

/** `GET /v1/catalog/blueprints/{id}.json` — brand and model for one blueprint. */
export const getBlueprint = (blueprintId: number): Promise<BlueprintDetail> =>
  get<BlueprintDetail>(`/catalog/blueprints/${blueprintId}.json`);

/** `GET /v1/catalog/blueprints/{id}/print_providers.json` */
export const listPrintProviders = (blueprintId: number): Promise<PrintProvider[]> =>
  get<PrintProvider[]>(`/catalog/blueprints/${blueprintId}/print_providers.json`);

/**
 * `GET /v1/catalog/print_providers.json` — every provider on the platform, with
 * its address. The per-blueprint list gives a title and not always a location,
 * and where a provider SHIPS FROM is half of what the shipping table means.
 */
export const listAllPrintProviders = (): Promise<PrintProvider[]> =>
  get<PrintProvider[]>("/catalog/print_providers.json");

/**
 * `GET /v1/catalog/blueprints/{b}/print_providers/{p}/shipping.json`
 *
 * 7 KB against v2's 6 MB, at the cost of not knowing which profile is which
 * method. For comparing providers that is the right trade; for quoting a rate
 * it is not, and `report.ts` uses v2.
 */
export const listShippingProfiles = (blueprintId: number, printProviderId: number): Promise<ShippingProfilesV1> =>
  get<ShippingProfilesV1>(`/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/shipping.json`);

/** `GET /v2/catalog/blueprints/{b}/print_providers/{p}/shipping.json` */
export const listShippingMethods =(blueprintId: number, printProviderId: number): Promise<ShippingMethodIndex> =>
  getV2<ShippingMethodIndex>(`/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/shipping.json`);

/**
 * `GET /v2/catalog/blueprints/{b}/print_providers/{p}/shipping/{method}.json`
 *
 * One row per variant per country, and it is not small — standard shipping for
 * a Bella+Canvas 3001 is 18,538 rows and 6 MB. There is no filter parameter;
 * `?country=`, `?filter[country]=` and `?variant_ids=` were all tried on
 * 2026-07-28 and all returned the whole set. Callers cache by blueprint and
 * provider and reduce locally.
 */
export const listShippingRates = (
  blueprintId: number,
  printProviderId: number,
  method: string,
): Promise<ShippingRates> =>
  getV2<ShippingRates>(
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/shipping/${method}.json`,
  );

/** `GET /v1/catalog/blueprints/{id}/print_providers/{id}/variants.json` */
export const listVariants = (blueprintId: number, printProviderId: number): Promise<VariantsResponse> =>
  get<VariantsResponse>(`/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`);

/** Substring match over title/brand/model. The API has no search parameter. */
export function searchBlueprints(all: Blueprint[], q: string): Blueprint[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return all;
  return all.filter((b) =>
    `${b.title} ${b.brand} ${b.model}`.toLowerCase().includes(needle),
  );
}

/* ==================================================================
   The write path.

   The geometry that used to block this file is resolved. Placement is
   NOT in pixels and NOT in inches: `x` and `y` are fractions of the
   print area with the origin at its top-left, so 0.5/0.5 is dead
   centre, and `scale` is the rendered image width as a fraction of the
   print area width. `angle` is degrees clockwise. That is why the
   catalog reports a different placeholder size for every garment size
   and the same placement still works on all of them — the numbers are
   proportional, so the print grows with the shirt.

   Each blueprint's legal `position` strings come from the variants
   response (`placeholders[].position`), not from the docs. For the two
   garments here they are front, back, left_sleeve, right_sleeve, neck.

   Every claim in this paragraph was checked against a product created
   on the live shop and read back, not against documentation.
   ================================================================== */

/** `POST /v1/uploads/images.json` — not shop-scoped; images belong to the account. */
export async function uploadImage(body: UploadImageBody): Promise<UploadedImage> {
  const uploaded = await request<UploadedImage>("POST", "/uploads/images.json", body);
  await pause(WRITE_PAUSE_MS);
  return uploaded;
}

/**
 * `POST /v1/shops/28277243/products.json`
 *
 * Creates a product as a DRAFT. Printify does not push anything to a sales
 * channel until `publish.json` is called, which this package does not
 * implement, on purpose: publishing is the captain's decision and it is one
 * click in a dashboard he can see. Nothing here can make the shop go live.
 */
export async function createProduct(body: CreateProductBody): Promise<PrintifyProduct> {
  const created = await request<PrintifyProduct>("POST", `/shops/${SHOP_ID}/products.json`, body);
  await pause(WRITE_PAUSE_MS);
  return created;
}

/** `GET /v1/shops/28277243/products/{id}.json` — read a product back to verify it. */
export const getProduct = (productId: string): Promise<PrintifyProduct> =>
  get<PrintifyProduct>(`/shops/${SHOP_ID}/products/${productId}.json`);

/**
 * `GET /v1/shops/28277243/products.json` — EVERY product, following the pages.
 *
 * **This used to be one call with `?limit=50` and no pagination**, written when
 * the shop held eight products. The line reached 59 and the four things that
 * read this all quietly went wrong at once, none of them noisily:
 *
 * - **`sync` builds its "what already exists" map from this.** Nine products
 *   became invisible to it, so the next sync would have CREATED DUPLICATES of
 *   products that were already on the shop.
 * - **`audit` is the shop guard's own proof that nothing was left behind.** An
 *   audit that cannot see past the fiftieth product cannot prove anything. It
 *   reported "0 probes left" after a sweep that created 65 of them, and that
 *   answer was structurally incapable of being anything else.
 * - `report` priced 50 of 59.
 * - `catalogue`'s "this shop already has one" marker missed nine.
 *
 * A limit is not a page. `?limit=N` without a loop is a silent truncation, and
 * silent truncation of the list you check your work against is the worst place
 * to put one.
 *
 * The response carries `current_page` and `last_page`; the loop trusts a short
 * page as well, so it terminates even if those fields ever stop being sent.
 */
export async function listProducts(): Promise<{ data: PrintifyProduct[] }> {
  /**
   * **50 is Printify's own ceiling, not a choice.** 100 was tried on
   * 2026-07-30 and the API answered `400 code 8150: limit: The limit may not be
   * greater than 50`. So the original `?limit=50` was the right number all
   * along — the bug was never the limit, it was the missing loop.
   */
  const PER_PAGE = 50;
  const data: PrintifyProduct[] = [];
  for (let page = 1; ; page += 1) {
    const body = await get<{ data: PrintifyProduct[]; current_page?: number; last_page?: number }>(
      `/shops/${SHOP_ID}/products.json?limit=${PER_PAGE}&page=${page}`,
    );
    const batch = body.data ?? [];
    data.push(...batch);
    if (batch.length < PER_PAGE) break;
    if (body.last_page !== undefined && page >= body.last_page) break;
    // A shop this size cannot legitimately have this many pages; the guard is
    // against a server that keeps answering rather than against our own maths.
    if (page > 50) throw new Error("listProducts: more than 50 pages — refusing to loop further.");
  }
  return { data };
}

/** `DELETE /v1/shops/28277243/products/{id}.json` — for cleaning up a bad run. */
export async function deleteProduct(productId: string): Promise<void> {
  await request<void>("DELETE", `/shops/${SHOP_ID}/products/${productId}.json`);
  await pause(WRITE_PAUSE_MS);
}

/**
 * `POST /v1/shops/28277243/orders/shipping.json` — what a basket costs to post.
 * Creates nothing; every call is a quote.
 *
 * The sync needs this to price a variant, because the target margin is a share
 * of what the CUSTOMER pays and the customer pays the postage. Quoting is the
 * only honest source: the v2 rate table gives the same figure but costs 6 MB per
 * blueprint, and typing it into the matrix is exactly the economics-from-memory
 * that file forbids.
 *
 * The address only has to name the right COUNTRY — measured on 2026-07-29, one
 * basket quoted $11.74 to Buffalo, Los Angeles, Anchorage and Miami.
 */
export const quoteOrderShipping = (
  lineItems: { product_id: string; variant_id: number; quantity: number }[],
): Promise<{ standard: number; express?: number }> =>
  request<{ standard: number; express?: number }>(
    "POST",
    `/shops/${SHOP_ID}/orders/shipping.json`,
    {
      line_items: lineItems,
      address_to: {
        first_name: "Golden",
        last_name: "Retrievers",
        email: "store@goldenretrieverhockey.com",
        phone: "7160000000",
        country: "US",
        region: "NY",
        address1: "1 Main St",
        city: "Buffalo",
        zip: "14201",
      },
    },
  );

/**
 * `PUT /v1/shops/28277243/products/{id}.json`
 *
 * Printify treats this as a merge, so a partial body edits only what it names.
 */
export async function updateProduct(productId: string, patch: Partial<CreateProductBody>): Promise<PrintifyProduct> {
  const updated = await request<PrintifyProduct>("PUT", `/shops/${SHOP_ID}/products/${productId}.json`, patch);
  await pause(WRITE_PAUSE_MS);
  return updated;
}

/* There is deliberately no publishProduct(). See createProduct above. */
