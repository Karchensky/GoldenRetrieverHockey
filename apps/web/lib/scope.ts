import { SESSION_FLOOR, assistScope, data, players, sessions } from "./data";
import { SEASON_ATLAS } from "./seasons";
import { GAP_WORDS, ROLLUPS, SPINE } from "./stats";
import type { SessionRollup } from "./stats";

/**
 * WHAT THE ARCHIVE HOLDS AND WHAT IT DOES NOT, SESSION BY SESSION.
 *
 * Coverage here is four different questions and conflating any two of them
 * flatters every count on the site. Rosters and statistics run from the first
 * session on file to the newest. GAME RESULTS DO NOT: the earliest surviving
 * game is years later than the earliest surviving roster, and better than half
 * the sessions have no game record at all. Scoresheets are narrower again.
 *
 * This was seven per-section caveats, then one box of six mono rows naming
 * seasons in prose. It is a chart now — four dimensions down, the session spine
 * across — because the shape of the archive's coverage is a shape, and a reader
 * who can see the whole 2011-2016 era dark on two rows and lit on the other two
 * has been told the thing the six rows spent two hundred words on.
 *
 * NOTHING HERE IS TYPED. Every cell is decided by the same predicate the thing
 * it describes is built from, and the game-log column is read off `SEASON_ATLAS`
 * — which is the field the Season index rail prints its own signals from — so
 * the chart and the rail cannot drift apart. A recovered season lights a cell
 * without anyone editing a sentence.
 */

/** Three answers, and no fourth. Absence is drawn, never left blank. */
export type CoverageState = "full" | "partial" | "none";

export type CoverageKey = "log" | "sheets" | "roster" | "stats";

/**
 * The four dimensions, in the order they thin out.
 *
 * Statistics and rosters are near-complete across fifteen years; the game log
 * starts in 2016 and the scoresheets are thinner still inside it. Reading top
 * to bottom the chart goes from the archive's largest hole to its smallest,
 * which is the fact the seven scope lines could never state.
 */
export const COVERAGE_ROWS: readonly { key: CoverageKey; term: string }[] = [
  { key: "log", term: "Game log" },
  { key: "sheets", term: "Scoresheets" },
  { key: "roster", term: "Roster" },
  { key: "stats", term: "Statistics" },
];

/** What each mark claims, in the archive's own vocabulary. Three terms in one
 *  grammar: the middle one was "a fragment", an article and a noun standing
 *  between two plain states, and it read as a different kind of claim from the
 *  two beside it. */
export const COVERAGE_WORDS: Record<CoverageState, string> = {
  full: "complete",
  partial: "partial",
  none: "nothing on file",
};

export type CoverageColumn = {
  sort: number;
  label: string;
  /** The tournament's name where the column is one, null where it is a league
   *  half. A tick on the axis is a POSITION IN TIME and cannot be placed on a
   *  four-day event: "2015 - Greater Buffalo Invitational" is three times the
   *  width of every other tick and names a competition rather than a date. */
  tournament: string | null;
  /** null on a half-year that holds no session at all. */
  states: Record<CoverageKey, CoverageState> | null;
  /** The archive's words for that half-year, where there is no session. */
  words: string | null;
};

const ATLAS = new Map(SEASON_ATLAS.map((entry) => [entry.sort, entry]));

const GAMES_AT = (sort: number) => data.games.filter((game) => game.sessionSort === sort);

/**
 * THE GAME LOG, ON THE RAIL'S OWN TERMS.
 *
 * `SEASON_ATLAS` is what the Season index strip and every season page are
 * printed from, so the three surfaces answer with one predicate:
 *
 * - Nothing at all — the strip's bare "no game log", which is most of the
 *   archive's first five years.
 * - A log shorter than the season it belongs to. Summer 2018 is the opposite
 *   case and stays whole: thirteen rows against a table saying twelve.
 *
 * THE LEAGUE'S TABLE IS NOT THE ONLY YARDSTICK, and while it was, a session
 * whose standings row did not survive was called complete the moment one result
 * did. 2013 - Summer holds five games and Karchensky's own line for it is 18
 * games, 27 goals and 27 assists — twenty-seven goals in five games — so the
 * chart certified the log complete on a season the archive holds barely a
 * quarter of, on the one row built to say what is missing. `SESSION_FLOOR` in
 * lib/data.ts is the length of the session proved WITHOUT the log: the league's
 * table where one survives, and otherwise the largest a single man's own lines
 * add up to, since nobody plays more games than the team. The masthead's games
 * total is the same derivation, so the two cannot drift.
 *
 * A RECOVERED RESULT IS NOT A GAME LOG, and this row briefly said it was. The
 * dated final scores in the 2012-13 and Summer 2013 write-ups scored a
 * "fragment" here off `entry.results` while the rail printed "27 results, no
 * game log" on the same two rows — one word for one state, and the two surfaces
 * had two. The scores are games now: the build reads them out of the recaps it
 * was already printing, so both seasons carry a real log and the rescue that
 * disagreed with the rail is gone rather than reworded.
 *
 * A FIXTURE THAT HAS NOT BEEN SKATED IS NOT A HOLE, AND A SCORE NOBODY WROTE
 * DOWN IS. The season being played carries eleven fixtures and seven results,
 * and counting the four to come as missing records would have the current season
 * open the chart as a gap. But 2012 - Winter carries two rows the source itself
 * marks `Score not recorded` — its own page prints them as em dashes — and those
 * are games the archive holds no result for, which is what this row measures.
 * A postponement is neither: it is on the schedule and was never skated.
 */
