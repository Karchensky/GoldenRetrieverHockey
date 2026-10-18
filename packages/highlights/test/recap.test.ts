import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardClock, GOAL_LEAD, PENALTY_LEAD, PENALTY_UNTIMED_LEAD, placePenalties, GOAL_TAIL, planRecap, SHOT_LEAD, SHOT_TAIL, shotLag, stoppages, stoppedAt, WHISTLE_LEAD, WHISTLE_TAIL,
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

test("a chance shows its own stretch of play, and a whistle it runs into is the same play, under the chance's name", () => {
  const goals = [{ t: 100, label: "GOAL" }];
  const rush: Candidate = { t: 500, kind: "chance", label: "Chance", worth: 1.2, lead: 4, tail: 9 };
  const plays = planRecap(goals, [rush, { ...whistle(512), label: "2nd 4:00" }], 1000);
  assert.deepEqual(plays.map((p) => [p.kind, p.start, p.end, p.label]), [["goal", 100 - GOAL_LEAD, 100 + GOAL_TAIL, "GOAL"], ["chance", 496, 513, "Chance"]]);
  // Worth more than a whistle the zone of which is unknown, less than a shot.
  const tight = planRecap(goals, [whistle(800), rush, shot(300)], GOAL_LEAD + GOAL_TAIL + SHOT_LEAD + SHOT_TAIL + 14);
  assert.deepEqual(tight.map((p) => p.kind), ["goal", "shot", "chance"]);
});

test("the clock between two readings: running, the time between them; stopped, the time they share", () => {
  const at = boardClock([{ t: 0, clock: 600 }, { t: 6, clock: 594 }, { t: 12, clock: 590 }, { t: 18, clock: 590 }, { t: 24, clock: null }, { t: 30, clock: 590 }]);
  assert.deepEqual(at(3), { clock: 597, running: true });
  // A whistle inside the six seconds: the clock runs on until it reaches the stopped time, and no further.
  assert.deepEqual(at(8), { clock: 592, running: true });
  assert.deepEqual(at(11), { clock: 590, running: true });
  assert.deepEqual(at(15), { clock: 590, running: false });
  // A reading missed is bridged, up to eight seconds either side; past that, nothing is said.
  assert.deepEqual(at(25), { clock: 590, running: false });
  assert.equal(at(40), null);
  // The clock set back up for a new period is not running time.
  assert.equal(boardClock([{ t: 0, clock: 2 }, { t: 6, clock: 900 }])(3)?.running, false);
});

test("a penalty is the whistle that called it — on time, or a delayed call blown seconds later — or else the moment the clock showed its time", () => {
  const periods = [
    { from: 1000, to: 2000, first: 900, last: 0, samples: 160, period: "2nd" },
    { from: 2100, to: 2500, first: 420, last: 0, samples: 60, period: "OT" },
  ];
  const whistles = [{ t: 1300, clock: 600 }, { t: 1520, clock: 372 }, { t: 2200, clock: 330 }];
  const readings = [{ t: 1700, clock: 210 }, { t: 1706, clock: 204 }];
  const pen = (period: string, time: string, team: string, detail: string) => ({ period, time, team, detail });
  const placed = placePenalties([
    pen("2nd", "10:00", "Buffalo Cigars", "#28 Christian Nati Hooking (Minor) 02:00"),
    // Delayed: the infraction at 6:30, the whistle at 6:12 once they touched the puck.
    pen("2nd", "06:30", "The Golden Retrievers", "#28 John Rein Tripping (Minor) 02:00"),
    // No whistle within half a minute after: the moment the clock passed 3:25.
    pen("2nd", "03:25", "The Golden Retrievers", "#4 Anthony Galante Roughing (Major) 05:00"),
    // The scoresheet's OT1 is the overtime the clock found.
    pen("OT1", "05:30", "The Golden Retrievers", "#96 Adam Kaplewicz Hooking (Minor) 02:00"),
    // A period the recording never showed is left out.
    pen("3rd", "01:00", "Buffalo Cigars", "#9 Someone Slashing (Minor) 02:00"),
  ], whistles, periods, readings);
  assert.deepEqual(placed.map((p) => [p.t, p.lead]), [[1300, PENALTY_LEAD], [1520, PENALTY_LEAD], [1706, PENALTY_UNTIMED_LEAD], [2200, PENALTY_LEAD]]);
  assert.equal(placed[0]!.label, "PENALTY  #28 Christian Nati Hooking  ·  Buffalo Cigars  ·  2nd 10:00");
  assert.equal(placed[2]!.label, "PENALTY  #4 Anthony Galante Roughing (Major)  ·  The Golden Retrievers  ·  2nd 03:25");
  // Roughing both ways at one whistle: one play, both named.
  const both = placePenalties([pen("2nd", "10:00", "A", "#4 Anthony Galante Roughing (Minor) 02:00"), pen("2nd", "10:00", "B", "#77 Kevin Hoddick Roughing (Minor) 02:00")], whistles, periods, readings);
  assert.deepEqual(both.map((p) => p.label), ["PENALTY  #4 Anthony Galante Roughing, #77 Kevin Hoddick Roughing  ·  2nd 10:00"]);
});
