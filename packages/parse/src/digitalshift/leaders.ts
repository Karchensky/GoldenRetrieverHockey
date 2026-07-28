import { text } from "../html.ts";

/**
 * Parse HarborCenter's LEAGUE-WIDE SCORING LEADERBOARD for one season —
 * the DigitalShift `partials/stats/leaders/table` response.
 *
 * This is the modern era's answer to the SportsEngine `league_instance` tables,
 * and it is the source for a player's standing "relative to the league" — where
 * a Retriever finished in scoring against everyone they played. Unlike the
 * Wayback HAHL tables, which survive only as page 1 (the top thirty by goals),
 * this is the WHOLE table the platform serves, sorted by points, carrying its
 * own explicit rank column.
 *
 * The same request returns two different rankings depending on one parameter,
 * and the parser does not need to know which it was handed — both are just a
 * ranked table:
 *   - no `division_id`  -> the league, every division merged
 *   - a `division_id`   -> that division only, re-ranked 1..N by the platform
 * The build layer knows from the URL which one it captured, and pairs it with
 * the season and division the corpus already names.
 *
 * SHAPE (verified against 22 captured tables, 11 seasons × league/division):
 *
 *   <h2 class="h3">Summer 2023</h2>              (league table: the SEASON)
 *   <h2 class="h3">Silver</h2>                   (division table: the DIVISION)
 *   <table class="stats-table leaders_players ">
 *     <thead><tr><th>Rk</th><th>Name</th><th>#</th><th>Team</th><th>Pos</th>
 *                <th>GP</th><th>G</th><th>A</th><th>Pts</th>...</tr></thead>
 *     <tbody>
 *       <tr><td> 1 </td>
 *           <td><a class="person-inline" href="stats#/player/773992">Frank Cefalu</a>
 *               <span class="p">#13</span></td>
 *           <td> 13 </td>
 *           <td><a class="team-inline" href="stats#/1367/team/272712"><img ...>Daddio's</a></td>
 *           <td> P </td><td> 10 </td><td> 16 </td><td> 18 </td><td> 34 </td>...
 *
 * TWO HAZARDS, both already paid for elsewhere in this repo:
 *
 * 1. THE TABLE IS RENDERED TWICE. Every scrollable table on this platform is
 *    followed by an `aria-hidden` responsive clone with byte-identical rows —
 *    the same duplication that would double every goal in a boxscore
 *    (digitalshift/boxscore.ts). Read naively, every player appears twice and a
 *    field of a hundred reads as two hundred. Deduped here on PLAYER ID: the
 *    clone carries the same ids, and the first occurrence wins.
 *
 * 2. THE TEAM IS A LOGO, NOT A STRING. A row's team cell is an `<img>` and a
 *    name, wrapped in a link to `#/1367/team/<id>`. Whose row is the
 *    Retrievers' is decided by that TEAM ID against the id the corpus already
 *    vouched for — never by substring-matching a team name on the page, the
 *    error that once turned three other clubs into Retrievers. So every row
 *    carries its own team id, and attribution belongs to the build layer.
 *
 * THE COLUMNS ARE READ BY HEADER, not by fixed position. The league's own
 * `view_settings.tables` vary the stat set between leagues and could between
 * seasons; the first five columns are identity (Rk, Name, #, Team, Pos) and the
 * rest are carried through verbatim under their own header so a changed stat set
 * is preserved rather than misread.
 */

export type LeaderRow = {
  /** The platform's own rank — the `Rk` column, verbatim as a number. */
  rank: number;
  /** DigitalShift's persistent player id, from `#/player/<id>`. The join key
   *  to a player's career pages; null only if a row has no player link. */
  playerId: number | null;
  name: string;
  /** Jersey number as printed, or null. */
  jersey: string | null;
  /** The row's OWN team id, from `#/1367/team/<id>`. The only honest way to
   *  decide whose row this is. */
  teamId: number | null;
  team: string;
  position: string | null;
  gp: number | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pim: number | null;
  /** Every stat column verbatim, keyed by its header (PPGA, PPG, SHG, GWG...). */
  stats: Record<string, string>;
};

