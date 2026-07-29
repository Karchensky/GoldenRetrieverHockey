import {
  SHOP_ID,
  getBlueprint,
  listAllPrintProviders,
  listProducts,
  listShippingMethods,
  listShippingRates,
} from "./api.ts";
import { loadArt, place, productLine } from "./line.ts";
import { ITEMS, MARKS } from "./matrix.ts";
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

/** Stripe's US card rate. 2.9% + 30c of the FULL charge, shipping included. */
export const STRIPE_PERCENT = 0.029;
export const STRIPE_FLAT_CENTS = 30;

/**
 * **US shipping is free and priced in.** Decided 2026-07-28. So the margin that
 * decides whether a product is worth selling is what is left after the goods,
 * Printify's US standard postage AND Stripe — not the gross margin, which
 * flatters every item by the price of its own parcel. A $6 sticker showed 74%
 * gross and lost $1.06 a sale.
 *
 * Net below this on the dearest variant is called out.
 */
const THIN_NET_MARGIN = 0.3;
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

/**
 * What one US sale actually leaves, under the policy the store ships on: the
 * customer pays the shelf price, and the postage comes out of it.
 */
const netOf = (retail: number, cost: number, ship: number): number =>
  retail - cost - ship - stripeFee(retail);

/**
 * The same arithmetic over the SMALLEST BASKET an item may be sold in.
 *
 * It exists for the sticker and it is not a special case: postage merges within
 * one product type, so three stickers post for $4.77 rather than $13.77 and the
 * per-unit figure is a lie about a product sold in threes. An item with no
 * minimum passes straight through with `units` of 1 and identical numbers.
 */
type Unit = { units: number; charge: number; goods: number; post: number; stripe: number; keep: number };

