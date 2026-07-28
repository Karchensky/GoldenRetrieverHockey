import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGames, parseSheetDate, parseSlashDate, iso, parseRecapDay, datedFixtures, weekdayOf } from "../src/games.ts";
import { parseGameSheet } from "../../parse/src/sportngin/game-sheet.ts";
import { parseRecapFixtures } from "../../parse/src/ownsite/game-recaps.ts";
import { parseRecentGames } from "../../parse/src/sportngin/recent-games.ts";
import { parseTeamSchedule, parseDaySchedule } from "../../parse/src/sportngin/game-schedule.ts";
import { parseGameDate, resolveSession } from "../src/sessions.ts";
import { parseSchedulePage } from "../../parse/src/ownsite/schedule-page.ts";
import { parseBoxscore } from "../../parse/src/digitalshift/boxscore.ts";
import {
  scheduleRows,
  isRetrievers as isRetrieversTeam,
  teamIdentity,
} from "../../capture/src/sources/digitalshift.ts";
import { corpusHtml, corpusPages } from "../../parse/test/helpers/corpus.ts";

/**
 * The game record, assembled from REAL captured bytes.
 *
 * Not a fixture. Every count below was arrived at by reading the corpus, and
 * each one is load-bearing for something the site says out loud.
 */

const prov = (source: string) => ({ source, label: source, archiveOnly: false });

/** The sheet's own id, taken from the game-centre link it carries. */
const sheets = corpusHtml("%game_sheet%")
  .map((html) => ({ html, sheet: parseGameSheet(html) }))
  .filter((x) => x.sheet !== null)
  .map((x) => ({
    url: `/game/game_sheet/${x.html.match(/\/game\/show\/(\d+)/)?.[1] ?? "0"}`,
    source: "eriemetro",
    sheet: x.sheet!,
  }));

const teamSchedules = corpusHtml("%eriemetrosports.com/schedule/team_instance%")
  .map((html) => parseTeamSchedule(html))
  .filter((s) => s !== null)
  .map((sched) => ({ url: "", source: "eriemetro", sched: sched! }));

const daySchedules = corpusHtml("%schedule/day%")
  .map((html) => parseDaySchedule(html))
  .filter((d) => d !== null)
  .map((day) => ({ url: "", source: "harborcenter-sportngin", day: day! }));

/**
 * The HarborCenter era, assembled from the same corpus: every Retrievers
 * schedule and the boxscores behind it, joined on ids exactly as generate.ts
 * joins them.
 *
 * The session comes from each team's OWN partial header and never from the
 * games' dates. HAHL plays its summer from MAY TO SEPTEMBER, so a date-derived
 * session splits five of the eleven and invents a "2020-21" that never was —
 * see `HsSchedule` in games.ts. The test below pins exactly that.
 */
const hsTeamSession = new Map<number, string>();
for (const { url, html } of corpusPages("%partials/stats/team?team_id=%")) {
  const content = (JSON.parse(html) as { content: string }).content;
  if (!isRetrieversTeam(content)) continue;
  const tid = Number(url.match(/team_id=(\d+)/)?.[1]);
  const id = teamIdentity(content);
  if (Number.isFinite(tid) && id?.session) hsTeamSession.set(tid, id.session);
}

const hsSchedules = corpusPages("%partials/stats/schedule/table%")
  .map(({ url, html }) => ({
    teamId: Number(url.match(/team_id=(\d+)/)?.[1]),
    html,
  }))
  .filter((x) => hsTeamSession.has(x.teamId))
  .map((x) => ({
    teamId: x.teamId,
    session: hsTeamSession.get(x.teamId)!,
    source: "harborcenter-hockeyshift",
    rows: scheduleRows((JSON.parse(x.html) as { content: string }).content),
  }));

const boxscores = corpusPages("%partials/stats/game/boxscore%").map(({ url, html }) => ({
  gameId: Number(url.match(/game_id=(\d+)/)?.[1]),
  source: "harborcenter-hockeyshift",
  box: parseBoxscore((JSON.parse(html) as { content: string }).content),
}));

/**
 * The two routes that reach BEFORE 2016 and BESIDE the schedules.
 *
 * Kept out of `built` and `all` on purpose: every count in the assertions
 * above was calibrated against exactly those inputs, and a route that adds 45
 * games would rewrite all of them into something nobody had checked.
 */
const recapCaptures = corpusPages("%goldenretrieverhockey.com%Game_Recaps%").map((p) => ({
  source: "goldenretrieverhockey",
  snap: Number(p.url.match(/\/web\/(\d{14})/)?.[1] ?? 0),
  fixtures: parseRecapFixtures(p.html),
}));

