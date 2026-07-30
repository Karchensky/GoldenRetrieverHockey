import { createProduct, deleteProduct, getBlueprint, getProduct, listAllPrintProviders, listPrintProviders, listShippingProfiles, listVariants, uploadImage } from "./api.ts";
import { loadArt } from "./line.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ITEMS, MARKS, MARGIN_TARGET, PRINT_DIR } from "./matrix.ts";
import { priceForVariant } from "./pricing.ts";
import type { CatalogPlaceholder } from "./types.ts";

/**
 * `cli.ts sweep` — EVERY maker for every garment this line sells, on cost.
 *
 * The captain asked whether we had "100% checked each seller option on Printify
 * to guarantee we are offering the best product and the cheapest/best priced
 * solution". The answer was no: about seventeen of sixty-odd provider options
 * had ever been cost-tested, and the two garments with the most unexamined
 * depth — the tee with 20 makers and the crewneck with 18 — were the two we had
 * looked at least.
 *
 * `cost.ts` answers this for ONE pair and prints for a human. This is the same
 * probe run across every pair, collected, and ranked, because the question is
 * comparative and a person reading sixty separate printouts will not hold them
 * all in their head.
 *
 * WHY IT HAS TO CREATE PRODUCTS. Printify publishes no cost in the catalog API —
 * verified again here, and the reason `catalogue` prints a paragraph saying so.
 * A variant's `cost` exists for the first time on a product that EXISTS. There
 * is no read-only path to this answer.
 *
 * WHAT IT LEAVES BEHIND: nothing. One draft per pair, `visible: false`, deleted
 * in a `finally` so a crash between create and read still cleans up, and a final
 * audit line that counts what is on the shop before and after. Run `cli.ts audit`
 * to confirm independently.
 *
 * THE COMPARISON IS ON LANDED COST, NOT STICKER COST. A maker that is 40 cents
 * cheaper per shirt and $9 dearer to post is not cheaper, and it took a mispriced
 * mug and a mispriced sticker to learn that. So each row carries the item cost,
 * the real first-item US postage for that provider, and what the garment would
 * have to retail at to hold MARGIN_TARGET — which is the only number that
 * actually decides anything.
 */

/** High enough that no blueprint on the platform costs more. Never sold. */
const PROBE_PRICE_CENTS = 19_999;

/** Printify's own ceiling: 400 code 8251 above this. */
const MAX_VARIANTS = 100;

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

type ProbeVariant = { id: number; title: string; options: Record<string, string>; placeholders?: CatalogPlaceholder[] };

export type SweepRow = {
  itemId: string;
  blueprintId: number;
  providerId: number;
  provider: string;
  country: string;
  inUse: boolean;
  variants: number;
  colours: number;
  sizes: string[];
  /** Cheapest and dearest cost ACROSS THE SIZES THIS LINE SELLS. See `sellable`. */
  minCost: number;
  maxCost: number;
  /** Cost per size, for the sizes we sell. The only like-for-like comparison. */
  bySize: Record<string, number>;
  /** Sizes in `ITEMS[].sizes` this maker does not carry. A real disqualifier. */
  missingSizes: string[];
  /** Cheapest and dearest across EVERY variant, sellable or not. Context only. */
  rawMin: number;
  rawMax: number;
  /** First-item US postage, cheapest method this provider offers. */
  postCents: number | null;
  /** Retail needed on the DEAREST variant to hold the target margin. */
  retailAtTarget: number | null;
  printAreaIn: string;
  note?: string;
};

/**
 * Sleep between calls. Printify rate-limits hard — a plain loop over sixty
 * providers took a 429 on the ninth blueprint when this was written, and a 429
 * mid-probe is the one case that could leave a draft behind.
 */
const pause = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** Retry a read that 429s. Creates and deletes are NOT retried here — see below. */
async function patient<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let wait = 4000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const message = String(error);
      if (attempt >= tries || !/429|Too Many/i.test(message)) throw error;
      console.error(`    ${label}: rate limited, waiting ${wait / 1000}s (${attempt}/${tries - 1})`);
      await pause(wait);
      wait *= 2;
    }
  }
}

