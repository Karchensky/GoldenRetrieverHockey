import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeamSchedule, parseDaySchedule } from "../src/sportngin/game-schedule.ts";
import { corpusHtml } from "./helpers/corpus.ts";

/**
 * Every assertion here runs against BYTES THAT WERE ACTUALLY SERVED.
 *
 * There is no hand-written fixture in this file, deliberately. A parser on
 * this project once passed 13/13 against an invented page shape and produced
 * 1,064 phantom goals and zero penalties against the real corpus, green the
 * whole time. Schedule pages are the last thing that should be trusted to a
 * fixture: the corpus holds TWO team-schedule shapes differing by one leading
 * column, and a fixture would only ever have held the one its author saw.
 *
 * Where the corpus is absent these SKIP. A green tick against no data is the
 * precise failure this file exists to prevent.
 */

const TEAM = corpusHtml("%eriemetrosports.com/schedule/team_instance%")
  .map((h) => parseTeamSchedule(h))
  .filter((s) => s !== null && /Golden Retrievers/i.test(s.team ?? ""));

const DAYS = corpusHtml("%schedule/day%").map((h) => parseDaySchedule(h)).filter((d) => d !== null);

/** Game ids of every captured Erie Metro sheet, read from the sheet's own body. */
const SHEET_IDS = new Set(
  corpusHtml("%eriemetrosports.com/game/game_sheet%")
    .map((h) => h.match(/\/game\/show\/(\d+)/)?.[1])
    .filter((x): x is string => x !== undefined),
);

const noTeam = TEAM.length === 0 && "corpus unavailable";
const noDays = DAYS.length === 0 && "corpus unavailable";

test("the team's own season schedule parses out of real captured bytes", { skip: noTeam }, () => {
  // Two seasons survive on Erie Metro: 2016-17 and 2017-18.
  assert.equal(TEAM.length, 2);
  for (const p of TEAM) {
    assert.match(p!.team!, /Golden Retrievers/);
    assert.match(p!.session!, /^20\d\d-\d\d/);
    assert.ok(p!.rows.length > 20, "a full season of rows");
    for (const r of p!.rows) {
      assert.match(r.gameId, /^\d+$/);
      // "Mon Sep 19" — a weekday and a day, and NO YEAR anywhere. The year
      // has to come from the sheet; this page cannot supply one.
      assert.match(r.date, /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/, r.date);
      assert.match(r.result, /^[WL] \d+-\d+$/, r.result);
    }
  }
});

test("the schedule proves the sheet collection is COMPLETE", { skip: noTeam }, () => {
  // The only claim about ABSENCE this archive can honestly make. A sheet
  // knows about itself and nothing else, so it can never prove none is
  // missing. The team's own schedule lists every game it played — and every
  // single one of those games has a sheet on file.
  const scheduled = new Set(TEAM.flatMap((p) => p!.rows.map((r) => r.gameId)));
  assert.equal(scheduled.size, 59, "30 games in 2016-17 plus 29 in 2017-18");

  if (SHEET_IDS.size === 0) return; // sheets not in this corpus slice
  const missing = [...scheduled].filter((id) => !SHEET_IDS.has(id));
  assert.deepEqual(missing, [], "every scheduled game has a captured sheet");
  assert.equal(SHEET_IDS.size, scheduled.size, "and no sheet is for a game not on the schedule");
});

test("the round label is read from the column headed 'Game ID'", { skip: noTeam }, () => {
  const rounds = TEAM.flatMap((p) => p!.rows.map((r) => r.round)).filter(Boolean);

  // Nine playoff games across two seasons, and the league spelled the label a
  // different way almost every time. The inconsistency is the evidence that a
  // human typed it into a field meant for something else.
  assert.equal(rounds.length, 9);
  assert.ok(rounds.some((r) => /^Semi/i.test(r)), "semi-finals are labelled");
  assert.ok(rounds.some((r) => /^Final/i.test(r)), "finals are labelled");
  assert.ok(
    new Set(rounds).size >= 7,
    `hand-typed and inconsistent, and not normalised: ${JSON.stringify(rounds)}`,
  );
});

