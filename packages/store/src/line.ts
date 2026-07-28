import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { LOGO_DIR, PRINT_DIR, ROOT, buildLine } from "./matrix.ts";
import type { LineItem } from "./matrix.ts";
import type { CatalogPlaceholder } from "./types.ts";

/**
 * The gate the product line has to pass, and the geometry it is placed by.
 *
 * **The line itself is no longer here.** It moved to ./matrix.ts on 2026-07-28,
 * because eight hardcoded products are not something the captain can compose:
 * he asked for a list of logos, a list of items, and the ability to mix and
 * match. That file holds those three lists and builds the line out of them.
 * This one holds the two things that must survive any composition — the claims
 * gate and the placement arithmetic.
 *
 * **A garment that quotes the archive has to be as accountable as the archive.**
 * That rule has already been broken twice. "120 goaltender lines" traced to
 * nothing and was silkscreened anyway. "16 sessions" was true for a day. So
 * every factual claim carried by a design is re-derived from
 * apps/web/data/site.json before a single byte is uploaded, and a claim that no
 * longer holds stops the sync.
 *
 * It caught one immediately. The catalog shipped a shirt reading **SAVES 0 /
 * EVERY GOALTENDER SEASON**. It is now false — Brent Seymour's 2012 and 2013
 * lines record 775, 180 and 118 saves, recovered after that shirt was written.
 * The zeroes belong to the HarborCenter era, whose platform does not record
 * saves at all. That design is not in this line and must not go on a garment
 * until the sentence on it is true again.
 *
 * **The line no longer quotes the archive at all.** The captain's instruction on
 * 2026-07-26 was team logos only, and the three shirts that carried archive text
 * — Everything Comes Back, Four Spellings, 45:00 — were deleted from the shop.
 * What is left prints a mark and a place: no counts, no years, no names. `CLAIMS`
 * is therefore empty, and the note above it records what each retired claim
 * guarded and why it went. The gate stays wired. The moment a garment states
 * something again, it is here that the statement gets checked, and a
 * `claims: []` that should not be empty is the failure mode to watch for.
 */

const SITE_JSON = join(ROOT, "apps/web/data/site.json");

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

export type Claim = {
  id: string;
  /** What the garment says, in the words a reader would use. */
  says: string;
  /** Re-derives it from site.json. Returns null when it holds, or why it does not. */
  check: (site: SiteData) => string | null;
};

type GoalieLine = { minutes?: string | null };
type Game = { goalies?: GoalieLine[] | null };
type Player = { name: string; aliases?: string[]; jerseys?: string[] };
type Session = { id: string; sort: number };
export type SiteData = { sessions: Session[]; players: Player[]; games: Game[] };

/**
 * The founding year, counted rather than typed.
 *
 * Deliberately the same calculation as `FOUNDED` in apps/web/lib/data.ts — the
 * floor of the earliest session's sort key — because this package cannot import
 * from the app and two different ways of counting one number is how a parcel
 * ends up disagreeing with the page that sold it. A session sorts on the year it
 * began, so the floor of the earliest is the year the club started.
 */
const firstYear = (site: SiteData): number =>
  Math.floor(site.sessions.reduce((earliest, s) => Math.min(earliest, s.sort), Infinity));

/**
 * Empty, and that is the correct state for this line.
 *
 * Three claims stood here. `forty-five` and `four-spellings` guarded sentences
 * printed on two shirts; both shirts were deleted on the captain's instruction
 * and both sentences still hold. `est-2012` guarded **EST. 2012**, and on
 * 2026-07-26 it stopped this sync cold: the captain's own stats workbook had
 * just been ingested, carrying a **Winter 2011** season with full statistics and
 * a paid franchise fee — the fee to *establish* a franchise. The club is a year
 * older than its own masthead claimed, the captain has ruled 2011, and EST. 2012
 * was false on a garment about to be printed.
 *
 * The fix was not to write 2011 anywhere. Every garment's copy now resolves
 * `{{firstYear}}` from site.json at upload time, and a derived number cannot be
 * stale — if a 2010 season ever turns up, the next sync prints it. A claim
 * guarding a token is a check on arithmetic, so there is nothing left here to
 * check: no mark in docs/logos carries a date, and no product states a count,
 * a year or a name in type.
 *
 * What survives is the machinery, which has now caught three real errors and
 * cost nothing. A garment that states a fact in type again gets a `Claim` here,
 * or it does not get printed.
 */
export const CLAIMS: Claim[] = [];

export async function loadSite(): Promise<SiteData> {
  return JSON.parse(await readFile(SITE_JSON, "utf8")) as SiteData;
}

