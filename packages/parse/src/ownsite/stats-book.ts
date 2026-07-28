import { existsSync } from "node:fs";
import { unzip, sharedStrings, sheetCells, colOf, rowOf, type Zip } from "./roster-book.ts";

/**
 * THE CAPTAIN'S STATISTICS WORKBOOK — `Golden Retriever Hockey (1).xlsx`.
 *
 * The team's own site framed live pivot tables off this file: `statistics.html`
 * embedded `onedrive.live.com/embed?cid=4DC7108A08DBAEC4&resid=…%21107`, and
 * the workbook still carries the `Pivot Source` sheet those tables were built
 * on. Both the embed and the download have answered 403 for the life of this
 * project. The captain sent the file.
 *
 * WHAT IT IS. Nineteen season-phases of skater and goaltender lines covering
 * Winter 2011-12 through Summer 2016 — the whole of the era the archive had
 * least of. Seven of its thirteen sessions exist nowhere else in the corpus:
 *
 *   Winter 2011-12 · Summer 2012 · Winter 2013-14 · GB Invitational 2014 ·
 *   Summer 2014 · GB Invitational 2016 · Summer 2016
 *
 * WHAT IS DELIBERATELY NOT READ, AND WILL NOT BE. The same rule as
 * `roster-book.ts`, and for the same reason. Eleven of the seventeen sheets are
 * the team's BOOKS: franchise fees, referee fees, per-player dues, who still
 * owes what, a beer blast, and a `USA Ins.` column holding real USA Hockey
 * registration identifiers ("111111111NAMEX"). None of that is read here. Two
 * sheets — `Player Stats` and `Goalie Stats` — are live pivots OF `Pivot
 * Source`, so reading them would double what is already read. One — `HC Stats`
 * — is a paste of a SportsEngine page, and a paste of a page is not a page.
 *
 * WHICH ROWS ARE REAL, AND WHO DECIDES.
 *
 * `Pivot Source` is the captain's own normalised table and it is the spine.
 * `Stats Archive` is the same data laid out ten blocks wide, and it carries 45
 * rows the pivot excludes: all-zero `Playoffs` placeholders for three sessions
 * whose playoffs were never recorded, and two goalie rows reading `#DIV/0!`.
 * Ingesting a 0 GP playoff line asserts that a playoff was played and that a
 * man got nothing out of it. The pivot leaves them out; so does this.
 *
 * It also carries ONE row the pivot lost: Corey Lloyd's four games in the 2016
 * Greater Buffalo Invitational, 3-1 with a shutout. The pivot has that
 * tournament's eleven skaters and not its goaltender — the pivot's range was
 * plainly never extended when the block was added. So the rule is stated rather
 * than special-cased: a `Stats Archive` row joins the pivot when it is ABSENT
 * from it and its GP is not zero. That admits Corey Lloyd and nothing else.
 *
 * PROVENANCE. Like the roster book, these figures trace to a man's spreadsheet
 * and not to a page that was served on the internet, and the site must say so.
 * Where a captured page states the same season, the page is the primary source;
 * see the reconciliation in generate.ts, which never overwrites a figure a page
 * stated and reports every disagreement instead.
 */

/** One player's line for one phase of one season, as the workbook writes it. */
export type BookStatLine = {
  /** The season VERBATIM: "Winter 2011 / 12", "Summer 2012", "GB Invitational 2016". */
  season: string;
  /** The league VERBATIM: "EMHL", "LSHL", "Performax", "Harbor Center". */
  league: string;
  /** "Regular Season" | "Playoffs" | "Tournament", verbatim from the `Playoff` column. */
  phase: string;
  name: string;
  /** "F", "D", "F/D", "G" — as written. */
  position: string;
  /** As written: "21", "89", "0" would be honoured. Never defaulted here. */
  jersey: string;
  kind: "skater" | "goalie";
  /**
   * Column header -> value, VERBATIM and as strings (§2.4).
   *
   * Never parsed: `GAA` is a live formula and arrives as "3.9285714285714284",
   * and `SV%` is a formula that divides by a hundred too many — Corey Lloyd's
   * 155 saves on 185 shots is written "8.3783783783783778E-3". Deciding what
   * either of those means is the build layer's problem, not this one's, and it
   * cannot be done at all if the cell is rounded away here.
   */
  stats: Record<string, string>;
  /** Which sheet the row was read from — "Pivot Source" or "Stats Archive". */
  sheet: string;
};

/** The workbook, under either the name it downloads as or the name it was sent as. */
export const STATS_BOOK_NAMES = [
  "Golden Retriever Hockey (1).xlsx",
  "Golden Retriever Hockey.xlsx",
];

/** Column letter -> 1-based index. "A" = 1, "AA" = 27. */
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
/** The inverse, so a header run can be walked by index. */
function numCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - r - 1) / 26;
  }
  return s;
}