const recentGames = corpusPages("%roster_players%")
  .map((p) => ({ source: /eriemetro/.test(p.url) ? "eriemetro" : "harborcenter-sportngin", page: parseRecentGames(p.html) }))
  .filter((x): x is { source: string; page: NonNullable<ReturnType<typeof parseRecentGames>> } => x.page !== null);

const noCorpus = sheets.length === 0 && "corpus unavailable";
/** The SportsEngine sources alone — what every assertion below was written for. */
const built = sheets.length
  ? buildGames({ sheets, teamSchedules, daySchedules, hsSchedules: [], boxscores: [] }, prov)
  : null;
/** Everything, both eras, exactly as the site is generated. */
const all = sheets.length
  ? buildGames({ sheets, teamSchedules, daySchedules, hsSchedules, boxscores }, prov)
  : null;

// --- dates ---------------------------------------------------------------

test("parseSheetDate reads the month abbreviation the sheets actually use", () => {
  // This reader exists because it needs the DAY as well: sessions.parseGameDate
  // answers a different question (which half-year is this?) and returns only
  // {year, month}.
  //
  // It used to exist for a second reason, recorded here in an assertion that
  // sessions.parseGameDate returned null for "Sep 19, 2016" — which it did,
  // for every one of the 65 real sheet dates, because it was written for the
  // DigitalShift game log's full month names. That made resolveSession's
  // date-overrides-label rule dead code that never once ran. The bug is fixed
  // now, so the assertion pinning it is gone; the two readers coexist on
  // purpose, for different return shapes, not because one is broken.
  assert.deepEqual(parseSheetDate("Sep 19, 2016"), { y: 2016, m: 9, d: 19 });
  assert.deepEqual(parseGameDate("Sep 19, 2016"), { year: 2016, month: 9 }, "and so does the other one, now");

  assert.deepEqual(parseSheetDate("Jul 20, 2018"), { y: 2018, m: 7, d: 20 });
  assert.deepEqual(parseSheetDate("Dec 08, 2016"), { y: 2016, m: 12, d: 8 });
  // Full names still work, so the two formats need only one reader.
  assert.deepEqual(parseSheetDate("July 13, 2026"), { y: 2026, m: 7, d: 13 });
  assert.equal(parseSheetDate("not a date"), null);
  assert.equal(parseSheetDate("Xxx 1, 2016"), null, "an unknown month is not guessed");
});

test("parseSlashDate reads the schedule title's date", () => {
  assert.deepEqual(parseSlashDate("5/17/2018"), { y: 2018, m: 5, d: 17 });
  assert.deepEqual(parseSlashDate("12/8/2016"), { y: 2016, m: 12, d: 8 });
  assert.equal(parseSlashDate("Sep 19, 2016"), null);
});

test("iso pads, and never goes near a Date object", () => {
  // A timezone would silently move a 10:50pm game to the previous day.
  assert.equal(iso({ y: 2016, m: 9, d: 1 }), "2016-09-01");
  assert.equal(iso({ y: 2018, m: 12, d: 26 }), "2018-12-26");
});

// --- the record ----------------------------------------------------------

test("the archive holds 73 games it can place in time", { skip: noCorpus }, () => {
  const t = built!.totals;
  assert.equal(t.games, 73);
  assert.equal(t.withSheet, 59, "59 scoresheets are this team's");
  assert.equal(t.scheduleOnly, 14, "13 Summer 2018 results plus one that never happened");
  assert.equal(t.played, 72);
  assert.equal(t.unplayed, 1);
  assert.equal(t.w + t.l + t.t, t.played, "every played game has a result");
});

test("every game is dated, and they sort", { skip: noCorpus }, () => {
  const g = built!.games;
  for (const x of g) assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/, `${x.id} ${x.dateRecorded}`);
  const dates = g.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort(), "oldest first, by real date");
  assert.equal(dates[0], "2016-09-19");
  assert.equal(dates.at(-1), "2020-04-10");
});

