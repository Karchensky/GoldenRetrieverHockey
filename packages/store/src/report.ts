import {
  SHOP_ID,
  getBlueprint,
  listAllPrintProviders,
  listProducts,
  listShippingMethods,
  listShippingRates,
} from "./api.ts";
import { loadArt, place, productLine } from "./line.ts";
import { ITEMS, MARGIN_TARGET, MARKS } from "./matrix.ts";
import type { LineItem } from "./matrix.ts";
import { canvasesFor } from "./sync.ts";
import type { PrintifyProduct } from "./types.ts";

/**
 * `npm run store:report` — every number needed to price this line, live.
 *
 * The captain's ask was to decide the store's economics himself without opening
 * a spreadsheet: what a thing costs him, what he makes, what the post costs,
 * which brand it is, and where the thin ones are. All of that exists in
 * Printify; none of it is in one place, and the two figures that decide whether
 * a product is worth selling — the cost of the LARGEST variant and the shipping
 * on a single unit — are four clicks apart in the dashboard.
 *
 * **Nothing in this file is typed from memory.** Costs and prices are read off
 * the live shop, brand and model off the catalog, shipping off the v2 rate
 * endpoint, printed size off the same placement arithmetic that sync.ts sends.
 * The only constants are Stripe's published fee and the two thresholds that
 * decide what gets flagged, and both are declared at the top where they can be
 * argued with.
 *
 * It writes nothing and creates nothing. Every call is a GET.
 */

/* ------------------------------------------------------------------ */
/* The assumptions, all of them, in one place                          */
/* ------------------------------------------------------------------ */

/**
 * A US card rate — 2.9% + 30c of the FULL charge, shipping included.
 *
 * The store sells through its own Stripe checkout, so this is a real cost and
 * not a precaution — and Stripe charges it on the whole charge, which means on
 * the postage and on the sales tax as well as on the goods.
 */
export const STRIPE_PERCENT = 0.029;
export const STRIPE_FLAT_CENTS = 30;

/**
 * **Postage is passed through at cost.** Decided 2026-07-29, replacing the
 * baked-in rate of the day before: one figure per product cannot express a
 * postage table where the second tee costs $2.40 against a $4.75 first, so
 * every multi-item basket overpaid.
 *
 * The margin that decides whether a product is worth selling is therefore what
 * is left after the goods and after Stripe — the postage cancels, being both
 * collected and paid. Net below this on the dearest variant is called out.
 *
 * **Lowered 30% → 20% → 18% on 2026-07-29**, tracking the captain's own line:
 * *"We want lower margins; I don't want to be ripping people off"*, then 20%
 * exactly. A threshold at or above the operating margin flags every row and
 * therefore flags nothing, so this sits just under it. 18% is where a sale
 * genuinely stops being worth making — below it one customer-error reprint,
 * which Printify charges for, costs more than three sales earn.
 */
const THIN_NET_MARGIN = 0.18;
/**
 * US first-item shipping above this share of retail is called out separately.
 * It is not a pricing failure once postage is priced in — it is a warning that
 * the item is mostly parcel, so its price moves with the carrier and not with
 * the garment.
 */
const HEAVY_SHIPPING = 0.25;

/**
 * The 27 countries Printify quotes as one EU profile. Listed rather than
 * inferred: the endpoint returns one row per country and nothing in it says
 * "this is the EU rate".
 */
const EU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

type Region = "US" | "CA" | "EU" | "ROW";
const REGIONS: Region[] = ["US", "CA", "EU", "ROW"];

function regionOf(code: string): Region | null {
  if (code === "US") return "US";
  if (code === "CA") return "CA";
  if (code === "REST_OF_THE_WORLD") return "ROW";
  if (EU.has(code)) return "EU";
  return null;
}

/** Negative money reads `-$1.06`, never `$-1.06`. It appears often enough to matter. */
const usd = (cents: number): string => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What Stripe takes off a charge of `cents`. */
const stripeFee = (cents: number): number => Math.round(cents * STRIPE_PERCENT) + STRIPE_FLAT_CENTS;

/* `netOf(retail, cost, ship)` lived here and was deleted on 2026-07-29. It
   encoded the old policy — the customer pays the shelf price and the postage
   comes out of it — and it had no callers, so it was a second, wrong definition
   of the one number this whole report exists to state. `unitOf` below is the
   only arithmetic. */

/**
 * The same arithmetic over the SMALLEST BASKET an item may be sold in.
 *
 * It exists for the sticker and it is not a special case: postage merges within
 * one product type, so three stickers post for $4.77 rather than $13.77 and the
 * per-unit figure is a lie about a product sold in threes. An item with no
 * minimum passes straight through with `units` of 1 and identical numbers.
 */
type Unit = { units: number; charge: number; goods: number; post: number; stripe: number; keep: number };

/**
 * The price set against a given cost, from the shop's own tiers.
 *
 * Every call site below asks about a COST — the dearest variant, the cheapest —
 * and every one of them used to assume a single price. With price following
 * cost, the pairing has to be looked up or the report quotes a 3XL's cost
 * against a small's price and reports a margin nobody earns.
 */
function priceAtCost(row: Row, cost: number): number {
  return row.tiers.find((t) => t.cost === cost)?.price ?? row.retail;
}

/** That tier's own US postage, or undefined to fall back to the product's worst. */
function postAtCost(row: Row, cost: number): number | undefined {
  return row.tiers.find((t) => t.cost === cost)?.post || undefined;
}

