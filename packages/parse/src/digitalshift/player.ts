import { text, cellsOf, rowsOf } from "../html.ts";

/**
 * Parse a DigitalShift `partials/stats/player?player_id=<id>` response.
 *
 * The best-shaped source in the archive: HarborCenter has PERSISTENT PLAYER
 * IDENTITY, so one call returns a player's entire career across every session
 * plus their game logs. SportsEngine has no equivalent — there, a player is a
 * different row every season with no career page, and identity must be
 * reconstructed downstream.
 */

/** Which table a row came out of. Skaters and goalies get DIFFERENT tables. */
export type RowKind = "skater" | "goalie";

/** One session on a player's career table. */
export type CareerRow = {
  /** "Summer 2026", "Fall/Winter 2025-26" — verbatim. */
  session: string;
  /** Team AS RECORDED. Both "Golden Retrievers" and "The Golden Retrievers"
   *  occur in alternating sessions and are the same team. */
  team: string;
  /** The team's DigitalShift id, from its link. The stable per-session key. */
  teamId: number | null;
  division: string;
  /** Which table this row came from. NOT inferred from the position cell —
   *  goalie tables have no position cell at all (see `tableKind`). */
  kind: RowKind;
  /** The `Pos` cell for skaters; "G" for goalie-table rows, which carry no
   *  `Pos` column — being in the goalie table IS the source's statement of
   *  the position. "G" is the source's own vocabulary: the skater table
   *  records exactly this value for players who tended goal (Devin Arnold,
   *  Summer 2024, Mooseheads). */
  position: string;
  /** Column -> raw value. Never coerced: "" is not 0 (§2.4). */
  stats: Record<string, string>;
};

/** One game from a player's game log. */
export type GameRow = {
  /** "July 13, 2026" — verbatim; date parsing is a later concern. */
  date: string;
  /** "Tall Boys Love Em vs The Golden Retrievers" — verbatim. */
  game: string;
  kind: RowKind;
  position: string;
  /** Goalie game rows carry `DEC` (W/L/T) here — a real column, kept. */
  stats: Record<string, string>;
};

export type HsPlayer = {
  playerId: number | null;
  name: string | null;
  career: CareerRow[];
  games: GameRow[];
};

const SEASON_HEADERS = ["Season", "Team", "Division"];
const GAME_HEADERS = ["Date", "Game"];

const startsWith = (headers: string[], want: string[]) =>
  want.every((w, i) => headers[i] === w);

/**
 * Which shape is this table? Decided by the COLUMNS — never by a position
 * cell, which is exactly what a goalie table lacks.
 *
 * HarborCenter emits a separate, WIDER table for goalies with NO `Pos` column,
 * so the fixed prefix is one column narrower and every read past it slides:
 *
 *   skater season: Season Team Division Pos GP G A Pts PPGA PIM PPG SHG GWG
 *   goalie season: Season Team Division GP W L T OTL SA GA GAA Sv Sv% SO MP PIM G A
 *   skater game:   Date Game Pos G A Pts PIM
 *   goalie game:   Date Game DEC SA GA Sv Sv% MP PIM G A
 *
 * Reading `Pos` positionally therefore takes a goalie's GP as his position
 * (season) or his W/L/T decision as his position (game log), and drops the
 * shadowed column entirely. Both shapes are verified against the corpus:
 * all 72 captured player partials are one or the other, and six players have
 * a goalie table (one of them has BOTH).
 */
export function tableKind(headers: string[]): RowKind {
  return headers.includes("Pos") ? "skater" : "goalie";
}

/** Goalie-table rows carry no `Pos` cell; the table itself is the statement. */
const GOALIE_POS = "G";

