import site from "../data/site.json";
import type { Game, SiteData, Player } from "../../../packages/build/src/types";

/**
 * The site's data, read at BUILD time from the generated corpus dump.
 *
 * There is no database and no runtime fetch — every page is static output.
 * This archive's size is a build step's problem, not a service's. Deliberately
 * not stated as a figure here: the last two counts
 * written into a comment in this repo were both stale within a day, and a
 * number nobody can verify is worse than no number.
 */
export const data = site as unknown as SiteData;

export const players = data.players;
export const totals = data.totals;
export const sessions = data.sessions;
export const trophies = data.trophies;
export const recaps = data.recaps;

export const bySlug = (slug: string): Player | undefined =>
  players.find((p) => p.slug === slug);

/**
 * THE TEAM'S NAME AS THE SHEET IN FRONT OF YOU SPELLS IT.
 *
 * `game.gr` is which side the Retrievers were, and it is the only thing in the
 * file that knows. The name itself is written two ways — "Golden Retrievers" on
 * most sheets and "The Golden Retrievers" on the rest — and matching the string
 * is this project's single most recurring bug. It is not theoretical: filtering
 * penalties on the literal "Golden Retrievers" silently drops fifty of them, a
 * tenth of the record, with no error anywhere.
 *
 * It lives here rather than in `lib/hubs.ts` because two files needed it and
 * only one had it. A goal event carries the side that scored it and `game.goals`
 * holds BOTH teams' goals, so `lib/best-game.ts` — which matched a man's name
 * against every scorer and every assist on the sheet — named four players a
 * best game they had against this club: Casey Krug's was a Busch League goal
 * and a Busch League assist in June 2024, eight years after his last session on
 * file. A shared name proves nothing in a league where a man skates for three
 * clubs at once; the side does.
 */
export const ourSide = (game: Game): string => (game.gr === "home" ? game.home : game.away);

/**
 * A CAREER TOTAL THAT STAYS BLANK WHEN NOTHING WAS EVER RECORDED.
 *
 * `player.career` sums nulls to nought, which is fine for arithmetic and is a
 * statement when it is printed. Seth Hamilton and Alex Wapinewski each have one
 * season line — 2019 - Winter — with every column null, and their pages led with
 * "Points 0 · Goals 0 · Assists 0 · Games 0" twenty pixels above a table
 * printing an em dash in all four. The franchise board on the same site already
 * prints "—" for both, deliberately, and the goaltender hero was rewritten to
 * refuse exactly this: it is not a stat line, it is an accusation, and it was
 * only ever guarded behind `net.primary`.
 *
 * Absence is not zero (§2.4) — for skaters too.
 */
export const recorded = (
  player: Player,
  key: "gp" | "g" | "a" | "pts" | "pim",
): number | null =>
  player.seasons.reduce<number | null>(
    (total, line) => (line[key] === null ? total : (total ?? 0) + line[key]!),
    null,
  );

/**
 * THE YEAR THE CLUB WAS FOUNDED — counted, never typed.
 *
 * This sat hardcoded as 2012 in five places, and it was wrong: the captain's
 * own stats workbook carries a `Winter 2011` sheet with a sixteen-player roster
 * and a paid franchise fee, which is the fee to *establish* a franchise. The
 * club is a year older than its own masthead claimed.
 *
 * So it is derived. A session sorts on the year it began — a fall/winter half
 * at year+0.5, a summer at year, a tournament a quarter-step past the half it
 * was played in — and the founding year is the floor of the earliest of them.
 * The next season recovered from before this one moves the masthead by itself,
 * which is the whole point. This archive's thesis is that a record keeps
 * turning up after everyone has stopped expecting it.
 */
export const FOUNDED: number = Math.floor(
  sessions.reduce((earliest, session) => Math.min(earliest, session.sort), Infinity),
);

