import type { GameSheet } from "../../parse/src/sportngin/game-sheet.ts";
import type { TeamSchedule, DaySchedule } from "../../parse/src/sportngin/game-schedule.ts";
import type { Boxscore } from "../../parse/src/digitalshift/boxscore.ts";
import type { ScheduleRow } from "../../capture/src/sources/digitalshift.ts";
import type { RecentGames } from "../../parse/src/sportngin/recent-games.ts";
import { parseRecentScore } from "../../parse/src/sportngin/recent-games.ts";
import type { RecapFixture } from "../../parse/src/ownsite/game-recaps.ts";
import type { SchedulePage } from "../../parse/src/ownsite/schedule-page.ts";
import { resolveSession, parseSessionLabel, sessionLabel } from "./sessions.ts";
import type { Game, GameTotals, Provenance } from "./types.ts";

/**
 * Assemble the game record from scoresheets, schedules and boxscores.
 *
 * What is actually here, having gone and looked:
 *
 * - **59 Golden Retrievers scoresheets**, Erie Metro, 2016-17 and 2017-18.
 *   Every one carries a date. The team's own season schedules list 30 and 29
 *   games; all 59 have a sheet, so these two seasons are COMPLETE and can be
 *   said to be complete, which is rarer here than it sounds.
 * - **193 HarborCenter games**, eleven sessions, Summer 2021 to Summer 2026 —
 *   the whole HockeyShift era, and until the `schedule/table` route was found
 *   the archive held not one of them. 189 have been played and every one of
 *   those has a boxscore. This is where the assist network went from two
 *   sessions of eighteen to thirteen.
 * - **13 Summer 2018 results** that exist only as rows on a league day
 *   schedule. No sheets, no roster, no session anywhere else in the archive.
 * - **1 game that never happened**: 10 April 2020, postponed. Plus four
 *   Summer 2026 fixtures not yet skated, which are a different kind of
 *   nothing and are not called a result either.
 * - **65 sheets were captured, not 59.** Six are a youth league's, swept in
 *   by a crawl. They are not this team's games and are not counted as them.
 *
 * THESE LEAGUES STOP WRITING DOWN GOALS IN THE PLAYOFFS. 24 of the 26 games
 * that have a score and no goal-by-goal record are playoff games, and it holds
 * across both platforms, both leagues and a decade: all 9 of Erie Metro's and
 * 15 of HAHL's 18. Not a capture failure and not a parse failure — the sheets
 * were served exactly as stored, and this is what is in them.
 *
 * Thirteen of eighteen sessions have games. The other five have none at all,
 * and the site draws that as the hole it is.
 */

const IS_GR = (t: string | undefined) => /^(the )?golden retrievers$/i.test((t ?? "").trim());

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * "Sep 19, 2016" -> {y,m,d}.
 *
 * The sheets ABBREVIATE the month ("Sep 19, 2016"). This reader also returns
 * the DAY, which `sessions.parseGameDate` does not — that one answers "which
 * half-year is this?" and stops at {year, month}. Both read abbreviations now;
 * `parseGameDate` did not when this was written, which is why the note here
 * used to say it was the reason this function exists.
 */
export function parseSheetDate(s: string): { y: number; m: number; d: number } | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const i = MONTHS.findIndex((x) => x === name || x.slice(0, 3) === name);
  if (i === -1) return null;
  return { y: Number(m[3]), m: i + 1, d: Number(m[2]) };
}

/** "5/17/2018" -> {y,m,d}. The day schedules carry the date in the title only. */
export function parseSlashDate(s: string): { y: number; m: number; d: number } | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) };
}

