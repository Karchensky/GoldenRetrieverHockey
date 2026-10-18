import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePeriods } from "../src/periods.ts";
import { isUs, to24h } from "../src/rink.ts";
import { verifyClip, type ClipReading } from "../src/clip.ts";
import { clipBeside } from "../src/beside.ts";
import { gamesWithWork, matchRinkGame, minuteOfDay, movedSincePlanned, planClips, sheetOf } from "../src/daily.ts";
import type { LocatedGoal, ScoredGoal } from "../src/locate.ts";

const row = (t: number, period: string | null, clock: number | null, home: number | null = 0, away: number | null = 0) =>
  ({ t, period, clock, clockText: "", home, away });

test("a period the overlay mislabels is placed by order and by the clock resetting", () => {
  // 2026-10-15 on the Rink 2 tile: 1st, 2nd, then "OT2" from 18:00 down — the 3rd —
  // and "OT2" again from 7:00 down after it — the overtime.
  const out = normalizePeriods([
    row(0, "1st", 700), row(100, "1st", 20), row(200, "2nd", 700), row(300, "2nd", 10),
    row(400, "OT2", 1079), row(500, "OT2", 600), row(510, null, null), row(600, "OT2", 20),
    row(700, "OT2", 407), row(800, "OT2", 47),
  ]);
  assert.deepEqual(out.map((r) => r.period), ["1st", "1st", "2nd", "2nd", "3rd", "3rd", null, "3rd", "OT1", "OT1"]);
});

test("ordinals are taken at their word, a game before ours included", () => {
  // 2026-10-07 on Rink 1 opened on the end of another game's 3rd, then ours from the 1st.
  const out = normalizePeriods([row(0, "3rd", 200), row(300, "1st", 720), row(900, "2nd", 600)]);
  assert.deepEqual(out.map((r) => r.period), ["3rd", "1st", "2nd"]);
});

test("we are the Golden Retrievers under either name, and never the Golden Seals", () => {
  assert.ok(isUs({ name: "The Golden", mascot: "Retrievers" }));
  assert.ok(isUs({ name: "Golden", mascot: "Retrievers" }));
  assert.ok(isUs({ name: "Golden Retrievers", mascot: "" }));
  assert.ok(!isUs({ name: "Golden", mascot: "Seals" }));
  assert.ok(!isUs({ name: "Vegas", mascot: "Golden Knights" }));
  assert.ok(!isUs({ name: "Golden", mascot: "" }));
});

test("the platform's 12-hour times become the site's 24-hour ones", () => {
  assert.equal(to24h("08:30 PM"), "20:30");
  assert.equal(to24h("10:20 PM"), "22:20");
  assert.equal(to24h("12:15 AM"), "00:15");
  assert.equal(to24h("12:05 PM"), "12:05");
  assert.throws(() => to24h("20:30"));
});

const goal: ScoredGoal = { period: "1st", time: "06:42", team: "The Golden Retrievers", scorer: "Jason Kaplewicz", assists: [], strength: "Even Strength" };
const before = { home: 0, away: 2 }, after = { home: 1, away: 2 };
/** A 23-second clip, two readings a second, the clock running down to 6:42 at `at` and holding there. */
const clip = (at: number, score = before): ClipReading[] =>
  Array.from({ length: 46 }, (_, i) => {
    const t = i / 2;
    const clock = t < at ? 402 + Math.ceil(at - t) : 402;
    return { t, period: "1st", clock, clockText: "", home: score.home, away: score.away };
  });

test("a clip of the goal passes, and says where in it the goal is", () => {
  const v = verifyClip(clip(15.5), goal, before, after, "rink2-tile", 23);
  assert.deepEqual(v, { ok: true, goalAt: 15.5, layout: "rink2-tile" });
});

test("a clip that misses the goal, or shows another game, is refused", () => {
  // The clock is already past 6:42 when the clip opens: no build-up, so not this goal.
  const late = clip(15.5).map((r) => ({ ...r, clock: 390 }));
  assert.match((verifyClip(late, goal, before, after, "x", 23) as { problem: string }).problem, /never reaches 06:42/);
  // Right clock, wrong score: a practice or a different game at the same time.
  assert.match((verifyClip(clip(15.5, { home: 3, away: 1 }), goal, before, after, "x", 23) as { problem: string }).problem, /board shows 3-1/);
  // The goal in the last second: there is nothing after it worth showing.
  assert.match((verifyClip(clip(21.5), goal, before, after, "x", 23) as { problem: string }).problem, /no build-up or no finish/);
});


const located = (index: number, t: number | null, confirmed = true): LocatedGoal => ({
  index, t, confirmed, candidates: [], before: { home: 0, away: 0 }, after: { home: 0, away: 0 },
  goal: { period: "1st", time: "05:00", team: "x", scorer: "x", assists: [], strength: "" },
});