const UNRECORDED_AT = (sort: number) =>
  GAMES_AT(sort).filter((game) => game.result === null && game.status === "Score not recorded").length;

const logState = (sort: number): CoverageState => {
  const entry = ATLAS.get(sort);
  const played = entry?.games ?? 0;
  if (played === 0) return "none";
  if (UNRECORDED_AT(sort) > 0) return "partial";
  return played < (SESSION_FLOOR.get(sort) ?? 0) ? "partial" : "full";
};

/**
 * SCORESHEETS — a sheet with events behind a played game.
 *
 * `scheduleOnly` is a game known from a schedule row and nothing else: Summer
 * 2018's thirteen games are all of that kind, so the session has a full log and
 * not one sheet. `hasDetail` is the second half of it — twenty-six sheets in
 * the file carry a real score and no goal-by-goal record at all, including a
 * 13-0 semi-final — and a sheet that records nothing is not a scoresheet.
 *
 * `SHEET_SORTS` in lib/hubs.ts counts the thirteen sessions a sheet survives
 * for at all, which is the figure the assist network and the penalties are
 * scoped by. This says how completely, and the two agree: of those thirteen,
 * four are whole and nine are fragments.
 */
const sheetState = (sort: number): CoverageState => {
  const played = GAMES_AT(sort).filter((game) => game.result !== null);
  if (played.length === 0) return "none";
  const kept = played.filter((game) => !game.scheduleOnly && game.hasDetail).length;
  if (kept === 0) return "none";
  return kept === played.length ? "full" : "partial";
};

/**
 * THE ROSTER — AND THE LEAGUE'S OWN COUNT BEATS THE FLAG.
 *
 * A roster is whole where somebody is named and neither flag is set; a fragment
 * where somebody is named and either is; and gone where nobody survives, which
 * is no session today. 28 + 3 + 0 is 31.
 *
 * `rosterPartial` IS SET AT THE BOUNDARY AND NEVER RE-EVALUATED. It means one
 * of these names came off a league-wide ranking rather than a team sheet, which
 * is the right test the moment a session is parsed and the wrong answer once a
 * roster arrives from somewhere else: 2020 - Winter carried the flag for a
 * single goaltender lifted out of a goalie table, and the captain's email later
 * filled the other eighteen. Nineteen men, against a published breakdown of
 * fifteen rostered, three taxi squad and one on injured reserve — the archive
 * can enumerate every man the league counted, and the chart was telling the men
 * on that roster it was missing some of them.
 *
 * So where a league published its own count of the team, that count decides.
 * Nothing is typed: `rosterStatus` is the league's figure, carried in
 * `site.json` for the one session that states one, and a session whose named men
 * reach it is complete however its names were recovered.
 */
const publishedRoster = (roll: SessionRollup): number | null => {
  const status = sessions.find((s) => s.sort === roll.sort)?.rosterStatus;
  return status && status.length > 0 ? status.reduce((total, row) => total + row.n, 0) : null;
};

const rosterState = (roll: SessionRollup): CoverageState => {
  if (roll.people === 0) return "none";
  const published = publishedRoster(roll);
  if (published !== null && roll.people >= published) return "full";
  return roll.rosterPartial || roll.rosterLost ? "partial" : "full";
};

/**
 * The same answer, for the Season index rail fifteen thousand pixels below.
 *
 * The rail prints "roster incomplete" and the chart prints a mark, and until
 * both read this they were two readings of one flag: the chart could be taught
 * that 2020 - Winter is whole and the rail would go on calling it a fragment on
 * the same page. One predicate, two surfaces, whichever way it is corrected next.
 */
const ROSTER_STATE: ReadonlyMap<number, CoverageState> = new Map(
  ROLLUPS.map((roll) => [roll.sort, rosterState(roll)]),
);

export const rosterStateAt = (sort: number): CoverageState | null =>
  ROSTER_STATE.get(sort) ?? null;

