import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PER_LINE, lineKey, money, resolveBasket } from "../src/basket.ts";
import type { CatalogProduct } from "../src/basket.ts";

/**
 * THE BASKET RULES, which are the rules that decide what somebody is charged.
 *
 * `packages/store/src/basket.ts` is the one module in this repository imported by both
 * the browser and the checkout Worker. The cart runs it so it can say "three
 * stickers, or none" in the drawer; the Worker runs it again because the cart
 * runs on the customer's computer. If it is wrong, it is wrong in both places at
 * once and the second check stops catching the first.
 *
 * Two halves, and the second one is the one that matters:
 *
 *   1. A FIXTURE, for the rules. Small, hand-built, and every awkward shape is
 *      in it on purpose — a product sold in threes, a product with one colour
 *      and one size, a colourway whose variant ids are deliberately distinct so
 *      a size-index bug cannot pass by coincidence.
 *
 *   2. THE REAL CATALOG. `apps/web/data/products.json` as it sits on disk, with
 *      no fixture anywhere near it. This project has already been bitten by an
 *      invented fixture that passed thirteen assertions and produced 1,064
 *      phantom goals, and the lesson generalises: a fixture proves the code does
 *      what its author expected, and only the real bytes prove the code does
 *      what the shop needs. Everything below the divider reads those bytes.
 */

/* ------------------------------------------------------------------ */
/* 1 — the rules, against a fixture                                    */
/* ------------------------------------------------------------------ */

const FIXTURE: CatalogProduct[] = [
  {
    id: "seal-tee",
    title: "Heritage Seal — Tee",
    description: "A mark.\n\nA garment.\n\nBuffalo, N.Y.",
    priceCents: 3600,
    taxCode: "txcd_30011000",
    markId: "heritage-seal",
    itemId: "tee",
    // Two colours, two sizes, four distinct ids. Distinct on purpose: if every
    // id were the same number a bug that always read index 0 would still pass.
    colors: [
      { name: "White", hex: "#f4f4f2", variants: [101, 102] },
      { name: "Black", hex: "#17191b", variants: [201, 202] },
    ],
    sizes: ["S", "M"],
    mockups: [],
    printify: { productId: "prod-seal-tee" },
  },
  {
    id: "seal-sticker",
    title: "Heritage Seal — Sticker",
    description: "A mark.",
    priceCents: 600,
    taxCode: "txcd_99999999",
    markId: "heritage-seal",
    itemId: "sticker",
    colors: [{ name: "White vinyl", hex: "#f4f4f2", variants: [301] }],
    sizes: ['3" × 3"'],
    sale: { minQuantity: 3, why: "Three post for the price of one." },
    mockups: [],
    printify: { productId: "prod-seal-sticker" },
  },
  {
    id: "roundel-sticker",
    title: "Championship Roundel — Sticker",
    description: "Another mark.",
    priceCents: 600,
    taxCode: "txcd_99999999",
    markId: "championship-roundel",
    itemId: "sticker",
    colors: [{ name: "White vinyl", hex: "#f4f4f2", variants: [401] }],
    sizes: ['3" × 3"'],
    sale: { minQuantity: 3, why: "Three post for the price of one." },
    mockups: [],
    printify: { productId: "prod-roundel-sticker" },
  },
];

const tee = (color: string, size: string, quantity = 1) =>
  ({ productId: "seal-tee", color, size, quantity });

test("resolves a line and prices it from the catalog", () => {
  const got = resolveBasket([tee("Black", "M", 2)], FIXTURE);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.lines.length, 1);
  assert.equal(got.lines[0]?.unitCents, 3600);
  assert.equal(got.lines[0]?.subtotalCents, 7200);
  assert.equal(got.subtotalCents, 7200);
});

test("the colour and size pick the right variant id", () => {
  // Black/M is the fourth id in the fixture. A bug that ignores either axis
  // lands on 101, 102 or 201 — all three are wrong and all three are present.
  const got = resolveBasket([tee("Black", "M")], FIXTURE);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.lines[0]?.variantId, 202);

  const white = resolveBasket([tee("White", "S")], FIXTURE);
  assert.equal(white.ok, true);
  if (!white.ok) return;
  assert.equal(white.lines[0]?.variantId, 101);
});

