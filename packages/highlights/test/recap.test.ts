import { test } from "node:test";
import assert from "node:assert/strict";
import { GOAL_LEAD, GOAL_TAIL, planRecap, SHOT_LEAD, SHOT_TAIL, shotLag, stoppedAfter } from "../src/recap.ts";

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

test("a shot the clock stopped straight after is told from one played on", () => {
  const running = Array.from({ length: 20 }, (_, i) => ({ t: i / 2, clock: 600 - Math.floor(i / 2) }));
  assert.equal(stoppedAfter(running, 2), false);
  const held = running.map((r) => (r.t >= 3 ? { ...r, clock: 597 } : r));
  assert.equal(stoppedAfter(held, 2), true);
});

test("every goal is in the recap, shots fill it to the budget, and plays that touch become one", () => {
  const goals = [{ t: 100, label: "GOAL A" }, { t: 1000, label: "GOAL B" }];
  const shots = [
    { t: 95, label: "Shot", stopped: false }, // the rush before goal A: one play with it
    { t: 400, label: "Shot", stopped: false },
    { t: 700, label: "Shot", stopped: true },
    { t: 702, label: "Shot", stopped: false },
  ];
  const goalLength = GOAL_LEAD + GOAL_TAIL, shotLength = SHOT_LEAD + SHOT_TAIL;
  // Room for the goals and one shot: the one the clock stopped after.
  const tight = planRecap(goals, shots, 2 * goalLength + shotLength + 1);
  assert.deepEqual(tight.map((p) => [p.kind, p.label]), [["goal", "GOAL A"], ["shot", "Shot"], ["goal", "GOAL B"]]);
  assert.equal(tight[1]!.start, 700 - SHOT_LEAD);
  // Room for everything: the shot at 95 merges into goal A, which keeps its label.
  const roomy = planRecap(goals, shots, 1000);
  assert.equal(roomy[0]!.label, "GOAL A");
  assert.equal(roomy[0]!.start, 95 - SHOT_LEAD);
  assert.equal(roomy.length, 4);
  // Goals are never left out for the budget.
  assert.equal(planRecap(goals, shots, 0).filter((p) => p.kind === "goal").length, 2);
});