/** ISO, for sorting and for `<time datetime>`. Never a Date: no timezones. */
export const iso = (d: { y: number; m: number; d: number }) =>
  `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * The weekday of a calendar date — Sakamoto's method, no `Date`.
 *
 * Arithmetic rather than a Date object for the same reason `iso` is: a Date is
 * a moment in a timezone and these are calendar days off a printed page. It
 * exists for ONE job, and it is the reason `schedule.html` can be trusted:
 * that page writes the weekday of every fixture and no year at all, so the
 * derived year is checkable fifteen times over against the club's own words.
 */
export function weekdayOf(d: { y: number; m: number; d: number }): string {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = d.m < 3 ? d.y - 1 : d.y;
  const i =
    (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[d.m - 1]! + d.d) % 7;
  return WEEKDAYS[i]!;
}

/**
 * The session a date falls in, when the source names no session of its own.
 *
 * This is the Erie Metro case: a sheet's league header says only "Erie Metro
 * Hockey League , Regular Season", so the date is the only evidence there is.
 * It works — the two seasons fall cleanly either side of a summer.
 */
function sessionOfDate(d: { y: number; m: number; d: number }) {
  const full = `${MONTHS[d.m - 1]![0]!.toUpperCase()}${MONTHS[d.m - 1]!.slice(1)} ${d.d}, ${d.y}`;
  const r = resolveSession("", full);
  return r ? { sort: r.sort, label: sessionLabel(r) } : null;
}

/**
 * The session a LEAGUE-LABELLED game belongs to. The label wins here.
 *
 * `resolveSession` gives the date priority, on the sound general rule that
 * labels lie. This is the case where it is the rule that lies. HAHL's session
 * is called "2018 Spring/Summer" and its first three games are 10, 17 and 24
 * May; the summer boundary in `sessions` is June, so the date test files those
 * three under "2017-18" — an Erie Metro season, in a different league, that
 * had already finished on 15 April. Spring is in the name. The league is
 * telling us which session its own game belongs to, and it is not guessing.
 *
 * Falls back to the date when the label says nothing usable.
 */
function sessionOfLabel(label: string, d: { y: number; m: number; d: number }) {
  const r = parseSessionLabel(label);
  return r ? { sort: r.sort, label: sessionLabel(r) } : sessionOfDate(d);
}

const num = (x: string | null | undefined): number | null => {
  if (x === undefined || x === null || x.trim() === "") return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

/**
 * One HarborCenter session's schedule, with the session it belongs to.
 *
 * `session` comes from the TEAM PARTIAL'S OWN HEADER — "Golden Retrievers,
 * Summer 2021, Silver" — and not from the games' dates. That is a deliberate
 * departure from the Erie Metro path above, and it is not a shortcut.
 *
 * HAHL PLAYS ITS SUMMER FROM MAY TO SEPTEMBER. `halfFromMonth` calls June to
 * August summer and everything else fall/winter, which is right for the league
 * that rule was written for and wrong for this one. Deriving these sessions
 * from dates splits FIVE of the eleven: Summer 2021 opens on 19 May and would
 * file its first two games under a "2020-21" session that has never existed,
 * Summer 2025 closes on 5 September and would lose its last game to 2025-26,
 * and twelve summer games in all would land in a fall/winter season. That is
 * the exact fault — "forged duplicate sessions, each holding half the
 * evidence" — that generate.ts already carries scar tissue for.
 *
 * We asked the API for team 121839's schedule and the league answered with
 * team 121839's games; team 121839's own page says it is Summer 2021. The
 * league is not inferring which session its games belong to, and neither
 * should we. Same reasoning as `sessionOfLabel` below, which exists because
 * HAHL calls another session "2018 Spring/Summer" and plays it in May.
 */
export type HsSchedule = {
  /** The Retrievers' team id for this session. The join key, and the filter. */
  teamId: number;
  /** Verbatim from the team partial: "Summer 2021", "Fall/Winter 2021-22". */
  session: string;
  source: string;
  rows: ScheduleRow[];
};

export type GameInput = {
  sheets: { url: string; source: string; sheet: GameSheet }[];
  teamSchedules: { url: string; source: string; sched: TeamSchedule }[];
  daySchedules: { url: string; source: string; day: DaySchedule }[];
  /** HarborCenter HockeyShift schedules — the game record for eleven sessions. */
  hsSchedules: HsSchedule[];
  /** Boxscores, joined to the schedules above on `gameId`. */
  boxscores: { gameId: number; source: string; box: Boxscore }[];
  /**
   * The "Recent Games" table off every captured SportsEngine player page.
   * Optional so the existing tests, written before this route existed, keep
   * describing exactly the record they were calibrated against.
   */
  recentGames?: { source: string; page: RecentGames }[];
  /**
   * The club's own written game recaps, ONE ENTRY PER CAPTURE of the page.
   *
   * Per capture, not merged: the page carries no years, so the snapshot's own
   * timestamp is what dates its games (see `datedFixtures`). Merging first
   * would throw away the only clock there is.
   */
  recaps?: { source: string; snap: number; fixtures: RecapFixture[] }[];
  /**
   * The club's own `schedule.html` — a typed fixture list, one entry per
   * capture.
   *
   * Unlike the recap page this one NAMES ITS OWN SEASON in a heading, so no
   * snapshot timestamp is needed to date it and none is carried. See the
   * schedule block in `buildGames`.
   */
  schedules?: { source: string; page: SchedulePage }[];
  /** Session sort -> the league that session was played in, from the captain's
   *  statistics workbook. The recap pages name the club's two leagues in a
   *  masthead printed on every page and never say which one a game was in. */
  leagueBySort?: Map<number, string>;
};

const idOf = (url: string) => url.match(/game_sheet\/(\d+)/)?.[1] ?? null;

/** "February 16" -> {m,d}. The recap pages never write a year. */
export function parseRecapDay(s: string): { m: number; d: number } | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const i = MONTHS.findIndex((x) => x === name || x.slice(0, 3) === name);
  if (i === -1) return null;
  return { m: i + 1, d: Number(m[2]) };
}

type DatedFixture = {
  number: string;
  /** ISO. Derived — see `datedFixtures`. */
  date: string;
  /** The page's own words: "February 16". */
  recorded: string;
  opponent: string;
  grScore: number | null;
  opScore: number | null;
  isPlayoff: boolean;
};

export type RecapBlock = {
  sort: number;
  label: string;
  source: string;
  fixtures: DatedFixture[];
};

/** The session that follows this one in the club's calendar. */
function nextHalf(p: { year: number; half: "summer" | "fall-winter" }) {
  return p.half === "summer"
    ? { year: p.year, half: "fall-winter" as const, sort: p.year + 0.5 }
    : { year: p.year + 1, half: "summer" as const, sort: p.year + 1 };
}

/**
 * Date the club's own game recaps, and split them into the seasons they are.
 *
 * THE PAGE WRITES NO YEARS AND NAMES NO SEASON. "Game 23: February 16 vs. Top
 * Shop" is the whole header. Four captures of it survive, and between them
 * they hold two different seasons' worth of games — so both facts a Game needs
 * have to be derived, and both are derived from the archive's own evidence
 * rather than typed in.
 *
 * **The year comes from the snapshot.** A page captured on 21 February 2013 is
 * showing the season in progress, listed newest first. Walk it downward: the
 * first game's year is the snapshot's when its month has already been reached
 * that year, and the year drops by one every time the month goes UP as you
 * move to an older game. December after January is the previous December. That
 * places all 34 games and is checkable — the oldest lands on 24 September 2012,
 * which is a Monday, and the page's own write-ups say "Monday Night".
 *
 * **The season comes from the numbering restarting.** The club numbers each
 * season's games from one, so a regular-season game whose number does not
 * exceed the last one is the first game of the NEXT session. That happens
 * exactly once here: game 26 on 15 March 2013, then game 1 on 19 April 2013.
 *
 * The playoffs are excluded from that test and it is not a detail. The page
 * numbers them from one as well, so its "Game 1: March 25" — a playoff opener
 * — reads identically to a season opener and would start a season that never
 * happened. `RecapFixture.section` is the only thing that knows, which is why
 * the parser carries it.
 *
 * A DATE ALONE CANNOT DO THIS, and the corpus proves it: the five games of the
 * second block were played 19 April to 8 May 2013, which `halfFromMonth` calls
 * fall/winter — the same session as the first block. They are not. The
 * captain's statistics workbook holds "Summer 2013 | LSHL" with a 16-game
 * regular season while "Winter 2012 / 13 | EMHL" has 26 — and 26 is exactly
 * what the first block holds. Two leagues, two seasons, one page.
 */
export function datedFixtures(
  captures: { source: string; snap: number; fixtures: RecapFixture[] }[],
): RecapBlock[] {
  // ---- 1. the year, off each capture's own timestamp -------------------
  const merged = new Map<string, { f: DatedFixture; source: string }>();
  for (const cap of captures) {
    const stamp = String(cap.snap);
    if (stamp.length < 8) continue;
    const snapYear = Number(stamp.slice(0, 4));
    const snapMonth = Number(stamp.slice(4, 6));
    let year = 0;
    let prevMonth = 0;

    for (const raw of cap.fixtures) {
      const md = parseRecapDay(raw.date);
      if (!md) continue;
      if (year === 0) year = md.m <= snapMonth ? snapYear : snapYear - 1;
      else if (md.m > prevMonth) year -= 1;
      prevMonth = md.m;

      const f: DatedFixture = {
        number: raw.number,
        date: iso({ y: year, m: md.m, d: md.d }),
        recorded: raw.date,
        opponent: raw.opponent,
        grScore: raw.grScore,
        opScore: raw.opScore,
        isPlayoff: raw.isPlayoff,
      };
      const key = `${f.number}|${f.date}|${f.opponent}`;
      const prev = merged.get(key);
      // A later capture that finally printed the score wins; otherwise the
      // first reading stands. Nothing here can turn a score back into a hole.
      if (!prev || (prev.f.grScore === null && f.grScore !== null)) {
        merged.set(key, { f, source: cap.source });
      }
    }
  }

  const all = [...merged.values()].sort(
    (a, b) => a.f.date.localeCompare(b.f.date) || a.f.number.localeCompare(b.f.number),
  );
  if (all.length === 0) return [];

  // ---- 2. the seasons, off the numbering restarting --------------------
  const blocks: { source: string; fixtures: DatedFixture[] }[] = [];
  let last: number | null = null;
  for (const { f, source } of all) {
    const n = !f.isPlayoff && /^\d+$/.test(f.number) ? Number(f.number) : null;
    if (blocks.length === 0 || (n !== null && last !== null && n <= last)) {
      blocks.push({ source, fixtures: [] });
      last = null;
    }
    blocks.at(-1)!.fixtures.push(f);
    if (n !== null) last = n;
  }

  // ---- 3. place the first block by date, the rest by succession --------
  const first = blocks[0]!.fixtures[0]!;
  const [y, m, d] = first.date.split("-").map(Number);
  const start = resolveSession(
    "",
    `${MONTHS[m! - 1]![0]!.toUpperCase()}${MONTHS[m! - 1]!.slice(1)} ${d}, ${y}`,
  );
  if (!start) return [];

  const out: RecapBlock[] = [];
  let at = { year: start.year, half: start.half, sort: start.sort };
  for (const b of blocks) {
    out.push({ sort: at.sort, label: sessionLabel(at), source: b.source, fixtures: b.fixtures });
    at = nextHalf(at);
  }
  return out;
}

export function buildGames(
  input: GameInput,
  prov: (source: string) => Provenance,
): { games: Game[]; totals: GameTotals } {
  // ---- round labels ----------------------------------------------------
  //
  // Only the team's own schedule knows which games were playoffs, and it
  // knows because somebody typed "Semi 1" into a column headed "Game ID".
  // Without this, nine sheets look like data rot rather than a league that
  // stopped recording goals every March.
  const rounds = new Map<string, string>();
  const scheduled = new Set<string>();
  for (const t of input.teamSchedules) {
    if (!IS_GR(t.sched.team ?? "")) continue;
    for (const r of t.sched.rows) {
      scheduled.add(r.gameId);
      if (r.round) rounds.set(r.gameId, r.round);
    }
  }

  const games: Game[] = [];
  const seen = new Set<string>();

  // ---- from scoresheets ------------------------------------------------
  for (const { url, source, sheet } of input.sheets) {
    const id = idOf(url);
    if (!id || seen.has(id)) continue;
    // Six captured sheets are a youth league's, swept in by a Wayback crawl
    // of HarborCenter. Counting them would invent six games.
    if (!IS_GR(sheet.awayTeam) && !IS_GR(sheet.homeTeam)) continue;
    const d = sheet.date ? parseSheetDate(sheet.date) : null;
    if (!d) continue; // a game the archive cannot place in time is not placed
    const s = sessionOfDate(d);
    if (!s) continue;
    seen.add(id);

    const grHome = IS_GR(sheet.homeTeam);
    const gf = num(grHome ? sheet.homeScore : sheet.awayScore);
    const ga = num(grHome ? sheet.awayScore : sheet.homeScore);

    games.push({
      id,
      date: iso(d),
      dateRecorded: sheet.date!,
      time: sheet.time,
      sessionSort: s.sort,
      session: s.label,
      league: "Erie Metro Hockey League",
      round: rounds.get(id) ?? null,
      away: sheet.awayTeam,
      awayScore: num(sheet.awayScore),
      home: sheet.homeTeam,
      homeScore: num(sheet.homeScore),
      gr: grHome ? "home" : "away",
      venueUnknown: false,
      opponent: grHome ? sheet.awayTeam : sheet.homeTeam,
      gf,
      ga,
      result: gf === null || ga === null ? null : gf > ga ? "W" : gf < ga ? "L" : "T",
      status: sheet.status ?? "",
      // The title says "(Final)" on every sheet, overtime ones included. Only
      // the status field can tell you a game went past regulation.
      ot: /ot/i.test(sheet.status ?? ""),
      shootoutWinner: sheet.shootoutWinner,
      rink: sheet.location,
      periodLabels: sheet.periodLabels,
      linescore: sheet.linescore,
      goals: sheet.goals,
      penalties: sheet.penalties,
      goalies: sheet.goalies,
      hasDetail: sheet.hasScoringDetail,
      scheduleOnly: false,
      provenance: prov(source),
    });
  }

  // ---- from day schedules ----------------------------------------------
  //
  // The whole of Summer 2018. There is no sheet and no roster for any of it;
  // the season exists because a crawler happened to catch the league's day
  // pages. A game with a sheet always wins — this only adds what is otherwise
  // nowhere.
  for (const { source, day } of input.daySchedules) {
    const d = day.date ? parseSlashDate(day.date) : null;
    if (!d) continue;
    const s = sessionOfLabel(day.league ?? "", d);
    if (!s) continue;

    for (const r of day.rows) {
      if (!IS_GR(r.awayTeam) && !IS_GR(r.homeTeam)) continue;
      if (seen.has(r.gameId)) continue;
      seen.add(r.gameId);

      const grHome = IS_GR(r.homeTeam);
      const gf = num(grHome ? r.homeScore : r.awayScore);
      const ga = num(grHome ? r.awayScore : r.homeScore);

      games.push({
        id: r.gameId,
        date: iso(d),
        dateRecorded: day.date!,
        time: null,
        sessionSort: s.sort,
        session: s.label,
        league: day.league ?? "",
        round: rounds.get(r.gameId) ?? null,
        away: r.awayTeam,
        awayScore: num(r.awayScore),
        home: r.homeTeam,
        homeScore: num(r.homeScore),
        gr: grHome ? "home" : "away",
        venueUnknown: false,
        opponent: grHome ? r.awayTeam : r.homeTeam,
        gf,
        ga,
        // A postponed game has no result. It is not a loss and not a draw.
        result: gf === null || ga === null ? null : gf > ga ? "W" : gf < ga ? "L" : "T",
        status: r.status || "Final",
        ot: false,
        shootoutWinner: null,
        rink: r.rink || null,
        periodLabels: [],
        linescore: [],
        goals: [],
        penalties: [],
        goalies: [],
        hasDetail: false,
        scheduleOnly: true,
        provenance: prov(source),
      });
    }
  }

  // ---- from HarborCenter schedules + boxscores -------------------------
  //
  // ELEVEN SESSIONS, 2021 to 2026 — the whole HockeyShift era, which until now
  // had no games at all. The schedule row states the fixture (date, teams,
  // score, rink, whether it was a playoff); the boxscore states how it
  // happened (every goal, its ordered assists, its real strength state).
  //
  // NOT ONE STRING IS MATCHED AGAINST A TEAM NAME HERE. The schedule was
  // requested for one team id and answered for that team id, so which side the
  // Retrievers were is an integer comparison, not a spelling. That is the
  // strongest possible form of the rule this repo learned the hard way when
  // substring-matching turned Classic Cue's, Burners and 716 Realty into
  // Retrievers teams.
  const boxByGame = new Map(input.boxscores.map((b) => [b.gameId, b]));
  for (const s of input.hsSchedules) {
    const p = parseSessionLabel(s.session);
    // A session we cannot place would sort itself in front of 1993. Dropped
    // rather than guessed at — same rule as the league tables in generate.ts.
    if (!p) continue;

    for (const r of s.rows) {
      const id = String(r.gameId);
      if (seen.has(id)) continue;
      seen.add(id);

      const grHome = r.homeTeamId === s.teamId;
      const b = boxByGame.get(r.gameId);
      // `homeScore`/`awayScore` are already null for a game that has not been
      // played: the API says 0-0 for those, and a scoreless draw is a result
      // (§2.4). Four Summer 2026 fixtures are in this state right now.
      const gf = grHome ? r.homeScore : r.awayScore;
      const ga = grHome ? r.awayScore : r.homeScore;

      // The shootout winner: a goal on the scoreboard that no player scored.
      // Read from the SO column of the boxscore's own linescore, where the
      // winner's cell reads "1 (2 - 0)" and the loser's "0 (0 - 2)". The
      // schedule row's `shootout` flag says one happened; only this says who
      // won it, and no scorer is invented to make the goals add up.
      let shootoutWinner: string | null = null;
      if (b) {
        const so = b.box.periodLabels.indexOf("SO");
        if (so !== -1) {
          const won = b.box.linescore.find(
            (l) => Number(String(l.periods[so] ?? "").match(/^(\d+)/)?.[1] ?? 0) > 0,
          );
          shootoutWinner = won?.team ?? null;
        }
      }

      games.push({
        id,
        date: r.date,
        dateRecorded: r.date,
        time: r.time,
        sessionSort: p.sort,
        // The team's own page identifies the session; the display label is canonical.
        session: sessionLabel(p),
        league: "Seneca HAHL",
        // The league states this outright, in a field of its own. Contrast the
        // SportsEngine era, where the only witness to a playoff is somebody
        // having typed "Semi 1" into a column headed "Game ID".
        round: r.gameType === "Playoffs" ? "Playoffs" : null,
        away: r.awayTeam,
        awayScore: r.awayScore,
        home: r.homeTeam,
        homeScore: r.homeScore,
        gr: grHome ? "home" : "away",
        venueUnknown: false,
        opponent: grHome ? r.awayTeam : r.homeTeam,
        gf,
        ga,
        result: gf === null || ga === null ? null : gf > ga ? "W" : gf < ga ? "L" : "T",
        status: r.status,
        ot: r.overtime,
        shootoutWinner,
        rink: r.rink,
        periodLabels: b?.box.periodLabels ?? [],
        linescore: b?.box.linescore.map((l) => ({
          team: l.team,
          periods: l.periods,
          final: l.final,
        })) ?? [],
        goals:
          b?.box.goals.map((g) => ({
            period: g.period,
            time: g.time,
            team: g.team,
            scorer: g.scorer.name,
            assists: g.assists.map((a) => a.name),
            strength: g.strength,
          })) ?? [],
        // The boxscore splits a penalty across four columns where the
        // SportsEngine sheet gives one. Recomposed from THIS row's own cells.
        penalties:
          b?.box.penalties.map((x) => ({
            period: x.period,
            time: x.time,
            team: x.team,
            detail: [
              x.player.jersey ? `#${x.player.jersey}` : "",
              x.player.name,
              x.infraction,
              x.length,
            ]
              .filter(Boolean)
              .join(" "),
          })) ?? [],
        // HockeyShift records no goaltender lines on a boxscore at all.
        // Absent is absent (§2.4) — not an empty goalie.
        goalies: [],
        hasDetail: b?.box.hasScoringDetail ?? false,
        // A game we hold a boxscore for is not schedule-only, even when that
        // boxscore turns out to carry no goal detail — seventeen of them do
        // not, and that is a hole in the source, not in our capture.
        scheduleOnly: b === undefined,
        provenance: prov(s.source),
      });
    }
  }

  // ---- from the "Recent Games" table on player pages -------------------
  //
  // FOURTEEN GAMES, ELEVEN OF THEM NOWHERE ELSE IN THE ARCHIVE. They land on
  // 2018-19 and 2019-20 — two sessions that between them held ONE game, from
  // a corpus that already contained these rows.
  //
  // Three things make this route safe, and all three are checked here rather
  // than argued about:
  //
  //   - THE GAME ID. The row links to `game/show/<id>`, the same id space the
  //     scoresheets use, so a game the archive already has is recognised as
  //     the same game and dropped. This block runs LAST for that reason.
  //   - IDENTITY AT BOTH ENDS. A row counts when the PAGE is one of our
  //     players' or when the row's own opponent cell names us. Both are
  //     identity tests on a cell, never a substring of a document — the
  //     Major's and Classic Cue's carry most of this roster and are not this
  //     club, and neither is ever called "Golden Retrievers".
  //   - THE VENUE IS REAL. "at Bandits" says the page team was away. It is
  //     not inferred and not defaulted, and it agrees with all three games
  //     the archive already holds from other routes.
  //
  // The score is printed from the PAGE TEAM's side, so a row off an
  // opponent's page is read backwards — which is the whole reason six of
  // these games are recoverable at all.
  for (const { source, page } of input.recentGames ?? []) {
    const pageIsGr = IS_GR(page.team);
    for (const row of page.rows) {
      if (!row.gameId) continue; // unjoinable: no id is invented for it
      const oppIsGr = IS_GR(row.opponent);
      if (!pageIsGr && !oppIsGr) continue;
      if (seen.has(row.gameId)) continue;

      const d = parseSlashDate(row.date);
      if (!d) continue;
      const s = sessionOfLabel(page.session, d);
      if (!s) continue;
      const sc = parseRecentScore(row.score);
      if (!sc) continue;
      seen.add(row.gameId);

      const [pageScore, otherScore] = sc;
      // Which side WE were: the page team's venue, flipped when the page is
      // the opponent's. No name is matched to decide it — `pageIsGr` already
      // did the identity work.
      const grHome = pageIsGr ? !row.pageTeamAway : row.pageTeamAway;
      const gf = pageIsGr ? pageScore : otherScore;
      const ga = pageIsGr ? otherScore : pageScore;
      const home = row.pageTeamAway ? row.opponent : page.team;
      const away = row.pageTeamAway ? page.team : row.opponent;

      games.push({
        id: row.gameId,
        date: iso(d),
        dateRecorded: row.date,
        time: null,
        sessionSort: s.sort,
        session: s.label,
        league: source === "eriemetro" ? "Erie Metro Hockey League" : "HAHL",
        // The table says nothing about a round. Erie Metro's own schedule
        // does, for the games it covers, and that is the only witness there
        // has ever been to a SportsEngine-era playoff.
        round: rounds.get(row.gameId) ?? null,
        away,
        awayScore: grHome ? ga : gf,
        home,
        homeScore: grHome ? gf : ga,
        gr: grHome ? "home" : "away",
        venueUnknown: false,
        opponent: pageIsGr ? row.opponent : page.team,
        gf,
        ga,
        result: gf > ga ? "W" : gf < ga ? "L" : "T",
        status: "Final",
        ot: false,
        shootoutWinner: null,
        rink: null,
        periodLabels: [],
        linescore: [],
        goals: [],
        penalties: [],
        goalies: [],
        hasDetail: false,
        scheduleOnly: true,
        provenance: prov(source),
      });
    }
  }

  // ---- from the club's own game recaps ----------------------------------
  //
  // THE ARCHIVE'S FIRST GAMES. Everything above this line is 2016 or later;
  // these are 2012 and 2013, off goldenretrieverhockey.com, and they are the
  // only game-by-game record that survives from the club's first five years.
  //
  // What the page gives and what it does not:
  //   - date, opponent, both scores, and a numbered sequence — all real.
  //   - NO YEAR. `datedFixtures` gets that from the snapshot's own timestamp.
  //   - NO VENUE, ever. It writes "vs." for all thirty-four games, home and
  //     away alike, so the word is not evidence. `venueUnknown` is what these
  //     games carry instead of a guess.
  for (const block of datedFixtures(input.recaps ?? [])) {
    for (const f of block.fixtures) {
      const id = `tgr-${f.date}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const gf = f.grScore;
      const ga = f.opScore;
      const scored = gf !== null && ga !== null;

      games.push({
        id,
        date: f.date,
        // The page's own words, which carry no year: "February 16".
        dateRecorded: f.recorded,
        time: null,
        sessionSort: block.sort,
        session: block.label,
        league: input.leagueBySort?.get(block.sort) ?? "",
        round: f.isPlayoff ? (/^\d+$/.test(f.number) ? "Playoffs" : f.number) : null,
        // THE SLOT PAIR, NOT A VENUE. See `Game.venueUnknown`: the club goes
        // in the slot its own `gr` names, so the pointer every other reader
        // tests on and the cell it points at can never come apart.
        away: f.opponent,
        awayScore: ga,
        home: "Golden Retrievers",
        homeScore: gf,
        gr: "home",
        venueUnknown: true,
        opponent: f.opponent,
        gf,
        ga,
        result: !scored ? null : gf! > ga! ? "W" : gf! < ga! ? "L" : "T",
        // "Played, and nobody wrote the score down" is not "postponed" and is
        // not "not started". Two games are in this state and both are known
        // to have happened — see GameTotals.scoreUnrecorded.
        status: scored ? "Final" : "Score not recorded",
        ot: false,
        shootoutWinner: null,
        rink: null,
        periodLabels: [],
        linescore: [],
        goals: [],
        penalties: [],
        goalies: [],
        hasDetail: false,
        scheduleOnly: true,
        provenance: prov(block.source),
      });
    }
  }

  // ---- from the club's own typed schedule -------------------------------
  //
  // THE ONLY GAME RECORD 2014-15 HAS. One Wayback capture of `schedule.html`,
  // fifteen fixtures of a season the archive otherwise holds zero games of.
  //
  // Three things this page states that the recap page does not, and one it
  // states the same way:
  //
  //   - ITS OWN SEASON, in a heading: "2014 / 2015 EMHL Season". `sessions.ts`
  //     reads that heading directly, so the session is the page's own word
  //     rather than an inference off a snapshot timestamp.
  //   - THE WEEKDAY of every fixture. That is what makes the derived year
  //     checkable: the heading gives the season, the month gives the half, and
  //     each of the fifteen weekdays then agrees or does not. All fifteen agree
  //     with calendar 2014 and none with 2015. A fixture whose weekday
  //     disagrees with its derived date is DROPPED — the archive does not
  //     publish a game it cannot date, and two witnesses that disagree are not
  //     a date.
  //   - THE SCORE'S ORIENTATION, via its own W/L labels. Winner first; see
  //     `ScheduleFixture.gf`, where the reading is derived and refused.
  //   - NO VENUE, ever — `vs.` on all fifteen, home and away alike, exactly as
  //     the recap page. `venueUnknown` again, and for the same reason.
  //
  // A fixture with neither score nor result is not "not played": this capture
  // is from 26 February 2015 and the four bare rows are dated December 2014,
  // so the page went stale rather than ahead of itself. They carry
  // `Score not recorded`, which is the archive's word for a game whose result
  // nobody wrote down, and never `unplayed`.
  for (const { source, page } of input.schedules ?? []) {
    const p = parseSessionLabel(page.heading);
    // A heading `sessions.ts` cannot place would file its games in front of
    // 1993. Same rule as every other route: not placed rather than guessed.
    if (!p) continue;

    for (const f of page.fixtures) {
      // A fall/winter season spans two calendar years and its `year` is the
      // first, so September to December belongs to it and January to May to
      // the year after. The exact inverse of `resolveSession`'s rule, and
      // checked against the page's own weekday immediately below.
      const y = p.half === "summer" ? p.year : f.month >= 6 ? p.year : p.year + 1;
      const d = { y, m: f.month, d: f.day };
      if (weekdayOf(d).toLowerCase() !== f.weekday.toLowerCase()) continue;

      const id = `tgr-${iso(d)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const scored = f.gf !== null && f.ga !== null;
      const isPlayoff = /playoff|championship|semi/i.test(f.section ?? "");

      games.push({
        id,
        date: iso(d),
        // The page's own words, which carry no year: "September 17".
        dateRecorded: f.recorded,
        time: f.time,
        sessionSort: p.sort,
        session: sessionLabel(p),
        // The workbook names the league of every session it holds; the
        // heading names one too. They agree here, and the workbook is the
        // source the recap route already reads, so it leads.
        league: input.leagueBySort?.get(p.sort) ?? page.league ?? "",
        round: isPlayoff ? (/^\d+$/.test(f.number) ? "Playoffs" : f.number) : null,
        // THE SLOT PAIR, NOT A VENUE — see `Game.venueUnknown` and the recap
        // block above. The club takes the slot its own `gr` names so the two
        // can never come apart.
        away: f.opponent,
        awayScore: f.ga,
        home: "Golden Retrievers",
        homeScore: f.gf,
        gr: "home",
        venueUnknown: true,
        opponent: f.opponent,
        gf: f.gf,
        ga: f.ga,
        // THE PAGE'S OWN LABEL, not a comparison of the scores. Game 8 reads
        // "(W)" and prints no score at all: the club recorded that it won and
        // did not record by how much, and both halves of that are facts.
        result: f.result,
        status: scored ? "Final" : "Score not recorded",
        ot: false,
        shootoutWinner: null,
        rink: null,
        periodLabels: [],
        linescore: [],
        goals: [],
        penalties: [],
        goalies: [],
        hasDetail: false,
        scheduleOnly: true,
        provenance: prov(source),
      });
    }
  }

  games.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // ---- totals ----------------------------------------------------------
  const played = games.filter((g) => g.result !== null);
  const sum = (f: (g: Game) => number | null) =>
    played.reduce((n, g) => n + (f(g) ?? 0), 0);

  const totals: GameTotals = {
    games: games.length,
    played: played.length,
    unplayed: games.length - played.length,
    /** Played, and the score never written down. Read off the status the
     *  recap route sets, so nothing has to guess which hole this is. */
    scoreUnrecorded: games.filter((g) => g.status === "Score not recorded").length,
    withSheet: games.filter((g) => !g.scheduleOnly).length,
    scheduleOnly: games.filter((g) => g.scheduleOnly).length,
    w: played.filter((g) => g.result === "W").length,
    l: played.filter((g) => g.result === "L").length,
    t: played.filter((g) => g.result === "T").length,
    gf: sum((g) => g.gf),
    ga: sum((g) => g.ga),
    /** GR goal EVENTS on file — fewer than goals SCORED, and that is the point. */
    goalsRecorded: games.reduce((n, g) => n + g.goals.filter((x) => IS_GR(x.team)).length, 0),
    penalties: games.reduce((n, g) => n + g.penalties.length, 0),
    goalieLines: games.reduce((n, g) => n + g.goalies.length, 0),
    shootouts: games.filter((g) => g.shootoutWinner !== null).length,
    shootoutWins: games.filter((g) => IS_GR(g.shootoutWinner ?? undefined)).length,
    otGames: games.filter((g) => g.ot).length,
    playoffGames: games.filter((g) => g.round !== null).length,
    /** Not one goal survives from any playoff game. Both years. */
    playoffGoalsRecorded: games
      .filter((g) => g.round !== null)
      .reduce((n, g) => n + g.goals.length, 0),
    playoffGoalsScored: games
      .filter((g) => g.round !== null)
      .reduce((n, g) => n + (g.gf ?? 0), 0),
    scheduleOnlyGoalsScored: games
      .filter((g) => g.scheduleOnly && g.result !== null)
      .reduce((n, g) => n + (g.gf ?? 0), 0),
    sheetsWithoutDetail: games.filter((g) => !g.scheduleOnly && !g.hasDetail).length,
    sessionsWithGames: new Set(games.map((g) => g.sessionSort)).size,
    /** The team's schedule lists every game it played; all of them have sheets. */
    scheduleComplete: scheduled.size > 0 && [...scheduled].every((id) => seen.has(id)),
    scheduledGames: scheduled.size,
  };

  return { games, totals };
}
