import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOAL_LEAD, GOAL_TAIL, planRecap, SHOT_LEAD, SHOT_TAIL, shotLag, stoppages, stoppedAt, WHISTLE_LEAD, WHISTLE_TAIL,
  type Candidate,
} from "../src/recap.ts";

test("the board's lag behind a shot is measured on the goals, the middle of them", () => {
  const goals = [{ t: 100, side: "home" as const }, { t: 500, side: "away" as const }, { t: 900, side: "home" as const }];
  const marks = [
    { t: 104, side: "home" as const, count: 3 }, { t: 503, side: "away" as const, count: 9 },
    // A late press, 20 seconds on, does not move the answer.
    { t: 920, side: "home" as const, count: 12 },
    // The other side's count going up is not this goal's.
    { t: 101, side: "away" as const, count: 2 },
  ];
  assert.equal(shotLag(goals, marks), 4);
  assert.equal(shotLag(goals, []), null);
});

test("a whistle is a clock that ran into a segment and held through the next two", () => {
  const seg = (i: number, clock: number | null) => ({ i, t: i * 6, clock });
  // Running 6:00, 5:55, then held at 5:52 across two segment starts: a whistle in segment 1.
  assert.deepEqual(stoppages([seg(0, 360), seg(1, 355), seg(2, 352), seg(3, 352)]), [{ segment: 1, clock: 352 }]);
  // Held once only is a coincidence of sampling, not a stoppage; a jump of minutes is a new period, not a whistle.
  assert.deepEqual(stoppages([seg(0, 360), seg(1, 355), seg(2, 355), seg(3, 349)]), [{ segment: 0, clock: 355 }]);
  assert.deepEqual(stoppages([seg(0, 30), seg(1, 720), seg(2, 720)]), []);
  assert.deepEqual(stoppages([seg(0, 360), seg(1, null), seg(2, 352), seg(3, 352)]), []);
});

test("the whistle is the first of four readings that agree on the stopped time", () => {
  const dense = [
    { t: 0, clock: 356 }, { t: 0.5, clock: 355 }, { t: 1, clock: 355 }, { t: 1.5, clock: 354 },
    { t: 2, clock: 353 }, { t: 2.5, clock: 353 }, { t: 3, clock: null }, { t: 3.5, clock: 353 }, { t: 4, clock: 353 },
  ];
  assert.equal(stoppedAt(dense, 353), 2);
  assert.equal(stoppedAt(dense, 340), null);
});

const shot = (t: number, worth = 2): Candidate => ({ t, kind: "shot", label: "Shot", worth });
const whistle = (t: number): Candidate => ({ t, kind: "whistle", label: "2nd 5:00", worth: 1 });

test("every goal is in the recap; the rest fill it most-worth first, and plays that touch become one", () => {
  const goals = [{ t: 100, label: "GOAL A" }, { t: 1000, label: "GOAL B" }];
  const goalLength = GOAL_LEAD + GOAL_TAIL, shotLength = SHOT_LEAD + SHOT_TAIL;
  // Room for the goals and one shot: the one the clock stopped on beats a plain shot and a whistle.
  const tight = planRecap(goals, [shot(400), whistle(600), shot(700, 3)], 2 * goalLength + shotLength + 1);
  assert.deepEqual(tight.map((p) => [p.kind, p.start]), [["goal", 100 - GOAL_LEAD], ["shot", 700 - SHOT_LEAD], ["goal", 1000 - GOAL_LEAD]]);
  // Room for everything: the shot just before goal A joins it, and the goal keeps its label.
  const roomy = planRecap(goals, [shot(95), shot(400), whistle(600)], 1000);
  assert.equal(roomy[0]!.label, "GOAL A");
  assert.equal(roomy[0]!.start, 95 - SHOT_LEAD);
  assert.deepEqual(roomy.map((p) => p.kind), ["goal", "shot", "whistle", "goal"]);
  assert.equal(roomy[2]!.end - roomy[2]!.start, WHISTLE_LEAD + WHISTLE_TAIL);
  // Goals are never left out for the budget.
  assert.equal(planRecap(goals, [shot(400)], 0).filter((p) => p.kind === "goal").length, 2);
});

test("among plays of equal worth, the one furthest from what is in goes first", () => {
  const goals = [{ t: 100, label: "GOAL" }];
  const one = planRecap(goals, [shot(130), shot(900)], GOAL_LEAD + GOAL_TAIL + SHOT_LEAD + SHOT_TAIL + 1);
  assert.deepEqual(one.map((p) => p.start), [100 - GOAL_LEAD, 900 - SHOT_LEAD]);
});
