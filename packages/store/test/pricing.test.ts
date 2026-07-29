import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRICE_STEP_CENTS,
  STRIPE_PERCENT,
  keepFor,
  priceForVariant,
} from "../src/pricing.ts";
import { MARGIN_TARGET } from "../src/matrix.ts";

/**
 * THE PRICE OF EVERYTHING, and the one file where an error is a refund.
 *
 * `pricing.ts` decides what every one of 252 variants costs. It is checked here
 * rather than trusted because the two bugs it has already had were both silent:
 * pricing a 15 oz mug against an 11 oz mug's postage put it four points UNDER
 * target, and pricing a sticker as three separate parcels put it eighteen points
 * OVER. Neither threw. Neither showed up anywhere but in arithmetic.
 *
 * The property that matters is not "the number is what I expected" — it is
 * **the margin comes out at the target, for every cost, every postage and every
 * basket size**. So most of what follows is a round trip: price it, then work
 * out what that price actually earns, and check the two agree.
 */

/* ------------------------------------------------------------------ */
/* The round trip                                                      */
/* ------------------------------------------------------------------ */

test("a priced variant earns the target margin, across the whole plausible range", () => {
  // Real costs in this shop run $1.58 (sticker) to $36.74 (3XL hoodie); real
  // postage runs $4.59 to $8.99. This sweeps well past both.
  for (let cost = 100; cost <= 6000; cost += 137) {
    for (const post of [0, 459, 475, 489, 699, 849, 899, 1500]) {
      for (const margin of [0.1, 0.15, 0.2, 0.25, 0.35, 0.5]) {
        const price = priceForVariant(cost, post, margin);
        const { margin: got } = keepFor(price, cost, post);
        assert.ok(
          got >= margin - 0.0005,
          `cost ${cost} post ${post} target ${margin}: priced ${price} and earned ${got.toFixed(4)}`,
        );
      }
    }
  }
});

test("rounding only ever overshoots, and never by more than the step", () => {
  // Rounding UP is deliberate: the target is a floor. The overshoot has to stay
  // small or "20%" quietly becomes 25% on the cheap items.
  for (let cost = 150; cost <= 4000; cost += 71) {
    for (const post of [459, 475, 849, 899]) {
      const price = priceForVariant(cost, post, 0.2);
      const { margin } = keepFor(price, cost, post);
      assert.ok(margin >= 0.1995, `${cost}/${post} came out under target at ${margin}`);
      // One step of price is at most this much margin on the smallest charge.
      const slack = PRICE_STEP_CENTS / (price + post);
      assert.ok(
        margin <= 0.2 + slack + 0.001,
        `${cost}/${post} overshot to ${margin} — more than one ${PRICE_STEP_CENTS}c step`,
      );
    }
  }
});

test("prices land on a whole step", () => {
  for (let cost = 100; cost <= 4000; cost += 313) {
    assert.equal(priceForVariant(cost, 475, 0.2) % PRICE_STEP_CENTS, 0);
  }
});

test("a dearer variant is never cheaper", () => {
  // The whole point of per-variant pricing: price follows cost, monotonically.
  let last = 0;
  for (const cost of [1154, 1410, 1644, 3292, 3416, 3458, 3579, 3674]) {
    const price = priceForVariant(cost, 475, 0.2);
    assert.ok(price >= last, `cost ${cost} priced ${price}, below the previous ${last}`);
    last = price;
  }
});

/* ------------------------------------------------------------------ */
/* Baskets sold in multiples                                           */
/* ------------------------------------------------------------------ */

test("an item sold in threes is priced for ONE parcel, not three", () => {
  // The sticker. $1.58 to make, and three share a $4.77 parcel.
  const perParcel = priceForVariant(158, 477, 0.2, 3);
  const asThreeParcels = priceForVariant(158, 477, 0.2, 1);
  assert.ok(
    perParcel < asThreeParcels,
    `pricing three in one parcel (${perParcel}) must undercut pricing each in its own (${asThreeParcels})`,
  );

  // And the basket that actually gets sold earns the target.
  const { margin } = keepFor(perParcel, 158, 477, 3);
  assert.ok(margin >= 0.1995 && margin < 0.24, `three at ${perParcel} earned ${margin}`);
});

