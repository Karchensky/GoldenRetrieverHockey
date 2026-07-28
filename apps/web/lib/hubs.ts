import { data, ourSide, players } from "./data";
import { ROLLUPS, SPINE } from "./stats";

/**
 * The stat hubs: the opponents, the sin bin, first and last.
 *
 * Everything here is derived from `site.json` at build time and nothing is
 * hardcoded, including the labels. The archive grows under this file — a
 * newly recovered session adds columns and rows and changes every total, and
 * nothing below may have to be touched when it does.
 *
 * It is deliberately its own module rather than more of `lib/stats.ts`: that
 * file is the spine, the network and the traces, and these are three views
 * built on top of them.
 */

// ------------------------------------------------------------------
// the name trap
// ------------------------------------------------------------------

/* `ourSide` is in lib/data.ts, beside the corpus it reads. It was defined here,
   where the penalties needed it, and `lib/best-game.ts` counted goal events
   without it — so one file knew which side scored and the other did not. */

/** A slot on the half-year spine, reduced to what a hub needs to draw it.
 *
 *  TWO TESTS, BECAUSE THEY ANSWER TWO QUESTIONS. `noRoster` is what SHADING is
 *  drawn from — nobody at all is on file, so nobody can be drawn — and it is
 *  the same predicate the coverage chart's roster row counts with, so the chart
 *  and the drawing cannot contradict each other. It was `rosterLost`, the
 *  session's own flag, which shaded 2020 - Winter and printed NO ROSTER ON FILE
 *  down a column the chart was naming men in.
 *
 *  On today's corpus nothing on file satisfies it: the captain's inbox filled
 *  the last two hollow sessions, and the only shaded columns left are the two
 *  half-years with no session. `FirstAndLast` reads the columns rather than
 *  typing a phrase, because that key has now gone stale twice.
 *
 *  `rosterLost` is the session's own flag and stays, because the longest-
 *  absence figure needs the wider set: a man cannot be shown to have missed a
 *  session whose team sheet is a fragment either. */
export type HubSlot = {
  sort: number;
  label: string;
  onFile: boolean;
  rosterLost: boolean;
  noRoster: boolean;
  /** The tournament's name where the slot is one, null where it is a league
   *  half. Carried so a hub's axis can take `axisTicks` — a tick is a position
   *  in time and may not land on a four-day event. */
  tournament: string | null;
};

export const HUB_SPINE: readonly HubSlot[] = SPINE.map((slot) => ({
  sort: slot.sort,
  label: slot.label,
  onFile: slot.kind === "session",
  rosterLost: slot.kind === "session" && slot.roll.rosterLost,
  noRoster: slot.kind !== "session" || slot.roll.people === 0,
  tournament: slot.kind === "session" ? slot.roll.tournament : null,
}));

/**
 * Sessions with a real scoresheet behind at least one game.
 *
 * `scheduleOnly` is a game known from a schedule row and nothing else — a
 * score, and not one thing about how it happened. Summer 2018's thirteen games
 * are all of that kind, so the session has games and no sheet, and a penalty or
 * an assist from it could not exist.
 *
 * Lives here rather than in lib/scope.ts because the sin bin is measured
 * against it as well as captioned by it.
 */
export const SHEET_SORTS: readonly number[] = [
  ...new Set(data.games.filter((game) => !game.scheduleOnly).map((game) => game.sessionSort)),
];

/**
 * Sessions the archive holds any game record for at all.
 *
 * The club-by-club ledger is built from games, and the game log starts years
 * after the roster book does — so the sessions it can speak for are these and
 * no others. Derived off the same corpus the ledger is, so a recovered schedule
 * widens both at once.
 */
export const LOG_SORTS: readonly number[] = [
  ...new Set(data.games.map((game) => game.sessionSort)),
];

const SPINE_INDEX: ReadonlyMap<number, number> = new Map(HUB_SPINE.map((slot, i) => [slot.sort, i]));

export const slotIndex = (sort: number): number => SPINE_INDEX.get(sort) ?? -1;

// ------------------------------------------------------------------
// 1. the opponents
// ------------------------------------------------------------------