/** Tab name -> sheet part, via the workbook's own relationships. */
function tabsOf(zip: Zip): { name: string; part: string }[] {
  const wb = zip.get("xl/workbook.xml")!.toString("utf8");
  const rels = new Map(
    [...zip.get("xl/_rels/workbook.xml.rels")!.toString("utf8")
      .matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  return [...wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({
    name: m[1]!,
    part: `xl/${(rels.get(m[2]!) ?? "").replace(/^\/?xl\//, "")}`,
  }));
}

/** A skater table names PTS; a goalie table names GAA. Nothing else is a table. */
function kindOf(headers: string[]): "skater" | "goalie" | null {
  const h = headers.map((x) => x.toUpperCase());
  if (h.includes("GAA")) return "goalie";
  if (h.includes("PTS")) return "skater";
  return null;
}

/**
 * Every stat table on one sheet, wherever it sits.
 *
 * BOTH SHEETS PUT TABLES SIDE BY SIDE, and that is the whole difficulty.
 * `Pivot Source` has skaters at column A and goaltenders at column R with a
 * two-column gutter; `Stats Archive` has TEN season blocks across 159 columns,
 * each holding a regular-season table, a playoff table and a goalie table
 * stacked vertically. A reader that assumes one table per sheet, or one table
 * per row, reads the goalie block's `GP` as the skater block's and files a
 * goaltender's wins as a forward's games.
 *
 * So a table is FOUND: a cell reading "Player Name" or "Name" opens one, the
 * headers are the unbroken run of non-empty cells to its right, and the rows
 * are what sits under that run until the name column goes blank. Each row
 * carries its own `Playoff`, `Season` and `League` cells, so no block heading
 * has to be located and no row can inherit the wrong season.
 */
function tablesOn(cells: Map<string, string>, sheet: string): BookStatLine[] {
  const out: BookStatLine[] = [];

  // Where every header run starts. A header cell can appear on any row.
  const heads: { col: number; row: number }[] = [];
  for (const [ref, v] of cells) {
    if (/^(player name|name)$/i.test(v.trim())) heads.push({ col: colNum(colOf(ref)), row: rowOf(ref) });
  }

  for (const head of heads) {
    // The unbroken run of headers to the right, the opening cell included.
    const headers: string[] = [];
    for (let c = head.col; ; c++) {
      const v = cells.get(`${numCol(c)}${head.row}`);
      if (v === undefined) break;
      headers.push(v.trim());
    }
    const kind = kindOf(headers);
    if (!kind) continue;

    const at = (h: string) => headers.findIndex((x) => x.toLowerCase() === h);
    const iPhase = at("playoff");
    const iSeason = at("season");
    const iLeague = at("league");
    const iPos = at("position");
    const iNum = at("number");
    if (iPhase < 0 || iSeason < 0) continue;

    // The stat columns are everything between the number and the phase — GP, G,
    // A, PTS, PIM, PPG, SHG, GWG, PPGA for a skater; GP, W, L, T (or OTL), SO,
    // GA, GAA, SV, SV% for a goaltender. Taken by header rather than by index
    // because the two vocabularies differ and one block heads its ties column
    // "OTL" while every other block heads it "T".
    const statCols: number[] = [];
    for (let i = 1; i < iPhase; i++) if (i !== iPos && i !== iNum) statCols.push(i);

    for (let r = head.row + 1; ; r++) {
      const name = cells.get(`${numCol(head.col)}${r}`)?.trim();
      if (!name) break;
      // A block repeats its own header, and carries text rows like "Playoff
      // Stats" and "No Playoff Stats Recorded" that occupy the name column.
      if (/^(player name|name)$/i.test(name)) break;
      const season = cells.get(`${numCol(head.col + iSeason)}${r}`)?.trim();
      if (!season) continue;

      const stats: Record<string, string> = {};
      for (const i of statCols) {
        const key = headers[i];
        const val = cells.get(`${numCol(head.col + i)}${r}`)?.trim();
        // "" is not 0 (§2.4) and neither is a spreadsheet error. `#DIV/0!` is
        // what a GAA formula prints over nought games; it is not a rate.
        if (!key || !val || val.startsWith("#")) continue;
        stats[key] = val;
      }

      out.push({
        season,
        league: cells.get(`${numCol(head.col + iLeague)}${r}`)?.trim() ?? "",
        phase: cells.get(`${numCol(head.col + iPhase)}${r}`)?.trim() ?? "",
        name,
        position: (iPos > 0 ? cells.get(`${numCol(head.col + iPos)}${r}`) : "")?.trim() ?? "",
        jersey: (iNum > 0 ? cells.get(`${numCol(head.col + iNum)}${r}`) : "")?.trim() ?? "",
        kind,
        stats,
        sheet,
      });
    }
  }
  return out;
}

/** Identity of a line, for joining the two sheets. */
const lineKey = (l: BookStatLine) => `${l.season}|${l.phase}|${l.kind}|${l.name}`;

/**
 * Read the workbook's statistics.
 *
 * `Pivot Source` is the spine; a `Stats Archive` row joins it only when the
 * pivot does not have that man in that phase of that season AND the row records
 * games played. See the header note — that rule admits exactly one row, and
 * refuses forty-five placeholders.
 */
export function parseStatsBook(path: string): BookStatLine[] {
  if (!existsSync(path)) return [];
  const zip = unzip(path);
  const ss = sharedStrings(zip);
  const tabs = tabsOf(zip);

  const read = (tab: string): BookStatLine[] => {
    const t = tabs.find((x) => x.name === tab);
    const part = t ? zip.get(t.part) : undefined;
    if (!part) return [];
    return tablesOn(sheetCells(part.toString("utf8"), ss), tab);
  };

  const pivot = read("Pivot Source");
  const seen = new Set(pivot.map(lineKey));
  const extra = read("Stats Archive").filter(
    (l) => !seen.has(lineKey(l)) && Number(l.stats.GP ?? "0") > 0,
  );
  return [...pivot, ...extra];
}