test("the units-aware formula reduces to the single-unit one at units = 1", () => {
  for (const cost of [158, 1154, 3674]) {
    for (const post of [459, 849]) {
      assert.equal(priceForVariant(cost, post, 0.2, 1), priceForVariant(cost, post, 0.2));
    }
  }
});

test("any basket size earns the target", () => {
  for (const units of [1, 2, 3, 5, 10]) {
    for (const cost of [158, 200, 1154, 3674]) {
      const price = priceForVariant(cost, 477, 0.2, units);
      const { margin } = keepFor(price, cost, 477, units);
      assert.ok(margin >= 0.1995, `${units} x ${cost} priced ${price} earned ${margin}`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

test("refuses a cost it cannot price from", () => {
  for (const cost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => priceForVariant(cost, 475, 0.2), /cost must be positive/);
  }
});

test("refuses a margin Stripe has already taken", () => {
  // At 97.1% and above the denominator is zero or negative and the "price"
  // would come back negative. A negative price is the worst bug in this file.
  for (const margin of [1 - STRIPE_PERCENT, 0.98, 1, 2, -0.1]) {
    assert.throws(() => priceForVariant(1000, 475, margin), /not reachable|/);
  }
  assert.throws(() => priceForVariant(1000, 475, 0.99), /not reachable/);
});

test("refuses a fractional basket", () => {
  for (const units of [0, -1, 1.5]) {
    assert.throws(() => priceForVariant(1000, 475, 0.2, units), /units must be/);
  }
});

test("keepFor is the inverse of the price, to the cent", () => {
  const { charge, stripe, keep } = keepFor(1700, 1154, 475);
  assert.equal(charge, 1700 + 475);
  assert.equal(stripe, Math.round(2175 * STRIPE_PERCENT) + 30);
  assert.equal(keep, charge - stripe - 1154 - 475);
});

/* ------------------------------------------------------------------ */
/* The shop as it stands                                               */
/* ------------------------------------------------------------------ */

const ROOT = join(import.meta.dirname, "..", "..", "..");

const catalog = (): {
  id: string;
  itemId: string;
  priceCents: number;
  prices?: Record<string, number>;
  sale?: { minQuantity?: number };
  colors: { variants: number[] }[];
  sizes: string[];
}[] => JSON.parse(readFileSync(join(ROOT, "apps/web/data/products.json"), "utf8")).products;

test("the target this shop is priced at is a sane one", () => {
  assert.ok(MARGIN_TARGET > 0 && MARGIN_TARGET < 1 - STRIPE_PERCENT);
  // A floor the captain set. Below 18% a single customer-error reprint costs
  // more than three sales earn; above 40% this stopped being a favour.
  assert.ok(MARGIN_TARGET >= 0.15 && MARGIN_TARGET <= 0.4, `MARGIN_TARGET is ${MARGIN_TARGET}`);
});

test("every real product prices every one of its variants", () => {
  for (const p of catalog()) {
    const ids = p.colors.flatMap((c) => c.variants);
    assert.ok(p.prices, `${p.id}: no per-variant prices — every size would bill at the cheapest`);
    for (const id of ids) {
      const price = p.prices?.[String(id)];
      assert.ok(
        typeof price === "number" && price > 0,
        `${p.id}: variant ${id} has no price`,
      );
    }
  }
});

test("priceCents is the CHEAPEST variant, because cards say 'from'", () => {
  for (const p of catalog()) {
    const all = Object.values(p.prices ?? {});
    if (!all.length) continue;
    assert.equal(p.priceCents, Math.min(...all), `${p.id}: 'from' price is not the lowest`);
  }
});

test("a dearer size never costs less than a smaller one, on every real product", () => {
  for (const p of catalog()) {
    for (const way of p.colors) {
      let last = 0;
      way.variants.forEach((id, i) => {
        const price = p.prices?.[String(id)] ?? p.priceCents;
        assert.ok(
          price >= last,
          `${p.id}: ${p.sizes[i]} is ${price}c, cheaper than the size below it (${last}c)`,
        );
        last = price;
      });
    }
  }
});

test("every real price lands on a whole step", () => {
  for (const p of catalog()) {
    for (const [id, price] of Object.entries(p.prices ?? {})) {
      assert.equal(price % PRICE_STEP_CENTS, 0, `${p.id}/${id} is ${price}c, off-step`);
    }
  }
});
