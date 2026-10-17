/**
 * Where in the rink's recording did each goal happen?
 *
 * The scoresheet says "1st, 11:52". The recording is two hours of wall-clock
 * video that can open on somebody else's practice, and the game clock stops for
 * every whistle — so no offset or scale turns game time into video time. What
 * the recording DOES carry is the broadcast overlay: period, clock and score,
 * painted on every frame. Read that overlay (OCR, elsewhere) into a timeline of
 * readings and the question becomes a search: the moment the overlay's clock in
 * that period reaches the scoresheet's time, confirmed by the score on the
 * overlay changing to what the goal made it.
 *
 * Nothing here guesses. A goal that cannot be found, or that could be in two
 * places, comes back with a `problem` and `ready` goes false — a highlights
 * package with a wrong goal in it is worse than none.
 */

/** One sampled frame of the overlay. Whatever the reader could not make out is null. */
export type Reading = {
  /** Seconds into the recording. */
  t: number;
  /** Normalised to the scoresheet's own labels: "1st", "2nd", "3rd", "OT1". */
  period: string | null;
  /** Seconds shown on the game clock. */
  clock: number | null;
  home: number | null;
  away: number | null;
};

/** The scoresheet's goal, as `site.json` carries it. */
export type ScoredGoal = {
  period: string;
  time: string;
  team: string;
  scorer: string;
  assists: string[];
  strength: string;
};

export type Score = { home: number; away: number };

export type Candidate = { t: number; confirmed: boolean };

export type LocatedGoal = {
  /** Position on the scoresheet. */
  index: number;
  goal: ScoredGoal;
  before: Score;
  after: Score;
  /** Seconds into the recording, or null when it could not be pinned down. */
  t: number | null;
  /** The overlay's score changed from `before` to `after` right there. */
  confirmed: boolean;
  /** Every place the clock reached this goal's time, for the report. */
  candidates: Candidate[];
  problem?: string;
};

export type Location = {
  direction: "down" | "up";
  goals: LocatedGoal[];
  /** Every goal found, once, with the score to prove it. */
  ready: boolean;
};

export type LocateOptions = {
  /** Readings either side of a crossing that must agree, so one misread cannot fake one. */
  agree?: number;
  /** How far the scoresheet's time may sit from where the clock actually stopped. */
  snapSeconds?: number;
  /** A clock that holds one value this long has stopped. */
  stoppedSeconds?: number;
  /** How long after the goal the overlay's score may take to change. */
  scoreLagSeconds?: number;
};

export function parseClock(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Not a game-clock time: "${text}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The score after every goal, in scoresheet order. */
export function scoreline(goals: ScoredGoal[], home: string, away: string): Score[] {
  let h = 0, a = 0;
  return goals.map((g) => {
    if (g.team === home) h++;
    else if (g.team === away) a++;
    else throw new Error(`Goal by "${g.team}", who is neither ${home} nor ${away}`);
    return { home: h, away: a };
  });
}

/**
 * Scoreboards in this league count down, but nothing here depends on it: the
 * readings say which way the clock runs.
 */
export function clockDirection(readings: Reading[]): "down" | "up" {
  let down = 0, up = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1]!, b = readings[i]!;
    if (a.clock === null || b.clock === null || a.period === null || a.period !== b.period) continue;
    const dt = b.t - a.t, dc = b.clock - a.clock;
    if (dt <= 0 || dt > 5 || dc === 0 || Math.abs(dc) > dt + 1) continue;
    if (dc < 0) down++;
    else up++;
  }
  return up > down ? "up" : "down";
}

/**
 * Every moment the clock in `period` reaches `clock`: the first of `agree`
 * readings at or past it, after `agree` readings short of it, so one misread
 * cannot fake a crossing.
 */
export function crossings(
  readings: Reading[], period: string, clock: number, direction: "down" | "up", agree = 2,
): number[] {
  const inPeriod = readings.filter((r) => r.period === period && r.clock !== null);
  const reached = (c: number) => (direction === "down" ? c <= clock : c >= clock);
  const out: number[] = [];
  for (let i = agree; i + agree <= inPeriod.length; i++) {
    const before = inPeriod.slice(i - agree, i), after = inPeriod.slice(i, i + agree);
    if (before.every((r) => !reached(r.clock!)) && after.every((r) => reached(r.clock!))) out.push(inPeriod[i]!.t);
  }
  return out;
}

