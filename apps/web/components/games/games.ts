import site from "../../data/site.json";
import type { SiteData, Game, Session } from "../../../../packages/build/src/types";
import type { GameRow } from "./GameList";

const data = site as unknown as SiteData;

export const games: Game[] = data.games;
export const gameTotals = data.gameTotals;
export const totals = data.totals;

export const gameById = (id: string) => games.find((g) => g.id === id);

/**
 * Spell a small number.
 *
 * Every figure on these pages is derived rather than typed, prose included.
 * The last two counts written into a comment in this repo were both stale
 * within a day; a sentence is no safer than a comment.
 */
const WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-one", "Twenty-two",
  "Twenty-three", "Twenty-four", "Twenty-five", "Twenty-six", "Twenty-seven",
  "Twenty-eight", "Twenty-nine", "Thirty",
];
export const spell = (n: number) => WORDS[n] ?? String(n);
export const lower = (n: number) => spell(n).toLowerCase();

/** Sheets captured that are NOT this team's games. Six, and they are a youth league's. */
export const notOurs = totals.gameSheets - gameTotals.withSheet;

/** The years the game record spans, from the games themselves. */
export const span = {
  first: games[0]?.date.slice(0, 4) ?? "",
  last: games.at(-1)?.date.slice(0, 4) ?? "",
};

/** Games in a session, by sort key. */
export const inSession = (sort: number) => games.filter((g) => g.sessionSort === sort);

/**
 * The list's view of a game: scoreline and flags, no events.
 *
 * `/games` renders 73 scorelines and not one goal, so shipping the goals,
 * penalties, goalies and box scores into its payload buys nothing and costs
 * most of the page. They are all still on /games/[id].
 */
export const rows = (): GameRow[] =>
  games.map((g) => ({
    id: g.id,
    date: g.date,
    sessionSort: g.sessionSort,
    opponent: g.opponent,
    gr: g.gr,
    gf: g.gf,
    ga: g.ga,
    result: g.result,
    round: g.round,
    ot: g.ot,
    shootoutWinner: g.shootoutWinner,
    status: g.status,
    hasDetail: g.hasDetail,
    archiveOnly: g.provenance.archiveOnly,
  }));

/**
 * A display label for a half-year, from its sort key alone.
 *
 * Duplicates `sessions.sessionLabel` in one line rather than pulling a
 * build-time package into the client bundle. It is needed for the halves that
 * have NO session object — a hole has no label of its own, and the whole point
 * of the timeline is to name the years nothing survives from.
 */
export const labelOf = (sort: number): string =>
  `${Math.floor(sort)} - ${sort % 1 === 0 ? "Summer" : "Winter"}`;

export type Slot = {
  sort: number;
  label: string;
  /** The session as the archive has it, if it has it at all. */
  session: Session | null;
  games: number;
  w: number;
  l: number;
  /** Known ONLY from game rows — no session, no roster, no statistics. */
  gamesOnly: boolean;
};

/**
 * Every half-year from the first session on file to the last, INCLUDING the
 * ones with nothing in them.
 *
 * The team plays twice a year, so the halves are a fixed sequence and a gap in
 * that sequence is a fact about the archive rather than an opinion. Iterating
 * the sessions we happen to hold would draw a tidy, continuous, false history:
 * "2013 Summer" sits directly beside "2016-17" in the data, and six sessions
 * are missing between them.
 *
 * The labels for empty halves are arithmetic, not a claim. "Summer 2020" here
 * says the archive holds nothing for that half, NOT that a season happened.
 */
export function timeline(): Slot[] {
  const sessions = data.sessions;
  const sorts = [
    ...sessions.map((s) => s.sort),
    ...games.map((g) => g.sessionSort),
  ];
  const first = Math.min(...sorts);
  const last = Math.max(...sorts);

  const out: Slot[] = [];
  for (let sort = first; sort <= last + 0.001; sort += 0.5) {
    const key = Math.round(sort * 2) / 2;
    const session = sessions.find((s) => s.sort === key) ?? null;
    const gs = games.filter((g) => g.sessionSort === key);
    out.push({
      sort: key,
      label: session?.id ?? (gs[0]?.session ?? labelOf(key)),
      session,
      games: gs.length,
      w: gs.filter((g) => g.result === "W").length,
      l: gs.filter((g) => g.result === "L").length,
      gamesOnly: session === null && gs.length > 0,
    });
  }
  return out;
}

/** Sessions that have at least one game, newest first. */
export function sessionsWithGames() {
  const seen = new Map<number, string>();
  for (const g of games) if (!seen.has(g.sessionSort)) seen.set(g.sessionSort, g.session);
  return [...seen]
    .sort((a, b) => b[0] - a[0])
    .map(([sort, label]) => ({ sort, label }));
}

/** The Retrievers' side of a game, as recorded. */
export const grSide = (g: Game) => (g.gr === "home" ? g.home : g.away);