test("columns are found by heading, not by counting", { skip: noTeam }, () => {
  // The corpus holds a second team-schedule shape with NO leading "Game ID"
  // column. Reading by index parses its date as a round label and its result
  // as a date, and never fails while doing it.
  const other = corpusHtml("%rinksatharborcenter.com/schedule/print/team_instance%")
    .map((h) => parseTeamSchedule(h))
    .filter((s) => s !== null && s.rows.length > 0);
  if (other.length === 0) return;

  for (const p of other) {
    for (const r of p!.rows) {
      assert.match(r.date, /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/, `date column found: ${r.date}`);
      assert.match(r.result, /^[WLT] \d+-\d+$/, `result column found: ${r.result}`);
      assert.equal(r.round, "", "this shape has no round column, so there is no round");
    }
  }
});

test("home and away are distinguishable: '@' marks an away game", { skip: noTeam }, () => {
  const rows = TEAM.flatMap((p) => p!.rows);
  assert.ok(rows.some((r) => r.opponent.startsWith("@")), "some games are away");
  assert.ok(rows.some((r) => !r.opponent.startsWith("@")), "some games are home");
});

test("day schedules parse, and a real Summer 2018 result comes out", { skip: noDays }, () => {
  const rows = DAYS.flatMap((d) => d!.rows.map((r) => ({ ...r, date: d!.date, league: d!.league })));
  const gr = rows.filter((r) => /golden retrievers/i.test(`${r.awayTeam} ${r.homeTeam}`));
  assert.ok(gr.length > 0, "the team appears on the day schedules");

  // Read off the captured page: 5/17/2018, Olympic at the Golden Retrievers,
  // 3-4. This is Summer 2018 — a season with no sheets, no roster and no
  // entry in the session list. These rows are the entire surviving record.
  const olympic = gr.find((r) => r.gameId === "21647558");
  assert.ok(olympic, "game 21647558 is on file");
  assert.equal(olympic!.awayTeam, "Olympic");
  assert.equal(olympic!.awayScore, "3");
  assert.equal(olympic!.homeTeam, "The Golden Retrievers");
  assert.equal(olympic!.homeScore, "4");
  assert.equal(olympic!.date, "5/17/2018");
  assert.match(olympic!.league!, /2018 Spring\/Summer/);
});

test("an unplayed game is NULL, not nought", { skip: noDays }, () => {
  const rows = DAYS.flatMap((d) => d!.rows);
  const postponed = rows.filter((r) => r.status === "Postponed");
  assert.ok(postponed.length > 0, "the corpus caught a postponed slate");
  for (const r of postponed) {
    assert.equal(r.awayScore, null, "a postponed game has no score");
    assert.equal(r.homeScore, null);
  }

  // And a real nought survives as a real nought. The two must never merge.
  assert.ok(
    rows.some((r) => r.awayScore === "0" || r.homeScore === "0"),
    "being shut out is recorded, and is not the same as not playing",
  );
});

test("the postponed slate the archive caught is 10 April 2020", { skip: noDays }, () => {
  const gr = DAYS
    .flatMap((d) => d!.rows.map((r) => ({ ...r, date: d!.date })))
    .filter((r) => /golden retrievers/i.test(`${r.awayTeam} ${r.homeTeam}`) && r.status === "Postponed");

  // The team had a game against Mad Dogs that never happened. The page saying
  // so is the only trace of it. The date is read off the row, not inferred.
  assert.ok(gr.length > 0);
  for (const r of gr) assert.equal(r.date, "4/10/2020");
});

test("a page that is not a schedule returns null rather than an empty schedule", () => {
  assert.equal(parseTeamSchedule("<title>Standings - 2018 - HAHL</title>"), null);
  assert.equal(parseDaySchedule("<title>Standings - 2018 - HAHL</title>"), null);
  // A day page needs a date in its title; without one it cannot place a game.
  assert.equal(parseDaySchedule("<title>Game Schedule - Golden Retrievers</title>"), null);
});