/** The team id from a row's `stats#/<league>/team/<id>` link. */
function teamIdOf(rowHtml: string): number | null {
  const m = rowHtml.match(/\/team\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Give a goalie season row the `Pts` its table has no column for.
 *
 * The ONLY derived value in this parser, and it is derived, never repaired.
 * The goalie table records `G` and `A` but has no `Pts` column at all, so a
 * goalie who scores reads as "1 goal, 0 points" — Corey Muff, Fall/Winter
 * 2022-23, whose goal is on the page and in the table's own totals row.
 * Pts is the definitional sum of two cells read verbatim off THIS row; both
 * operands trace to the stored page.
 *
 * Distinct from the goalie numbers that are merely WRONG — SA copies GA and
 * Sv is 0 even in wins, in every one of the 25 captured goalie season lines
 * (23 of them wins) and all 271 goalie game lines. Those are recorded values
 * and are passed through untouched; a missing column is not.
 *
 * Blank stays blank: if either operand is "" there is no sum to take, and
 * "" is not 0 (§2.4).
 */
export function derivePts(stats: Record<string, string>): void {
  if (stats.Pts !== undefined) return; // never shadow a real column
  const g = Number(stats.G);
  const a = Number(stats.A);
  if (stats.G?.trim() && stats.A?.trim() && Number.isFinite(g) && Number.isFinite(a)) {
    stats.Pts = String(g + a);
  }
}

/**
 * Parse a player partial.
 *
 * The SPA renders each table MULTIPLE TIMES (responsive desktop/mobile
 * variants), so rows must be deduped or every career silently doubles.
 */
export function parseHsPlayer(content: string, playerId?: number): HsPlayer {
  const career: CareerRow[] = [];
  const games: GameRow[] = [];
  const seenCareer = new Set<string>();
  const seenGames = new Set<string>();

  for (const table of content.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const trs = rowsOf(table);
    const headerRow = trs.find((r) => /<th[\s>]/.test(r));
    if (!headerRow) continue;
    const headers = cellsOf(headerRow);

    const isSeason = startsWith(headers, SEASON_HEADERS);
    const isGame = startsWith(headers, GAME_HEADERS);
    if (!isSeason && !isGame) continue;

    const kind = tableKind(headers);
    // Where the identity columns stop and the stats begin. One NARROWER on a
    // goalie table, which has no `Pos`. Everything after this point is read
    // header-by-header, so no stat can be shadowed by the gap.
    const fixed = (isSeason ? 3 : 2) + (kind === "skater" ? 1 : 0);

    for (const tr of trs) {
      if (/<th[\s>]/.test(tr)) continue;
      const v = cellsOf(tr);
      // Arity mismatch means a footer/aggregate, not a data row. Skipping
      // beats silently misaligning every column after the gap.
      if (v.length !== headers.length) continue;

      const position = kind === "skater" ? (v[fixed - 1] ?? "") : GOALIE_POS;
      const stats: Record<string, string> = {};
      for (let i = fixed; i < headers.length; i++) {
        const k = headers[i];
        if (k) stats[k] = v[i] ?? "";
      }

      if (isSeason) {
        const [session, team, division] = v;
        if (!session || !team) continue;
        // Keyed by KIND too: one player can have a skater row AND a goalie row
        // for the same session and team (Devin Arnold, Summer 2024,
        // Mooseheads). Without `kind` the goalie row looks like a responsive
        // duplicate and is silently dropped.
        const key = `${session}|${team}|${kind}`;
        if (seenCareer.has(key)) continue; // responsive duplicate
        seenCareer.add(key);
        if (kind === "goalie") derivePts(stats);
        career.push({
          session,
          team,
          teamId: teamIdOf(tr),
          division: division ?? "",
          kind,
          position,
          stats,
        });
      } else {
        const [date, game] = v;
        if (!date || !game) continue;
        const key = `${date}|${game}|${kind}`;
        if (seenGames.has(key)) continue; // responsive duplicate
        seenGames.add(key);
        games.push({ date, game, kind, position, stats });
      }
    }
  }

  return {
    playerId: playerId ?? null,
    name: playerNameOf(content),
    career,
    games,
  };
}

/** The player's name, from whichever header the partial carries. */
export function playerNameOf(content: string): string | null {
  const sr = content.match(/<h1[^>]*class="sr-only"[^>]*>\s*([^<,]+)/)?.[1];
  if (sr) return text(sr);
  const title = content.match(/ng-init="config\.title\s*=\s*'([^']+)'/)?.[1];
  if (title) return text(title);
  const div = content.match(/<div class="title">\s*([^<]+?)\s*<\/div>/)?.[1];
  return div ? text(div) : null;
}

/** Is this career row a Golden Retrievers season? Accepts both live variants. */
export function isRetrieversRow(r: CareerRow): boolean {
  return /^(the\s+)?golden\s+retrievers$/i.test(r.team.trim());
}