test("the other leagues' sheets are NOT counted as this team's games", { skip: noCorpus }, () => {
  // 92 sheets are captured; 59 are this team's. The other 33 are other leagues
  // played at the same rinks — a squirt league, the HARBORCENTER Cup, the youth
  // BEHL — swept in when `harborcenter.sportngin.com` was rescued whole.
  //
  // The count of FOREIGN sheets is expected to keep rising as more of those
  // hosts are captured, and it is not the fact under test. THE INVARIANT IS
  // BELOW: whatever else lands in the corpus, `withSheet` stays this team's and
  // every game the build publishes names the Retrievers.
  assert.equal(sheets.length, 92, "sheets on file across every league captured");
  assert.equal(built!.totals.withSheet, 59, "fifty-nine of them are ours");
  assert.ok(sheets.length > built!.totals.withSheet, "and the rest belong to somebody else");
  for (const g of built!.games) {
    assert.match(`${g.away} ${g.home}`, /Golden Retrievers/i, `${g.id}: ${g.away} v ${g.home}`);
  }
});

test("the team's own schedule proves the two Erie Metro seasons are COMPLETE", { skip: noCorpus }, () => {
  assert.equal(built!.totals.scheduledGames, 59);
  assert.equal(built!.totals.scheduleComplete, true);

  const bySession = new Map<string, number>();
  for (const g of built!.games) bySession.set(g.session, (bySession.get(g.session) ?? 0) + 1);
  assert.equal(bySession.get("2016 - Winter"), 30, "30 games, exactly as the schedule lists");
  assert.equal(bySession.get("2017 - Winter"), 29, "29 games, exactly as the schedule lists");
});

test("HAHL's own label beats the date rule for a session that starts in May", { skip: noCorpus }, () => {
  // The league calls it "2018 Spring/Summer" and opens it on 10 May. The
  // summer boundary in `sessions` is June, so the date test alone files the
  // first three games under "2017-18" — an Erie Metro season, in a different
  // league, that had already ended on 15 April. Spring is in the name.
  const summer = built!.games.filter((g) => g.session === "2018 - Summer");
  assert.equal(summer.length, 13);
  assert.equal(summer.filter((g) => g.date.startsWith("2018-05")).length, 3, "the May games");
  for (const g of summer) assert.equal(g.sessionSort, 2018);

  const may = built!.games.filter((g) => g.date === "2018-05-10");
  assert.equal(may.length, 1);
  assert.equal(may[0]!.session, "2018 - Summer", "not 2017 - Winter");

  // And 2017-18 keeps exactly the games Erie Metro actually scheduled.
  assert.ok(built!.games.filter((g) => g.session === "2017 - Winter").every((g) => !g.scheduleOnly));
});

// --- the holes -----------------------------------------------------------

test("not one goal survives from any playoff game", { skip: noCorpus }, () => {
  const t = built!.totals;
  assert.equal(t.playoffGames, 9, "four in 2016-17, five in 2017-18");
  assert.equal(t.playoffGoalsRecorded, 0);
  assert.equal(t.sheetsWithoutDetail, 9, "and they are exactly the sheets with no detail");

  for (const g of built!.games.filter((x) => x.round !== null)) {
    assert.equal(g.hasDetail, false, `${g.date} ${g.round}`);
    assert.equal(g.goals.length, 0);
    assert.equal(g.penalties.length, 0);
    // The score still exists. Only the goals are gone.
    assert.notEqual(g.gf, null);
    assert.notEqual(g.ga, null);
  }

  // The team reached the final in both seasons and lost both series.
  //
  // Note the anchor. A loose /final/i also catches "Semi2 Final", which is
  // the SECOND SEMI-FINAL — the league typed the round by hand and spelled it
  // eight different ways across nine games, so matching it loosely promotes a
  // semi into a final and quietly rewrites the team's history.
  const finals = built!.games.filter((g) => /^final/i.test(g.round ?? ""));
  assert.equal(finals.length, 5, "two finals in 2016-17, three in 2017-18");
  assert.equal(finals.filter((g) => g.result === "L").length, 4);
  assert.ok(finals.every((g) => g.opponent === "Hammers"), "the same team, both years");

  const semis = built!.games.filter((g) => /^semi/i.test(g.round ?? ""));
  assert.equal(semis.length, 4);
  assert.ok(semis.every((g) => g.result === "W"), "won every semi-final it played");
});

test("the gap between goals SCORED and goals RECORDED decomposes exactly", { skip: noCorpus }, () => {
  // 505 scored, 362 written down. The 143 missing are not rot and not a
  // parser fault — every one is accounted for, and the site says so.
  const t = built!.totals;
  const gap = t.gf - t.goalsRecorded;

  const playoff = built!.games.filter((g) => g.round !== null).reduce((n, g) => n + (g.gf ?? 0), 0);
  const scheduleOnly = built!.games
    .filter((g) => g.scheduleOnly && g.result !== null)
    .reduce((n, g) => n + (g.gf ?? 0), 0);
  const shootouts = built!.games
    .filter((g) => g.shootoutWinner !== null && /golden retrievers/i.test(g.shootoutWinner!)).length;

  assert.equal(playoff + scheduleOnly + shootouts, gap, "nothing unexplained");
  assert.equal(gap, 143);
  assert.equal(playoff, 63, "nine playoff games nobody wrote up");
  assert.equal(scheduleOnly, 78, "a whole summer known only from a schedule");
  assert.equal(shootouts, 2, "and two goals no player scored");
});

