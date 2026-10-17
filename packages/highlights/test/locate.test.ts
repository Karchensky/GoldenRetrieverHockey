import { test } from "node:test";
import assert from "node:assert/strict";
import { clockDirection, crossings, locateGoals, parseClock, scoreline, type Reading, type ScoredGoal } from "../src/locate.ts";

/**
 * A simulated recording, because the real one cannot live in a public
 * repository. It is built to the shape the 2026-10-15 recording was described
 * as having: someone's practice on the same clock first, then a 12/12/18 game
 * whose clock stops at every whistle, the score going up a few seconds into the
 * stoppage, and an overlay that the reader sometimes cannot make out.
 */

const HOME = "The Golden Retrievers", AWAY = "Buffalo Cigars";

/** Buffalo Cigars at The Golden Retrievers, 2026-10-15, as the scoresheet has it. */
const GOALS: ScoredGoal[] = [
  ["1st", "11:52", AWAY, "Mike Kline"], ["1st", "06:56", AWAY, "Mike Kline"],
  ["1st", "06:42", HOME, "Jason Kaplewicz"], ["1st", "02:22", HOME, "Anthony Christy"],
  ["2nd", "04:36", AWAY, "Mike Kline"], ["3rd", "07:24", AWAY, "Mike Kline"],
  ["3rd", "05:34", HOME, "John Rein"], ["3rd", "02:46", HOME, "Anthony Christy"],
].map(([period, time, team, scorer]) => ({ period: period!, time: time!, team: team!, scorer: scorer!, assists: [], strength: "Even Strength" }));

type Whistle = { period: string; clock: string; hold: number; goal?: boolean };

type Sim = {
  practice?: boolean;
  /** Where the clock actually stops for each goal, when the scorekeeper typed something else. */
  stoppedAt?: Record<number, string>;
  whistles?: Whistle[];
  /** Seconds after the whistle the score goes up, for a goal the board was late with. */
  boardLate?: Record<number, number>;
  showScore?: boolean;
  endAt?: number;
};

function simulate({ practice = true, stoppedAt = {}, whistles = [], boardLate = {}, showScore = true, endAt = Infinity }: Sim = {}) {
  const readings: Reading[] = [];
  const truth: number[] = [];
  const late: { at: number; home: boolean }[] = [];
  let t = 0, home = 0, away = 0;
  const emit = (period: string | null, clock: number | null) => {
    for (const l of late.filter((x) => x.at === t)) l.home ? home++ : away++;
    if (t < endAt) readings.push({ t, period, clock, home: showScore ? home : null, away: showScore ? away : null });
    t++;
  };

  if (practice) {
    // A practice runs the same scoreboard down from 12:00 at 0–0 — straight
    // through every time on this scoresheet's 1st period.
    for (let c = 720; c >= 300; c--) emit("1st", c);
    for (let i = 0; i < 300; i++) emit(null, null);
  }

  const stopsFor = (period: string) => [
    ...GOALS.flatMap((g, i) => g.period === period ? [{ period, clock: stoppedAt[i] ?? g.time, hold: 45, goal: i }] : []),
    ...whistles.filter((w) => w.period === period).map((w) => ({ ...w, goal: undefined as number | undefined })),
  ];
  for (const [period, length] of [["1st", 720], ["2nd", 720], ["3rd", 1080]] as const) {
    const pending = stopsFor(period);
    for (let c = length; c >= 0; c--) {
      emit(period, c);
      for (const s of pending.filter((x) => parseClock(x.clock) === c)) {
        if (s.goal !== undefined) truth[s.goal] = t;
        for (let i = 0; i < s.hold; i++) {
          if (s.goal !== undefined && i === 12) {
            const isHome = GOALS[s.goal]!.team === HOME;
            if (boardLate[s.goal] === undefined) isHome ? home++ : away++;
            else late.push({ at: truth[s.goal]! + boardLate[s.goal]!, home: isHome });
          }
          emit(period, c);
        }
      }
    }
    for (let i = 0; i < 240; i++) emit(period, 0);
  }
  return { readings, truth };
}

/** The whistle is a held reading, so the first held second is where the goal is. */
const near = (actual: number | null, expected: number, slack = 1) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= slack, `expected ~${expected}s, got ${actual}`);

test("parses the scoresheet's clock and keeps the running score", () => {
  assert.equal(parseClock("11:52"), 712);
  assert.equal(parseClock("0:07"), 7);
  assert.throws(() => parseClock("11.52"));
  assert.deepEqual(scoreline(GOALS, HOME, AWAY).at(-1), { home: 4, away: 4 });
  assert.deepEqual(scoreline(GOALS, HOME, AWAY)[2], { home: 1, away: 2 });
  assert.throws(() => scoreline([{ ...GOALS[0]!, team: "Daddio" }], HOME, AWAY), /neither/);
});