export type OpponentRow = {
  name: string;
  gp: number;
  w: number;
  l: number;
  t: number;
  /** On the schedule, never played. A postponement is not a loss. */
  unplayed: number;
  gf: number;
  ga: number;
  diff: number;
  playoff: number;
  /** ISO dates of the first and last meeting on file. */
  first: string;
  last: string;
  /** Session sorts this club was met in, oldest first. */
  sorts: number[];
  /** SESSIONS, and the field is named for what it counts. Three of the
   *  thirty-one are four-day tournaments, so a club met once in the 2015
   *  invitational was being credited with a "season" — and the row's own
   *  aria-label already read "sessions" where the visible text read
   *  "seasons". */
  sessions: number;
};

type OpponentDraft = Omit<OpponentRow, "diff" | "sessions" | "sorts"> & { sorts: Set<number> };

export const OPPONENTS: readonly OpponentRow[] = (() => {
  const ledger = new Map<string, OpponentDraft>();

  for (const game of data.games) {
    let row = ledger.get(game.opponent);
    if (!row) {
      row = {
        name: game.opponent,
        gp: 0, w: 0, l: 0, t: 0, unplayed: 0,
        gf: 0, ga: 0, playoff: 0,
        first: game.date, last: game.date,
        sorts: new Set<number>(),
      };
      ledger.set(game.opponent, row);
    }
    row.sorts.add(game.sessionSort);
    if (game.round !== null) row.playoff++;
    if (game.date < row.first) row.first = game.date;
    if (game.date > row.last) row.last = game.date;

    if (game.result === null) {
      row.unplayed++;
      continue;
    }
    row.gp++;
    if (game.result === "W") row.w++;
    else if (game.result === "L") row.l++;
    else row.t++;
    row.gf += game.gf ?? 0;
    row.ga += game.ga ?? 0;
  }

  return [...ledger.values()]
    .map(({ sorts, ...row }) => ({
      ...row,
      diff: row.gf - row.ga,
      sorts: [...sorts].sort((a, b) => a - b),
      sessions: sorts.size,
    }))
    .sort((a, b) => b.gp - a.gp || b.diff - a.diff || a.name.localeCompare(b.name));
})();

export const OPPONENT_SUMMARY = {
  clubs: OPPONENTS.length,
  played: data.gameTotals.played,
  w: data.gameTotals.w,
  l: data.gameTotals.l,
  t: data.gameTotals.t,
  gf: data.gameTotals.gf,
  ga: data.gameTotals.ga,
  /** CLUBS THIS TEAM HAS ACTUALLY SKATED AGAINST, which is not every club on
   *  file: one was met on a schedule and never played. It is the denominator of
   *  the three below, and the four figures are printed as a row that adds up —
   *  so it counts the same clubs they can. */
  clubsPlayed: OPPONENTS.filter((o) => o.gp > 0).length,
  beaten: OPPONENTS.filter((o) => o.w > o.l).length,
  lostTo: OPPONENTS.filter((o) => o.l > o.w).length,
  level: OPPONENTS.filter((o) => o.gp > 0 && o.w === o.l).length,
  onceOnly: OPPONENTS.filter((o) => o.gp === 1).length,
  maxDiff: Math.max(1, ...OPPONENTS.map((o) => Math.abs(o.diff))),
  mostPlayed: OPPONENTS[0] ?? null,
};

/**
 * The window of the spine the game record actually covers.
 *
 * The roster record starts four years before the first surviving scoresheet.
 * Drawing a club's meetings against the whole spine spends half the strip on
 * half-years no schedule was ever kept for.
 */
export const OPPONENT_COLUMNS: readonly HubSlot[] = (() => {
  const sorts = OPPONENTS.flatMap((o) => o.sorts);
  if (sorts.length === 0) return HUB_SPINE;
  const from = Math.max(0, slotIndex(Math.min(...sorts)));
  const to = Math.max(from, slotIndex(Math.max(...sorts)));
  return HUB_SPINE.slice(from, to + 1);
})();

// ------------------------------------------------------------------
// identity, for the rows that name people in prose
// ------------------------------------------------------------------