/** Round-robin by size, sizes we sell first, capped at Printify's hundred. */
function pickVariants(all: ProbeVariant[], want: string[]): ProbeVariant[] {
  const buckets = new Map<string, ProbeVariant[]>();
  for (const v of all) {
    const size = v.options.size ?? "";
    const bucket = buckets.get(size);
    if (bucket) bucket.push(v); else buckets.set(size, [v]);
  }
  const order = [
    ...want.filter((s) => buckets.has(s)),
    ...[...buckets.keys()].filter((s) => !want.includes(s)),
  ];
  const out: ProbeVariant[] = [];
  for (let round = 0; out.length < MAX_VARIANTS; round += 1) {
    let added = false;
    for (const size of order) {
      const v = buckets.get(size)?.[round];
      if (!v) continue;
      out.push(v);
      added = true;
      if (out.length >= MAX_VARIANTS) break;
    }
    if (!added) break;
  }
  return out;
}

async function probe(
  itemId: string,
  blueprintId: number,
  providerId: number,
  provider: { title?: string; location?: { country?: string } } | undefined,
  inUse: boolean,
  uploadedId: string,
): Promise<SweepRow> {
  const base: SweepRow = {
    itemId, blueprintId, providerId,
    provider: provider?.title ?? `provider ${providerId}`,
    country: provider?.location?.country ?? "?",
    inUse, variants: 0, colours: 0, sizes: [],
    minCost: 0, maxCost: 0, bySize: {}, missingSizes: [], rawMin: 0, rawMax: 0,
    postCents: null, retailAtTarget: null, printAreaIn: "",
  };

  const catalog = await patient("variants", () =>
    listVariants(blueprintId, providerId) as unknown as Promise<{ variants: ProbeVariant[] }>);
  const all = catalog.variants ?? [];

  /**
   * PICK THE 100 THAT ANSWER THE QUESTION, not the first 100 in the response.
   *
   * A Bella+Canvas 3001 through Printify Choice has 995 variants. Taking the
   * head of that list can return a hundred variants of four colours and miss
   * 3XL entirely, which is the size that decides the price. So sizes we sell
   * come first, and within them the list is walked round-robin by size so every
   * one of ours is represented before any colour gets a second entry.
   */
  const want = ITEMS.find((i) => i.id === itemId)?.sizes ?? [];
  const chosen = pickVariants(all, want);
  const first = chosen[0];
  if (!first) return { ...base, note: "no variants" };

  const position = (first.placeholders ?? [])[0]?.position;
  if (!position) return { ...base, note: "no print areas" };

  base.colours = new Set(all.map((v) => v.options.color).filter(Boolean)).size;
  base.sizes = [...new Set(all.map((v) => v.options.size).filter((x): x is string => Boolean(x)))];
  base.printAreaIn = (first.placeholders ?? [])
    .slice(0, 1)
    .map((p) => `${(p.width / 300).toFixed(1)}x${(p.height / 300).toFixed(1)}in`)
    .join("");

  // Postage, from the catalog — it IS published, unlike cost. Cheapest US
  // first-item rate across the methods this provider offers, which is the same
  // figure `catalogue` prints and the one `pricing.ts` is fed.
  try {
    const shipping = await patient("shipping", () => listShippingProfiles(blueprintId, providerId));
    const rates = (shipping.profiles ?? [])
      .filter((p) => p.countries.includes("US"))
      .map((p) => p.first_item.cost);
    if (rates.length) base.postCents = Math.min(...rates);
  } catch {
    // A provider that will not quote US postage cannot serve this shop anyway;
    // the row still reports cost so the omission is visible rather than silent.
  }

  let productId: string | null = null;
  try {
    const created = await patient("create", () => createProduct({
      title: `COST PROBE ${blueprintId}/${providerId} — delete me`,
      description: "Temporary. Created to read cost, deleted in the same command.",
      blueprint_id: blueprintId,
      print_provider_id: providerId,
      visible: false,
      variants: chosen.map((v) => ({ id: v.id, price: PROBE_PRICE_CENTS, is_enabled: true })),
      print_areas: [{
        variant_ids: chosen.map((v) => v.id),
        placeholders: [{ position, images: [{ id: uploadedId, x: 0.5, y: 0.5, scale: 0.5, angle: 0 }] }],
      }],
    }));
    productId = created.id;

    const read = await patient("read", () => getProduct(created.id));
    const source = new Map(chosen.map((v) => [v.id, v]));
    const priced = read.variants.filter((v) => v.is_enabled && v.cost > 0);
    if (!priced.length) return { ...base, note: "no cost reported" };

    base.variants = priced.length;
    base.rawMin = Math.min(...priced.map((v) => v.cost));
    base.rawMax = Math.max(...priced.map((v) => v.cost));

    /**
     * COMPARE ON THE SIZES WE SELL, NOT ON EVERY SIZE THE MAKER CARRIES.
     *
     * The first version of this ranked on max-over-all-variants and was wrong
     * in a way that would have moved a real order: SwiftPOD's IND4000 carries
     * 5XL, our hoodie stops at 3XL, so the probe reported a $54.98 top cost for
     * a size this shop has never listed and made the incumbent look $30 dearer
     * than the alternative. A maker is only dearer on the goods we actually
     * put in the basket.
     */
    const want = ITEMS.find((i) => i.id === itemId)?.sizes ?? [];
    const cheapestFor = new Map<string, number>();
    for (const v of priced) {
      const size = source.get(v.id)?.options.size;
      if (!size) continue;
      const seen = cheapestFor.get(size);
      // Cheapest colourway at that size: colour choice is ours, size is not.
      if (seen === undefined || v.cost < seen) cheapestFor.set(size, v.cost);
    }
    for (const size of want) {
      const cost = cheapestFor.get(size);
      if (cost === undefined) base.missingSizes.push(size);
      else base.bySize[size] = cost;
    }

    const sellable = Object.values(base.bySize);
    if (!sellable.length) {
      // One-size goods (beanie) and anything whose size strings do not match
      // ours fall back to the raw range, flagged so it is not read as matched.
      base.minCost = base.rawMin;
      base.maxCost = base.rawMax;
      base.note = want.length ? "sizes did not match — raw range" : undefined;
    } else {
      base.minCost = Math.min(...sellable);
      base.maxCost = Math.max(...sellable);
    }

    if (base.postCents !== null) {
      base.retailAtTarget = priceForVariant(base.maxCost, base.postCents, MARGIN_TARGET, 1);
    }
    return base;
  } catch (error) {
    return { ...base, note: String(error).replace(/\s+/g, " ").slice(0, 120) };
  } finally {
    if (productId) {
      // Deletion is retried harder than anything else: a draft left on the shop
      // is the only lasting harm this command can do.
      try {
        const doomed = productId;
        await patient("delete", () => deleteProduct(doomed), 8);
      } catch (error) {
        console.error(`  !! COULD NOT DELETE PROBE ${productId} — delete it by hand: ${String(error)}`);
      }
    }
  }
}

