import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogProduct } from "../src/basket.ts";
import { unitPriceFor, variantIdFor } from "../src/basket.ts";
import { GOOGLE, excludedBecause, feedRows, renderFeed } from "../src/feed.ts";
import { postageOf, productSchema } from "../src/schema.ts";
import { ROOT } from "../src/matrix.ts";

/**
 * THE PAGE AND THE FEED MUST QUOTE THE PRICE THE CHECKOUT CHARGES.
 *
 * The point of putting this module in `packages/store` rather than in
 * `apps/web` is that it can be asserted here, against the real catalogue, by
 * the same suite that already guards the basket. `unitPriceFor` is the function
 * the Worker prices a line with; every claim below resolves through it, so a
 * price cannot drift into the markup or the feed without failing.
 *
 * **These are assertions about a build artifact, so they skip when it is
 * absent** rather than failing a clean checkout that has not synced.
 */

const CATALOG = join(ROOT, "apps/web/data/products.json");
const ORIGIN = "https://goldenretrieverhockey.com";

const catalogue: { products: CatalogProduct[] } | null = existsSync(CATALOG)
  ? JSON.parse(readFileSync(CATALOG, "utf8"))
  : null;

const products = catalogue?.products ?? [];
const skip = products.length ? false : "no catalogue — run `npm run store:sync`";

/** Cents as Google and schema.org want them: "19.75", never 19.75 and never "19.8". */
const asAmount = (cents: number): string => (cents / 100).toFixed(2);

/** The markup for a product that has any, typed for the assertions below. */
type Graph = {
  productGroupID: string;
  hasVariant: { sku: string; offers: { price: string; priceCurrency: string } }[];
};

const graphOf = (product: CatalogProduct): Graph | null =>
  productSchema(product, ORIGIN) as Graph | null;

test("every JSON-LD offer quotes what the checkout would charge", { skip }, () => {
  for (const product of products) {
    const graph = graphOf(product);
    if (!graph) continue;
    for (const variant of graph.hasVariant) {
      const expected = unitPriceFor(product, Number(variant.sku));
      assert.equal(
        variant.offers.price,
        asAmount(expected),
        `${product.id} sku ${variant.sku}: markup says ${variant.offers.price}, ` +
          `unitPriceFor says ${asAmount(expected)}`,
      );
      assert.equal(variant.offers.priceCurrency, "USD");
    }
  }
});

test("every feed row quotes what the checkout would charge", { skip }, () => {
  const { rows } = feedRows(products, ORIGIN);
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const row of rows) {
    const product = byId.get(row.itemGroupId);
    assert.ok(product, `feed row ${row.id} names an unknown product ${row.itemGroupId}`);
    const expected = unitPriceFor(product!, Number(row.id));
    assert.equal(
      row.price,
      `${asAmount(expected)} USD`,
      `${row.itemGroupId} variant ${row.id}: feed says ${row.price}`,
    );
  }
});

/**
 * The one assertion that makes the two halves of this work provably the same
 * object rather than two descriptions that happen to agree today.
 *
 * `g:id` is the Printify variant id, and so is the `sku` on the page's own
 * offer. Merchant Center reconciles a feed row against the landing page it
 * points at; if those two identifiers ever part company, the reconciliation
 * fails silently and the listing is disapproved for a price mismatch.
 */
test("every feed row is the same object as an offer on the page", { skip }, () => {
  const { rows } = feedRows(products, ORIGIN);
  const skus = new Map<string, Set<string>>();
  for (const product of products) {
    const graph = graphOf(product);
    if (!graph) continue;
    skus.set(graph.productGroupID, new Set(graph.hasVariant.map((v) => v.sku)));
  }
  for (const row of rows) {
    const group = skus.get(row.itemGroupId);
    assert.ok(group, `feed row ${row.id} has item_group_id ${row.itemGroupId}, which is no ProductGroup`);
    assert.ok(
      group!.has(row.id),
      `feed row ${row.id} (${row.itemGroupId}) matches no sku in that product's markup`,
    );
  }
});

/**
 * THE ONE THAT CATCHES A NEW GARMENT.
 *
 * Add a line to `MATRIX` for something that is not a tee, a long sleeve, a
 * crewneck, a hoodie, a youth tee or a mug, and this fails naming it. Without
 * it the feed would either throw during a Cloudflare build — where nobody is
 * watching — or, in a more forgiving design, guess a product category and file
 * the thing wrong on Google forever.
 */