/**
 * STATISTICS, WHICH IS WIDER THAN SCORING AND HAS TO BE.
 *
 * The row this replaces counted skater points and was labelled with the wider
 * word, so it printed "none for 2019 - Summer · 2020 - Winter" about two
 * sessions this same site prints a final standings row and a goaltender's
 * season for. A false "none" is the one claim this archive cannot survive
 * making: its whole argument is the difference between a season nobody kept and
 * a season nobody played.
 *
 * So the test is a line-by-line one and a session is only dark when it holds no
 * scoring line, no standings row and no goaltender. Where the scoring alone is
 * missing the cell is a fragment — which is what those two sessions are, and
 * what the career arcs say about them in their own narrower word: no scoring on
 * file.
 *
 * COMPLETE MEANS EVERY COLUMN, NOT THE POINTS COLUMN. The test was `pts` alone,
 * so 2016 - Summer — thirteen skater lines carrying games, goals, assists and
 * points, and a penalty-minutes column that is thirteen nulls — was the chart's
 * strongest mark on a session whose own page prints fifteen em dashes one click
 * away. It is the only session on file where a whole statistical column is
 * missing and the rest survives, and it is exactly the cell a reader checks.
 *
 * A goaltender's row is excluded from the scoring test because his columns are
 * the platform's rather than the man's, the same refusal `savesOf` and the
 * franchise board already make.
 */
const STAT_COLUMNS = ["gp", "g", "a", "pts", "pim"] as const;
const statLines = (roll: SessionRollup) =>
  players.flatMap((p) => p.seasons.filter((s) => s.session === roll.id && s.kind !== "goalie"));

const hasTeamRecord = (roll: SessionRollup) =>
  sessions.find((s) => s.sort === roll.sort)?.record != null;

const hasGoalie = (roll: SessionRollup) =>
  players.some((p) => p.seasons.some((s) => s.session === roll.id && s.kind === "goalie"));

const statState = (roll: SessionRollup): CoverageState => {
  const lines = statLines(roll);
  const whole = (key: (typeof STAT_COLUMNS)[number]) => lines.every((line) => line[key] !== null);
  if (lines.length > 0 && STAT_COLUMNS.every(whole)) return "full";
  if (lines.some((line) => line.pts !== null)) return "partial";
  return hasTeamRecord(roll) || hasGoalie(roll) ? "partial" : "none";
};

/**
 * The chart's columns: `SPINE`, which is every half-year from the first session
 * on file to the last whether or not anything survived it, PLUS the three
 * four-day tournaments that sort between halves. Anything counting half-years
 * off this has to skip the ones carrying `tournament` — which is what
 * `axisTicks` exists for.
 *
 * The empty halves are drawn. A chart of what the archive holds that quietly
 * omitted the two half-years nobody has would be the same site that lists only
 * what it has and decides the rest never happened — and the difference between
 * "searched for, not found" and "confirmed not played" is the archive's whole
 * argument, so each carries its own words.
 */
export const COVERAGE: readonly CoverageColumn[] = SPINE.map((slot) => {
  if (slot.kind !== "session") {
    return {
      sort: slot.sort,
      label: slot.label,
      tournament: null,
      states: null,
      words: GAP_WORDS[slot.gap.status],
    };
  }
  return {
    sort: slot.sort,
    label: slot.label,
    tournament: slot.roll.tournament,
    states: {
      log: logState(slot.sort),
      sheets: sheetState(slot.sort),
      roster: rosterState(slot.roll),
      stats: statState(slot.roll),
    },
    words: null,
  };
});

/** Sessions complete in each dimension, out of the sessions on file. The one
 *  figure the chart cannot be read for: a column of marks per session does not
 *  add itself up. */
export const COVERAGE_COMPLETE: Readonly<Record<CoverageKey, number>> = (() => {
  const out = { log: 0, sheets: 0, roster: 0, stats: 0 };
  for (const column of COVERAGE) {
    if (column.states === null) continue;
    for (const row of COVERAGE_ROWS) if (column.states[row.key] === "full") out[row.key]++;
  }
  return out;
})();

/** The half-years with no session at all, in the archive's own words. */
export const COVERAGE_ABSENT: readonly { label: string; words: string }[] = COVERAGE.flatMap(
  (column) => (column.words === null ? [] : [{ label: column.label, words: column.words }]),
);

export const SCOPE = {
  sessions: sessions.length,

  /** Who set up whom — goal events, so it needs the sheet, not the score. The
   *  player pages are scoped by this and take the same labelled row through
   *  `ScopeNote`. */
  assists: {
    covered: assistScope.count,
    missing: assistScope.missingCount,
  },
} as const;

/* The six mono rows are gone with the box that set them. They were the whole
   statement of coverage in prose — "25 of 31 complete · a fragment in 2016 -
   Winter · 2018 - Summer · …" — and naming seven seasons inside one
   middot-separated line is a list a reader parses twice and remembers none of.
   The chart says the same thing by pointing at the seasons themselves, and the
   predicates above are the same predicates, moved. */
