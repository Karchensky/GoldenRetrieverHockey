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

/**
 * THE HALF THE GRID WAS MISSING.
 *
 * `garments` measured cost. The captain's rule is **quality first, then the
 * cheapest of that quality** — and a table of prices cannot express the first
 * clause at all. Asked why Gildan 18000 and not Gildan 12000, the grid could
 * only say which was cheaper, which is the second question.
 *
 * Printify's blueprint description carries the spec: fabric weight, blend,
 * construction. This reads it for every blueprint already in the grid and
 * merges it in. **It creates nothing and probes nothing** — pure catalogue
 * reads — so it is cheap to re-run and safe to run any time.
 *
 *   node packages/store/src/cli.ts garment-specs
 */
export async function garmentSpecs(): Promise<number> {
  const out = join(PRINT_DIR, "garment-grid.json");
  let grid: { rows: GarmentRow[] };
  try {
    grid = JSON.parse(await readFile(out, "utf8")) as { rows: GarmentRow[] };
  } catch {
    console.error("No garment-grid.json. Run `cli.ts garments` first.");
    return 2;
  }

  const seen = new Map<number, { spec: string; weightOz: number | null; blend: string | null }>();
  for (const row of grid.rows) {
    if (seen.has(row.blueprintId)) continue;
    const b = await probeRetry(() => getBlueprint(row.blueprintId));
    const { text, weightOz, blend } = readGarmentSpec(b.description);

    seen.set(row.blueprintId, { spec: text.slice(0, 320), weightOz, blend });
    console.log(
      `  ${String(row.blueprintId).padStart(5)}  ${`${b.brand ?? ""} ${b.model ?? ""}`.trim().slice(0, 30).padEnd(32)}` +
        `${weightOz ? `${weightOz} oz` : "weight n/a"}`.padEnd(14) + (blend ?? "blend n/a"),
    );
    await probePause(350);
  }

  const enriched = grid.rows.map((r) => ({ ...r, ...seen.get(r.blueprintId) }));
  await writeFile(out, `${JSON.stringify({ rows: enriched }, null, 2)}\n`);
  console.log(`\n${seen.size} blueprints described. Rebuild with: npm run store:summary`);
  return 0;
}

/**
 * Read fabric weight and blend out of a Printify blueprint description.
 *
 * Exported and pure so it can be tested against REAL captured descriptions.
 * It was inline and untested, and it spent a fortnight reporting Lane Seven
 * LS14004 as 100% cotton — a claim that reached seven live product listings.
 * See the note inside for what it read and why. The fixtures in
 * test/garment-specs.test.ts are verbatim Printify responses, never invented:
 * an invented fixture is how a parser passes its tests and lies in production.
 */