test("every listable garment has Google attributes", { skip }, () => {
  for (const product of products) {
    if (excludedBecause(product)) continue;
    const attrs = GOOGLE[product.itemId];
    assert.ok(
      attrs,
      `itemId "${product.itemId}" (${product.id}) reaches the feed with no entry in GOOGLE. ` +
        `Add a category, a product type, whether it is apparel, and for apparel an age group.`,
    );
    assert.ok(attrs!.category.includes(">"), `${product.itemId}: category should be a taxonomy path`);
    if (attrs!.apparel) {
      assert.ok(attrs!.ageGroup, `${product.itemId}: apparel needs an age group`);
    }
  }
});

/**
 * NO SILENT DROPS.
 *
 * A feed missing a product reads as complete coverage when it is not. Every
 * product is either listed or excluded for a reason the runner prints.
 */
test("every product is either listed or excluded for a stated reason", { skip }, () => {
  const { rows, skipped } = feedRows(products, ORIGIN);
  const listed = new Set(rows.map((r) => r.itemGroupId));
  for (const product of products) {
    const why = excludedBecause(product);
    if (why) {
      assert.ok(
        !listed.has(product.id),
        `${product.id} is excluded (${why}) and still has rows in the feed`,
      );
      assert.ok(
        skipped.some((line) => line.startsWith(`${product.id}:`)),
        `${product.id} was dropped without being reported`,
      );
      continue;
    }
    assert.ok(listed.has(product.id), `${product.id} is listable and produced no rows`);
  }
  assert.equal(
    listed.size + skipped.length,
    products.length,
    "every product should be accounted for exactly once",
  );
});

/**
 * A minimum quantity is part of the price, and a feed row cannot express one.
 *
 * The stickers are the live case: three post for what one costs, so one is not
 * sold on its own and a row at $3.50 would advertise something nobody can buy.
 */
test("nothing with a minimum quantity reaches the feed", { skip }, () => {
  const { rows } = feedRows(products, ORIGIN);
  const listed = new Set(rows.map((r) => r.itemGroupId));
  for (const product of products) {
    const min = product.sale?.minQuantity ?? 1;
    if (min > 1) assert.ok(!listed.has(product.id), `${product.id} sells in ${min}s and is listed singly`);
  }
});

/**
 * THE ONE THAT WAS MISSING, AND THE BUILD FOUND IT.
 *
 * `excludedBecause` was written for the feed alone, so the ten sticker pages
 * shipped a `ProductGroup` offering $3.50 while the page beside it sold three
 * for $10.50. Both halves obey the rule now and this holds them to it.
 */
test("a product sold with a minimum gets no product markup at all", { skip }, () => {
  let withheld = 0;
  for (const product of products) {
    const why = excludedBecause(product);
    if (!why) {
      assert.ok(graphOf(product), `${product.id} is buyable singly and has no markup`);
      continue;
    }
    withheld += 1;
    assert.equal(graphOf(product), null, `${product.id} is ${why} and still advertises a unit price`);
  }
  // The stickers are the live case; if that ever becomes zero the rule has
  // quietly stopped applying to anything and this test stops proving anything.
  assert.ok(withheld > 0, "nothing is excluded — has the sticker minimum gone?");
});

test("every buyable variant is described exactly once", { skip }, () => {
  for (const product of products) {
    const graph = graphOf(product);
    if (!graph) continue;
    const seen = new Set(graph.hasVariant.map((v) => v.sku));
    assert.equal(seen.size, graph.hasVariant.length, `${product.id} lists a sku twice`);

    // Everything the basket can resolve is described, and nothing else is.
    let buyable = 0;
    for (const color of product.colors) {
      for (const size of product.sizes) {
        const id = variantIdFor(product, color.name, size);
        if (id === null) continue;
        buyable += 1;
        assert.ok(seen.has(String(id)), `${product.id}: ${color.name}/${size} is buyable and undescribed`);
      }
    }
    assert.equal(buyable, graph.hasVariant.length, `${product.id}: markup and catalogue disagree on variant count`);
  }
});

/**
 * NOTHING INVENTED.
 *
 * There are no reviews and no ratings on this shop, and a fabricated
 * `aggregateRating` is the single most common way product markup becomes a
 * lie — it is also the one Google penalises. This fails if either ever appears.
 */
