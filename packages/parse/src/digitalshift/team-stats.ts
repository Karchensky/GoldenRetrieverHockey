import { text, cellsOf, rowsOf } from "../html.ts";
import { derivePts, tableKind, type RowKind } from "./player.ts";

/**
 * Parse a DigitalShift `partials/stats/team/stats?team_id=<id>` response.
 *
 * THE TEAM'S OWN ROSTER TABLE — every man who dressed for one club in one
 * session, with his NUMBER, his position and his line. The capture layer has
 * fetched this route since the DigitalShift adapter was written
 * (`endpoints.teamStats`) and 96 responses sit in the corpus; nothing had ever
 * read one. Two things were lost for as long as that was true.
 *
 * 1. THE JERSEY NUMBERS. The archive's standing claim was that this platform
 *    "does not collect numbers at all", and that four men — Sean McCormick,
 *    Jeff Antolos, Dylan McLaughlin, Matt Dickerson — had no number evidenced
 *    anywhere and so wore the default 99. That was true of the PLAYER route,
 *    `partials/stats/player`, which is what the archive had been reading and
 *    which carries no number. It was never true of the platform: this table
 *    has a `#` column, states it twice per row (the cell and a `<span class="p">`
 *    beside the name), and gives all four of them a number.
 *
 * 2. THE PLAYOFFS. One response carries FOUR tables — players and goalies, for
 *    Regular Season and for Playoffs — and the player route's career table is
 *    regular season only. Every playoff game this club has played in the
 *    DigitalShift era was therefore absent from the archive.
 *
 * Verified against the corpus rather than asserted: for all 11 Golden
 * Retrievers sessions, every regular-season line this parser reads is
 * IDENTICAL to the line the player route already gave (169/169 skaters,
 * 11/11 goalies, zero disagreements). The two routes are independent renders
 * of one record, which is what makes it safe for the builder to let them
 * collide on the dedup key instead of summing them.
 */

export type TeamStatsRow = {
  /** Which table this row came out of. Never inferred from a position cell —
   *  the goalie table has no `Pos` column at all (see `tableKind`). */
  kind: RowKind;
  /** "Regular Season" | "Playoffs", from the section heading above the table.
   *  The page states this outright; it is not derived from dates. */
  phase: string;
  /** The player's DigitalShift id, from his `#/player/<id>` link. */
  playerId: number | null;
  name: string;
  /** The `#` cell, verbatim. "0" is a real jersey number and is kept as one:
   *  Dylan McLaughlin, Summer 2021, wears it on the page twice. */
  jersey: string | null;
  /** The `Pos` cell for skaters; "G" for goalie-table rows, which carry no
   *  `Pos` column — being in the goalie table IS the statement. */
  position: string;
  /** Column -> raw value. Never coerced: "" is not 0 (§2.4). */
  stats: Record<string, string>;
};

/** Goalie-table rows carry no `Pos` cell; the table itself is the statement. */
const GOALIE_POS = "G";

/** "Player Stats - Regular Season" / "Goalie Stats - Playoffs". */
const SECTION = /(Player|Goalie) Stats - (Regular Season|Playoffs)/i;

/**
 * Parse a team stats partial.
 *
 * The page is SECTIONED BY ITS OWN `<h3>` HEADINGS, and each section's first
 * `<table>` is the real one: like every scrollable table on this platform it is
 * rendered twice, the second an `aria-hidden` responsive clone. Rows are also
 * deduped on (phase, kind, player id) so that a markup change which broke the
 * sectioning could not silently double a career — the failure mode this repo
 * has already paid for elsewhere.
 */
export function parseHsTeamStats(content: string): TeamStatsRow[] {
  const out: TeamStatsRow[] = [];
  const seen = new Set<string>();

  const heads = [...content.matchAll(/<h3[^>]*>\s*([^<]+?)\s*<\/h3>/g)];
  for (let i = 0; i < heads.length; i++) {
    const m = SECTION.exec(heads[i]![1]!);
    if (!m) continue;
    const phase = m[2]!;
    const section = content.slice(
      heads[i]!.index,
      i + 1 < heads.length ? heads[i + 1]!.index : content.length,
    );

    const table = section.match(/<table[\s\S]*?<\/table>/)?.[0];
    if (!table) continue;

    const trs = rowsOf(table);
    const headerRow = trs.find((r) => /<th[\s>]/.test(r));
    if (!headerRow) continue;
    const headers = cellsOf(headerRow);

    const kind = tableKind(headers);
    // Where the identity columns stop and the stats begin: `#`, `Name`, and a
    // `Pos` that only the skater table has. Everything after is read
    // header-by-header, so no stat can be shadowed by the gap.
    const fixed = 2 + (kind === "skater" ? 1 : 0);

    for (const tr of trs) {
      if (/<th[\s>]/.test(tr)) continue;
      const v = cellsOf(tr);
      // Arity mismatch means a footer/aggregate, not a data row. Skipping beats
      // silently misaligning every column after the gap.
      if (v.length !== headers.length) continue;

      const playerId = Number(tr.match(/#\/player\/(\d+)/)?.[1]);
      const key = `${phase}|${kind}|${playerId}`;
      if (seen.has(key)) continue; // responsive duplicate
      seen.add(key);

      // The name cell also carries a `<span class="p">#21</span>` echo of the
      // number; `text()` would fold it into the name.
      const name = text((v[1] ?? "").replace(/#\d+\s*$/, ""));
      if (!name) continue;

      const stats: Record<string, string> = {};
      for (let j = fixed; j < headers.length; j++) {
        const k = headers[j];
        if (k) stats[k] = v[j] ?? "";
      }
      if (kind === "goalie") derivePts(stats);

      out.push({
        kind,
        phase,
        playerId: Number.isFinite(playerId) ? playerId : null,
        name,
        jersey: (v[0] ?? "").trim() || null,
        position: kind === "skater" ? (v[fixed - 1] ?? "") : GOALIE_POS,
        stats,
      });
    }
  }
  return out;
}