test("a postponed game is not a loss", { skip: noCorpus }, () => {
  const off = built!.games.filter((g) => g.result === null);
  assert.equal(off.length, 1);
  const g = off[0]!;
  assert.equal(g.date, "2020-04-10");
  assert.equal(g.status, "Postponed");
  assert.equal(g.gf, null, "no score, rather than nought");
  assert.equal(g.ga, null);
  assert.equal(g.opponent, "Mad Dogs");
  // It counts as a game the archive knows about, and as nothing else.
  assert.ok(!built!.games.filter((x) => x.result === "L").includes(g));
});

test("the shootout winners are recorded and score no goals", { skip: noCorpus }, () => {
  const t = built!.totals;
  assert.equal(t.shootouts, 4);
  assert.equal(t.otGames, 6, "six games went past regulation; four have any detail at all");

  for (const g of built!.games.filter((x) => x.shootoutWinner !== null)) {
    assert.equal(g.ot, true);
    assert.ok(!g.goals.some((x) => /shootout/i.test(x.scorer)), "no invented scorer");
  }
});

test("only four of sixteen sessions have a single game on file", { skip: noCorpus }, () => {
  // The headline hole. Twelve sessions have a roster and no games whatsoever.
  assert.equal(built!.totals.sessionsWithGames, 4);
  const sorts = [...new Set(built!.games.map((g) => g.sessionSort))].sort((a, b) => a - b);
  assert.deepEqual(sorts, [2016.5, 2017.5, 2018, 2019.5]);
});

// --- the HarborCenter era ------------------------------------------------

test("every Retrievers session at HarborCenter has its games", { skip: noCorpus }, () => {
  // Eleven sessions, 2021 to 2026. Before the schedule/table route was found
  // the archive held not one HockeyShift game: the assist network covered two
  // sessions of eighteen and said so.
  assert.equal(hsSchedules.length, 11, "eleven Retrievers teams at HarborCenter");
  const hs = all!.games.filter((g) => g.league === "Seneca HAHL");
  // AT LEAST, not EXACTLY. This is the one era still being played, and its
  // schedule grows: 193 when this was written, 195 the first time the
  // current-season sync ran, and more the next time the league adds a playoff
  // fixture. Pinning it made a green suite depend on the season standing
  // still, which is the opposite of what this archive is for. The count must
  // never SHRINK — that would mean games left the schedule — and the session
  // structure below is the part that is genuinely fixed.
  assert.ok(hs.length >= 193, `${hs.length} HarborCenter games — was 193 and must not shrink`);
  assert.equal(new Set(hs.map((g) => g.sessionSort)).size, 11);
});

test("a HAHL summer session keeps its May and September games", { skip: noCorpus }, () => {
  // THE TRAP THIS TEST EXISTS FOR. HAHL plays summer from May to September;
  // `halfFromMonth` calls June-August summer and everything else fall/winter.
  // Deriving these sessions from dates files Summer 2021's opening two games
  // (19 and 26 May) under a "2020-21" session that has never existed, and
  // takes Summer 2025's last game (5 September) into 2025-26. The team's own
  // page says which session it is; the league is not guessing.
  const summer21 = all!.games.filter((g) => g.session === "2021 - Summer");
  assert.equal(summer21.length, 13, "all thirteen, including the May games");
  assert.deepEqual(
    [...new Set(summer21.map((g) => g.sessionSort))],
    [2021],
    "one session, not two",
  );
  assert.ok(summer21.some((g) => g.date.startsWith("2021-05")), "May games are Summer 2021");

  const summer25 = all!.games.filter((g) => g.session === "2025 - Summer");
  assert.ok(summer25.some((g) => g.date.startsWith("2025-09")), "September games too");

  // And no session was invented in front of the archive's first.
  assert.ok(!all!.games.some((g) => g.sessionSort === 2020.5), "no phantom 2020-21");
});