test("no rating or review is claimed anywhere", { skip }, () => {
  for (const product of products) {
    const json = JSON.stringify(productSchema(product, ORIGIN) ?? {});
    assert.ok(!/aggregateRating/i.test(json), `${product.id} claims a rating`);
    assert.ok(!/"review"/i.test(json), `${product.id} claims a review`);
  }
});

/**
 * No listing claims free delivery, because none of them offers it.
 *
 * Postage is most of the margin on this shop. `postageOf` throws rather than
 * defaulting a missing figure to zero — this proves the catalogue is complete
 * enough that it never has to.
 */
test("every listed product states real postage", { skip }, () => {
  const { rows } = feedRows(products, ORIGIN);
  for (const row of rows) {
    assert.notEqual(row.shippingPrice, "0.00 USD", `${row.itemGroupId} advertises free postage`);
    assert.match(row.shippingPrice, /^\d+\.\d{2} USD$/, `${row.itemGroupId}: ${row.shippingPrice}`);
  }
  for (const product of products) {
    if (excludedBecause(product)) continue;
    assert.equal(typeof postageOf(product), "number");
  }
});

test("the rendered feed is well-formed and escapes its data", { skip }, () => {
  const { rows } = feedRows(products, ORIGIN);
  const xml = renderFeed(rows, ORIGIN);

  assert.equal((xml.match(/<item>/g) ?? []).length, rows.length);
  assert.equal((xml.match(/<\/item>/g) ?? []).length, rows.length);

  // An unescaped ampersand is the classic way a feed stops parsing, and the
  // product descriptions carry "&" in fabric blends and the taxonomy path
  // carries it in "Apparel & Accessories".
  const loose = xml.split("\n").filter((line) => /&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(line));
  assert.deepEqual(loose, [], "unescaped ampersand in the feed");
});

/**
 * THE PAGE AS BUILT, AGAINST THE MARKUP IT CARRIES.
 *
 * Every assertion above is about the functions. This one is about the artifact
 * a crawler will actually fetch: it reads `apps/web/out`, pulls the JSON-LD out
 * of each product page, and checks that both ends of the price range it claims
 * are printed where a reader can see them.
 *
 * **This is the test the whole exercise turns on**, and the first time it ran
 * it failed on ten pages — the sticker markup offering $3.50 above a page
 * selling three for $10.50. Nothing in the unit tests could see that, because
 * both halves were individually correct.
 *
 * Skips on a checkout that has not been built, like the mockup tests.
 */
const EXPORT = join(ROOT, "apps/web/out/store");
const built = skip || !existsSync(EXPORT) ? "no export — run `npm run build:site`" : false;

test("every built product page shows the prices its markup claims", { skip: built }, () => {
  let checked = 0;
  for (const product of products) {
    const file = join(EXPORT, `${product.id}.html`);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");

    const graph = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
      .map((m) => JSON.parse(m[1]!) as { "@type": string; hasVariant?: { offers: { price: string } }[] })
      .find((b) => b["@type"] === "ProductGroup");

    if (excludedBecause(product)) {
      assert.equal(graph, undefined, `${product.id} sells with a minimum and shipped a ProductGroup`);
      continue;
    }
    assert.ok(graph?.hasVariant, `${product.id} shipped without product markup`);

    const prices = graph!.hasVariant!.map((v) => Number(v.offers.price));
    const low = `$${Math.min(...prices).toFixed(2)}`;
    const high = `$${Math.max(...prices).toFixed(2)}`;

    // Everything a reader can see, with the JSON-LD itself stripped out first.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
    const shown = new Set(visible.match(/\$\d+\.\d{2}/g) ?? []);

    assert.ok(shown.has(low), `${product.id}: markup offers ${low}, which the page never prints`);
    assert.ok(shown.has(high), `${product.id}: markup offers ${high}, which the page never prints`);
    checked += 1;
  }
  assert.ok(checked > 0, "no built product pages were checked");
});

/**
 * The markup a crawler reads has to survive being embedded in HTML, and
 * `components/JsonLd.tsx` escapes `<` on the way in. This proves the payload
 * still parses back to the same object afterwards.
 */
test("escaped JSON-LD parses back unchanged", { skip }, () => {
  for (const product of products.slice(0, 5)) {
    const graph = productSchema(product, ORIGIN);
    if (!graph) continue;
    const embedded = JSON.stringify(graph).replace(/</g, "\\u003c");
    assert.ok(!embedded.includes("</"), `${product.id}: an unescaped "</" could close the script element`);
    assert.deepEqual(JSON.parse(embedded), JSON.parse(JSON.stringify(graph)));
  }
});