export type LeaderTable = {
  /**
   * The table's own `<h2>` — the SEASON for a league table ("Summer 2023"),
   * the DIVISION for a division table ("Silver"). Informational: the build
   * layer takes the authoritative season and division from the URL and corpus,
   * because a division table's heading does not name its season.
   */
  title: string | null;
  headers: string[];
  /** Ranked rows, in table order, one per player (clone rows removed). */
  rows: LeaderRow[];
};

const num = (s: string | undefined): number | null => {
  // "" is NOT 0: an untracked column must never become a zero (§2.4).
  if (s === undefined || s.trim() === "") return null;
  const v = Number(s.trim());
  return Number.isFinite(v) ? v : null;
};

/** Raw `<td>`/`<th>` cell HTML of one row, in order, empties kept (§2.9). */
function rawCells(row: string): string[] {
  return row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
}

export function parseLeaders(html: string): LeaderTable {
  const title = html.match(/<h2[^>]*class="[^"]*h3[^"]*"[^>]*>([\s\S]*?)<\/h2>/)?.[1];

  // The player leaderboard table. There is only one KIND on the page, but two
  // copies of it; the header comes from whichever renders first and both are
  // identical.
  const tables = html.match(/<table[^>]*class="[^"]*leaders_players[^"]*"[^>]*>[\s\S]*?<\/table>/g) ?? [];
  if (tables.length === 0) return { title: title ? text(title) : null, headers: [], rows: [] };

  const headerRow = tables[0]!.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? "";
  const headers = rawCells(headerRow).map(text);

  // Where each carried-through stat lives, by header label. The first five
  // columns are identity and are read explicitly below.
  const idx = (label: string) => headers.findIndex((h) => h.toLowerCase() === label.toLowerCase());
  const iGp = idx("GP"), iG = idx("G"), iA = idx("A"), iPts = idx("Pts"), iPim = idx("PIM");

  const rows: LeaderRow[] = [];
  const seen = new Set<number>();

  for (const table of tables) {
    const body = table.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? table;
    for (const tr of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = rawCells(tr);
      if (cells.length < 5) continue; // not a data row

      const playerId = num(tr.match(/#\/player\/(\d+)/)?.[1] ?? "");
      // A row with no player is a header, a spacer, or an empty state — never a
      // ranked player. Skipping it beats inventing a rank for nobody.
      if (playerId === null) continue;
      // The responsive clone repeats every id; the first occurrence is enough.
      if (seen.has(playerId)) continue;
      seen.add(playerId);

      const rank = num(text(cells[0]!));
      if (rank === null) continue; // an unranked row is not a standing

      // Name from the anchor itself, not the cell: the cell also carries a
      // "#13" jersey span that text() would append to the name.
      const name = text(cells[1]!.match(/<a[^>]*person-inline[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? cells[1]!);
      const jersey = text(cells[2]!) || null;
      const teamId = num(tr.match(/#\/1367\/team\/(\d+)/)?.[1] ?? "");
      // Team name: the anchor's text, the logo `<img>` contributing nothing.
      const team = text(cells[3]!);
      const position = text(cells[4]!) || null;

      const stats: Record<string, string> = {};
      for (let i = 5; i < headers.length; i++) {
        const key = headers[i];
        if (key) stats[key] = text(cells[i] ?? "");
      }

      rows.push({
        rank,
        playerId,
        name,
        jersey,
        teamId,
        team,
        position,
        gp: iGp >= 0 ? num(text(cells[iGp] ?? "")) : null,
        g: iG >= 0 ? num(text(cells[iG] ?? "")) : null,
        a: iA >= 0 ? num(text(cells[iA] ?? "")) : null,
        pts: iPts >= 0 ? num(text(cells[iPts] ?? "")) : null,
        pim: iPim >= 0 ? num(text(cells[iPim] ?? "")) : null,
        stats,
      });
    }
  }

  return { title: title ? text(title) : null, headers, rows };
}