test("which side the Retrievers were is decided by team id, never by name", { skip: noCorpus }, () => {
  const hs = all!.games.filter((g) => g.league === "Seneca HAHL");
  for (const g of hs) {
    const own = g.gr === "home" ? g.home : g.away;
    assert.match(own, /^(the )?golden retrievers$/i, `${g.id}: gr side is not us`);
    assert.doesNotMatch(g.opponent, /^(the )?golden retrievers$/i);
  }
});

test("an unplayed fixture is not a scoreless draw", { skip: noCorpus }, () => {
  // The API reports 0-0 for a game nobody has skated. Four Summer 2026
  // fixtures are in that state; recording them as ties would invent results.
  const notStarted = all!.games.filter((g) => g.status === "Not Started");
  assert.ok(notStarted.length > 0);
  for (const g of notStarted) {
    assert.equal(g.result, null);
    assert.equal(g.gf, null);
    assert.equal(g.ga, null);
    assert.equal(g.goals.length, 0);
  }
});

test("HarborCenter goals reconcile against the scores, shootouts included", { skip: noCorpus }, () => {
  // The same reconciliation the parse tests run, but through the BUILD: if the
  // schedule row and the boxscore were joined on the wrong id, or a game were
  // counted twice, these would disagree.
  const hs = all!.games.filter((g) => g.league === "Seneca HAHL" && g.hasDetail);
  assert.ok(hs.length > 150, `only ${hs.length} games with detail`);
  for (const g of hs) {
    const scored = g.goals.filter((x) => /^(the )?golden retrievers$/i.test(x.team)).length;
    const so = g.shootoutWinner && /^(the )?golden retrievers$/i.test(g.shootoutWinner) ? 1 : 0;
    assert.equal(scored + so, g.gf, `game ${g.id}: goals+shootout != goals for`);
  }
});

test("no game is counted twice across the two eras", { skip: noCorpus }, () => {
  const ids = all!.games.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate game id in the record");
  // The Erie Metro path is untouched by the HarborCenter one.
  const erie = all!.games.filter((g) => g.league === "Erie Metro Hockey League");
  assert.equal(erie.length, built!.games.filter((g) => g.league === "Erie Metro Hockey League").length);
});

test("the league states its own playoffs, and shots are never invented", { skip: noCorpus }, () => {
  const hs = all!.games.filter((g) => g.league === "Seneca HAHL");
  assert.ok(hs.some((g) => g.round === "Playoffs"), "playoff games are marked");
  // HockeyShift's boxscore has a Shots table whose every cell equals the
  // Scoring table's. It is the goals again under another label, and this
  // archive does not put a fabricated statistic on the site.
  for (const g of hs) assert.deepEqual(g.goalies, []);
});

// --- the club's own recaps, and the "Recent Games" table -----------------

/**
 * Everything, plus the two routes that had never been read. Built separately
 * so the assertions above keep describing the record they were written for.
 */
const withRecovered = sheets.length
  ? buildGames(
      {
        sheets, teamSchedules, daySchedules, hsSchedules, boxscores,
        recentGames, recaps: recapCaptures,
        leagueBySort: new Map([[2012.5, "EMHL"], [2013, "LSHL"]]),
      },
      prov,
    )
  : null;

test("parseRecapDay reads a date with no year, which is all the page ever writes", () => {
  assert.deepEqual(parseRecapDay("February 16"), { m: 2, d: 16 });
  assert.deepEqual(parseRecapDay("April 5"), { m: 4, d: 5 });
  assert.deepEqual(parseRecapDay("Sep 19"), { m: 9, d: 19 });
  assert.equal(parseRecapDay("February 16, 2013"), null, "a year is not silently dropped");
  assert.equal(parseRecapDay("Xxx 1"), null);
  assert.equal(parseRecapDay(""), null);
});

test("THE YEAR comes off the snapshot, walking the page backwards", { skip: noCorpus }, () => {
  const blocks = datedFixtures(recapCaptures);
  const every = blocks.flatMap((b) => b.fixtures);
  assert.equal(every.length, 34);

  // Captured 25 April 2013. The page runs from the championship series back
  // to the season opener, and the year drops the moment the month goes UP.
  const by = (n: string, d: string) => every.find((f) => f.number === n && f.recorded === d);
  assert.equal(by("Championship 1", "April 5")?.date, "2013-04-05");
  assert.equal(by("26", "March 15")?.date, "2013-03-15");
  assert.equal(by("16", "January 4")?.date, "2013-01-04");
  assert.equal(by("15", "December 20")?.date, "2012-12-20", "December is the PREVIOUS year");
  assert.equal(by("1", "September 24")?.date, "2012-09-24");

  // Every date is real and they all sit inside the two seasons.
  for (const f of every) assert.match(f.date, /^201[23]-\d{2}-\d{2}$/, f.recorded);
  const dates = every.map((f) => f.date);
  assert.equal(new Set(dates).size, dates.length, "no two games share a date");
});