/**
 * Every form of every name the archive has ever recorded, longest first.
 *
 * A penalty row is a sentence, not a set of fields, and the man's name is
 * inside it. Resolving the NAME first off this map and taking the infraction
 * from what is left is the only approach that survives all three formats on
 * file. Splitting the row positionally instead — first token is a number,
 * second is a first name, third is a surname — silently cuts first names off
 * surnames and files "Kaplewicz Slashing" as an infraction.
 *
 * Longest-first matters: "Brendan Kaplewicz" has to be tried before any
 * shorter form that is inside it. No recorded form is a substring of another
 * that belongs to a different player, so the longest match is the right one.
 */
const ALIAS_TO_NAME: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const player of players) {
    map.set(player.name, player.name);
    for (const alias of player.aliases) map.set(alias, player.name);
    for (const line of player.seasons) map.set(line.recordedAs, player.name);
  }
  return map;
})();

const ALIAS_KEYS: readonly string[] = [...ALIAS_TO_NAME.keys()].sort((a, b) => b.length - a.length);

const SLUG_OF: ReadonlyMap<string, string> = new Map(players.map((p) => [p.name, p.slug]));

// ------------------------------------------------------------------
// 2. the sin bin
// ------------------------------------------------------------------

const SEVERITY = /\((Minor|Major|Misconduct|Match Penalty|Double Minor|10 Min Misconduct|Bench Minor|Game Misconduct|Penalty Shot)\)/i;
const SEVERITY_ONLY = /^(minor|major|misconduct|game misconduct|bench minor|double minor|match penalty|10 min misconduct|penalty shot)$/i;

export type PenaltyRow = {
  who: string;
  slug: string;
  infraction: string;
  severity: string | null;
  period: string;
  sort: number;
  date: string;
};

/**
 * One penalty row parsed into a person and an offence.
 *
 * Two source formats, plus a variant, and all three end up here:
 *   Erie Metro    "Rich Fedele: Roughing - Minor (0:0)"
 *   HarborCenter  "#18 Brett Koeppel Cross-Checking (Minor) 02:00"
 *   either        "Name (served by Name): Slashing - Minor (0:0)"
 *
 * The infraction is kept in the SOURCE'S OWN spelling. Tidying "Cross-Checking"
 * into house style would be the archive deciding what the scorekeeper meant,
 * and the whole point of this record is that it does not.
 */