test("a price in the input is ignored — there is nowhere for it to go", () => {
  const hostile = { ...tee("Black", "M"), priceCents: 1, unitCents: 1, subtotalCents: 1 };
  const got = resolveBasket([hostile], FIXTURE);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.lines[0]?.unitCents, 3600);
  assert.equal(got.subtotalCents, 3600);
});

test("a variant id in the input is ignored", () => {
  // 999 is not a variant of anything. It must not reach the resolved line.
  const hostile = { ...tee("Black", "M"), variantId: 999 };
  const got = resolveBasket([hostile], FIXTURE);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.lines[0]?.variantId, 202);
});

test("refuses an empty basket", () => {
  const got = resolveBasket([], FIXTURE);
  assert.equal(got.ok, false);
});

test("refuses a product, colour or size that is not in the catalog", () => {
  for (const line of [
    { productId: "nope", color: "Black", size: "M", quantity: 1 },
    tee("Chartreuse", "M"),
    tee("Black", "XXL"),
  ]) {
    const got = resolveBasket([line], FIXTURE);
    assert.equal(got.ok, false, `${JSON.stringify(line)} should have been refused`);
  }
});

test("refuses a quantity that is not a whole number one or more", () => {
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const got = resolveBasket([tee("Black", "M", quantity)], FIXTURE);
    assert.equal(got.ok, false, `quantity ${quantity} should have been refused`);
  }
});

test("refuses more than the per-line cap", () => {
  assert.equal(resolveBasket([tee("Black", "M", MAX_PER_LINE)], FIXTURE).ok, true);
  assert.equal(resolveBasket([tee("Black", "M", MAX_PER_LINE + 1)], FIXTURE).ok, false);
});

test("duplicate lines are merged before the cap is applied", () => {
  // Split across two entries, this is MAX_PER_LINE + 2 of one shirt. Each entry
  // passes on its own; the basket must not.
  const half = Math.ceil((MAX_PER_LINE + 2) / 2);
  const got = resolveBasket([tee("Black", "M", half), tee("Black", "M", half)], FIXTURE);
  assert.equal(got.ok, false);
});

test("merging sums quantities rather than dropping a line", () => {
  const got = resolveBasket([tee("Black", "M", 1), tee("Black", "M", 2)], FIXTURE);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.lines.length, 1);
  assert.equal(got.lines[0]?.line.quantity, 3);
  assert.equal(got.subtotalCents, 10800);
});

test("one sticker is refused; three are not", () => {
  const one = resolveBasket([{ productId: "seal-sticker", color: "White vinyl", size: '3" × 3"', quantity: 1 }], FIXTURE);
  assert.equal(one.ok, false);

  const three = resolveBasket([{ productId: "seal-sticker", color: "White vinyl", size: '3" × 3"', quantity: 3 }], FIXTURE);
  assert.equal(three.ok, true);
});

test("THREE DIFFERENT sticker designs meet the minimum", () => {
  // The measurement the rule was built on: three designs post for $4.77, which
  // is exactly what three copies of one post for. A rule that counted copies of
  // a DESIGN would refuse this basket, and refusing it is the reason a fixed
  // three-pack SKU was rejected.
  const got = resolveBasket(
    [
      { productId: "seal-sticker", color: "White vinyl", size: '3" × 3"', quantity: 2 },
      { productId: "roundel-sticker", color: "White vinyl", size: '3" × 3"', quantity: 1 },
    ],
    FIXTURE,
  );
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.subtotalCents, 1800);
});

test("the sticker minimum does not leak onto other items", () => {
  const got = resolveBasket([tee("Black", "M", 1)], FIXTURE);
  assert.equal(got.ok, true);
});

test("a tee plus two stickers is still refused", () => {
  const got = resolveBasket(
    [tee("Black", "M", 1), { productId: "seal-sticker", color: "White vinyl", size: '3" × 3"', quantity: 2 }],
    FIXTURE,
  );
  assert.equal(got.ok, false);
});

test("every problem is collected, not just the first", () => {
  const got = resolveBasket([tee("Chartreuse", "M"), tee("Black", "XXL")], FIXTURE);
  assert.equal(got.ok, false);
  if (got.ok) return;
  assert.equal(got.problems.length, 2);
});