export async function sweep(only?: string): Promise<number> {
  const items = only ? ITEMS.filter((i) => i.id === only) : ITEMS;
  if (!items.length) {
    console.error(`No item "${only}". One of: ${ITEMS.map((i) => i.id).join(", ")}`);
    return 2;
  }

  const mark = MARKS[0];
  if (!mark) throw new Error("MARKS is empty; nothing to upload as probe artwork.");
  const art = await loadArt(mark.press);
  const uploaded = await uploadImage({ file_name: `cost-probe-${art.name}`, contents: art.base64 });
  const allProviders = await listAllPrintProviders();

  const rows: SweepRow[] = [];
  for (const item of items) {
    const blueprint = await patient("blueprint", () => getBlueprint(item.blueprintId));
    const providers = await patient("providers", () => listPrintProviders(item.blueprintId));
    console.log(`\n${"=".repeat(96)}`);
    console.log(`${item.title} — ${`${blueprint.brand} ${blueprint.model}`.trim()}`);
    console.log(`blueprint ${item.blueprintId} · ${providers.length} makers · currently ${item.printProviderId}`);
    console.log("=".repeat(96));

    for (const p of providers) {
      const provider = allProviders.find((a) => a.id === p.id) ?? p;
      const inUse = p.id === item.printProviderId;
      process.stdout.write(`  ${String(p.id).padStart(4)}  ${(provider.title ?? "").padEnd(24)}`);
      const row = await probe(item.id, item.blueprintId, p.id, provider, inUse, uploaded.id);
      rows.push(row);
      if (row.note) {
        console.log(`  —  ${row.note}`);
      } else {
        console.log(
          `  ${usd(row.minCost)}–${usd(row.maxCost)}`.padEnd(20) +
            `post ${row.postCents === null ? "n/a" : usd(row.postCents)}`.padEnd(14) +
            `retail ${row.retailAtTarget === null ? "n/a" : usd(row.retailAtTarget)}` +
            (inUse ? "   <- in use" : ""),
        );
      }
      await pause(1200);
    }
  }

  report(rows);

  // The raw measurements, so a decision can be re-argued without re-probing —
  // sixty draft creations is not something to repeat to check one number.
  const out = join(PRINT_DIR, "provider-sweep.json");
  await mkdir(PRINT_DIR, { recursive: true });
  await writeFile(out, `${JSON.stringify({ target: MARGIN_TARGET, rows }, null, 2)}\n`);
  console.log(`\nEvery measurement written to ${out}`);
  return 0;
}

