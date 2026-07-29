import {
  getBlueprint,
  listAllPrintProviders,
  listBlueprints,
  listPrintProviders,
  listProducts,
  listShippingProfiles,
  listVariants,
  searchBlueprints,
} from "./api.ts";
import { ITEMS, REJECTS_CREATION } from "./matrix.ts";
import type { CatalogPlaceholder } from "./types.ts";

/**
 * `store:catalogue` — what else could this be printed on, and by whom.
 *
 * The captain asked to pick the brand. This is the tool for that question and
 * it stops exactly where the API stops.
 *
 * **Printify does not publish per-variant cost anywhere in the catalog.**
 * Checked on 2026-07-28: `/v1/catalog/blueprints/{b}/print_providers/{p}/
 * variants.json` returns options and print areas and no price; the whole v2
 * catalog tree 404s apart from shipping. A variant's `cost` field appears for
 * the first time on a product that EXISTS, which is why `store:report` can
 * quote costs for the drafts that exist and nothing can quote them for a provider
 * this shop has never used. Printify's own dashboard shows them on the
 * provider-choice screen, and that is where the brand gets picked — see
 * STORE.md at the repo root (local, gitignored).
 *
 * What this does give, for every provider of a garment, is everything cost is
 * usually traded against: where they ship FROM, how many colours and sizes they
 * carry, how big the print area is, what it costs to post, and whether they will
 * accept a product at all. On an $18 mug posted for $6.99, the second number
 * decides more than the first.
 */

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** Providers known to reject creation for a blueprint, indexed for lookup. */
const rejects = (blueprintId: number, printProviderId: number): string | null =>
  REJECTS_CREATION.find((r) => r.blueprintId === blueprintId && r.printProviderId === printProviderId)?.error ?? null;

/** The cheapest and dearest first-item rate this provider quotes for a country. */
function rateRange(
  profiles: Awaited<ReturnType<typeof listShippingProfiles>>["profiles"],
  country: string,
): { low: number; high: number } | null {
  const hits = profiles.filter((p) => p.countries.includes(country)).map((p) => p.first_item.cost);
  if (!hits.length) return null;
  return { low: Math.min(...hits), high: Math.max(...hits) };
}

/**
 * The print areas, biggest first, capped at three.
 *
 * Printful offers ten on a hoodie — wrists, centre chest, left chest — and the
 * full list is four times the width of every other column in the table. The
 * three biggest are the ones a crest could go on; the rest are a badge.
 */
function areaSummary(placeholders: CatalogPlaceholder[] | undefined): string {
  if (!placeholders?.length) return "no print areas";
  const sorted = [...placeholders].sort((a, b) => b.width * b.height - a.width * a.height);
  const shown = sorted
    .slice(0, 3)
    .map((p) => `${p.position} ${(p.width / 300).toFixed(1)}x${(p.height / 300).toFixed(1)}in`)
    .join(" · ");
  return sorted.length > 3 ? `${shown} +${sorted.length - 3}` : shown;
}

/** A garment type: list the blueprints that match, so he can pick an id. */
async function listMatches(query: string): Promise<number> {
  const all = await listBlueprints();
  const hits = searchBlueprints(all, query);
  if (!hits.length) {
    console.log(`Nothing matches ${JSON.stringify(query)} in ${all.length} blueprints.`);
    return 1;
  }

  const inUse = new Set(ITEMS.map((i) => i.blueprintId));
  console.log(`${hits.length} of ${all.length} blueprints match ${JSON.stringify(query)}.\n`);
  for (const b of hits.slice(0, 40)) {
    const mine = inUse.has(b.id) ? " <- in this line" : "";
    console.log(
      `${String(b.id).padStart(6)}  ${`${b.brand} ${b.model}`.trim().padEnd(34)} ${b.title}${mine}`,
    );
  }
  if (hits.length > 40) console.log(`\n...and ${hits.length - 40} more. Narrow the query.`);
  console.log(`\nThen: cli.ts catalogue <id>   for its providers, print areas and postage.`);
  return 0;
}

