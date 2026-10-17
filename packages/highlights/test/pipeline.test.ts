import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePeriods } from "../src/periods.ts";
import { isUs, to24h } from "../src/rink.ts";
import { verifyClip, type ClipReading } from "../src/clip.ts";
import { matchRinkGame, planClips } from "../src/daily.ts";
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
    { goals: [1], start: 115, seconds: 23 },
    // 400 and 420: 385 to 428, 43 seconds — under the rink's one-minute limit, so one credit.
    { goals: [3, 4], start: 385, seconds: 43 },
  ]);
});

test("goals too far apart for one clip get one each — and a gap alone does not cost a second credit", () => {
  // 100 and 160: 85 to 168 would be 83 seconds, over the minute.
  assert.deepEqual(planClips([located(0, 100), located(1, 160)], new Set([0, 1])).map((c) => c.goals), [[0], [1]]);
  // 100 and 130: separate windows, 85-108 and 115-138, but 85 to 138 is 53 seconds — one clip, one credit.
  assert.deepEqual(planClips([located(0, 100), located(1, 130)], new Set([0, 1])), [{ goals: [0, 1], start: 85, seconds: 53 }]);
});

test("a box score is matched to a rink game by date, time and rink, or not at all", () => {
  const game = { id: "1", date: "2026-10-15", time: "20:30", rink: "Rink 2", status: "Final", gr: "home" as const, home: "h", away: "a", goals: [] };
  const rinkGame = (id: number, date: string, time: string, rink: string) => ({ id, date, time, rink, home: "", away: "" });
  assert.equal(matchRinkGame(game, [rinkGame(42732, "2026-10-15", "20:30", "Rink 2"), rinkGame(1, "2026-10-15", "20:30", "Rink 1")])?.id, 42732);
  assert.equal(matchRinkGame(game, [rinkGame(2, "2026-10-15", "21:30", "Rink 2")]), null);
  // Two candidates is not an answer.
  assert.equal(matchRinkGame(game, [rinkGame(3, "2026-10-15", "20:30", "Rink 2"), rinkGame(4, "2026-10-15", "20:30", "Rink 2")]), null);
});