function readPenalty(detail: string): { who: string; infraction: string; severity: string | null } | null {
  const clean = detail.replace(/\(served by[^)]*\)/i, "");
  const key = ALIAS_KEYS.find((k) => clean.includes(k));
  if (key === undefined) return null;

  const severityMatch = clean.match(SEVERITY) ?? clean.match(/[:\-]\s*(Minor|Major|Misconduct)\s*\(/i);

  // Strip the name, then the leading "#18" or ":" that joined it to the rest.
  let rest = clean.replace(key, "").replace(/^#?\s*\S*\s*/, "");
  // The parenthesised severity and the clock always sit at the end.
  rest = rest.replace(/\(.*$/, "").replace(/\d+:\d+\s*$/, "").trim();
  // Erie separates the infraction from the severity with a spaced hyphen.
  // "Cross-Checking" has no spaces around its hyphen and survives this.
  const head = (rest.split(/\s+-\s+/)[0] ?? "").trim();

  return {
    who: ALIAS_TO_NAME.get(key) ?? key,
    infraction: head === "" || SEVERITY_ONLY.test(head) ? "Unspecified" : head,
    severity: severityMatch?.[1] ?? null,
  };
}

/** "Cross-Checking" and "Cross Checking" are one offence, however written. */
const infractionKey = (name: string): string => name.toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();

export type SinBinPlayer = {
  name: string;
  slug: string;
  n: number;
  /**
   * Penalty minutes off the season tables, OVER THE SAME SESSIONS THE COUNT
   * COVERS.
   *
   * It used to be the whole career, so a row printed 79 penalties beside 256
   * minutes: two figures measured over two different halves of the archive,
   * under a caveat that named only the smaller span. Seventy-nine penalties of
   * which seventy-four are minors cannot reach 256 minutes, and a reader
   * checking his own row against his own memory got arithmetic that will not
   * reconcile. The minutes are a different source from the rows — they always
   * were, and the two still need not agree exactly — but they are now a
   * statement about the same seasons.
   */
  pim: number | null;
  mix: { infraction: string; n: number }[];
};

export const SIN_BIN = (() => {
  const rows: PenaltyRow[] = [];
  let unparsed = 0;

  for (const game of data.games) {
    const us = ourSide(game);
    for (const penalty of game.penalties) {
      if (penalty.team !== us) continue;
      const read = readPenalty(penalty.detail);
      if (read === null) {
        unparsed++;
        continue;
      }
      rows.push({
        who: read.who,
        slug: SLUG_OF.get(read.who) ?? "",
        infraction: read.infraction,
        severity: read.severity,
        period: penalty.period,
        sort: game.sessionSort,
        date: game.date,
      });
    }
  }

  const count = <T>(items: readonly T[], key: (item: T) => string) => {
    const out = new Map<string, number>();
    for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
    return out;
  };

  // Group offences case-insensitively; print the spelling the sheets use most.
  const spellings = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const k = infractionKey(row.infraction);
    const forms = spellings.get(k) ?? new Map<string, number>();
    forms.set(row.infraction, (forms.get(row.infraction) ?? 0) + 1);
    spellings.set(k, forms);
  }
  const canonical = new Map<string, string>();
  for (const [k, forms] of spellings) {
    canonical.set(k, [...forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]);
  }
  const nameOf = (raw: string): string => canonical.get(infractionKey(raw)) ?? raw;

  const byInfraction = count(rows, (r) => nameOf(r.infraction));
  const byPeriod = count(rows, (r) => r.period);
  const bySeverity = count(rows, (r) => r.severity ?? "Unrecorded");

  const perPlayer = new Map<string, PenaltyRow[]>();
  for (const row of rows) perPlayer.set(row.who, [...(perPlayer.get(row.who) ?? []), row]);

  const sheetSorts = new Set(SHEET_SORTS);
  const sortOfSession = new Map(data.sessions.map((session) => [session.id, session.sort]));
  const scopedPim = new Map(
    players.map((p) => [
      p.name,
      p.seasons
        .filter((line) => sheetSorts.has(sortOfSession.get(line.session) ?? Number.NaN))
        .reduce<number | null>((total, line) => (line.pim === null ? total : (total ?? 0) + line.pim), null),
    ]),
  );

  const people: SinBinPlayer[] = [...perPlayer]
    .map(([name, own]) => ({
      name,
      slug: SLUG_OF.get(name) ?? "",
      n: own.length,
      pim: scopedPim.get(name) ?? null,
      mix: [...count(own, (r) => nameOf(r.infraction))]
        .map(([infraction, n]) => ({ infraction, n }))
        .sort((a, b) => b.n - a.n || a.infraction.localeCompare(b.infraction)),
    }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const minors = bySeverity.get("Minor") ?? 0;

  return {
    rows: rows.length,
    unparsed,
    people,
    infractions: [...byInfraction]
      .map(([infraction, n]) => ({ infraction, n }))
      .sort((a, b) => b.n - a.n || a.infraction.localeCompare(b.infraction)),
    periods: [...byPeriod]
      .map(([period, n]) => ({ period, n }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    severities: [...bySeverity]
      .map(([severity, n]) => ({ severity, n }))
      .sort((a, b) => b.n - a.n),
    minors,
    beyondMinor: rows.length - minors,
    majors: bySeverity.get("Major") ?? 0,
  };
})();

// ------------------------------------------------------------------
// 3. first and last
// ------------------------------------------------------------------

export type SpanRow = {
  name: string;
  slug: string;
  jersey: string | null;
  sessions: number;
  first: number;
  last: number;
  /** Every session sort he is named in, oldest first. */
  sorts: number[];
  /** Named in the newest session on file. */
  current: boolean;
};

const SORT_OF_SESSION: ReadonlyMap<string, number> = new Map(data.sessions.map((s) => [s.id, s.sort]));

/**
 * THE SESSION A MAN IS STILL PLAYING IN — the newest LEAGUE HALF, and never
 * simply the newest thing on the spine.
 *
 * A tournament is a session and sorts as one, a quarter-step past the half it
 * was played in. So the day a four-day invitational lands last on file, "named
 * in the newest session" would mean "entered a four-day event" — eleven or
 * twelve men out of a squad of eighteen — and every regular who did not enter
 * would read as gone from a club he is still playing for. The three
 * invitationals on file carry 11, 12 and 12 names against halves of 15 to 28.
 *
 * The floor is therefore the newest half, and anything at or past it counts,
 * tournaments included: a man who played the current half and then the
 * invitational after it is plainly still here. Same reasoning and the same
 * shape as `RECENT_FROM` in lib/stats.ts, which draws the timelines' opening
 * grid. On today's corpus the newest session IS a half, so the two definitions
 * name the same eighteen men; this one goes on naming them when it is not.
 */
const CURRENT_FROM: number = (() => {
  const halves = ROLLUPS.filter((roll) => roll.tournament === null);
  const spine = halves.length > 0 ? halves : ROLLUPS;
  return spine.at(-1)?.sort ?? Number.NaN;
})();

const CURRENT_LABEL: string = ROLLUPS.find((roll) => roll.sort === CURRENT_FROM)?.label ?? "";

/**
 * The archive's own order: by arrival, then by how long the man lasted.
 *
 * It is the order the rows are drawn in below the men still playing, and it is
 * also the order the longest-absence tie is named in — so that figure does not
 * change its wording because the chart above it was re-sorted.
 */
const BY_ARRIVAL = (a: SpanRow, b: SpanRow): number =>
  a.first - b.first || b.last - a.last || b.sessions - a.sessions || a.name.localeCompare(b.name);

/**
 * WHO IS STILL PLAYING, FIRST, LONGEST TENURE DOWN.
 *
 * The chart used to open on 2011 and run to the end, so the eighteen men a
 * reader might actually recognise were scattered through seventy-nine rows in
 * order of when they arrived. The men still on the ice lead it now, deepest
 * tenure first; everybody else keeps the arrival order behind them, which is
 * what makes the lower two thirds read as a history rather than a list.
 */
export const SPANS: readonly SpanRow[] = players
  .flatMap((player) => {
    const sorts = [...new Set(
      player.seasons.flatMap((line) => {
        const sort = SORT_OF_SESSION.get(line.session);
        return sort === undefined ? [] : [sort];
      }),
    )].sort((a, b) => a - b);
    const first = sorts[0];
    const last = sorts.at(-1);
    if (first === undefined || last === undefined) return [];
    return [{
      name: player.name,
      slug: player.slug,
      jersey: player.jerseys[0] ?? null,
      sessions: player.career.sessions,
      first,
      last,
      sorts,
      current: last >= CURRENT_FROM,
    }];
  })
  .sort(BY_ARRIVAL)
  /* Then the men still playing are lifted to the front, deepest tenure first.
     A second pass rather than one compound comparator, because `sort` is
     stable: everybody who is not current compares equal here and keeps the
     order the pass above put them in. */
  .sort((a, b) =>
    Number(b.current) - Number(a.current) ||
    (a.current && b.current
      ? b.sessions - a.sessions || a.first - b.first || a.name.localeCompare(b.name)
      : 0),
  );

export const SPAN_SUMMARY = (() => {
  const firstOnFile = SPANS.length > 0 ? Math.min(...SPANS.map((s) => s.first)) : Number.NaN;
  const fromTheStart = SPANS.filter((s) => s.first === firstOnFile);

  const onFile = HUB_SPINE.filter((s) => s.onFile);

  /**
   * The longest gap between two appearances, IN SESSIONS HE COULD BE SHOWN
   * ABSENT FROM.
   *
   * It was `(last − first) / 0.5 − 1`, raw calendar halves, and two of the nine
   * it reported for Anthony Galante were Summer 2017, whose record has never
   * been found, and Summer 2020, which the archive confirms twice over was not
   * played. Counting spine rows instead fixed those two and left the other half
   * of the same defect standing: of the seven it then reported, two were
   * sessions whose team sheets had not survived — 2019 - Summer with nobody on
   * it at all and 2020 - Winter with a single goaltender. Both have since come
   * out of the captain's inbox, so `rosterLost` is set nowhere today and the
   * skip below is inert. It stays for the next hollow season, not for these.
   *
   * A man cannot be shown to have missed a season whose team sheet is gone, and
   * this figure names him. Sessions flagged `rosterLost` are skipped the way
   * the empty halves already are — the count is over the sessions where a
   * roster survives to be absent from, which is the same set the section's
   * scope line describes.
   *
   * AND A FOUR-DAY TOURNAMENT IS NOT AN ABSENCE, which is the same ruling
   * `CURRENT_FROM` twelve lines above already makes and this figure was
   * contradicting inside one row of four tiles. Missing an invitational was
   * being read as gone here and expressly not gone there. The three on file
   * carry 11, 12 and 12 entrants against halves of 15 to 28, so most of the
   * squad "missed" each of them; Alex Suffoletto's record of five was two
   * seasons and two weekends, and he skipped three halves in a row. Over the
   * halves the record is three and it is shared — which is why ties are named.
   */
  const countable = onFile
    .filter((slot) => !slot.rosterLost && slot.tournament === null)
    .map((slot) => slot.sort);
  /* Counted BETWEEN two sorts rather than off an index, so a man who appears in
     a session that is itself skipped still has his other gaps measured. Corey
     Muff was the one name on the 2020 - Winter sheet when that skip had a
     session to skip. */
  const missedBetween = (from: number, to: number): number =>
    countable.filter((sort) => sort > from && sort < to).length;

  /* TIES ARE NAMED, NOT BROKEN. `missed > longest.n` handed the record to
     whichever sorted first, which is by first appearance and has nothing to do
     with the record — the archive stating a shared fact about one man more
     confidently than the data supports. Everyone who reaches the longest
     absence is named. Whether that is one man or four is a question for the
     corpus and not for this comment: the four rosters that arrived from the
     captain's inbox closed two of the ties this note used to list. */
  let longestN = 0;
  const longestWho: { name: string; slug: string }[] = [];
  /* IN THE ARCHIVE'S OWN ORDER, not the chart's. `SPANS` now opens on the men
     still playing, and reading the tie off it would have this figure's wording
     change because a chart above it was re-sorted. */
  for (const span of [...SPANS].sort(BY_ARRIVAL)) {
    let worst = 0;
    for (let i = 1; i < span.sorts.length; i++) {
      worst = Math.max(worst, missedBetween(span.sorts[i - 1]!, span.sorts[i]!));
    }
    if (worst === 0) continue;
    if (worst > longestN) {
      longestN = worst;
      longestWho.length = 0;
    }
    if (worst === longestN) longestWho.push({ name: span.name, slug: span.slug });
  }
  const longest = longestN > 0
    ? { n: longestN, name: longestWho.map((w) => w.name).join(", "), slug: longestWho[0]!.slug, who: longestWho }
    : null;

  /* THE DEEPEST TENURE ON FILE, and ties are named rather than broken — the
     same rule the absence figure below it has always obeyed. Counted in
     SESSIONS, which is the unit the archive counts its own length in. */
  const deepest = Math.max(0, ...SPANS.map((s) => s.sessions));
  const tenured = [...SPANS].sort(BY_ARRIVAL).filter((s) => s.sessions === deepest);
  const longestTenure = deepest > 0 && tenured.length > 0
    ? { n: deepest, name: tenured.map((s) => s.name).join(", "), slug: tenured[0]!.slug }
    : null;

  return {
    people: SPANS.length,
    onceOnly: SPANS.filter((s) => s.sessions === 1).length,
    /** Men with five or more sessions on file — the club's regulars, against a
     *  roster book where close to half the names appear exactly once. Five is
     *  the captain's threshold, not a derived one. */
    regulars: SPANS.filter((s) => s.sessions >= 5).length,
    stillHere: SPANS.filter((s) => s.current).length,
    fromTheStart: fromTheStart.length,
    bothEnds: fromTheStart.filter((s) => s.current).length,
    longestTenure,
    longestAbsence: longest,
    firstLabel: onFile[0]?.label ?? "",
    lastLabel: onFile.at(-1)?.label ?? "",
    /** The session a man counts as still playing in — see `CURRENT_FROM`. */
    currentLabel: CURRENT_LABEL,
  };
})();