export type Stop = { start: number; end: number; clock: number };

/**
 * Every stretch where the clock in `period` held one value for `stoppedSeconds`
 * or more. A misread or two in the middle of a stoppage does not end it — split
 * there, a goal's stop would look like it began wherever the misread was.
 */
export function stops(readings: Reading[], period: string, stoppedSeconds = 4, bridgeSeconds = 10): Stop[] {
  const inPeriod = readings.filter((r) => r.period === period && r.clock !== null);
  const runs: Stop[] = [];
  for (let i = 0; i < inPeriod.length;) {
    let j = i;
    while (j + 1 < inPeriod.length && inPeriod[j + 1]!.clock === inPeriod[i]!.clock) j++;
    const run = { start: inPeriod[i]!.t, end: inPeriod[j]!.t, clock: inPeriod[i]!.clock! };
    // Skip back over short runs of other values to a run of this value.
    let k = runs.length - 1;
    while (k >= 0 && runs[k]!.clock !== run.clock && run.start - runs[k]!.end <= bridgeSeconds) k--;
    if (k >= 0 && runs[k]!.clock === run.clock && run.start - runs[k]!.end <= bridgeSeconds) {
      runs[k]!.end = run.end;
      runs.length = k + 1;
    } else {
      runs.push(run);
    }
    i = j + 1;
  }
  return runs.filter((r) => r.end - r.start >= stoppedSeconds);
}

const shows = (r: Reading, s: Score) => r.home === s.home && r.away === s.away;

/**
 * When the overlay's score turned `before` into `after` inside [from, to]: the
 * first of `hold` readings in a row showing `after`, with `before` seen in the
 * minute leading up to it. Two misread digits a second apart are not a goal;
 * a score that stays up is. Null when it never changed — a practice's
 * scoreboard sits at 0–0 the whole time, which is how its clock is told apart
 * from the game's.
 */
export function scoreChange(
  readings: Reading[], before: Score, after: Score, from: number, to: number, hold = 3,
): number | null {
  const scored = readings.filter((r) => r.home !== null && r.away !== null && r.t >= from - 60 && r.t <= to + 60);
  let lastBefore = -Infinity;
  for (let i = 0; i + hold <= scored.length; i++) {
    const r = scored[i]!;
    if (shows(r, before)) lastBefore = r.t;
    if (r.t < from || r.t > to || r.t - lastBefore > 60) continue;
    if (scored.slice(i, i + hold).every((x) => shows(x, after))) return r.t;
  }
  return null;
}

/**
 * Where one crossing puts the goal. The goal is the whistle, not the crossing:
 * the clock stops on it and the score goes up during that stop. So once the
 * score has changed, the goal is the stop near the scoresheet's time that the
 * score went up in — which also catches a scorekeeper typing 11:48 for a goal
 * the clock froze on at 11:50, and ignores an offside two seconds earlier
 * because the score did not change during that one.
 *
 * A late board puts the score up after play has resumed, inside no stop at all:
 * on 2026-10-15 it went up two and a half minutes after 1st 11:52, past a
 * re-dropped faceoff that held the clock at 11:51. Then the goal is the longest
 * stop near the time — a goal brings a centre-ice faceoff, an offside or a
 * re-drop does not. A clock that never stops leaves the crossing itself.
 */
