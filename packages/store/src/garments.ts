import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getBlueprint, listAllPrintProviders, listBlueprints, listPrintProviders, uploadImage } from "./api.ts";
import { loadArt } from "./line.ts";
import { ITEMS, MARKS, PRINT_DIR } from "./matrix.ts";
import { probeCost, probePause, type SweepRow } from "./sweep.ts";

/**
 * WHICH GARMENT, not which maker.
 *
 * `sweep` answers "of the blueprint we chose, who is the cheapest maker". It
 * has never answered the question above it: **was this the right blueprint at
 * all?** That was argued once in matrix.ts comments and never measured, and a
 * decision recorded in prose is a decision nobody can re-check.
 *
 * This measures it. For every category it finds the real candidate blueprints
 * in Printify's catalogue of 1,914, and probes each one's cost the same way
 * `sweep` does — create a draft, read the costs back, delete it.
 *
 *   node packages/store/src/cli.ts garments        every category
 *   node packages/store/src/cli.ts garments tee    one of them
 *
 * WHAT IT COSTS TO RUN. Each probe is five API calls and creates then deletes
 * one draft product on the live shop. A full run is a few hundred calls and
 * several minutes. Nothing is left behind: the draft is deleted before the next
 * candidate starts, and a 429 mid-probe is the only case that could strand one
 * — `sweep`'s own retry logic is reused for exactly that reason.
 *
 * CROSS-BLUEPRINT COSTS ARE INDICATIVE AND SAY SO. Variant ids are per
 * blueprint, so our own six colourways cannot be named on a garment we have
 * never sold. The probe falls back to a sampled set and flags `indicative`. It
 * is the right number for choosing between garments and the wrong number to
 * quote as our cost — which is what the flag is for.
 */

/** How to recognise the candidates for each category in the catalogue. */
const CANDIDATES: Record<string, { match: RegExp; reject: RegExp; cap: number }> = {
  tee: { match: /\bt-?shirt\b/i, reject: /sweat|hood|long|kid|youth|toddler|baby|women|tank|crop|dress|AOP|polo|pocket/i, cap: 10 },
  longsleeve: { match: /long ?sleeve/i, reject: /sweat|hood|kid|youth|toddler|women|AOP/i, cap: 8 },
  crewneck: { match: /crewneck sweatshirt|crew neck sweatshirt/i, reject: /hood|kid|youth|zip|AOP|drop shoulder/i, cap: 8 },
  hoodie: { match: /hood/i, reject: /zip|kid|youth|toddler|AOP|women|crop|vest/i, cap: 10 },
  youth: { match: /(kids|youth).*(t-?shirt)|t-?shirt.*(kids|youth)/i, reject: /long|sweat|hood|AOP|dress/i, cap: 8 },
  cap: { match: /\b(cap|hat)\b/i, reject: /beanie|bucket|AOP|visor/i, cap: 8 },
  beanie: { match: /beanie/i, reject: /AOP/i, cap: 6 },
  mug: { match: /\bmug\b/i, reject: /AOP|travel|camper|enamel|color.?chang/i, cap: 8 },
  sticker: { match: /sticker/i, reject: /sheet|AOP/i, cap: 6 },
};

/** Printify Choice. Preferred wherever it exists — it reroutes when a house is busy. */
const CHOICE = 99;

export type GarmentRow = SweepRow & {
  brand: string;
  model: string;
  blueprintTitle: string;
  /** True for the blueprint this shop actually sells. */
  current: boolean;
  providerCount: number;
  hasChoice: boolean;
};