test("only our goals are clipped, and two of ours close together share one clip", () => {
  const goals = [located(0, 100), located(1, 130), located(2, 200), located(3, 400), located(4, 420), located(5, 700, false)];
  // Ours: 1, 3, 4 and 5. Theirs at 0 and 2 are never clipped; 5 was never confirmed by the score.
  const plan = planClips(goals, new Set([1, 3, 4, 5]));
  assert.deepEqual(plan, [
    { goals: [1], at: [130], start: 115, seconds: 23 },
    // 400 and 420: 385 to 428, 43 seconds — under the rink's one-minute limit, so one credit.
    { goals: [3, 4], at: [400, 420], start: 385, seconds: 43 },
  ]);
});

test("goals too far apart for one clip get one each — and a gap alone does not cost a second credit", () => {
  // 100 and 160: 85 to 168 would be 83 seconds, over the minute.
  assert.deepEqual(planClips([located(0, 100), located(1, 160)], new Set([0, 1])).map((c) => c.goals), [[0], [1]]);
  // 100 and 130: separate windows, 85-108 and 115-138, but 85 to 138 is 53 seconds — one clip, one credit.
  assert.deepEqual(planClips([located(0, 100), located(1, 130)], new Set([0, 1])), [{ goals: [0, 1], at: [100, 130], start: 85, seconds: 53 }]);
});

test("a box score is matched to a rink game by date, time and rink, or not at all", () => {
  const game = { id: "1", date: "2026-10-15", time: "20:30", rink: "Rink 2", status: "Final", gr: "home" as const, home: "h", away: "a", goals: [] };
  const rinkGame = (id: number, date: string, time: string, rink: string) => ({ id, date, time, rink, home: "", away: "" });
  assert.equal(matchRinkGame(game, [rinkGame(42732, "2026-10-15", "20:30", "Rink 2"), rinkGame(1, "2026-10-15", "20:30", "Rink 1")])?.id, 42732);
  assert.equal(matchRinkGame(game, [rinkGame(2, "2026-10-16", "20:30", "Rink 2")]), null);
  // Two candidates is not an answer.
  assert.equal(matchRinkGame(game, [rinkGame(3, "2026-10-15", "20:30", "Rink 2"), rinkGame(4, "2026-10-15", "20:30", "Rink 2")]), null);
  // The league's rink names carry a sponsor some seasons, and older times are written out.
  const older = { ...game, time: "9:20 PM EDT", rink: "New Wave Energy Rink 2" };
  assert.equal(matchRinkGame(older, [rinkGame(5, "2026-10-15", "21:20", "Rink 2"), rinkGame(6, "2026-10-15", "21:20", "Rink 1")])?.id, 5);
  // Filed under another time, but our only recorded game that day: it. Two that day and neither fits: nothing.
  assert.equal(matchRinkGame(game, [rinkGame(7, "2026-10-15", "20:45", "Rink 2")])?.id, 7);
  assert.equal(matchRinkGame(game, [rinkGame(7, "2026-10-15", "20:45", "Rink 2"), rinkGame(8, "2026-10-15", "22:00", "Rink 1")]), null);
});

test("a time of day, however the league or the rink wrote it", () => {
  assert.equal(minuteOfDay("20:30"), 1230);
  assert.equal(minuteOfDay("9:20 PM EDT"), 1280);
  assert.equal(minuteOfDay("10:50 pm"), 1370);
  assert.equal(minuteOfDay("12:15 AM"), 15);
  assert.equal(minuteOfDay(null), null);
  assert.equal(minuteOfDay("TBD"), null);
});


/** Oct 15 in miniature: Buffalo scored first, then us twice. */
const game = {
  id: "1335913", date: "2026-10-15", time: "20:30", rink: "Rink 2", status: "Final", gr: "home" as const,
  home: "The Golden Retrievers", away: "Buffalo Cigars",
  goals: [
    { period: "1st", time: "11:52", team: "Buffalo Cigars", scorer: "Mike Kline", assists: [], strength: "" },
    { period: "1st", time: "06:42", team: "The Golden Retrievers", scorer: "Jason Kaplewicz", assists: [], strength: "" },
    { period: "1st", time: "02:22", team: "The Golden Retrievers", scorer: "Anthony Christy", assists: [], strength: "" },
  ],
};
const clipOf = (goal: number, period: string, time: string, scorer: string) =>
  ({ goal, period, time, scorer, clip: `1335913-${goal}.mp4`, poster: `1335913-${goal}.jpg`, seconds: 23 });

