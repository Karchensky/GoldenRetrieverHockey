/**
 * What to charge for one variant, so that every size earns the same margin.
 *
 * **THE PROBLEM THIS SOLVES.** A Bella+Canvas 3001 costs $11.54 in small and
 * $16.44 in 3XL. One price per product therefore cannot be fair: at $23 the
 * small earned 37.3% and the 3XL earned 19.7%, which means somebody who takes a
 * medium was subsidising somebody who takes a 3XL by about four dollars. The
 * captain's instruction on 2026-07-29 was "20% on all sizes… let's not abuse
 * people here", and the only way to honour it is to let the price follow the
 * cost.
 *
 * Printify prices per VARIANT, so this is expressible. It just was not expressed.
 *
 * **The arithmetic.** For a target margin `m`, measured against what the
 * customer actually pays:
 *
 *     charge = price + postage
 *     keep   = charge − cost − postage − (charge × 2.9% + 30¢)
 *            = price − cost − (price + postage) × 2.9% − 30¢
 *
 * Setting `keep = m × charge` and solving for price:
 *
 *     price = (m × post + 0.029 × post + 0.30 + cost) / (0.971 − m)
 *
 * The postage appears on both sides — it is collected and paid, so it cancels
 * out of the profit — but it does NOT vanish, because Stripe takes its cut of
 * the postage too, and because the margin is a share of a charge that includes
 * it. That is the `0.229 × post` term for m = 0.20.
 */

/** Stripe's US card rate. The same constants report.ts publishes. */
export const STRIPE_PERCENT = 0.029;
export const STRIPE_FLAT_CENTS = 30;

/**
 * Prices land on a whole multiple of this, **rounded up**.
 *
 * Up, not nearest: rounding down would put the variant under the target, and
 * the target is a floor the captain set rather than an average to hit. The
 * overshoot is at most 49 cents, which on a $17 tee is a third of a point of
 * margin.
 *
 * Twenty-five cents rather than fifty because the sticker sells for under three
 * dollars, where a fifty-cent step is an 18% jump and pushed it four points over
 * target. A quarter costs at most a third of a point on a $17 tee.
 */
export const PRICE_STEP_CENTS = 25;

/**
 * The price for one variant. Integer cents in, integer cents out.
 *
 * Throws rather than returning a loss-making figure: a margin at or above
 * 97.1% has no solution — the denominator goes to zero and then negative — and
 * a silent negative price is the worst possible failure in this file.
 */
export function priceForVariant(
  costCents: number,
  postageCents: number,
  margin: number,
  units = 1,
): number {
  if (!Number.isFinite(costCents) || costCents <= 0) {
    throw new Error(`priceForVariant: cost must be positive cents, got ${costCents}`);
  }
  if (!Number.isFinite(postageCents) || postageCents < 0) {
    throw new Error(`priceForVariant: postage must be cents, got ${postageCents}`);
  }
  const ceiling = 1 - STRIPE_PERCENT;
  if (!(margin >= 0) || margin >= ceiling) {
    throw new Error(
      `priceForVariant: margin ${margin} is not reachable — it must be under ` +
        `${ceiling.toFixed(3)}, because Stripe takes ${(STRIPE_PERCENT * 100).toFixed(1)}% first.`,
    );
  }

  if (!Number.isInteger(units) || units < 1) {
    throw new Error(`priceForVariant: units must be a whole number, got ${units}`);
  }

  /* `units` IS THE SMALLEST BASKET THIS ITEM SELLS IN, and it changes the
     answer. A sticker is sold in threes and three of them share ONE parcel:
     $4.77 for the set, not $4.59 each. Solving the single-unit equation and
     multiplying by three prices in three parcels that never existed — measured
     on 2026-07-29, that put the sticker at 38.6% against a 20% target, which is
     precisely the "abusing people" the captain named.
     The postage is a per-BASKET term, so it is divided across the units by the
     `units` in the denominator rather than multiplied by them:

       charge = units x price + post
       price  = (units x cost + (m + 0.029) x post + 0.30) / (units x (0.971 - m))

     For units = 1 this is exactly the equation above it. */
  const numerator =
    units * costCents +
    (margin + STRIPE_PERCENT) * postageCents +
    STRIPE_FLAT_CENTS;
  const exact = numerator / (units * (ceiling - margin));
  return Math.ceil(exact / PRICE_STEP_CENTS) * PRICE_STEP_CENTS;
}

/** What a sale of `units` at `priceCents` actually leaves. All integer cents. */
export function keepFor(
  priceCents: number,
  costCents: number,
  postageCents: number,
  units = 1,
): { charge: number; stripe: number; keep: number; margin: number } {
  const charge = priceCents * units + postageCents;
  const stripe = Math.round(charge * STRIPE_PERCENT) + STRIPE_FLAT_CENTS;
  const keep = charge - stripe - costCents * units - postageCents;
  return { charge, stripe, keep, margin: charge ? keep / charge : 0 };
}