function unitOf(row: Row, cost: number, price = row.retail, firstItem?: number): Unit {
  const units = Math.max(1, row.sale?.minQuantity ?? 1);
  const rate = row.shipping.find((m) => m.method === "standard")?.byRegion.get("US");
  // `firstItem` overrides the product's worst rate with this TIER's own, which
  // is what a margin has to be measured against. See `usPostPerVariant`.
  const first = firstItem ?? rate?.first ?? 0;
  const post = rate ? first + (units - 1) * rate.additional : first;
  const goods = cost * units;

  /* POSTAGE IS PASSED THROUGH, NOT ABSORBED — changed 2026-07-29.
     This used to read `keep = charge - goods - post - stripe`, where `charge`
     was the retail price alone. That was right while every price had a
     first-item postage rate baked into it. It is wrong now, and wrong in the
     direction that matters: with postage taken out of the prices, subtracting
     it from a revenue figure that no longer contains it counted the same
     dollars twice and reported the $17 mug at MINUS $1.07 — a product losing
     money on every sale, when it in fact keeps $7.66.
     What the customer pays is the goods PLUS the real postage. What we pay is
     the goods cost plus that same postage, so the postage cancels and what is
     left is the retail less the cost less the card fee — and Stripe's cut is
     taken on the whole charge including the postage, which is why `post` is
     still in the arithmetic at all. */
  const charge = price * units + post;
  const stripe = stripeFee(charge);
  return { units, charge, goods, post, stripe, keep: charge - goods - post - stripe };
}

/* ------------------------------------------------------------------ */
/* Shipping                                                            */
/* ------------------------------------------------------------------ */

type Rate = { first: number; additional: number; handlingFrom: number; handlingTo: number };
type MethodRates = { method: string; byRegion: Map<Region, Rate>; otherCountries: number };
type MethodByVariant = {
  method: string;
  byVariant: Map<number, Map<Region, Rate>>;
  otherCountries: number;
};

/**
 * Keyed by blueprint and provider ONLY, never by variant list.
 *
 * The two tees are one blueprint and one provider with different colourways, so
 * a cache that included the variant ids missed on the second and downloaded the
 * same 6 MB twice. Halving the fetches took the report from 24 seconds to 13.
 */
const shippingCache = new Map<string, MethodByVariant[]>();

/** Worst first-item and additional-item cost, widest handling window. */
function worst(a: Rate | undefined, b: Rate): Rate {
  if (!a) return b;
  return {
    first: Math.max(a.first, b.first),
    additional: Math.max(a.additional, b.additional),
    handlingFrom: Math.min(a.handlingFrom, b.handlingFrom),
    handlingTo: Math.max(a.handlingTo, b.handlingTo),
  };
}

/**
 * Every shipping method a blueprint/provider offers, indexed by variant and cut
 * down to the four regions worth printing.
 *
 * The cut is not cosmetic. Standard shipping for a Bella+Canvas 3001 is 18,538
 * rows and 6 MB — one per variant per country — and there is no filter
 * parameter, so the whole set comes down and is reduced here.
 */
async function ratesOf(blueprintId: number, printProviderId: number): Promise<MethodByVariant[]> {
  const key = `${blueprintId}/${printProviderId}`;
  const hit = shippingCache.get(key);
  if (hit) return hit;

  const index = await listShippingMethods(blueprintId, printProviderId);
  const out: MethodByVariant[] = [];

  for (const entry of index.data) {
    const method = entry.attributes.name;
    const rates = await listShippingRates(blueprintId, printProviderId, method);
    const byVariant = new Map<number, Map<Region, Rate>>();
    const others = new Set<string>();

    for (const row of rates.data) {
      const a = row.attributes;
      const region = regionOf(a.country.code);
      if (!region) { others.add(a.country.code); continue; }
      const forVariant = byVariant.get(a.variantId) ?? new Map<Region, Rate>();
      forVariant.set(region, worst(forVariant.get(region), {
        first: a.shippingCost.firstItem.amount,
        additional: a.shippingCost.additionalItems.amount,
        handlingFrom: a.handlingTime.from,
        handlingTo: a.handlingTime.to,
      }));
      byVariant.set(a.variantId, forVariant);
    }

    if (byVariant.size) out.push({ method, byVariant, otherCountries: others.size });
  }

  // Standard first: it is what Printify charges unless an order says otherwise.
  out.sort((a, b) => (a.method === "standard" ? -1 : b.method === "standard" ? 1 : a.method.localeCompare(b.method)));
  shippingCache.set(key, out);
  return out;
}

/**
 * The rates that apply to one product's variants.
 *
 * Where two variants of the same product are quoted differently the dearer is
 * kept, because a shipping figure that silently reports only the cheap size is
 * the same lie as a resolution figure that reports only the small shirt.
 */
async function shippingFor(
  blueprintId: number,
  printProviderId: number,
  variantIds: number[],
): Promise<MethodRates[]> {
  const all = await ratesOf(blueprintId, printProviderId);
  const out: MethodRates[] = [];
  for (const m of all) {
    const byRegion = new Map<Region, Rate>();
    for (const id of variantIds) {
      for (const [region, rate] of m.byVariant.get(id) ?? []) {
        byRegion.set(region, worst(byRegion.get(region), rate));
      }
    }
    if (byRegion.size) out.push({ method: m.method, byRegion, otherCountries: m.otherCountries });
  }
  return out;
}