test("a day with every goal of ours on its box score is nothing to do — before signing in to anything", () => {
  const highlights = { "1335913": [clipOf(1, "1st", "06:42", "Jason Kaplewicz"), clipOf(2, "1st", "02:22", "Anthony Christy")] };
  assert.deepEqual(gamesWithWork({ since: "2026-10-07", games: [game], ledger: {}, highlights }), []);
  // A goal of ours with no clip is work; a game before the start date never is.
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [game], ledger: {}, highlights: { "1335913": [highlights["1335913"][0]!] } }).length, 1);
  assert.equal(gamesWithWork({ since: "2026-10-16", games: [game], ledger: {}, highlights: {} }).length, 0);
});

test("an overtime game is clipped like any other; one not played, or not ours, never is", () => {
  const ot = { ...game, status: "Final/OT" };
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [ot], ledger: {}, highlights: {} }).length, 1);
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [{ ...game, status: "Postponed" }], ledger: {}, highlights: {} }).length, 0);
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [{ ...game, gr: null }], ledger: {}, highlights: {} }).length, 0);
});

test("a game it could not finish is left for a person — until its scoresheet is corrected", () => {
  const stuck = { rinkGame: 42732, clips: [], problem: "1st 06:42 Jason Kaplewicz: not found", sheet: sheetOf(game) };
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [game], ledger: { "1335913": stuck }, highlights: {} }).length, 0);
  const corrected = { ...game, goals: [game.goals[0]!, { ...game.goals[1]!, time: "06:12" }, game.goals[2]!] };
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [corrected], ledger: { "1335913": stuck }, highlights: {} }).length, 1);
});

test("a corrected scoresheet: a clip follows its goal, and one with no goal left is reported once", () => {
  // The league adds a goal it missed, at the top: ours move down one place each.
  const corrected = { ...game, goals: [{ ...game.goals[0]!, time: "14:10" }, ...game.goals] };
  const highlights = { "1335913": [clipOf(1, "1st", "06:42", "Jason Kaplewicz"), clipOf(2, "1st", "02:22", "Anthony Christy")] };
  // Found by period and time, both clips still have their goal: nothing to do, nothing to report.
  assert.deepEqual(gamesWithWork({ since: "2026-10-07", games: [corrected], ledger: {}, highlights }), []);
  // The time of one is corrected instead: that clip matches no goal of ours, which is work — once.
  const retimed = { ...game, goals: [game.goals[0]!, { ...game.goals[1]!, time: "06:41" }, game.goals[2]!] };
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [retimed], ledger: { "1335913": { rinkGame: 42732, clips: [{ goals: [1], start: 0, seconds: 23, moment: "m", status: "published" }] } }, highlights }).length, 1);
  assert.equal(gamesWithWork({ since: "2026-10-07", games: [retimed], ledger: { "1335913": { rinkGame: 42732, clips: [{ goals: [1], start: 0, seconds: 23, moment: "m", status: "published" }], stale: ["1335913-1.mp4"] } }, highlights }).length, 0);
});

test("no credit is spent on a clip whose goal moved, or is not ours, since it was found", () => {
  const planned = { goals: [1], labels: ["1st 06:42"] };
  assert.deepEqual(movedSincePlanned(game, planned), []);
  // A goal added above it: it is further down the scoresheet, still ours at 06:42 — the same moment of the same recording.
  const added = { ...game, goals: [game.goals[0]!, { ...game.goals[0]!, time: "08:00" }, ...game.goals.slice(1)] };
  assert.deepEqual(movedSincePlanned(added, planned), []);
  // Time corrected: the clip was found for a moment the scoresheet no longer has.
  assert.deepEqual(movedSincePlanned({ ...game, goals: [game.goals[0]!, { ...game.goals[1]!, time: "06:41" }, game.goals[2]!] }, planned), [1]);
  // Given to the other team.
  assert.deepEqual(movedSincePlanned({ ...game, goals: [game.goals[0]!, { ...game.goals[1]!, team: "Buffalo Cigars" }, game.goals[2]!] }, planned), [1]);
});

test("the page shows a clip beside one goal of ours only, and never a guess", () => {
  const clips = [clipOf(1, "1st", "06:42", "Jason Kaplewicz")];
  assert.equal(clipBeside(clips, game.goals, 1, game.home), clips[0]);
  assert.equal(clipBeside(clips, game.goals, 2, game.home), undefined);
  // Corrected to theirs: shown beside nothing.
  const theirs = [game.goals[0]!, { ...game.goals[1]!, team: "Buffalo Cigars" }, game.goals[2]!];
  assert.equal(clipBeside(clips, theirs, 1, game.home), undefined);
  // Two goals at that moment: neither gets it.
  const twice = [game.goals[0]!, game.goals[1]!, { ...game.goals[2]!, time: "06:42" }];
  assert.equal(clipBeside(clips, twice, 1, game.home), undefined);
  assert.equal(clipBeside(clips, twice, 2, game.home), undefined);
});
