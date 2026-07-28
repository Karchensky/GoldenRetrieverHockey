import { text } from "../html.ts";
import { parseTitle } from "./roster-player.ts";

/**
 * Parse the "Recent Games" table on a SportsEngine `roster_players/<id>` page.
 *
 * 579 captured pages carry `<table id="recent-game-stats">` and NOTHING in
 * this build has ever opened one. They sat inside a route the archive already
 * reads — the roster pages were parsed for the player's season line and for
 * the fifteen teammates in the sidebar, and this table, five rows further
 * down, was skipped because `parseRosterPlayer` requires a row's cell count to
 * match its header and this one's never does (the Result header spans two
 * columns). A structural refusal that happened to be right, for four years.
 *
 * WHAT ONE ROW IS. A completed game, from the PAGE TEAM's side:
 *
 *   <td class="date">05/06/2019</td>
 *   <td>L</td>
 *   <td class="score">3-5</td>
 *   <td class="name"><a href=".../game/show/25377208?referrer=4498446">at Bandits</a></td>
 *
 * Date, result, score, opponent, and — in the link — THE PLATFORM'S OWN GAME
 * ID, which is the same id space the scoresheets are addressed by. That is
 * what makes these rows joinable rather than merely suggestive: a row whose id
 * the archive already holds is dropped as a duplicate, and one it does not is
 * a game.
 *
 * AND THE VENUE IS IN THE OPPONENT CELL. "at Bandits" means the PAGE TEAM was
 * away; a bare "Grand Island Fish" means it was at home. Verified against
 * three games the archive already holds from other routes — a scoresheet
 * (16569729, GR at home to the Hammers) and two day-schedule rows (22147490
 * and 22152394, one each way) — and all three agree on venue and on score.
 *
 * TWO SHAPES, ONE READER. Erie Metro's table carries a GP column and
 * HarborCenter's does not, because HAHL's SportsEngine era never counted a
 * skater's games. Nothing here reads the stat columns at all — the player's
 * own season line is already on file from the table above this one — so the
 * difference does not reach this parser.
 *
 * THE PAGE IS NOT EVIDENCE OF THE TEAM. `team` is the page's own subject, from
 * the title, and every row names its opponent in its own cell. Whose game a
 * row is belongs to the build layer, which tests BOTH ends: a Retrievers game
 * is on our players' pages and, equally, in the "Recent Games" of the men we
 * played. Six of the fourteen games this route yields were found on an
 * opponent's page and nowhere else.
 */

export type RecentGame = {
  /** The platform's own game id, off the row's game-centre link. Null where
   *  the cell carries no link — the row is then unjoinable and the build
   *  drops it rather than minting an id of its own. */
  gameId: string | null;
  /** "05/06/2019", verbatim. */
  date: string;
  /** "W" | "L" | "T", FROM THE PAGE TEAM'S SIDE. */
  result: string;
  /** "3-5", page team's goals first. Kept as printed. */
  score: string;
  /** The other club, with the venue prefix removed. */
  opponent: string;
  /** TRUE when the cell read "at <opponent>" — the PAGE TEAM was away, so the
   *  opponent was at home. The one venue fact this table carries. */
  pageTeamAway: boolean;
};

export type RecentGames = {
  /** The page's subject team, from its own title. */
  team: string;
  /** The session that title names: "2018-19 Fall/Winter". */
  session: string;
  rows: RecentGame[];
};

/** Rows carry their own marker class; header repeats and spacers do not. */
const ROW = /<tr[^>]*class="[^"]*preview_recent_games[^"]*"[^>]*>[\s\S]*?<\/tr>/g;

export function parseRecentGames(html: string): RecentGames | null {
  const table = html.match(/<table[^>]*id="recent-game-stats"[^>]*>[\s\S]*?<\/table>/)?.[0];
  if (!table) return null;

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const t = title ? parseTitle(text(title)) : null;
  if (!t) return null;

  const rows: RecentGame[] = [];
  for (const tr of table.match(ROW) ?? []) {
    const date = text(tr.match(/<td class="date">([\s\S]*?)<\/td>/)?.[1] ?? "");
    const score = text(tr.match(/<td class="score">([\s\S]*?)<\/td>/)?.[1] ?? "");
    const nameCell = tr.match(/<td class="name">([\s\S]*?)<\/td>/)?.[1] ?? "";
    if (!date || !score || !nameCell) continue;

    // The result cell is the one immediately BEFORE the score cell. It carries
    // no class of its own, so it is found by position rather than by name —
    // and by position relative to a cell that IS named, never by a fixed
    // index, because the two platforms' column counts differ (§2.9).
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
    const scoreAt = tds.findIndex((c) => /class="score"/.test(c));
    if (scoreAt < 1) continue;
    const result = text(tds[scoreAt - 1]!);
    if (!/^[WLT]$/i.test(result)) continue;

    const raw = text(nameCell);
    const away = /^at\s+/i.test(raw);
    rows.push({
      gameId: nameCell.match(/game\/show\/(\d+)/)?.[1] ?? null,
      date,
      result: result.toUpperCase(),
      score,
      opponent: raw.replace(/^at\s+/i, "").trim(),
      pageTeamAway: away,
    });
  }

  return { team: t.team, session: t.session, rows };
}

/** "3-5" -> [3, 5]. Null on anything else: a score is two numbers or nothing. */
export function parseRecentScore(score: string): [number, number] | null {
  const m = score.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}