/** The comparative view, which is the whole reason this exists. */
function report(rows: SweepRow[]): void {
  console.log(`\n\n${"=".repeat(96)}`);
  console.log("WHAT THIS CHANGES");
  console.log("=".repeat(96));
  console.log(
    "\nRanked on RETAIL AT TARGET — what the dearest size would have to sell for to\n" +
      `hold ${Math.round(MARGIN_TARGET * 100)}% after that maker's own US postage and Stripe's cut. A maker that is\n` +
      "cheaper per shirt and dearer to post is not cheaper.\n",
  );

  for (const item of ITEMS) {
    const mine = rows.filter((r) => r.itemId === item.id && !r.note && r.retailAtTarget !== null);
    if (!mine.length) continue;
    mine.sort((a, b) => (a.retailAtTarget ?? 0) - (b.retailAtTarget ?? 0));
    const current = mine.find((r) => r.inUse);
    const best = mine[0];

    console.log(`\n${item.title}`);
    console.log(`  ${"maker".padEnd(26)}${"from".padEnd(5)}${"cost".padEnd(18)}${"post".padEnd(9)}${"retail @target".padEnd(15)}colours  sizes`);
    for (const r of mine.slice(0, 8)) {
      console.log(
        `  ${r.provider.slice(0, 25).padEnd(26)}${r.country.padEnd(5)}` +
          `${`${usd(r.minCost)}–${usd(r.maxCost)}`.padEnd(18)}` +
          `${(r.postCents === null ? "n/a" : usd(r.postCents)).padEnd(9)}` +
          `${(r.retailAtTarget === null ? "n/a" : usd(r.retailAtTarget)).padEnd(15)}` +
          `${String(r.colours).padStart(7)}  ${r.sizes.length}` +
          (r.inUse ? "   <- in use" : ""),
      );
    }
    if (current && best && best.providerId !== current.providerId) {
      const saving = (current.retailAtTarget ?? 0) - (best.retailAtTarget ?? 0);
      if (saving > 0) {
        console.log(
          `  >> ${best.provider} would let this retail ${usd(saving)} cheaper at the same margin` +
            ` (${usd(current.retailAtTarget ?? 0)} -> ${usd(best.retailAtTarget ?? 0)}).`,
        );
        // Cheaper is a reason to look, not a reason to move. Say what it costs.
        if (best.colours < current.colours) {
          console.log(`     BUT it carries ${best.colours} colourways against ${current.colours}.`);
        }
        if (best.missingSizes.length) {
          console.log(`     BUT it does not carry ${best.missingSizes.join(", ")} — sizes this line sells.`);
        }
        if (best.providerId === 99) {
          console.log("     AND provider 99 is Printify Choice, a router rather than a named maker:");
          console.log("     it picks whichever house is free, so two orders of the same shirt can");
          console.log("     come from two factories. Fine for a mug, a real decision for a garment.");
        }
      } else {
        console.log("  >> Nothing beats the current maker on landed cost.");
      }
    } else if (current) {
      console.log("  >> The current maker is already the cheapest at target margin.");
    }
    const gaps = mine.filter((r) => r.missingSizes.length && !r.inUse);
    if (gaps.length) {
      console.log(`  -- cannot carry the full size run: ${gaps.map((r) => `${r.provider} (no ${r.missingSizes.join("/")})`).join("; ")}`);
    }
  }

  const failed = rows.filter((r) => r.note);
  if (failed.length) {
    console.log(`\n\nNOT MEASURED (${failed.length})`);
    for (const r of failed) console.log(`  ${r.itemId.padEnd(12)}${String(r.providerId).padStart(4)}  ${r.provider.padEnd(24)}  ${r.note}`);
    console.log("\nA provider that will not quote is not a provider this shop can use, but the");
    console.log("count is a floor on what was compared, not a complete survey. Re-run to retry.");
  }

  console.log(`\n\n${rows.length} provider options probed across ${new Set(rows.map((r) => r.itemId)).size} garments.`);
  console.log("Every probe was created visible:false and deleted. Run `cli.ts audit` to confirm.");
}