function settle(
  readings: Reading[], goal: ScoredGoal, before: Score, after: Score, t0: number,
  { snapSeconds = 3, stoppedSeconds = 4, scoreLagSeconds = 180 }: LocateOptions,
): Candidate {
  const s = scoreChange(readings, before, after, t0 - 120, t0 + scoreLagSeconds);
  if (s === null) return { t: t0, confirmed: false };
  const clock = parseClock(goal.time);
  const near = stops(readings, goal.period, stoppedSeconds)
    .filter((x) => x.start <= s && x.start >= s - 300 && Math.abs(x.clock - clock) <= snapSeconds);
  const stop = near.find((x) => s <= x.end + 3) ?? [...near].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (stop) return { t: stop.start, confirmed: true };
  return t0 <= s ? { t: t0, confirmed: true } : { t: t0, confirmed: false };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

/**
 * A running median over each period's clock and over the score: an isolated
 * misread — a 6 taken for an 8 — disappears, and a clock that is really running
 * or really stopped comes through unchanged, so no crossing moves.
 */
export function smooth(readings: Reading[], width = 2): Reading[] {
  const out = readings.map((r) => ({ ...r }));
  const apply = (rows: Reading[], pick: (r: Reading) => number, put: (r: Reading, v: number) => void) => {
    const values = rows.map(pick);
    rows.forEach((r, i) => put(r, median(values.slice(Math.max(0, i - width), i + width + 1))));
  };
  for (const period of new Set(out.map((r) => r.period))) {
    if (period === null) continue;
    apply(out.filter((r) => r.period === period && r.clock !== null), (r) => r.clock!, (r, v) => { r.clock = v; });
  }
  const scored = out.filter((r) => r.home !== null && r.away !== null);
  apply(scored, (r) => r.home!, (r, v) => { r.home = v; });
  apply(scored, (r) => r.away!, (r, v) => { r.away = v; });
  return out;
}

export function locateGoals(
  readings: Reading[], goals: ScoredGoal[], home: string, away: string, options: LocateOptions = {},
): Location {
  const sorted = smooth([...readings].sort((a, b) => a.t - b.t));
  const direction = clockDirection(sorted);
  const scores = scoreline(goals, home, away);

  const located: LocatedGoal[] = goals.map((goal, index) => {
    const before = index === 0 ? { home: 0, away: 0 } : scores[index - 1]!;
    const after = scores[index]!;
    const settled = crossings(sorted, goal.period, parseClock(goal.time), direction, options.agree)
      .map((t0) => settle(sorted, goal, before, after, t0, options));
    // Two crossings either side of one stoppage settle on the same whistle.
    const candidates = settled.filter((c, i) => settled.findIndex((d) => d.t === c.t) === i);
    return { index, goal, before, after, t: null, confirmed: false, candidates };
  });

  choose(located);
  for (const g of located) {
    if (g.problem || g.t === null) continue;
    if (!g.confirmed) {
      g.problem = `The overlay never showed ${g.before.home}–${g.before.away} becoming ${g.after.home}–${g.after.away} here.`;
    }
  }
  return { direction, goals: located, ready: located.every((g) => g.t !== null && g.confirmed) };
}

/**
 * Pick one candidate per goal, in order, so the most goals are confirmed by the
 * score. A practice on the same sheet of ice runs the same clock past the same
 * times — the score is what tells the game apart from it, and the order of the
 * goals is what tells a 1st-period 11:52 from the next one.
 *
 * Longest weighted chain, forwards and backwards: a candidate sits on SOME best
 * chain exactly when its two halves add up to the best total. One such
 * candidate per goal is an answer; two is a goal that could be in two places.
 */
function choose(goals: LocatedGoal[]): void {
  type Node = { g: number; c: Candidate; w: number; f: number; b: number };
  const nodes: Node[] = goals.flatMap((goal, g) =>
    goal.candidates.map((c) => ({ g, c, w: c.confirmed ? 2 : 1, f: 0, b: 0 })));
  for (const n of nodes) {
    const prior = nodes.filter((m) => m.g < n.g && m.c.t < n.c.t && m.f > 0);
    n.f = n.w + Math.max(0, ...prior.map((m) => m.f));
  }
  for (const n of [...nodes].reverse()) {
    const later = nodes.filter((m) => m.g > n.g && m.c.t > n.c.t && m.b > 0);
    n.b = n.w + Math.max(0, ...later.map((m) => m.b));
  }
  const best = Math.max(0, ...nodes.map((n) => n.f));

  for (const [g, goal] of goals.entries()) {
    const label = `${goal.goal.period} ${goal.goal.time}`;
    if (goal.candidates.length === 0) {
      goal.problem = `The overlay's ${goal.goal.period}-period clock never reaches ${goal.goal.time}.`;
      continue;
    }
    const onBest = nodes.filter((n) => n.g === g && n.f + n.b - n.w === best);
    if (onBest.length === 1) {
      goal.t = onBest[0]!.c.t;
      goal.confirmed = onBest[0]!.c.confirmed;
    } else if (onBest.length === 0) {
      goal.problem = `${label} only appears out of order with the goals around it.`;
    } else {
      goal.problem = `${label} fits equally well at ${onBest.map((n) => n.c.t.toFixed(0) + "s").join(" and ")}.`;
    }
  }
}