/**
 * HOW LONG A SESSION WAS, PROVED WITHOUT THE GAME LOG.
 *
 * Two things the archive can show about the length of a season that do not
 * depend on a schedule surviving:
 *
 * - the league's own standings row, where one survives — five do;
 * - the largest a single PLAYER's lines add up to. This was a max over lines
 *   rather than a sum per man, so a regular season and a playoff run competed
 *   instead of adding: 2012 - Winter was credited 26 while Karchensky's own two
 *   rows for it are 26 and 6, and a dozen player pages printed the pair.
 *
 * Nobody plays more games than the team does, and in a fifteen-man beer-league
 * side somebody plays nearly all of them — so each is a FLOOR under the length
 * of the session, and the larger floor is the honest one.
 *
 * It is exported because two questions need it and were answering it twice: the
 * masthead's games total below, and the coverage chart's game-log row, which had
 * only the standings and so called a five-game log of an eighteen-game summer
 * complete. One derivation, two readings.
 */
export const SESSION_FLOOR: ReadonlyMap<number, number> = new Map(
  sessions.map((session) => {
    const perPlayer = players
      .map((player) => player.seasons.filter((line) => line.session === session.id))
      .filter((mine) => mine.length > 0)
      .map((mine) =>
        mine.reduce<number | null>(
          (sum, line) => (line.gp === null ? sum : (sum ?? 0) + line.gp),
          null,
        ),
      )
      .filter((gp): gp is number => gp !== null);
    return [session.sort, Math.max(session.record?.gp ?? 0, ...perPlayer, 0)];
  }),
);

/**
 * GAMES THE TEAM ACTUALLY PLAYED — which is not the size of the game log.
 *
 * The masthead printed `games.length` — 268 — beside careers of 422, 373 and
 * 361 games, which is not a rounding disagreement, it is an impossible one. The
 * game LOG is thin before 2016-17: thirteen sessions have no schedule on file at
 * all, because the sources for that era published season totals and leaders
 * rather than results. So the log is the number of games we hold a RECORD of,
 * and it was standing in a slot labelled "Games".
 *
 * The third floor is the log itself, which for thirteen sessions is MORE than
 * the standings row or the roster knows about: 2016 - Winter logs thirty played
 * fixtures against twenty-six credited, 2017 - Winter twenty-nine against
 * twenty-three. A reader could count the log on the season index and find the
 * franchise total that contains it smaller than the season. 552 against a log of
 * 306 played.
 */
export const TEAM_GAMES: number = sessions.reduce((total, session) => {
  const logged = data.games.filter(
    (game) => game.sessionSort === session.sort && game.result !== null,
  ).length;
  return total + Math.max(SESSION_FLOOR.get(session.sort) ?? 0, logged);
}, 0);

/**
 * THE SCOPE OF THE ASSIST NETWORK — the most misleading thing on this site
 * until it was written down.
 *
 * "Who set up whom" is built from goal events on scoresheets. A session only
 * contributes when its source recorded goal-by-goal detail; a final score or a
 * season aggregate cannot prove who passed to whom.
 *
 * The numbers are right only inside that scope. Everything is derived here, so
 * a newly recovered scoresheet expands the graph without a hand-edited list.
 */
export const assistScope = (() => {
  const withSheets = new Set(
    data.games.filter((g) => (g.goals?.length ?? 0) > 0).map((g) => g.session),
  );
  // Game sessions and roster sessions are labelled differently by four
  // platforms ("2016-17" vs "2016-17 Regular Season"), so match on the parsed
  // sort key the build already agreed on rather than on the string.
  const sorts = new Set(
    data.games.filter((g) => (g.goals?.length ?? 0) > 0).map((g) => g.sessionSort),
  );
  const covered = sessions.filter((s) => sorts.has(s.sort));
  const missing = sessions.filter((s) => !sorts.has(s.sort));
  return {
    /** Sessions whose goals are on file, in order. */
    sessions: covered,
    count: covered.length,
    total: sessions.length,
    labels: covered.map((s) => s.id),
    /**
     * The sessions with NO goal-by-goal record — and the right thing to print.
     *
     * The copy used to list the covered sessions, because there were two of
     * them. There are thirteen now, and "Counted from 2016-17 Regular Season
     * and 2017-18 Regular Season and Summer 2021 and Fall/Winter 2021-22 and
     * ..." is a thirteen-item run-on that shipped the moment the archive got
     * better. Naming the HOLES is shorter, more useful, and shrinks as the
     * archive grows rather than swelling with it.
     */
    missingLabels: missing.map((s) => s.id),
    missingCount: missing.length,
    ids: withSheets,
    /** True when a session's goal-by-goal record survives. */
    covers: (sort: number) => sorts.has(sort),
  };
})();