test("lineKey separates products, colours and sizes", () => {
  assert.notEqual(lineKey(tee("Black", "M")), lineKey(tee("Black", "S")));
  assert.notEqual(lineKey(tee("Black", "M")), lineKey(tee("White", "M")));
});

test("money renders cents", () => {
  assert.equal(money(3600), "$36.00");
  assert.equal(money(600), "$6.00");
  assert.equal(money(0), "$0.00");
});

/* ------------------------------------------------------------------ */
/* 2 — the real catalog                                                */
/* ------------------------------------------------------------------ */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CATALOG = join(ROOT, "apps/web/data/products.json");

const real = (): CatalogProduct[] => {
  const parsed = JSON.parse(readFileSync(CATALOG, "utf8")) as { products: CatalogProduct[] };
  return parsed.products;
};

test("the real catalog is not empty", () => {
  assert.ok(real().length > 0, "products.json has no products — run npm run store:sync");
});

test("every real product carries what checkout needs", () => {
  for (const product of real()) {
    assert.ok(product.id, "a product has no id");
    assert.ok(product.title, `${product.id}: no title`);
    assert.ok(product.priceCents > 0, `${product.id}: price is not positive`);
    assert.ok(product.taxCode, `${product.id}: no Stripe tax code — it would be taxed as general goods`);
    assert.match(product.taxCode, /^txcd_\d+$/, `${product.id}: "${product.taxCode}" is not a Stripe tax code`);
    assert.ok(product.colors.length > 0, `${product.id}: no colourways`);
    assert.ok(product.sizes.length > 0, `${product.id}: no sizes`);
    assert.ok(product.printify?.productId, `${product.id}: no Printify product id — it cannot be fulfilled`);
  }
});

test("every real colourway has exactly one variant id per size", () => {
  // The failure this catches is silent and expensive: a short array makes the
  // largest size resolve to `undefined`, and the basket refuses a shirt that is
  // on the page. buildLine() refuses it upstream; this proves what shipped.
  for (const product of real()) {
    for (const color of product.colors) {
      assert.equal(
        color.variants.length,
        product.sizes.length,
        `${product.id}/${color.name}: ${color.variants.length} variant ids for ${product.sizes.length} sizes`,
      );
      for (const id of color.variants) {
        assert.ok(Number.isInteger(id) && id > 0, `${product.id}/${color.name}: bad variant id ${id}`);
      }
    }
  }
});

test("no two real products claim the same id", () => {
  const ids = real().map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every real product can be put in a basket and priced", () => {
  // One of everything, at its own minimum, resolved against the real catalog.
  // Nothing on the shop may be unbuyable.
  const catalog = real();
  for (const product of catalog) {
    const color = product.colors[0];
    const size = product.sizes[0];
    assert.ok(color && size);
    const quantity = product.sale?.minQuantity ?? 1;
    const got = resolveBasket(
      [{ productId: product.id, color: color.name, size, quantity }],
      catalog,
    );
    assert.equal(got.ok, true, `${product.id} cannot be bought: ${got.ok ? "" : got.problems.join(" ")}`);
    if (!got.ok) continue;
    assert.equal(got.subtotalCents, product.priceCents * quantity);
  }
});

test("stickers in the real catalog are sold in threes", () => {
  const stickers = real().filter((p) => p.itemId === "sticker");
  if (!stickers.length) return;
  for (const sticker of stickers) {
    assert.equal(
      sticker.sale?.minQuantity,
      3,
      `${sticker.id}: a single sticker loses money — it must carry the minimum`,
    );
  }
});

test("real clothing is not taxed as general goods", () => {
  // The whole point of the tax codes. A garment shipped as txcd_99999999 is
  // charged New York's full 8.75% instead of the 4.75% it owes, and the
  // difference is collected from the customer and remitted to nobody.
  const APPAREL = new Set(["tee", "hoodie", "cap", "beanie"]);
  for (const product of real()) {
    if (!APPAREL.has(product.itemId)) continue;
    assert.notEqual(
      product.taxCode,
      "txcd_99999999",
      `${product.id} is apparel and would be taxed as general tangible goods`,
    );
  }
});