test("THE SEASON comes off the numbering restarting, never off the date", { skip: noCorpus }, () => {
  const blocks = datedFixtures(recapCaptures);
  assert.equal(blocks.length, 2, "two seasons on one page");

  assert.equal(blocks[0]!.sort, 2012.5);
  assert.equal(blocks[0]!.label, "2012 - Winter");
  assert.equal(blocks[0]!.fixtures.length, 29, "26 regular season and three playoff games");

  // THE TRAP. These five were played 19 April to 8 May 2013 — months that
  // `halfFromMonth` calls fall/winter, which is the SAME session as the block
  // above. They are not: the club numbered them from one, in a different
  // league. The captain's workbook has "Summer 2013 | LSHL" beside
  // "Winter 2012 / 13 | EMHL", and 26 is exactly what the first block holds.
  assert.equal(blocks[1]!.sort, 2013);
  assert.equal(blocks[1]!.label, "2013 - Summer");
  assert.equal(blocks[1]!.fixtures.length, 5);
  assert.ok(blocks[1]!.fixtures.every((f) => f.date >= "2013-04-19"));

  // And the playoff opener is NOT read as a restart. Its number is "1" and it
  // sits between game 26 and the championship series; only its section knows.
  const playoffOpener = blocks[0]!.fixtures.find((f) => f.date === "2013-03-25");
  assert.ok(playoffOpener, "25 March is in the first block, not starting a new one");
  assert.equal(playoffOpener!.number, "1");
  assert.equal(playoffOpener!.isPlayoff, true);
});

test("34 games arrive from the recaps, and 11 from the Recent Games tables", { skip: noCorpus }, () => {
  const gained = withRecovered!.totals.games - all!.totals.games;
  assert.equal(gained, 45);

  const recap = withRecovered!.games.filter((g) => g.id.startsWith("tgr-"));
  assert.equal(recap.length, 34);
  assert.equal(recap.filter((g) => g.sessionSort === 2012.5).length, 29);
  assert.equal(recap.filter((g) => g.sessionSort === 2013).length, 5);

  // The eleven land on two sessions that between them held ONE game.
  const known = new Set(all!.games.map((g) => g.id));
  const fromTable = withRecovered!.games.filter((g) => !known.has(g.id) && !g.id.startsWith("tgr-"));
  assert.equal(fromTable.length, 11);
  assert.equal(fromTable.filter((g) => g.sessionSort === 2018.5).length, 6);
  assert.equal(fromTable.filter((g) => g.sessionSort === 2019.5).length, 5);
});

test("A GAME WHOSE VENUE WAS NEVER RECORDED SAYS SO", { skip: noCorpus }, () => {
  // The club's own page writes "vs." for every game it ever played, home and
  // away alike, so the word is not evidence and no home side is invented. The
  // flag is what these games carry instead — and `gr` still points at us,
  // which is the fact every other reader in this project tests on.
  const unknown = withRecovered!.games.filter((g) => g.venueUnknown);
  assert.equal(unknown.length, 34);
  for (const g of unknown) {
    const us = g.gr === "home" ? g.home : g.away;
    assert.match(us, /^(the )?golden retrievers$/i, `${g.id}: gr does not point at us`);
    assert.doesNotMatch(g.opponent, /^(the )?golden retrievers$/i);
    assert.equal(g.rink, null, "no venue means no rink either");
  }

  // And every game any source DID place keeps saying so.
  const placed = withRecovered!.games.filter((g) => !g.venueUnknown);
  assert.equal(placed.length, withRecovered!.totals.games - 34);
  for (const g of placed) {
    const us = g.gr === "home" ? g.home : g.away;
    assert.match(us, /^(the )?golden retrievers$/i, `${g.id}: gr does not point at us`);
  }
});

test("played, and nobody wrote the score down, is not 'unplayed'", { skip: noCorpus }, () => {
  const t = withRecovered!.totals;
  assert.equal(t.scoreUnrecorded, 2);
  // The one postponement and the Summer 2026 fixtures are still their own
  // kind of nothing; this is a third.
  assert.equal(t.unplayed, all!.totals.unplayed + 2);

  const held = withRecovered!.games.filter((g) => g.status === "Score not recorded");
  assert.deepEqual(held.map((g) => g.date).sort(), ["2013-03-25", "2013-04-10"]);
  for (const g of held) {
    assert.equal(g.result, null, "no result invented");
    assert.equal(g.gf, null, "and no nought where a number is missing");
    assert.equal(g.ga, null);
    assert.notEqual(g.round, null, "both are playoff games");
  }
});