/**
 * US standard first-item postage **per variant**, not collapsed to the worst.
 *
 * `shippingFor` above deliberately takes the worst rate across a product's
 * variants, because most of what this report says about shipping is a warning
 * and the pessimistic figure is the right one to warn with. That is wrong for a
 * MARGIN: an 11 oz mug posts for $6.99 and a 15 oz for $8.99, and charging the
 * small one the big one's postage reported it at 18.6% against a real 20.9% —
 * a product that looks under target and is not, which is the kind of figure
 * somebody reprices against.
 */
async function usPostPerVariant(
  blueprintId: number,
  printProviderId: number,
  variantIds: number[],
): Promise<Map<number, number>> {
  const all = await ratesOf(blueprintId, printProviderId);
  const standard = all.find((m) => m.method === "standard");
  const out = new Map<number, number>();
  if (!standard) return out;
  for (const id of variantIds) {
    const rate = standard.byVariant.get(id)?.get("US");
    if (rate) out.set(id, rate.first);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One product                                                         */
/* ------------------------------------------------------------------ */

/**
 * One cost the shop reports, and **the price that was set against it**.
 *
 * `price` arrived on 2026-07-29 with per-variant pricing. Before that a product
 * had one price and a tier only needed its cost; now the price follows the cost
 * so that a 3XL and a small earn the same margin, and a tier without its own
 * price cannot state a margin at all.
 */
type CostTier = {
  cost: number;
  price: number;
  /** US standard first-item postage for this tier — its OWN, not the product's worst. */
  post: number;
  variants: number;
  sizes: string[];
  colours: string[];
};

type Row = {
  id: string;
  title: string;
  markId: string;
  itemId: string;
  productId: string | null;
  visible: boolean | null;
  blueprintId: number;
  brand: string;
  model: string;
  blueprintTitle: string;
  printProviderId: number;
  providerTitle: string;
  providerCountry: string;
  retail: number;
  /** Enabled on the shop. Zero when the cost was suppressed as a stale garment. */
  variants: number;
  /** What the matrix asks for, which is the only count that means anything on a drift. */
  matrixVariants: number;
  tiers: CostTier[];
  minCost: number;
  maxCost: number;
  art: string;
  artPx: string;
  print: { position: string; widthIn: number; maxWidthIn: number; minDpi: number } | null;
  shipping: MethodRates[];
  /** Print positions the catalog offers, when they disagree with the matrix. */
  positionDrift: string | null;
  /**
   * Set when the product on the shop is a DIFFERENT GARMENT from the one the
   * matrix now describes — a different blueprint, or the same blueprint from a
   * different maker.
   *
   * This exists because the product is matched by TITLE, and a title is derived
   * from the mark and the item and does not change when the garment underneath
   * it does. Change a hoodie from Gildan to Independent Trading in matrix.ts and
   * the old Gildan draft still answers to "Golden Retrievers Crest — Hoodie",
   * so every cost in this report would be the Gildan's, quoted confidently
   * against the Independent's price. It would look right and be wrong by ten
   * dollars a unit. When this is set, the cost tiers are NOT printed.
   */
  garmentDrift: string | null;
  /** Buying rules checkout has to enforce, from the matrix. */
  sale: LineItem["sale"];
  notes: string[];
};

/** Split the enabled variants into cost tiers, since cost moves with size. */
function costTiers(
  product: PrintifyProduct,
  sizeOf: Map<number, string>,
  colourOf: Map<number, string>,
  postOf: Map<number, number>,
): CostTier[] {
  const tiers = new Map<number, { price: number; post: number; variants: number; sizes: Set<string>; colours: Set<string> }>();
  for (const v of product.variants) {
    if (!v.is_enabled) continue;
    const tier = tiers.get(v.cost) ?? { price: v.price, post: 0, variants: 0, sizes: new Set<string>(), colours: new Set<string>() };
    tier.post = Math.max(tier.post, postOf.get(v.id) ?? 0);
    // Variants at one cost should be at one price. If they are not, the DEAREST
    // is reported, because that is the one whose margin looks best and the point
    // of this report is to be pessimistic where it is unsure.
    tier.price = Math.max(tier.price, v.price);
    tier.variants++;
    const size = sizeOf.get(v.id);
    const colour = colourOf.get(v.id);
    if (size) tier.sizes.add(size);
    if (colour) tier.colours.add(colour);
    tiers.set(v.cost, tier);
  }
  return [...tiers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cost, t]) => ({ cost, price: t.price, post: t.post, variants: t.variants, sizes: [...t.sizes], colours: [...t.colours] }));
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

export async function report(): Promise<number> {
  const LINE = productLine();
  const live = await listProducts();
  const byTitle = new Map(live.data.map((p) => [p.title, p]));
  const providers = new Map((await listAllPrintProviders()).map((p) => [p.id, p]));

  const blueprints = new Map<number, Awaited<ReturnType<typeof getBlueprint>>>();
  for (const id of new Set(LINE.map((i) => i.blueprintId))) blueprints.set(id, await getBlueprint(id));

  const rows: Row[] = [];

  for (const item of LINE) {
    const product = byTitle.get(item.title) ?? null;
    const blueprint = blueprints.get(item.blueprintId);
    const provider = providers.get(item.printProviderId);
    const variantIds = item.colors.flatMap((c) => c.variants);
    const notes: string[] = [];

    // variant id -> size and colour, from the matrix, so a cost tier can be
    // named rather than listed as a set of numbers.
    const sizeOf = new Map<number, string>();
    const colourOf = new Map<number, string>();
    for (const c of item.colors) {
      c.variants.forEach((id, n) => {
        const size = item.sizes[n];
        if (size) sizeOf.set(id, size);
        colourOf.set(id, c.name);
      });
    }

    // A product is matched by title, and titles survive a change of garment.
    // Check what is actually underneath before believing a single figure off it.
    let garmentDrift: string | null = null;
    if (product && (product.blueprint_id !== item.blueprintId || product.print_provider_id !== item.printProviderId)) {
      garmentDrift =
        `the shop's product is blueprint ${product.blueprint_id} / provider ${product.print_provider_id}; ` +
        `the matrix now says blueprint ${item.blueprintId} / provider ${item.printProviderId}`;
    }

    /* **RETAIL COMES OFF THE SHOP NOW, and that is a reversal.**
       It used to come off the matrix, because the matrix decided the price and
       the shop merely held the last one pushed. That is no longer true: the
       price is COMPUTED, per variant, from the cost the shop reports and the
       postage Printify quotes, so `item.priceCents` is an anchor sent at
       creation and nothing more. Reporting it made every tee read $23 with a
       19.7-37.3% spread — precisely the spread per-variant pricing removed.
       The matrix figure is still shown when the product is not on the shop at
       all, because then there is nothing else to show. */
    const shopPrices = product
      ? product.variants.filter((v) => v.is_enabled).map((v) => v.price)
      : [];
    const retail = shopPrices.length ? Math.min(...shopPrices) : item.priceCents;
    let tiers: CostTier[] = [];
    if (product) {
      const prices = [...new Set(shopPrices)].sort((a, b) => a - b);
      if (prices.length > 1) {
        notes.push(`priced per size: ${prices.map(usd).join(" · ")}`);
      }
      if (product.visible) notes.push("VISIBLE — this product is not a draft");
      if (garmentDrift) {
        notes.push(`the shop holds a DIFFERENT GARMENT — ${garmentDrift}`);
        notes.push("no cost is shown: the one on the shop is the old garment's. `cli.ts cost` quotes the new one");
      } else {
        tiers = costTiers(
          product,
          sizeOf,
          colourOf,
          await usPostPerVariant(item.blueprintId, item.printProviderId, variantIds),
        );
      }
    } else {
      notes.push("not on the shop yet — `cli.ts sync` would create it");
    }

    // The printed size, re-derived exactly as sync.ts derives it.
    let print: Row["print"] = null;
    let artPx = "";
    let artName = item.placements[0]?.art ?? "";
    let positionDrift: string | null = null;
    try {
      const p = item.placements[0];
      if (p) {
        const loaded = await loadArt(p.art);
        artName = p.art;
        artPx = `${loaded.box.width} x ${loaded.box.height}`;
        const { smallest, largest, tightestShape } = await canvasesFor(
          item.blueprintId, item.printProviderId, variantIds, p.position,
        );
        const fitted = place(smallest, loaded.box, p.widthIn, tightestShape);
        const maxWidthIn = Number(((largest.width / 300) * fitted.scale).toFixed(2));
        print = {
          position: p.position,
          widthIn: fitted.widthIn,
          maxWidthIn,
          minDpi: Math.round(loaded.box.width / maxWidthIn),
        };
      }
    } catch (err) {
      notes.push(`could not measure the art: ${err instanceof Error ? err.message : String(err)}`);
    }

    // What the catalog says this garment can be printed on, against what the
    // matrix declares. A silent disagreement here is how a placement ends up
    // legal in the config and rejected by the API.
    const declared = ITEMS.find((i) => i.id === item.itemId)?.positions ?? [];
    try {
      const firstVariant = variantIds[0];
      if (firstVariant !== undefined && declared.length) {
        const offered = await positionsOf(item.blueprintId, item.printProviderId, firstVariant);
        const missing = declared.filter((d) => !offered.includes(d));
        const extra = offered.filter((o) => !declared.includes(o));
        if (missing.length || extra.length) {
          positionDrift =
            `matrix declares ${declared.join(", ")}; the catalog offers ${offered.join(", ") || "none"}`;
        }
      }
    } catch {
      // The placement measurement above already reports a catalog failure.
    }

    const costs = tiers.map((t) => t.cost);

    rows.push({
      id: item.id,
      title: item.title,
      markId: item.markId,
      itemId: item.itemId,
      productId: product?.id ?? null,
      visible: product ? product.visible : null,
      blueprintId: item.blueprintId,
      brand: blueprint?.brand?.trim() || "—",
      model: blueprint?.model?.trim() || "",
      blueprintTitle: blueprint?.title ?? "",
      printProviderId: item.printProviderId,
      providerTitle: provider?.title ?? "unknown",
      providerCountry: provider?.location?.country ?? "??",
      retail,
      variants: tiers.reduce((n, t) => n + t.variants, 0),
      matrixVariants: variantIds.length,
      tiers,
      minCost: costs.length ? Math.min(...costs) : 0,
      maxCost: costs.length ? Math.max(...costs) : 0,
      art: artName,
      artPx,
      print,
      shipping: await shippingFor(item.blueprintId, item.printProviderId, variantIds),
      positionDrift,
      garmentDrift,
      sale: item.sale,
      notes,
    });
  }

  render(rows, live.data);
  return rows.some((r) => r.notes.some((n) => n.startsWith("VISIBLE"))) ? 1 : 0;
}

/** The print positions one variant actually offers, per the catalog. */
async function positionsOf(blueprintId: number, printProviderId: number, variantId: number): Promise<string[]> {
  // canvasesFor throws with the offered list when a position is missing, so ask
  // it for something no garment has and read the answer out of the message.
  try {
    await canvasesFor(blueprintId, printProviderId, [variantId], "__probe__");
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const match = /It offers: (.*)$/.exec(message);
    if (!match?.[1]) throw err;
    return match[1] === "none" ? [] : match[1].split(", ");
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Discount codes                                                      */
/* ------------------------------------------------------------------ */

/** The columns the table prints. Percent off the GOODS, never off the postage. */
const DISCOUNT_STEPS = [0, 10, 15, 20, 25, 30];

/**
 * What one sale keeps when a code takes `percent` off the shelf price.
 *
 * The discount comes off the goods only. Postage is passed through at cost and
 * a code that discounted it would be paying the carrier out of our own pocket —
 * Printify charges its rate whatever the customer was charged. Stripe's cut is
 * still taken on the whole reduced charge INCLUDING that postage, which is the
 * reason break-even sits well below the 30% margin instead of exactly at it.
 */
function keepAtDiscount(row: Row, tier: CostTier, percent: number): number {
  const price = Math.round(tier.price * (1 - percent / 100));
  return unitOf(row, tier.cost, price, tier.post || undefined).keep;
}

/**
 * The largest WHOLE percent that still leaves every one of these tiers at or
 * above zero. Whole percents because that is what a Stripe coupon takes.
 */
function breakEven(row: Row, tiers: CostTier[]): number {
  for (let d = 0; d <= 100; d++) {
    if (tiers.some((t) => keepAtDiscount(row, t, d) < 0)) return d - 1;
  }
  return 100;
}

/**
 * THE TABLE THE CAPTAIN ASKED FOR: profit per item at a given code.
 *
 * One line per GARMENT, not per product — every mark on a tee has the same
 * blueprint, maker, cost and price, so fifty-nine lines would be nine facts
 * repeated. The worst tier of each garment is the one quoted, because the
 * dearest size is what goes underwater first and a code is set once for all of
 * them.
 */
function discounts(rows: Row[]): void {
  const byItem = new Map<string, { row: Row; tiers: CostTier[] }>();
  for (const row of rows) {
    if (!row.tiers.length || row.garmentDrift) continue;
    const seen = byItem.get(row.itemId);
    if (seen) seen.tiers.push(...row.tiers);
    else byItem.set(row.itemId, { row, tiers: [...row.tiers] });
  }
  if (!byItem.size) return;

  console.log("");
  console.log(RULE);
  console.log(` A DISCOUNT CODE — what you keep per item, at each percent off`);
  console.log(RULE);
  console.log("");
  console.log(` Percent comes off the GOODS. Postage is passed through at cost and is never`);
  console.log(` discounted — Printify charges its rate whatever the customer paid. Stripe still`);
  console.log(` takes ${pct(STRIPE_PERCENT)} + ${usd(STRIPE_FLAT_CENTS)} of the reduced charge, which is why break-even lands`);
  console.log(` below the ${pct(MARGIN_TARGET)} margin rather than exactly on it.`);
  console.log("");
  console.log(` Each row is the DEAREST size of that garment — the first one to go underwater.`);
  console.log(` A sticker is a pack of three, priced and posted as one sale.`);
  console.log("");

  const head = DISCOUNT_STEPS.map((d) => `${d}%`.padStart(9)).join("");
  console.log(` ${"garment".padEnd(12)}${"sale".padStart(9)}${head}${"break-even".padStart(12)}`);
  console.log(` ${THIN.slice(0, 12 + 9 + head.length + 12)}`);

  let tightest = { item: "", at: 100 };
  for (const [itemId, { row, tiers }] of byItem) {
    // The dearest tier is the binding one; quote it, and test every tier.
    const worstTier = tiers.reduce((a, b) => (b.cost > a.cost ? b : a));
    const cells = DISCOUNT_STEPS.map((d) => usd(keepAtDiscount(row, worstTier, d)).padStart(9)).join("");
    const be = breakEven(row, tiers);
    if (be < tightest.at) tightest = { item: itemId, at: be };
    // `sale` is the whole basket, not the unit — a sticker's $4.00 beside a
    // three-pack's profit is two different sales on one line.
    const units = Math.max(1, row.sale?.minQuantity ?? 1);
    const sale = usd(worstTier.price * units) + (units > 1 ? `×${units}` : "");
    console.log(` ${itemId.padEnd(12)}${sale.padStart(9)}${cells}${`${be}%`.padStart(12)}`);
  }

  console.log("");
  console.log(
    ` SAFE ON EVERYTHING: ${tightest.at}% — the ${tightest.item} breaks even there and loses money above it.`,
  );
  console.log(` Set a team code a point or two under that. At ${tightest.at}% you are working for nothing;`);
  console.log(` the point of the code is to sell near cost, not to pay for the privilege.`);
}

const RULE = "=".repeat(96);
const THIN = "-".repeat(96);

/** Printify's own US standard first-item rate for this product. */
const usPost = (row: Row): number =>
  row.shipping.find((m) => m.method === "standard")?.byRegion.get("US")?.first ?? 0;

function flagsFor(row: Row): string[] {
  const flags: string[] = [];
  if (row.garmentDrift) flags.push("GARMENT");
  if (row.maxCost) {
    const worst = unitOf(row, row.maxCost, priceAtCost(row, row.maxCost), postAtCost(row, row.maxCost));
    if (worst.keep / worst.charge < THIN_NET_MARGIN) flags.push("THIN");
  }
  // Measured over the same smallest basket: a sticker's $4.59 is 76% of one
  // sticker and 25% of the three it is sold in.
  const smallest = unitOf(row, 0);
  if (smallest.post / smallest.charge > HEAVY_SHIPPING) flags.push("POST");
  return flags;
}

function render(rows: Row[], live: PrintifyProduct[]): void {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);

  console.log(RULE);
  console.log(` GOLDEN RETRIEVERS — STORE ECONOMICS`);
  console.log(` shop ${SHOP_ID} · live from the Printify API · ${now} UTC`);
  console.log(RULE);

  /* --- at a glance ------------------------------------------------ */

  console.log("");
  console.log(` PRICED PER SIZE AT ${pct(MARGIN_TARGET)} NET — every size earns the same, so a 3XL`);
  console.log(` costs more than a small instead of the small subsidising it. 'pays' is the`);
  console.log(` goods plus the real postage; postage is passed through at cost.`);
  console.log("");
  console.log(
    ` ${"product".padEnd(20)}${"pays".padStart(17)}  ${"your cost".padEnd(17)}` +
      `${"US post".padStart(8)}  ${"you keep".padEnd(17)}${"net".padStart(14)}  flags`,
  );
  console.log(` ${THIN.slice(0, 94)}`);

  for (const row of rows) {
    /* CHEAPEST AND DEAREST BY COST, then presented in the order the READER
       expects — ascending. With one price per product the cheap variant was
       always the better sale, so "worst - best" happened to read low to high.
       Per-variant pricing inverts that: every size earns the same PERCENTAGE, so
       the dearest size returns the most DOLLARS, and the old ordering printed
       "$5.70 - $4.53". Ranges are sorted on what they contain. */
    const low = unitOf(row, row.minCost, priceAtCost(row, row.minCost), postAtCost(row, row.minCost));
    const high = unitOf(row, row.maxCost, priceAtCost(row, row.maxCost), postAtCost(row, row.maxCost));
    const single = row.minCost === row.maxCost;
    const span = (a: number, b: number): string =>
      a === b ? usd(a) : `${usd(Math.min(a, b))} - ${usd(Math.max(a, b))}`;

    const label = high.units > 1 ? `${row.id} x${high.units}` : row.id;
    const pays = row.maxCost ? span(low.charge, high.charge) : usd(high.charge);
    const cost = row.maxCost ? span(low.goods, high.goods) : "—";
    const keep = !row.maxCost ? "—" : span(low.keep, high.keep);
    const net = !row.maxCost
      ? "—"
      : single
        ? pct(high.keep / high.charge)
        : `${pct(Math.min(low.keep / low.charge, high.keep / high.charge))} - ` +
          `${pct(Math.max(low.keep / low.charge, high.keep / high.charge))}`;
    console.log(
      (` ${label.padEnd(20)}${pays.padStart(17)}  ${cost.padEnd(17)}` +
        `${(high.post ? usd(high.post) : "—").padStart(8)}  ${keep.padEnd(17)}${net.padStart(14)}  ` +
        `${flagsFor(row).join(" ")}`).trimEnd(),
    );
  }

  /* --- per mark --------------------------------------------------- */

  for (const mark of MARKS) {
    const mine = rows.filter((r) => r.markId === mark.id);
    if (!mine.length) continue;

    console.log("");
    console.log(RULE);
    console.log(` ${mark.title.toUpperCase()} — ${mark.grounds.join(" and ")} bodies`);
    console.log(` ${mark.source}`);
    console.log(RULE);

    for (const row of mine) {
      const flags = flagsFor(row);
      console.log("");
      console.log(
        ` ${row.id} · ${row.title}${flags.length ? `   [${flags.join(" ")}]` : ""}`,
      );
      const garment = `   garment    ${`${row.brand} ${row.model}`.trim()} — ${row.blueprintTitle}`;
      console.log(`${(garment.length > 72 ? `${garment.slice(0, 71)}…` : garment).padEnd(74)}blueprint ${row.blueprintId}`);
      console.log(
        `   provider   ${row.providerTitle}, ships from ${row.providerCountry}`.padEnd(74) +
          `provider ${row.printProviderId}`,
      );
      console.log(
        `   on Printify ${row.productId ?? "not created"}` +
          `${row.visible === null ? "" : row.visible ? "  VISIBLE" : "  draft"}` +
          `   ${row.garmentDrift ? `${row.matrixVariants} variants in the matrix` : `${row.variants} enabled variants`}`,
      );
      if (row.print) {
        console.log(
          `   print      ${row.print.position} · ${row.art} ${row.artPx} px · ` +
            `${row.print.widthIn} in smallest → ${row.print.maxWidthIn} in largest · ` +
            `${row.print.minDpi} dpi at the largest`,
        );
      }
      if (row.positionDrift) console.log(`   positions  ${row.positionDrift}`);
      if (row.sale) {
        const rule = [
          row.sale.minQuantity && row.sale.minQuantity > 1 ? `sold in ${row.sale.minQuantity}s` : "",
          row.sale.addOnOnly ? "never on its own" : "",
        ].filter(Boolean).join(", ");
        console.log(`   sold as    ${rule} — ${row.sale.why}`);
      }

      /* cost tiers, and what is left of the price after the parcel */
      console.log("");
      console.log(`   retail ${usd(row.retail)}, US postage included`);
      if (row.garmentDrift) {
        console.log(`     COST NOT SHOWN — ${row.garmentDrift}.`);
        console.log(`     The figure on the shop belongs to the old garment. For the new one:`);
        console.log(`       node packages/store/src/cli.ts cost ${row.blueprintId} ${row.printProviderId}`);
      } else if (!row.tiers.length) {
        console.log(`     no cost on file — Printify only quotes cost on a product that exists.`);
        console.log(`     node packages/store/src/cli.ts cost ${row.blueprintId} ${row.printProviderId}`);
      } else {
        console.log(
          `     ${"cost".padEnd(9)}${"+ post".padEnd(9)}${"you keep".padEnd(10)}${"net".padEnd(9)}what it covers`,
        );
        for (const tier of row.tiers) {
          const u = unitOf(row, tier.cost, tier.price, tier.post || undefined);
          const covers = tier.sizes.length
            ? `${plural(tier.variants, "variant")} · ${tier.sizes.join(", ")}`
            : plural(tier.variants, "variant");
          console.log(
            `     ${usd(u.goods).padEnd(9)}${usd(u.post).padEnd(9)}${usd(u.keep).padEnd(10)}` +
              `${pct(u.keep / u.charge).padEnd(9)}${covers}`,
          );
        }
      }

      /* shipping */
      console.log("");
      if (!row.shipping.length) {
        console.log(`   shipping   none quoted for these variants`);
      } else {
        console.log(
          `   shipping   ${"".padEnd(5)}${"first".padStart(8)}${"+ each".padStart(9)}  handling`,
        );
        for (const m of row.shipping) {
          let label = m.method;
          for (const region of REGIONS) {
            const rate = m.byRegion.get(region);
            if (!rate) continue;
            console.log(
              `     ${label.padEnd(10)}${region.padEnd(5)}${usd(rate.first).padStart(8)}` +
                `${usd(rate.additional).padStart(9)}  ${rate.handlingFrom}-${rate.handlingTo} days`,
            );
            label = "";
          }
          const missing = REGIONS.filter((r) => !m.byRegion.has(r));
          if (missing.length) {
            console.log(`     ${"".padEnd(10)}${missing.join(", ")} not offered on ${m.method}`);
          }
        }
      }

      /* the one-sale numbers, and what abroad adds on top */
      if (row.maxCost) {
        const ship = usPost(row);
        const u = unitOf(row, row.maxCost, priceAtCost(row, row.maxCost), postAtCost(row, row.maxCost));
        const breakEven = Math.ceil(
          (row.maxCost * u.units + u.post + STRIPE_FLAT_CENTS) / (1 - STRIPE_PERCENT) / u.units,
        );
        console.log("");
        console.log(
          `   one US ${u.units > 1 ? `order of ${u.units}` : "sale"}, worst-case variant at ${usd(row.maxCost)} cost:`,
        );
        console.log(
          `     customer pays ${usd(u.charge).padStart(8)}   Printify ${usd(u.goods + u.post).padStart(8)}` +
            `   Stripe ${usd(u.stripe).padStart(7)}   you keep ${usd(u.keep).padStart(8)}`,
        );
        console.log(
          `     break-even retail at this cost: ${usd(breakEven)} — below that a US sale costs you money`,
        );
        // International pays the DIFFERENCE, because the US rate is already in
        // the shelf price. Where a provider posts abroad for less than it posts
        // at home — Printful does, on the tee and the cap — that difference is
        // negative and the surcharge is nothing.
        const abroad = REGIONS.filter((r) => r !== "US");
        const std = row.shipping.find((m) => m.method === "standard");
        if (std) {
          const parts = abroad.map((region) => {
            const rate = std.byRegion.get(region);
            if (!rate) return `${region} not offered`;
            const extra = rate.first - ship;
            return `${region} ${extra <= 0 ? "no surcharge" : `+${usd(extra)}`}`;
          });
          console.log(`     abroad, at cost, over the US rate already in the price: ${parts.join(" · ")}`);
        }
      }

      for (const note of row.notes) console.log(`   ! ${note}`);
    }
  }

  /* --- totals ----------------------------------------------------- */

  console.log("");
  console.log(RULE);
  console.log(` ONE OF EACH — worst-case variant, US, free shipping`);
  console.log(RULE);
  console.log("");

  let retail = 0, cost = 0, ship = 0, stripe = 0;
  let priced = 0, unpriced = 0;
  for (const row of rows) {
    if (!row.maxCost) { unpriced++; continue; }
    priced++;
    const u = unitOf(row, row.maxCost, priceAtCost(row, row.maxCost), postAtCost(row, row.maxCost));
    retail += u.charge;
    cost += u.goods;
    ship += u.post;
    stripe += u.stripe;
  }
  const keep = retail - cost - ship - stripe;
  const width = 22;
  console.log(` ${"customer pays".padEnd(width)}${usd(retail).padStart(10)}   ${priced} of ${rows.length} products`);
  console.log(` ${"Printify takes".padEnd(width)}${`-${usd(cost + ship)}`.padStart(10)}   ${usd(cost)} goods + ${usd(ship)} post`);
  console.log(` ${"card fee".padEnd(width)}${`-${usd(stripe)}`.padStart(10)}   ${pct(STRIPE_PERCENT)} + ${usd(STRIPE_FLAT_CENTS)} per order, assumed`);
  console.log(` ${"-".repeat(width + 10)}`);
  console.log(` ${"you keep".padEnd(width)}${usd(keep).padStart(10)}   ${pct(keep / retail)} of retail`);
  if (unpriced) {
    console.log("");
    console.log(
      ` ${plural(unpriced, "product")} left out: no cost is readable for them. ` +
        `See the GARMENT lines below.`,
    );
  }

  /* --- discount codes --------------------------------------------- */

  discounts(rows);

  /* --- flags ------------------------------------------------------ */

  const flagged = rows.filter((r) => flagsFor(r).length);
  if (flagged.length) {
    console.log("");
    console.log(RULE);
    console.log(` WORTH A DECISION`);
    console.log(RULE);
    console.log("");
    for (const row of flagged) {
      const flags = flagsFor(row);
      if (flags.includes("GARMENT")) {
        console.log(` GARMT ${row.id.padEnd(20)} ${row.garmentDrift}.`);
        console.log(`       ${" ".repeat(20)} Delete the old draft in the dashboard, then \`cli.ts sync\`.`);
      }
      if (flags.includes("THIN")) {
        const u = unitOf(row, row.maxCost, priceAtCost(row, row.maxCost), postAtCost(row, row.maxCost));
        const dearest = row.tiers[row.tiers.length - 1]?.sizes ?? [];
        const where = row.tiers.length > 1 && dearest.length ? ` on ${dearest.join("/")}` : "";
        console.log(
          ` THIN  ${row.id.padEnd(20)} ${pct(u.keep / u.charge)} net${where} — ${usd(u.charge)} in ` +
            `less ${usd(u.goods)} goods, ${usd(u.post)} post and ${usd(u.stripe)} Stripe.`,
        );
        console.log(`       ${" ".repeat(20)} Raise the price, or find a better maker: \`cli.ts catalogue ${row.blueprintId}\`.`);
      }
      if (flags.includes("POST")) {
        const u = unitOf(row, 0);
        console.log(
          ` POST  ${row.id.padEnd(20)} ${usd(u.post)} of a ${usd(u.charge)} order is postage — ` +
            `${pct(u.post / u.charge)}.`,
        );
        console.log(`       ${" ".repeat(20)} Priced in, so it is covered. It is the carrier that moves this price.`);
      }
    }
  }

  /* --- reconciliation --------------------------------------------- */

  const matrixTitles = new Set(rows.map((r) => r.title));
  const strays = live.filter((p) => !matrixTitles.has(p.title));
  const missing = rows.filter((r) => !r.productId);
  if (strays.length || missing.length) {
    console.log("");
    console.log(RULE);
    console.log(` THE SHOP AND THE MATRIX DISAGREE`);
    console.log(RULE);
    console.log("");
    for (const p of strays) {
      console.log(` on the shop, not in MATRIX   ${p.id}  visible=${p.visible}  ${p.title}`);
    }
    for (const r of missing) {
      console.log(` in MATRIX, not on the shop   ${r.id}  ${r.title}`);
    }
  }

  /* --- how the numbers are made ----------------------------------- */

  console.log("");
  console.log(RULE);
  console.log(` HOW THESE ARE MADE`);
  console.log(RULE);
  console.log("");
  console.log(` cost      per variant, off the live product on shop ${SHOP_ID}. It moves with size, and`);
  console.log(`           sometimes with colour, which is why it is a range and a set of tiers. For a`);
  console.log(`           garment this shop has never sold: \`cli.ts cost <blueprintId> <providerId>\`.`);
  console.log(` retail    packages/store/src/matrix.ts, US postage included. sync pushes it; a shop`);
  console.log(`           holding a different figure is a shop that has not been synced, and says so.`);
  console.log(` post      Printify's own rate for that garment and provider, per method. It is THEIRS:`);
  console.log(`           you cannot set it. It comes out of the price, not off the customer.`);
  console.log(`           It does NOT merge across product types — a tee and a cap from one maker`);
  console.log(`           pay two first-item rates. Only quantity of ONE thing merges.`);
  console.log(` you keep  retail less cost, less US standard postage, less Stripe. That is the number.`);
  console.log(` abroad    the international rate MINUS the US rate already inside the price, so a`);
  console.log(`           customer abroad pays the difference and nothing twice.`);
  console.log(` handling  Printify's own handlingTime range for that shipping plan, in days. Their`);
  console.log(`           figure, quoted as given — the US rows are days, the international ones are`);
  console.log(`           a much wider window and read as production plus transit.`);
  console.log(` card fee  ${pct(STRIPE_PERCENT)} + ${usd(STRIPE_FLAT_CENTS)} on the whole charge. Checkout is OURS`);
  console.log(`           (workers/checkout), so this is a real cost rather than a floor — and`);
  console.log(`           Stripe charges it on the sales tax as well as on the goods.`);
  console.log(` dpi       the art's pixel width over its printed width on the LARGEST size offered.`);
  console.log(`           The floor is 300 and sync refuses to upload under it.`);
  console.log(` GARMENT   the shop's product is a different blueprint or maker from the matrix's.`);
  console.log(` THIN      under ${pct(THIN_NET_MARGIN)} kept on the dearest variant, after postage and Stripe.`);
  console.log(` POST      US standard postage over ${pct(HEAVY_SHIPPING)} of the price. Covered, but carrier-driven.`);
  console.log("");
  console.log(` No sales tax in these figures. YOU are the seller of record — it is yours to`);
  console.log(` collect and to remit, and MANUAL.md 5 has the tax split. No returns`);
  console.log(` here either. No subscription: Printify Premium needs 16-17 orders a MONTH to`);
  console.log(` pay for itself and this shop will not clear that.`);
  console.log("");
}