/**
 * A goaltender's record, over the lines that actually carry each figure.
 *
 * DIGITALSHIFT NEVER PUBLISHED SAVES. Every HarborCenter line stores `sv: "0"`
 * and `svPct: ".000"` beside a goals-against figure in the dozens, which is not
 * a goaltender who stopped nothing — it is a column the platform left empty and
 * filled with a nought. Read literally it made the club's longest-serving
 * goalie 148 saves in 258 games and a .000 save percentage for fourteen
 * seasons: the archive's own "absence is not zero" rule broken in the one place
 * it accuses somebody.
 *
 * So a nought save behind a goal conceded is read as unrecorded, and saves are
 * summed — and reported — only over the games whose lines carry them.
 */
export type Goaltending = {
  /** Every game he tended, whatever else survives. */
  gp: number;
  w: number;
  l: number;
  t: number;
  ga: number;
  shutouts: number;
  /** Saves on file, and the games they were recorded over. */
  sv: number;
  svGp: number;
  /** He is filed as a goaltender: he tended more than he skated. */
  primary: boolean;
};

const int = (value: string | null | undefined): number => parseInt(value ?? "", 10) || 0;

/** A save figure the source actually published, or null. */
export const savesOf = (line: { goalie?: { sv?: string | null; ga?: string | null } | null }): number | null => {
  const raw = line.goalie?.sv;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value)) return null;
  return value === 0 && int(line.goalie?.ga) > 0 ? null : value;
};

/**
 * A save percentage as a save percentage.
 *
 * Two sources, two spellings, and one of them is neither: the workbook stores
 * `"0.863%"` — a proportion with a percent sign welded on — and DigitalShift
 * stores `".000"` for a column it never filled. Both come out as `.863` or as
 * nothing at all.
 */
export const savePctOf = (line: { goalie?: { svPct?: string | null } | null }): string | null => {
  const raw = line.goalie?.svPct;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw.replace("%", ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return (value > 1 ? value / 100 : value).toFixed(3).replace(/^0/, "");
};

export function goaltending(player: Player): Goaltending {
  const lines = player.seasons.filter((line) => line.kind === "goalie" && line.goalie);
  const skated = player.seasons
    .filter((line) => line.kind !== "goalie")
    .reduce((total, line) => total + (line.gp ?? 0), 0);

  const out = lines.reduce<Goaltending>(
    (total, line) => {
      const saves = savesOf(line);
      return {
        gp: total.gp + (line.gp ?? 0),
        w: total.w + int(line.goalie?.w),
        l: total.l + int(line.goalie?.l),
        t: total.t + int(line.goalie?.t),
        ga: total.ga + int(line.goalie?.ga),
        shutouts: total.shutouts + int(line.goalie?.so),
        sv: total.sv + (saves ?? 0),
        svGp: total.svGp + (saves === null ? 0 : line.gp ?? 0),
        primary: false,
      };
    },
    { gp: 0, w: 0, l: 0, t: 0, ga: 0, shutouts: 0, sv: 0, svGp: 0, primary: false },
  );

  return { ...out, primary: lines.length > 0 && out.gp > skated };
}

/** Everyone who ever set this player up, or was set up by them. */
export function linemates(name: string) {
  const out = new Map<string, { gave: number; got: number }>();
  for (const e of data.assists) {
    if (e.from === name) {
      const r = out.get(e.to) ?? { gave: 0, got: 0 };
      r.gave += e.n;
      out.set(e.to, r);
    } else if (e.to === name) {
      const r = out.get(e.from) ?? { gave: 0, got: 0 };
      r.got += e.n;
      out.set(e.from, r);
    }
  }
  return [...out]
    .map(([who, v]) => ({ who, ...v, total: v.gave + v.got }))
    .sort((a, b) => b.total - a.total);
}