/** Throws with every failure listed, rather than the first one. */
export function assertClaims(site: SiteData, ids: string[]): void {
  const failures: string[] = [];
  for (const id of ids) {
    const claim = CLAIMS.find((c) => c.id === id);
    if (!claim) { failures.push(`${id}: no such claim`); continue; }
    const why = claim.check(site);
    if (why) failures.push(`${id} — the art says "${claim.says}" but ${why}`);
  }
  if (failures.length) {
    throw new Error(
      `Refusing to upload art whose claims no longer hold:\n  ${failures.join("\n  ")}\n` +
        `Fix the design, or drop the product. Do not print it and hope.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

export type ArtBox = { width: number; height: number };

/**
 * The `scale` that renders `art` at `widthIn` inches inside `area`, and the
 * effective print resolution that results.
 *
 * `scale` is a fraction of the print area's WIDTH, so a portrait image inside a
 * landscape print area — every hoodie front — is limited by height instead, and
 * the caller gets told rather than getting a print that runs off the garment.
 *
 * `areaShape` is the SHAPE of the tightest canvas the same scale will be sent
 * to, as height over width, and it defaults to this area's own. It exists
 * because one `scale` covers every variant and the variants are not all the same
 * shape: a black mug is offered in 11 oz at 2475 × 1155 and 15 oz at 2448 × 1266,
 * and a scale computed against the 15 oz — which is the SMALLER canvas, so the
 * one this function is handed — overflows the 11 oz by a tenth of an inch. It
 * cost nothing to notice with a landscape wordmark on it and would have cropped
 * a portrait crest.
 */
export function place(
  area: CatalogPlaceholder,
  art: ArtBox,
  widthIn: number,
  areaShape: number = area.height / area.width,
): {
  scale: number;
  widthIn: number;
  heightIn: number;
  dpi: number;
  heightFill: number;
} {
  // Printify's canvases are quoted at 300 dpi.
  const areaWIn = area.width / 300;
  const areaHIn = area.height / 300;
  const aspect = art.height / art.width;

  let w = widthIn;
  let h = w * aspect;
  // Never let a print exceed 94% of the area in either direction: providers
  // trim at the edge and a design that touches it comes back cropped.
  const maxH = areaWIn * areaShape * 0.94;
  const maxW = areaWIn * 0.94;
  if (h > maxH) { h = maxH; w = h / aspect; }
  if (w > maxW) { w = maxW; h = w * aspect; }

  return {
    scale: Number((w / areaWIn).toFixed(4)),
    widthIn: Number(w.toFixed(2)),
    heightIn: Number(h.toFixed(2)),
    dpi: Math.round(art.width / w),
    heightFill: Number((h / areaHIn).toFixed(3)),
  };
}

/* ------------------------------------------------------------------ */
/* Art                                                                 */
/* ------------------------------------------------------------------ */

export type Art = { name: string; base64: string; box: ArtBox; sourcePath: string };

/**
 * Read a print file, trim its transparent margin, and return it ready to upload.
 *
 * The trim is not cosmetic. Printify places an image by its file box, so a file
 * with a transparent border around its artwork prints at the size of the border
 * rather than the size asked for. Both sources this can be handed have one: the
 * vector masters render onto a square 6000px canvas that the 4526 x 5094 mark
 * sits inside, and `scripts/build-print-files.mjs` letterboxes a harvested
 * design into the garment's print area.
 *
 * It only applies to art with an alpha channel, and that condition is load
 * bearing: trimming a FLAT file eats the artwork rather than the margin around
 * it, because there is no margin. Nothing in the line is flat today —
 * `retriever-plate.png` was, and it went with the pixel retriever — but the
 * guard costs nothing and the next mark drawn for white vinyl will need it.
 */
export async function loadArt(file: string): Promise<Art> {
  const sourcePath = file.startsWith("logos/")
    ? join(LOGO_DIR, file.slice("logos/".length))
    : join(PRINT_DIR, file);
  const source = sharp(await readFile(sourcePath));
  const hasAlpha = (await source.metadata()).hasAlpha ?? false;
  const prepared = await (hasAlpha ? source.trim({ threshold: 0 }) : source)
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return {
    name: file.replace(/[/\\]/g, "-"),
    base64: prepared.data.toString("base64"),
    box: { width: prepared.info.width, height: prepared.info.height },
    sourcePath,
  };
}

/* ------------------------------------------------------------------ */
/* The line                                                            */
/* ------------------------------------------------------------------ */

export type { LineItem, Placement } from "./matrix.ts";

/**
 * The product line, composed from ./matrix.ts.
 *
 * Eight products, built from two marks and six items. There is no product list
 * in this repository any more: MATRIX holds one line per product and everything
 * else — id, title, colourways, price, placement, description — is derived, so
 * the same tee cannot be priced two ways or carry two different spellings of
 * the same paragraph.
 *
 * **Resolution is not the binding constraint any more.** Every mark this line
 * used to print was a 1254 px flat carrying about 900 px of artwork, which is
 * 158 dpi at six inches; that is why the crest was once sold at six inches and
 * the wordmark at 5.17. The vector masters have no ceiling. Nothing is sized to
 * its file now. Everything is sized to the garment, and the garment wins first.
 *
 * One trap survives the re-export, and it is why dpi is a range rather than a
 * number: Printify's placement is a PROPORTION of the print area, and the print
 * area is bigger on a 3XL than on an S. One scale is sent for every size. The
 * tee prints 7.38 inches wide on a small and 10.0 on everything from L up, and
 * the second number is the one that decides whether the print looks soft, so
 * sync.ts reports both and products.json stores both.
 *
 * The floor is 300 dpi at the printed size, measured on the LARGEST size
 * offered, and sync.ts refuses to upload under it. The worst in this line is 453.
 *
 * **A function rather than a constant, and memoised.** `buildLine()` throws on a
 * matrix that does not hold together — a mark on a ground it cannot use, a
 * colourway with the wrong number of variant ids, a placement the garment does
 * not offer — and those are the errors most worth reading. As a module-level
 * constant the throw happened during import, before any handler existed, and
 * Node printed a loader stack with the sentence buried in it. Called from inside
 * a command, the CLI's own handler prints the sentence and nothing else.
 */
let built: LineItem[] | null = null;
export function productLine(): LineItem[] {
  built ??= buildLine();
  return built;
}

/** Resolve {{tokens}} in a description from site.json. Same idiom as lib/store.ts. */
export function fillTokens(text: string, site: SiteData): string {
  const values: Record<string, () => string> = {
    firstYear: () => String(firstYear(site)),
    sessions: () => String(site.sessions.length),
    people: () => String(site.players.length),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (whole, k: string) => values[k]?.() ?? whole);
}