export function readGarmentSpec(description: unknown): { text: string; weightOz: number | null; blend: string | null } {
  const text = String(description ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

  // Weight. Printify quotes oz/yd² or g/m², inconsistently and sometimes both.
  let weightOz: number | null = null;
  const oz = /(\d+(?:\.\d+)?)\s*(?:oz|ounce)/i.exec(text);
  const gsm = /(\d+(?:\.\d+)?)\s*g\s*\/\s*m/i.exec(text);
  if (oz) weightOz = Number(oz[1]);
  else if (gsm) weightOz = Math.round(Number(gsm[1]) * 0.0295 * 10) / 10;

  /*
   * BLEND, AND WHY THIS IS MORE CAREFUL THAN IT LOOKS.
   *
   * The first version pulled the first "N% cotton ... M% polyester" pair out
   * of the prose and printed it as the garment's blend. On Gildan 64000 that
   * produced "35/65 cotton-poly" from a sentence that actually reads *"Solid
   * colors are 100% cotton, while heathers and sport grey use polyester
   * blends"* — so it reported a mostly-polyester shirt that is, in the
   * colours we sell, entirely cotton. It did the same to Bella+Canvas 3001
   * ("99/1"). Two of the tee comparisons were wrong in the direction that
   * flatters whichever garment happened to be described second.
   *
   * Almost every blank varies: solids one blend, heathers another. So where
   * the copy says so, this refuses to name a single number and says it
   * varies. A hedge that is true beats a figure that is not.
   *
   * **IT WENT WRONG AGAIN ON 2026-08-01 AND THE COST WAS A FALSE CLAIM ON A
   * LIVE PRODUCT.** Lane Seven LS14004 (bp446) is described by Printify as:
   *
   *     .:80% cotton, 20% recycled polyester (varies per color)
   *     ...
   *     .:100% cotton face
   *
   * `allCotton` matched the *face* and reported **100% cotton**. That figure
   * chose the crewneck over the Gildan, was written into matrix.ts as "the
   * only all-cotton crewneck measured", and printed on seven live listings.
   * Two separate holes let it through:
   *
   *   - `pair` needs `N% poly` and the text says `20% RECYCLED polyester`, so
   *     the real fibre line never matched.
   *   - `allCotton` matched a phrase that is not a fibre content at all. A
   *     cotton FACE over a poly back is exactly what it is not.
   *
   * The same run was silent on the shirt we do sell: Bella+Canvas 3501 reads
   * "100% **Airlume** combed and ring-spun cotton" and `allCotton` had no word
   * for Airlume, so the one genuinely all-cotton garment in the shop came back
   * `null`. Wrong about ours, wrong about theirs, in opposite directions.
   *
   * So: the fibre bullet is found FIRST and read whole, and the loose
   * whole-text patterns only run when there is no fibre bullet to read.
   */
  let blend: string | null = null;

  /* A FACE, A BACK, A SWEATBAND AND A LINING ARE CONSTRUCTIONS, NOT CONTENTS.
     `100% cotton face` describes the surface a print lands on; a garment with
     one can be any blend underneath, and Lane Seven LS14004 is 80/20. These
     phrases come out before any percentage is read — not the bullet they sit
     in, because ITC SS3000 states its real content and its face in the SAME
     bullet: "80% cotton, 20% polyester fleece with 100% cotton face". */
  const stripConstruction = (s: string): string =>
    s.replace(/\d+\s*%\s*[a-z\- ]*?(?:face|back|sweatband|lining|twill tape)\b/gi, " ");

  const bullets = text.split(".:").slice(1).map((s) => s.trim());
  /* A bullet is a fibre content if, once the constructions are gone, it still
     OPENS with a percentage and still names a fibre. */
  const isFibre = (s: string): boolean =>
    /^\s*(?:material\s*:\s*)?\d+\s*%/i.test(stripConstruction(s).trim()) &&
    /cotton|poly/i.test(stripConstruction(s));
  /* Prefer the bullet that names BOTH fibres — a blend can state its face on
     one line and its content on another, and only one of them is the answer. */
  const fibreBullet = bullets.find((s) => isFibre(s) && /poly/i.test(stripConstruction(s))) ?? bullets.find(isFibre);

  const heathers = /heather|sport grey|sport gray/i.test(text);
  /* A parenthetical inside the fibre bullet is always an exception for one
     colourway — "(Green Camo is 65% polyester, 35% cotton)" — never the
     garment's own content. It is stripped before the numbers are read and
     counted as a reason to hedge. */
  const aside = fibreBullet ? /\([^)]*\d\s*%[^)]*\)/.test(fibreBullet) : false;
  const varies =
    heathers || aside ||
    /solid colou?rs? are|depending on (?:the )?colou?r|varies? (?:per|for different|by) colou?r|fiber content (?:may )?var/i
      .test(text);

  const fibreText = fibreBullet ? stripConstruction(fibreBullet).replace(/\([^)]*\)/g, " ") : undefined;
  /* "80% cotton, 20% recycled polyester" — anything may sit between the number
     and the fibre word, which is what "recycled" broke. But it may NOT contain
     another percent sign: on "80% Cotton 20% Polyester", which has no comma to
     stop at, a gap that could cross one read the poly share as 80. */
  const cottonPct = fibreText ? /(\d+)\s*%\s*[^,;.%]*?cotton/i.exec(fibreText) : null;
  const polyPct = fibreText ? /(\d+)\s*%\s*[^,;.%]*?poly/i.exec(fibreText) : null;

  if (fibreText && cottonPct && polyPct) {
    blend = `${cottonPct[1]}/${polyPct[1]} cotton-poly`;
    if (varies) blend += ", varies by colour";
  } else if (fibreText && cottonPct && Number(cottonPct[1]) === 100) {
    blend = heathers ? "100% cotton solids, blends in heathers" : varies ? "100% cotton, varies by colour" : "100% cotton";
  } else {
    // No fibre bullet to read. Fall back to the old whole-text patterns, which
    // are looser and therefore only trusted when there is nothing better.
    const pair = /(\d+)\s*%\s*(?:combed\s*)?(?:and\s*)?(?:ring[- ]?spun\s*)?cotton[^.]{0,20}?(\d+)\s*%\s*poly/i.exec(text);
    const slash = /(\d{2})\s*\/\s*(\d{2})\s*cotton[- ]?poly/i.exec(text);
    // "face", "sweatband", "lining" are constructions, not fibre contents.
    const allCotton =
      /100\s*%\s*(?:combed\s*|airlume\s*|organic\s*|ring[- ]?spun\s*|pre[- ]?shrunk\s*)*cotton(?!\s*(?:face|sweatband|lining|twill tape))/i
        .test(text);

    if (varies) blend = allCotton ? "100% cotton solids, blends in heathers" : "varies by colour";
    else if (pair) blend = `${pair[1]}/${pair[2]} cotton-poly`;
    else if (slash) blend = `${slash[1]}/${slash[2]} cotton-poly`;
    else if (allCotton) blend = "100% cotton";
  }

  return { text, weightOz, blend };
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
