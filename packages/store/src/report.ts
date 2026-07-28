import {
  SHOP_ID,
  getBlueprint,
  listAllPrintProviders,
  listProducts,
  listShippingMethods,
  listShippingRates,
} from "./api.ts";
import { loadArt, place, productLine } from "./line.ts";
import { ITEMS, MARKS, markById } from "./matrix.ts";
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

/** Gross margin below this is called out. A garment under it barely pays for itself. */
const THIN_MARGIN = 0.4;
/** US first-item shipping above this share of retail is called out. */
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
  variants: number;
  tiers: CostTier[];
  minCost: number;
  maxCost: number;
  art: string;
  artPx: string;
  print: { position: string; widthIn: number; maxWidthIn: number; minDpi: number } | null;
  shipping: MethodRates[];
  /** Print positions the catalog offers, when they disagree with the matrix. */
  positionDrift: string | null;
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

    let tiers: CostTier[] = [];
    let retail = item.priceCents;
    if (product) {
      tiers = costTiers(product, sizeOf, colourOf);
      const prices = [...new Set(product.variants.filter((v) => v.is_enabled).map((v) => v.price))];
      const only = prices[0];
      if (prices.length === 1 && only !== undefined) {
        retail = only;
        if (only !== item.priceCents) {
          notes.push(`the shop prices this at ${usd(only)}, the matrix at ${usd(item.priceCents)}`);
        }
      } else if (prices.length > 1) {
        notes.push(`${prices.length} different prices on the shop: ${prices.map(usd).join(", ")}`);
        retail = Math.min(...prices);
      }
      if (product.visible) notes.push("VISIBLE — this product is not a draft");
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
      tiers,
      minCost: costs.length ? Math.min(...costs) : 0,
      maxCost: costs.length ? Math.max(...costs) : 0,
      art: artName,
      artPx,
      print,
      shipping: await shippingFor(item.blueprintId, item.printProviderId, variantIds),
      positionDrift,
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

function flagsFor(row: Row): string[] {
  const flags: string[] = [];
  if (row.maxCost && (row.retail - row.maxCost) / row.retail < THIN_MARGIN) flags.push("THIN");
  const us = row.shipping.find((m) => m.method === "standard")?.byRegion.get("US");
  if (us && us.first / row.retail > HEAVY_SHIPPING) flags.push("POST");
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
  console.log(
    ` ${"product".padEnd(20)}${"retail".padStart(8)}  ${"your cost".padEnd(17)}` +
      `${"margin".padStart(12)}  ${"US post".padStart(8)}  flags`,
  );
  console.log(` ${THIN.slice(0, 88)}`);

  for (const row of rows) {
    const cost = row.maxCost
      ? row.minCost === row.maxCost ? usd(row.minCost) : `${usd(row.minCost)} - ${usd(row.maxCost)}`
      : "unknown";
    const marginBest = row.maxCost ? (row.retail - row.minCost) / row.retail : 0;
    const marginWorst = row.maxCost ? (row.retail - row.maxCost) / row.retail : 0;
    const margin = !row.maxCost
      ? "—"
      : row.minCost === row.maxCost ? pct(marginBest) : `${pct(marginWorst)} - ${pct(marginBest)}`;
    const us = row.shipping.find((m) => m.method === "standard")?.byRegion.get("US");
    console.log(
      (` ${row.id.padEnd(20)}${usd(row.retail).padStart(8)}  ${cost.padEnd(17)}` +
        `${margin.padStart(12)}  ${(us ? usd(us.first) : "—").padStart(8)}  ${flagsFor(row).join(" ")}`).trimEnd(),
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
      console.log(
        `   garment    ${`${row.brand} ${row.model}`.trim()} — ${row.blueprintTitle}`.padEnd(74) +
          `blueprint ${row.blueprintId}`,
      );
      console.log(
        `   provider   ${row.providerTitle}, ships from ${row.providerCountry}`.padEnd(74) +
          `provider ${row.printProviderId}`,
      );
      console.log(
        `   on Printify ${row.productId ?? "not created"}` +
          `${row.visible === null ? "" : row.visible ? "  VISIBLE" : "  draft"}` +
          `   ${row.variants} enabled variants`,
      );
      if (row.print) {
        console.log(
          `   print      ${row.print.position} · ${row.art} ${row.artPx} px · ` +
            `${row.print.widthIn} in smallest → ${row.print.maxWidthIn} in largest · ` +
            `${row.print.minDpi} dpi at the largest`,
        );
      }
      if (row.positionDrift) console.log(`   positions  ${row.positionDrift}`);

      /* cost tiers */
      console.log("");
      console.log(`   retail ${usd(row.retail)}`);
      if (!row.tiers.length) {
        console.log(`     no cost on file — Printify only quotes cost on a product that exists`);
      } else {
        console.log(`     ${"cost".padEnd(9)}${"profit".padEnd(9)}${"margin".padEnd(9)}what it covers`);
        for (const tier of row.tiers) {
          const profit = row.retail - tier.cost;
          const covers = tier.sizes.length
            ? `${plural(tier.variants, "variant")} · ${tier.sizes.join(", ")}`
            : plural(tier.variants, "variant");
          console.log(
            `     ${usd(tier.cost).padEnd(9)}${usd(profit).padEnd(9)}` +
              `${pct(profit / row.retail).padEnd(9)}${covers}`,
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

      /* the one-sale numbers */
      if (row.maxCost) {
        const us = row.shipping.find((m) => m.method === "standard")?.byRegion.get("US");
        const ship = us?.first ?? 0;
        console.log("");
        console.log(`   one US sale, worst-case variant at ${usd(row.maxCost)} cost:`);
        const passCharge = row.retail + ship;
        const passKeep = passCharge - stripeFee(passCharge) - row.maxCost - ship;
        console.log(
          `     post charged on top   customer pays ${usd(passCharge).padStart(8)}   ` +
            `you keep ${usd(passKeep).padStart(8)}   ${pct(passKeep / row.retail)} of retail`,
        );
        const freeKeep = row.retail - stripeFee(row.retail) - row.maxCost - ship;
        const breakEven = Math.ceil((row.maxCost + ship + STRIPE_FLAT_CENTS) / (1 - STRIPE_PERCENT));
        console.log(
          `     free shipping         customer pays ${usd(row.retail).padStart(8)}   ` +
            `you keep ${usd(freeKeep).padStart(8)}   ${pct(freeKeep / row.retail)} of retail`,
        );
        console.log(
          `     break-even retail with free shipping: ${usd(breakEven)}` +
            ` — below that a sale costs you money`,
        );
      }

      for (const note of row.notes) console.log(`   ! ${note}`);
    }
  }

  /* --- totals ----------------------------------------------------- */

  console.log("");
  console.log(RULE);
  console.log(` ONE OF EACH — worst-case variant, US, standard post charged on top`);
  console.log(RULE);
  console.log("");

  let retail = 0, cost = 0, ship = 0, stripe = 0;
  let priced = 0;
  for (const row of rows) {
    if (!row.maxCost) continue;
    priced++;
    const s = row.shipping.find((m) => m.method === "standard")?.byRegion.get("US")?.first ?? 0;
    retail += row.retail;
    cost += row.maxCost;
    ship += s;
    stripe += stripeFee(row.retail + s);
  }
  const keep = retail + ship - cost - ship - stripe;
  const width = 22;
  console.log(` ${"customer pays".padEnd(width)}${usd(retail + ship).padStart(10)}   ${priced} products`);
  console.log(` ${"Printify takes".padEnd(width)}${`-${usd(cost + ship)}`.padStart(10)}   ${usd(cost)} goods + ${usd(ship)} post`);
  console.log(` ${"Stripe takes".padEnd(width)}${`-${usd(stripe)}`.padStart(10)}   ${pct(STRIPE_PERCENT)} + ${usd(STRIPE_FLAT_CENTS)} per order`);
  console.log(` ${"-".repeat(width + 10)}`);
  console.log(` ${"you keep".padEnd(width)}${usd(keep).padStart(10)}   ${pct(keep / retail)} of retail`);

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
      if (flags.includes("THIN")) {
        const margin = (row.retail - row.maxCost) / row.retail;
        const dearest = row.tiers[row.tiers.length - 1]?.sizes ?? [];
        const where = row.tiers.length > 1 && dearest.length ? ` on ${dearest.join("/")}` : "";
        console.log(
          ` THIN  ${row.id.padEnd(20)} ${pct(margin)}${where} — ` +
            `${usd(row.maxCost)} cost against ${usd(row.retail)} retail.`,
        );
        console.log(`       ${" ".repeat(20)} Raise the price, or pick a cheaper provider in the dashboard.`);
      }
      if (flags.includes("POST")) {
        const us = row.shipping.find((m) => m.method === "standard")?.byRegion.get("US");
        console.log(
          ` POST  ${row.id.padEnd(20)} ${usd(us?.first ?? 0)} to post a ${usd(row.retail)} item — ` +
            `${pct((us?.first ?? 0) / row.retail)} of the price.`,
        );
        console.log(`       ${" ".repeat(20)} It only makes sense in a basket with something else.`);
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
  console.log(`           sometimes with colour, which is why it is a range and a set of tiers.`);
  console.log(` retail    what the shop holds. Set in packages/store/src/matrix.ts, pushed by sync.`);
  console.log(` post      Printify's own rate for that garment and provider, per method. It is THEIRS:`);
  console.log(`           you cannot set it, only decide what the customer pays. See docs/STORE.md.`);
  console.log(` handling  Printify's own handlingTime range for that shipping plan, in days. Their`);
  console.log(`           figure, quoted as given — the US rows are days, the international ones are`);
  console.log(`           a much wider window and read as production plus transit.`);
  console.log(` Stripe    ${pct(STRIPE_PERCENT)} + ${usd(STRIPE_FLAT_CENTS)} on the whole charge, shipping included. US card rate.`);
  console.log(` dpi       the art's pixel width over its printed width on the LARGEST size offered.`);
  console.log(`           The floor is 300 and sync refuses to upload under it.`);
  console.log(` THIN      gross margin under ${pct(THIN_MARGIN)} on the dearest variant.`);
  console.log(` POST      US standard shipping over ${pct(HEAVY_SHIPPING)} of retail.`);
  console.log("");
  console.log(` No tax. No returns. No Printify subscription — this account is on the free plan,`);
  console.log(` which is a per-item price rather than a monthly one.`);
  console.log("");
}