export async function garments(only?: string): Promise<number> {
  const wanted = only ? [only] : Object.keys(CANDIDATES);
  const bad = wanted.filter((w) => !CANDIDATES[w]);
  if (bad.length) {
    console.error(`No category "${bad.join(", ")}". One of: ${Object.keys(CANDIDATES).join(", ")}`);
    return 2;
  }

  const mark = MARKS[0];
  if (!mark) throw new Error("MARKS is empty; nothing to upload as probe artwork.");
  const art = await loadArt(mark.press);
  const uploaded = await uploadImage({ file_name: `garment-probe-${art.name}`, contents: art.base64 });

  const catalogue = await listBlueprints();
  const allProviders = await listAllPrintProviders();
  const rows: GarmentRow[] = [];

  for (const category of wanted) {
    const rule = CANDIDATES[category]!;
    const item = ITEMS.find((i) => i.id === category);
    const current = item?.blueprintId;

    // The candidate set: everything in the catalogue that is this kind of
    // garment, with the one we sell forced in even if the filter would miss it.
    const found = catalogue.filter((b) => {
      const text = `${b.title} ${b.brand} ${b.model}`;
      return rule.match.test(text) && !rule.reject.test(text);
    });
    const candidates = found.slice(0, rule.cap);
    if (current && !candidates.some((c) => c.id === current)) {
      const ours = catalogue.find((b) => b.id === current);
      if (ours) candidates.unshift(ours);
    }

    console.log(`\n${"=".repeat(96)}`);
    console.log(` ${category.toUpperCase()} — ${found.length} candidate blueprints in the catalogue, probing ${candidates.length}`);
    console.log("=".repeat(96));

    for (const bp of candidates) {
      let providers;
      try {
        providers = await probeRetry(() => listPrintProviders(bp.id));
      } catch {
        console.log(`  ${String(bp.id).padStart(5)}  ${bp.title.slice(0, 44).padEnd(46)}  no providers`);
        continue;
      }
      const hasChoice = providers.some((p) => p.id === CHOICE);
      // Probe Printify Choice where it exists, otherwise the first US maker —
      // one probe per blueprint, because the question here is which GARMENT.
      const pick = providers.find((p) => p.id === CHOICE)
        ?? providers.find((p) => (allProviders.find((a) => a.id === p.id)?.location?.country) === "US")
        ?? providers[0];
      if (!pick) continue;

      const provider = allProviders.find((a) => a.id === pick.id) ?? pick;
      const detail = await probeRetry(() => getBlueprint(bp.id));
      process.stdout.write(`  ${String(bp.id).padStart(5)}  ${`${bp.brand} ${bp.model}`.trim().slice(0, 30).padEnd(32)}${(provider.title ?? "").slice(0, 18).padEnd(20)}`);

      const row = await probeCost(category, bp.id, pick.id, provider, bp.id === current, uploaded.id);
      rows.push({
        ...row,
        brand: detail.brand ?? bp.brand ?? "",
        model: detail.model ?? bp.model ?? "",
        blueprintTitle: bp.title,
        current: bp.id === current,
        providerCount: providers.length,
        hasChoice,
      });

      /*
       * A NOTE IS NOT A REJECTION, and printing it as one was alarming and
       * wrong. Every cap candidate came back "sizes did not match — raw range",
       * which means the rival blueprint names its sizes differently from ours
       * so the cost spans all its variants rather than our size run. That is an
       * indicative price, which is exactly what a cross-blueprint comparison
       * can offer. Only a zero cost means the maker would not price at all.
       */
      console.log(
        !row.minCost
          ? `  —  no price${row.note ? ` (${String(row.note).replace(/\s+/g, " ").slice(0, 40)})` : ""}`
          : `  $${(row.minCost / 100).toFixed(2)}–$${(row.maxCost / 100).toFixed(2)}`.padEnd(20) +
              `post ${row.postCents === null ? "n/a" : `$${(row.postCents / 100).toFixed(2)}`}`.padEnd(14) +
              (bp.id === current ? "  <- WE SELL THIS" : "") +
              (hasChoice ? "" : "  (no Choice)") +
              (row.note ? "  ~indicative" : ""),
      );
      await probePause(1200);
    }
  }

  /*
   * MERGE, DO NOT OVERWRITE.
   *
   * A full run is seventy-odd probes and long enough to be interrupted, so it
   * has to be runnable a category at a time without throwing away the last
   * one. Rows for the categories just measured replace their predecessors;
   * everything else on disk is kept.
   */
  const out = join(PRINT_DIR, "garment-grid.json");
  await mkdir(PRINT_DIR, { recursive: true });
  let kept: GarmentRow[] = [];
  try {
    const prior = JSON.parse(await readFile(out, "utf8")) as { rows?: GarmentRow[] };
    kept = (prior.rows ?? []).filter((r) => !wanted.includes(r.itemId));
  } catch {
    // First run, or a file we cannot read. Either way, start from what we have.
  }
  await writeFile(out, `${JSON.stringify({ rows: [...kept, ...rows] }, null, 2)}\n`);
  console.log(`\n${rows.length} blueprints measured. Written to ${out}`);
  console.log("Rebuild the page with: npm run store:summary");
  return 0;
}

/** Same patience as the sweep: Printify 429s hard on a tight loop. */
async function probeRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let wait = 4000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= tries || !/429|Too Many/i.test(String(error))) throw error;
      await probePause(wait);
      wait *= 2;
    }
  }
}