test("the Recent Games rows agree with the games the archive already held", { skip: noCorpus }, () => {
  // Three of the fourteen are already on file from a scoresheet and from two
  // day-schedule rows. This route must not disturb them — and its reading of
  // them, checked in the parse tests, matches on venue and on score.
  for (const id of ["16569729", "22147490", "22152394"]) {
    const before = all!.games.find((g) => g.id === id);
    const after = withRecovered!.games.find((g) => g.id === id);
    assert.deepEqual(after, before, `game ${id} was rewritten by the recent-games route`);
  }
});

test("no game is counted twice once every route has spoken", { skip: noCorpus }, () => {
  const ids = withRecovered!.games.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  const dates = withRecovered!.games.map((g) => g.date);
  assert.deepEqual(dates, [...dates].sort(), "still oldest first");
  assert.equal(dates[0], "2012-09-24", "the archive's earliest game is four years earlier");
});

test("the recap games carry the league the workbook names, not a guess", { skip: noCorpus }, () => {
  const winter = withRecovered!.games.filter((g) => g.sessionSort === 2012.5 && g.id.startsWith("tgr-"));
  const summer = withRecovered!.games.filter((g) => g.sessionSort === 2013);
  assert.ok(winter.length > 0 && winter.every((g) => g.league === "EMHL"));
  assert.ok(summer.length > 0 && summer.every((g) => g.league === "LSHL"));
});

// --- the club's own typed schedule, 2014/15 ------------------------------

/**
 * The last route, added on top of everything above so the counts already
 * asserted keep describing exactly the record they were calibrated against.
 *
 * `2014 - Winter` held ZERO games before this. The workbook says that season
 * ran 24 regular-season fixtures and 3 playoffs; this page, captured in
 * February 2015 and already stale, lists fifteen. Fifteen is not the season —
 * it is the first fifteen games of it, and the archive says so by holding
 * fifteen rather than by rounding up.
 */
const schedulePages = corpusPages("%goldenretrieverhockey.com%schedule.html")
  .map((p) => parseSchedulePage(p.html))
  .filter((x): x is NonNullable<typeof x> => x !== null)
  .map((page) => ({ source: "team-archive", page }));

const withSchedule = sheets.length
  ? buildGames(
      {
        sheets, teamSchedules, daySchedules, hsSchedules, boxscores,
        recentGames, recaps: recapCaptures, schedules: schedulePages,
        leagueBySort: new Map([[2012.5, "EMHL"], [2013, "LSHL"], [2014.5, "EMHL"]]),
      },
      prov,
    )
  : null;

test("weekdayOf is arithmetic, and it agrees with the dates already on file", () => {
  // Sakamoto against the archive's own anchors rather than against itself.
  assert.equal(weekdayOf({ y: 2012, m: 9, d: 24 }), "Monday");   // the recaps' opener
  assert.equal(weekdayOf({ y: 2013, m: 4, d: 5 }), "Friday");    // Championship 1
  assert.equal(weekdayOf({ y: 2000, m: 2, d: 29 }), "Tuesday");  // a leap day, century rule
  assert.equal(weekdayOf({ y: 1900, m: 3, d: 1 }), "Thursday");  // NOT a leap year
  assert.equal(weekdayOf({ y: 2026, m: 7, d: 28 }), "Tuesday");
});

test("THE YEAR IS 2014, and the page's own fifteen weekdays say so", { skip: noCorpus }, () => {
  const page = schedulePages[0]!.page;
  assert.equal(page.fixtures.length, 15);
  let agrees2014 = 0;
  let agrees2015 = 0;
  for (const f of page.fixtures) {
    if (weekdayOf({ y: 2014, m: f.month, d: f.day }) === f.weekday) agrees2014++;
    if (weekdayOf({ y: 2015, m: f.month, d: f.day }) === f.weekday) agrees2015++;
  }
  assert.equal(agrees2014, 15, "every weekday/date pair matches calendar 2014");
  assert.equal(agrees2015, 0, "and not one matches 2015");
});