test("reads the clock's direction from the readings", () => {
  const { readings } = simulate();
  assert.equal(clockDirection(readings), "down");
  assert.equal(clockDirection(readings.map((r) => ({ ...r, clock: r.clock === null ? null : 1080 - r.clock }))), "up");
});

test("finds all eight goals past a practice that ran the same clock", () => {
  const { readings, truth } = simulate();
  const located = locateGoals(readings, GOALS, HOME, AWAY);
  assert.equal(located.ready, true, JSON.stringify(located.goals.map((g) => g.problem)));
  for (const [i, g] of located.goals.entries()) {
    near(g.t, truth[i]!);
    assert.equal(g.confirmed, true);
  }
  // The practice crossed 1st-period 11:52 too, and was turned down for it.
  assert.equal(located.goals[0]!.candidates.length, 2);
  assert.equal(located.goals[0]!.candidates.filter((c) => c.confirmed).length, 1);
});

test("survives an overlay the reader cannot always make out", () => {
  const { readings, truth } = simulate();
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const noisy = readings.map((r) => {
    const x = random();
    if (x < 0.08) return { ...r, period: null, clock: null, home: null, away: null };
    // A misread digit: 6 for 8, or a score off by one.
    if (x < 0.1 && r.clock !== null) return { ...r, clock: r.clock + 120 };
    if (x < 0.11 && r.home !== null) return { ...r, home: r.home + 1 };
    return r;
  });
  const located = locateGoals(noisy, GOALS, HOME, AWAY);
  assert.equal(located.ready, true, JSON.stringify(located.goals.map((g) => g.problem)));
  for (const [i, g] of located.goals.entries()) near(g.t, truth[i]!, 2);
});

test("one misread is not a crossing", () => {
  const r = (t: number, clock: number): Reading => ({ t, period: "1st", clock, home: 0, away: 0 });
  const readings = [r(0, 720), r(1, 719), r(2, 600), r(3, 717), r(4, 716)];
  assert.deepEqual(crossings(readings, "1st", 700, "down"), []);
});

test("a scorekeeper's time a few seconds off still lands on the whistle", () => {
  // The scoresheet says 11:52; the clock actually froze at 11:54.
  const { readings, truth } = simulate({ stoppedAt: { 0: "11:54" } });
  const located = locateGoals(readings, GOALS, HOME, AWAY);
  assert.equal(located.ready, true);
  near(located.goals[0]!.t, truth[0]!);
  // ...and the other way: the clock froze at 11:50, past the typed time.
  const later = simulate({ stoppedAt: { 0: "11:50" } });
  near(locateGoals(later.readings, GOALS, HOME, AWAY).goals[0]!.t, later.truth[0]!);
});

test("an offside two seconds before a goal is not the goal", () => {
  const { readings, truth } = simulate({ whistles: [{ period: "3rd", clock: "05:36", hold: 30 }] });
  const located = locateGoals(readings, GOALS, HOME, AWAY);
  assert.equal(located.ready, true);
  near(located.goals[6]!.t, truth[6]!);
});

test("a late board is not fooled by a re-drop after the goal", () => {
  // 2026-10-15: the score went up 150s after 1st 11:52, with play long resumed, and
  // the faceoff after the goal was dropped twice — the clock held at 11:51 between.
  const { readings, truth } = simulate({ boardLate: { 0: 150 }, whistles: [{ period: "1st", clock: "11:51", hold: 5 }] });
  const located = locateGoals(readings, GOALS, HOME, AWAY);
  assert.equal(located.ready, true, JSON.stringify(located.goals.map((g) => g.problem)));
  near(located.goals[0]!.t, truth[0]!);
});

test("without a score on the overlay a practice cannot be told apart, and says so", () => {
  const { readings } = simulate({ showScore: false });
  const located = locateGoals(readings, GOALS, HOME, AWAY);
  assert.equal(located.ready, false);
  assert.match(located.goals[0]!.problem!, /fits equally well/);
  // Goals the practice never reached are still placed, but unconfirmed.
  assert.ok(located.goals[4]!.t !== null);
  assert.equal(located.goals[4]!.confirmed, false);
  assert.match(located.goals[4]!.problem!, /never showed/);
});

test("a recording that stops early leaves the missing goals unfound", () => {
  const full = simulate();
  const { readings } = simulate({ endAt: full.truth[6]! - 60 });
  const located = locateGoals(readings, GOALS, HOME, AWAY);
  assert.equal(located.ready, false);
  assert.ok(located.goals.slice(0, 6).every((g) => g.t !== null && g.confirmed));
  assert.equal(located.goals[6]!.t, null);
  assert.equal(located.goals[7]!.t, null);
  assert.match(located.goals[7]!.problem!, /never reaches 02:46/);
});