function unitOf(row: Row, cost: number): Unit {
  const units = Math.max(1, row.sale?.minQuantity ?? 1);
  const rate = row.shipping.find((m) => m.method === "standard")?.byRegion.get("US");
  const post = rate ? rate.first + (units - 1) * rate.additional : 0;
  const charge = row.retail * units;
  const goods = cost * units;
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

/* ------------------------------------------------------------------ */
/* One product                                                         */
/* ------------------------------------------------------------------ */

type CostTier = { cost: number; variants: number; sizes: string[]; colours: string[] };

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
function costTiers(product: PrintifyProduct, sizeOf: Map<number, string>, colourOf: Map<number, string>): CostTier[] {
  const tiers = new Map<number, { variants: number; sizes: Set<string>; colours: Set<string> }>();
  for (const v of product.variants) {
    if (!v.is_enabled) continue;
    const tier = tiers.get(v.cost) ?? { variants: 0, sizes: new Set<string>(), colours: new Set<string>() };
    tier.variants++;
    const size = sizeOf.get(v.id);
    const colour = colourOf.get(v.id);
    if (size) tier.sizes.add(size);
    if (colour) tier.colours.add(colour);
    tiers.set(v.cost, tier);
  }
  return [...tiers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cost, t]) => ({ cost, variants: t.variants, sizes: [...t.sizes], colours: [...t.colours] }));
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

    // **Retail is the matrix's, always.** matrix.ts is where the price is
    // decided and sync is what pushes it; a figure sitting on the shop is the
    // last one pushed, not the current one. This used to report the SHOP's
    // price, which meant a repricing looked like it had not happened until it
    // had been uploaded. The disagreement is still reported — it just no longer
    // decides the arithmetic.
    const retail = item.priceCents;
    let tiers: CostTier[] = [];
    if (product) {
      const prices = [...new Set(product.variants.filter((v) => v.is_enabled).map((v) => v.price))];
      if (prices.length === 1 && prices[0] !== undefined && prices[0] !== retail) {
        notes.push(`the shop still prices this at ${usd(prices[0])} — sync has not pushed ${usd(retail)}`);
      } else if (prices.length > 1) {
        notes.push(`${prices.length} different prices on the shop: ${prices.map(usd).join(", ")}`);
      }
      if (product.visible) notes.push("VISIBLE — this product is not a draft");
      if (garmentDrift) {
        notes.push(`the shop holds a DIFFERENT GARMENT — ${garmentDrift}`);
        notes.push("no cost is shown: the one on the shop is the old garment's. `cli.ts cost` quotes the new one");
      } else {
        tiers = costTiers(product, sizeOf, colourOf);
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

const RULE = "=".repeat(96);
const THIN = "-".repeat(96);

/** Printify's own US standard first-item rate for this product. */
const usPost = (row: Row): number =>
  row.shipping.find((m) => m.method === "standard")?.byRegion.get("US")?.first ?? 0;

function flagsFor(row: Row): string[] {
  const flags: string[] = [];
  if (row.garmentDrift) flags.push("GARMENT");
  if (row.maxCost) {
    const worst = unitOf(row, row.maxCost);
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
  console.log(` US POSTAGE IS FREE AND PRICED IN. Every figure below is after it.`);
  console.log("");
  console.log(
    ` ${"product".padEnd(20)}${"retail".padStart(8)}  ${"your cost".padEnd(17)}` +
      `${"US post".padStart(8)}  ${"you keep".padEnd(17)}${"net".padStart(14)}  flags`,
  );
  console.log(` ${THIN.slice(0, 94)}`);

  for (const row of rows) {
    const best = unitOf(row, row.minCost);
    const worst = unitOf(row, row.maxCost);
    const label = worst.units > 1 ? `${row.id} x${worst.units}` : row.id;
    const cost = row.maxCost
      ? row.minCost === row.maxCost ? usd(worst.goods) : `${usd(best.goods)} - ${usd(worst.goods)}`
      : "—";
    const keep = !row.maxCost
      ? "—"
      : row.minCost === row.maxCost ? usd(worst.keep) : `${usd(worst.keep)} - ${usd(best.keep)}`;
    const net = !row.maxCost
      ? "—"
      : row.minCost === row.maxCost
        ? pct(worst.keep / worst.charge)
        : `${pct(worst.keep / worst.charge)} - ${pct(best.keep / best.charge)}`;
    console.log(
      (` ${label.padEnd(20)}${usd(worst.charge).padStart(8)}  ${cost.padEnd(17)}` +
        `${(worst.post ? usd(worst.post) : "—").padStart(8)}  ${keep.padEnd(17)}${net.padStart(14)}  ` +
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
          const u = unitOf(row, tier.cost);
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
        const u = unitOf(row, row.maxCost);
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
    const u = unitOf(row, row.maxCost);
    retail += u.charge;
    cost += u.goods;
    ship += u.post;
    stripe += u.stripe;
  }
  const keep = retail - cost - ship - stripe;
  const width = 22;
  console.log(` ${"customer pays".padEnd(width)}${usd(retail).padStart(10)}   ${priced} of ${rows.length} products`);
  console.log(` ${"Printify takes".padEnd(width)}${`-${usd(cost + ship)}`.padStart(10)}   ${usd(cost)} goods + ${usd(ship)} post`);
  console.log(` ${"Stripe takes".padEnd(width)}${`-${usd(stripe)}`.padStart(10)}   ${pct(STRIPE_PERCENT)} + ${usd(STRIPE_FLAT_CENTS)} per order`);
  console.log(` ${"-".repeat(width + 10)}`);
  console.log(` ${"you keep".padEnd(width)}${usd(keep).padStart(10)}   ${pct(keep / retail)} of retail`);
  if (unpriced) {
    console.log("");
    console.log(
      ` ${plural(unpriced, "product")} left out: no cost is readable for them. ` +
        `See the GARMENT lines below.`,
    );
  }

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
        const u = unitOf(row, row.maxCost);
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
  console.log(` Stripe    ${pct(STRIPE_PERCENT)} + ${usd(STRIPE_FLAT_CENTS)} on the whole charge. US card rate.`);
  console.log(` dpi       the art's pixel width over its printed width on the LARGEST size offered.`);
  console.log(`           The floor is 300 and sync refuses to upload under it.`);
  console.log(` GARMENT   the shop's product is a different blueprint or maker from the matrix's.`);
  console.log(` THIN      under ${pct(THIN_NET_MARGIN)} kept on the dearest variant, after postage and Stripe.`);
  console.log(` POST      US standard postage over ${pct(HEAVY_SHIPPING)} of the price. Covered, but carrier-driven.`);
  console.log("");
  console.log(` No sales tax in these figures — Stripe Tax adds it at checkout and it is the`);
  console.log(` customer's, not yours. No returns. No Printify subscription: the free plan is a`);
  console.log(` per-item price rather than a monthly one.`);
  console.log("");
}