/** One blueprint: every provider who makes it, and what that choice costs. */
async function showBlueprint(blueprintId: number): Promise<number> {
  const blueprint = await getBlueprint(blueprintId);
  const providers = await listPrintProviders(blueprintId);
  const located = new Map((await listAllPrintProviders()).map((p) => [p.id, p]));
  const usedHere = new Map(ITEMS.filter((i) => i.blueprintId === blueprintId).map((i) => [i.printProviderId, i.id]));
  const onShop = new Set((await listProducts()).data.filter((p) => p.blueprint_id === blueprintId).map((p) => p.print_provider_id));

  console.log(`${`${blueprint.brand} ${blueprint.model}`.trim()} — ${blueprint.title}`);
  console.log(`blueprint ${blueprint.id} · ${providers.length} print providers\n`);

  const header =
    `${"id".padStart(5)}  ${"provider".padEnd(24)}${"from".padEnd(5)}${"variants".padStart(9)}  ` +
    `${"US post".padEnd(17)}${"EU post".padEnd(17)}print area`;
  console.log(header);
  console.log("-".repeat(Math.min(header.length + 20, 118)));

  for (const provider of providers) {
    const country = located.get(provider.id)?.location?.country ?? "??";
    const refused = rejects(blueprintId, provider.id);

    let variantCount = "—";
    let areas = "";
    try {
      const res = await listVariants(blueprintId, provider.id);
      variantCount = String(res.variants.length);
      const first = (res.variants as { placeholders?: CatalogPlaceholder[] }[])[0];
      areas = areaSummary(first?.placeholders);
    } catch (err) {
      areas = `variants unavailable: ${err instanceof Error ? err.message.split("\n")[0] : "error"}`;
    }

    let us = "—", eu = "—";
    try {
      const shipping = await listShippingProfiles(blueprintId, provider.id);
      const rUs = rateRange(shipping.profiles, "US");
      const rEu = rateRange(shipping.profiles, "DE");
      us = rUs ? (rUs.low === rUs.high ? usd(rUs.low) : `${usd(rUs.low)}-${usd(rUs.high)}`) : "not offered";
      eu = rEu ? (rEu.low === rEu.high ? usd(rEu.low) : `${usd(rEu.low)}-${usd(rEu.high)}`) : "not offered";
    } catch {
      us = eu = "no rates";
    }

    console.log(
      `${String(provider.id).padStart(5)}  ${provider.title.slice(0, 23).padEnd(24)}${country.padEnd(5)}` +
        `${variantCount.padStart(9)}  ${us.padEnd(17)}${eu.padEnd(17)}${areas}`,
    );
    const marks: string[] = [];
    const used = usedHere.get(provider.id);
    if (used) marks.push(`this line's "${used}" uses it`);
    if (onShop.has(provider.id)) marks.push(`shop 28277243 has a product on it — store:report quotes its real cost`);
    if (refused) marks.push(`REJECTS CREATION: ${refused}`);
    for (const m of marks) console.log(`${" ".repeat(7)}${m}`);
  }

  console.log("");
  console.log(`US post / EU post are FIRST-ITEM rates, cheapest to dearest of the methods each`);
  console.log(`provider offers. Printify sets them; you cannot. store:report breaks them out by`);
  console.log(`method for the garments this line already sells.`);
  console.log("");
  console.log(`ITEM COST IS NOT IN THIS TABLE AND CANNOT BE. Printify publishes no cost in the`);
  console.log(`catalog API — a variant's cost first appears on a product that exists. To compare`);
  console.log(`cost by brand, open Printify > Catalog > the garment > choose a print provider:`);
  console.log(`the per-provider price sits on that screen. STORE.md walks it.`);
  return 0;
}

export async function catalogue(arg: string | undefined): Promise<number> {
  if (!arg) {
    console.error(`catalogue <query>        garment types matching a word — "hoodie", "beanie"`);
    console.error(`catalogue <blueprintId>  its print providers, postage and print areas`);
    return 2;
  }
  return /^\d+$/.test(arg) ? showBlueprint(Number(arg)) : listMatches(arg);
}