test("fifteen games arrive in a session that held none", { skip: noCorpus }, () => {
  const gained = withSchedule!.totals.games - withRecovered!.totals.games;
  assert.equal(gained, 15);
  assert.equal(withRecovered!.games.filter((g) => g.sessionSort === 2014.5).length, 0);

  const season = withSchedule!.games.filter((g) => g.sessionSort === 2014.5);
  assert.equal(season.length, 15);
  assert.ok(season.every((g) => g.session === "2014 - Winter"));
  assert.ok(season.every((g) => g.league === "EMHL"));
  assert.ok(season.every((g) => g.scheduleOnly), "no sheet survives for any of them");
  assert.equal(season[0]!.date, "2014-09-17");
  assert.equal(season.at(-1)!.date, "2014-12-29");
  // Dated by the heading's season and the month, and every one of them
  // round-trips back to the session it was filed under.
  for (const g of season) {
    const [y, m, d] = g.date.split("-").map(Number);
    assert.equal(parseGameDate(`${["January","February","March","April","May","June","July","August","September","October","November","December"][m! - 1]} ${d}, ${y}`)?.year, y);
    assert.equal(resolveSession("", `${["January","February","March","April","May","June","July","August","September","October","November","December"][m! - 1]} ${d}, ${y}`)?.sort, 2014.5);
  }
});

test("the venue is unknown on all fifteen, exactly as on the recap page", { skip: noCorpus }, () => {
  const season = withSchedule!.games.filter((g) => g.sessionSort === 2014.5);
  for (const g of season) {
    assert.equal(g.venueUnknown, true, `${g.id} states a venue no source recorded`);
    assert.equal(g.gr, "home");
    assert.equal(g.home, "Golden Retrievers", "the slot its own gr names");
    assert.equal(g.away, g.opponent);
    assert.equal(g.rink, null);
    assert.doesNotMatch(g.opponent, /^(the )?golden retrievers$/i);
  }
  assert.equal(withSchedule!.games.filter((g) => g.venueUnknown).length, 49, "34 recaps + 15 here");
});

test("6-5 across eleven results, and the five holes are drawn as holes", { skip: noCorpus }, () => {
  const season = withSchedule!.games.filter((g) => g.sessionSort === 2014.5);
  const played = season.filter((g) => g.result !== null);
  assert.equal(played.length, 11);
  assert.equal(played.filter((g) => g.result === "W").length, 6);
  assert.equal(played.filter((g) => g.result === "L").length, 5);
  assert.equal(played.filter((g) => g.result === "T").length, 0);

  // The goals are the ten SCORED games' only. Game 8 is a win with no score
  // and contributes nothing rather than nought.
  const scored = season.filter((g) => g.gf !== null);
  assert.equal(scored.length, 10);
  assert.equal(scored.reduce((n, g) => n + g.gf!, 0), 79);
  assert.equal(scored.reduce((n, g) => n + g.ga!, 0), 73);

  const held = season.filter((g) => g.status === "Score not recorded");
  assert.equal(held.length, 5);
  for (const g of held) {
    assert.equal(g.gf, null, "no nought where a number is missing");
    assert.equal(g.ga, null);
  }
  // Game 8 is the archive's only game with a RESULT and no score. The club
  // recorded that it won and never recorded by how much, and both are facts.
  const eight = season.find((g) => g.date === "2014-11-14")!;
  assert.equal(eight.result, "W");
  assert.equal(eight.status, "Score not recorded");
  assert.equal(eight.gf, null);
  assert.equal(withSchedule!.totals.scoreUnrecorded, 7, "2 from 2013, 5 from here");
});

test("a fixture whose weekday disagrees with its derived date is not published", () => {
  // 17 September 2014 was a Wednesday. A page claiming Thursday is a page and
  // a calendar disagreeing, and two witnesses that disagree are not a date.
  const bad = parseSchedulePage(
    "<h1>2014 / 2015 EMHL Season</h1><p>Regular Season</p>" +
      "<p>Game 1: Thursday, September 17th - 9:20 pm - vs. Catholic Health (9 - 3 W)</p>" +
      "<p>Game 2: Saturday, September 27th - 10:20 pm - vs. The Brownshafts (12 - 11 L)</p>",
  )!;
  assert.equal(bad.fixtures.length, 2, "the parser reads both — it reports, it does not judge");
  const built = buildGames(
    { sheets: [], teamSchedules: [], daySchedules: [], hsSchedules: [], boxscores: [],
      schedules: [{ source: "team-archive", page: bad }] },
    prov,
  );
  assert.equal(built.games.length, 1, "only the fixture the calendar agrees with");
  assert.equal(built.games[0]!.date, "2014-09-27");
});
