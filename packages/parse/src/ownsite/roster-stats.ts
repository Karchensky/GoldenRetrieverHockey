import { text, rowsOf, cellsOf } from "../html.ts";
import type { PlayerSeason, Phase } from "../types.ts";

/**
 * Parse `Team_Roster___Stats.html` from goldenretrieverhockey.com — the
 * team's OWN dead website, rescued from the Internet Archive.
 *
 * THIS IS THE ONLY SURVIVING REACH INTO 2012-2016. Erie Metro's own pages
 * from that era are gone, Pointstreak is dead, and the leagues that hosted
 * them have migrated platforms twice since. If this parser is wrong, the era
 * is simply not recoverable from anywhere else.
 *
 * It is also, embarrassingly, the last one written: 37 captures of the
 * keystone source sat in the corpus for the entire project while the site
 * shipped a homepage promising "an entire era held only by the Internet
 * Archive — all of it retrieved". None of it was retrieved. The gap was found
 * by the team's own captain noticing his game count looked short.
 *
 * SHAPE (SiteFinity export, verified against the real bytes):
 *   <div id="content1">  EMHL Winter 2012 - 2013 Stats (Still missing game # 2 stats)
 *   <div id="content2">  <table> skaters </table>
 *   <div id="content3">  <table> goalies </table>
 *
 * The blocks are a FLAT SEQUENCE, not nested: a block with no table is a
 * heading, and every table block after it belongs to that heading until the
 * next one. A page may carry several seasons this way.
 */

/** One season's heading and the tables filed under it. */
type Block = { heading: string; tables: string[] };

/**
 * Split the page into heading-and-tables blocks.
 *
 * Keyed on `<div id="contentN">` because that is what the export actually
 * emits — every other div on the page is layout chrome (`sf_region6`,
 * `sf_extra11`) and carries no authored content.
 */
export function blocksOf(html: string): Block[] {
  const marks = [...html.matchAll(/<div id="content(\d+)">/g)];
  const out: Block[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i]!.index!;
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : html.length;
    const chunk = html.slice(start, end);
    const tables = [...chunk.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    if (tables.length === 0) {
      const heading = text(chunk).trim();
      // A heading is only a heading if it says something. Empty spacer blocks
      // are common in this export and must not open a new season.
      if (heading) out.push({ heading, tables: [] });
    } else if (out.length > 0) {
      out[out.length - 1]!.tables.push(...tables);
    }
  }
  return out;
}

/**
 * Normalise a season heading into a session label and a phase.
 *
 *   "EMHL Winter 2012 - 2013 Stats (Still missing game # 2 stats)"
 *      -> { league: "EMHL", session: "Winter 2012 - 2013", phase: "Regular Season" }
 *   "EMHL Winter 2012 - 2013 Playoff Stats:"
 *      -> { ..., phase: "Playoffs" }
 *   "LSHL 2013 Summer Stats:"
 *      -> { league: "LSHL", session: "2013 Summer", phase: "Regular Season" }
 *
 * `note` keeps the scorekeeper's own parenthetical. "(Still missing game # 2
 * stats)" is not noise — it is the team telling you, in 2013, exactly which
 * games these totals do not include, and it is the only provenance that era
 * will ever have.
 */
export function seasonOf(heading: string): {
  league: string | null;
  session: string;
  phase: string;
  note: string | null;
} | null {
  const t = heading.replace(/\s+/g, " ").trim();
  if (!/\b(19|20)\d\d\b/.test(t)) return null;

  const noteM = t.match(/\(([^)]*)\)/);
  const note = noteM ? noteM[1]!.trim() : null;

  const bare = t.replace(/\([^)]*\)/g, "").replace(/[:\s]+$/, "").trim();
  const phase = /playoff/i.test(bare) ? "Playoffs" : "Regular Season";

  const leagueM = bare.match(/^([A-Z]{3,5})\b/);
  const league = leagueM ? leagueM[1]! : null;

  const session = bare
    .replace(/^[A-Z]{3,5}\b/, "")
    .replace(/\bplayoff\b/i, "")
    .replace(/\bstats\b/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return { league, session: session || bare, phase, note };
}

/** A goalie table names W/L and GAA; a skater table names PTS. */
function kindOf(header: string[]): "skater" | "goalie" | null {
  const h = header.map((c) => c.toUpperCase());
  if (h.includes("GAA") || (h.includes("W") && h.includes("L"))) return "goalie";
  if (h.includes("PTS") || h.includes("G")) return "skater";
  return null;
}

/**
 * Parse one roster/stats page into PlayerSeason rows.
 *
 * Every stat column is carried through verbatim under its own header rather
 * than mapped to a fixed schema. The columns are not the same across eras —
 * this page has PPGA, HarborCenter does not — and inventing a common shape
 * here would silently drop whatever does not fit.
 */
export function parseRosterStats(html: string, team = "The Golden Retrievers"): PlayerSeason[] {
  const out: PlayerSeason[] = [];

  for (const block of blocksOf(html)) {
    const season = seasonOf(block.heading);
    if (!season) continue;

    for (const table of block.tables) {
      const rows = rowsOf(table).map((r) => cellsOf(r).map((c) => text(c).trim()));
      const header = rows.find((r) => /name/i.test(r[0] ?? ""));
      if (!header) continue;
      const kind = kindOf(header);
      if (!kind) continue;

      for (const cells of rows) {
        if (cells === header) continue;
        const name = cells[0] ?? "";
        // Blank spacer rows are everywhere in this export, and a row whose
        // first cell repeats the header is a second header inside one table.
        if (!name || /^name$|^player name$/i.test(name)) continue;
        if (cells.every((c) => !c)) continue;

        const stats: Record<string, string> = {};
        for (let i = 3; i < header.length; i++) {
          const key = header[i];
          const val = cells[i];
          if (key && val) stats[key] = val;
        }
        if (Object.keys(stats).length === 0) continue;

        const phase: Phase = {
          label: season.phase,
          isAggregate: /^totals?$/i.test(name),
          kind,
          stats,
        };

        out.push({
          team,
          session: season.session,
          jersey: cells[2] ?? "",
          name,
          position: cells[1] || null,
          dob: null,
          weight: null,
          phases: [phase],
        });
      }
    }
  }

  return out;
}
