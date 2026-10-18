import { calibrate, loadLayouts, readOverlay, type Frame, type Layout, type OverlayReading } from "./overlay.ts";
import { choosePeriods, clockRuns, normalizePeriods, periodsByClock, type ClockRun } from "./periods.ts";
import { parseClock, scoreline, type Reading, type Score, type ScoredGoal } from "./locate.ts";
import { segmentAt, segmentFrames, type Stream } from "./stream.ts";

/**
 * Reading as little of the recording as it takes to find every goal.
 *
 * A two-hour recording is about 1,200 six-second segments. A sweep reads the
 * first frame of every 20th — the shape of the night: the practice or the game
 * before, warm-up, the periods, whatever follows. Then, goal by goal and in
 * scoresheet order, two binary searches: for the segment where the board's
 * score turns into what this goal made it, and for where the clock reached
 * this goal's time. Only the stretch between those two is read densely, two
 * frames a second. On 2026-10-15 that was 138 segments of 1,245.
 *
 * A search moves only on an exact reading of the score before or after: one
 * misread digit once sent it to the wrong segment. Each goal is searched for
 * only after the last, because the recording can open on another game whose
 * board already shows this one's final score — 2026-10-07's did.
 */

export type Found = { layout: Layout; readings: Reading[]; periods: ClockRun[]; fetched: Stream["fetched"] };

const SWEEP = 20;

export async function findGoals(stream: Stream, goals: ScoredGoal[], home: string, away: string, layouts = loadLayouts()): Promise<Found | { problem: string }> {
  const n = stream.segments.length;
  const start = (i: number) => stream.segments[i]!.start;

  // The sweep, read with every board we know, each lined up with this recording; the one whose clock reads is this game's.
  const swept: { t: number; frame: Frame }[] = [];
  for (let i = 0; i < n; i += SWEEP) swept.push(...await segmentFrames(stream, i, 0));
  const ranked = layouts.map((l) => calibrate(swept.map((s) => s.frame), l)).sort((a, b) => b.clocks - a.clocks);
  const frames = swept.length;
  if (!ranked[0] || ranked[0].clocks < frames * 0.25) {
    return { problem: `no known scoreboard on this recording — the best, ${ranked[0]?.layout.name}, read a clock in ${ranked[0]?.clocks ?? 0} of ${frames} sweep frames` };
  }
  const layout = ranked[0].layout;

  // Segment index -> what was read there, at what density.
  const read = new Map<number, { perSecond: number; rows: (OverlayReading & { t: number })[] }>();
  for (const { t, frame } of swept) read.set(segmentAt(stream, t), { perSecond: 0, rows: [{ t, ...readOverlay(frame, layout) }] });
  swept.length = 0;

  // The game's periods, by its clock: the board's label is a hint at most — see `choosePeriods`.
  const sweepRows = [...read.values()].flatMap((v) => v.rows);
  const periods = choosePeriods(clockRuns(sweepRows), goals, normalizePeriods(sweepRows));
  if (!periods.length) return { problem: "the clock on this recording never runs the way a game's periods do" };
  const probe = async (i: number, perSecond: number) => {
    if (i < 0 || i >= n) return;
    const have = read.get(i);
    if (have && have.perSecond >= perSecond) return;
    const rows = (await segmentFrames(stream, i, perSecond)).map(({ t, frame }) => ({ t, ...readOverlay(frame, layout) }));
    read.set(i, { perSecond, rows });
  };
  const readings = () => periodsByClock(normalizePeriods([...read.values()].flatMap((v) => v.rows)), periods);
  const first = (i: number) => readings().find((r) => Math.abs(r.t - start(i)) < 0.01);

  const scores = scoreline(goals, home, away);
  const is = (r: Reading | undefined, s: Score) => !!r && r.home === s.home && r.away === s.away;
  let after0 = -Infinity;

  for (const [g, goal] of goals.entries()) {
    const before = g === 0 ? { home: 0, away: 0 } : scores[g - 1]!, after = scores[g]!;
    const total = after.home + after.away;
    const swept = readings().filter((r) => r.period !== null && r.home !== null && r.t > after0 && Math.abs(r.t - start(segmentAt(stream, r.t))) < 0.01);
    const j = swept.findIndex((r, k) => is(r, after) && swept[k + 1] && (is(swept[k + 1], after) || swept[k + 1]!.home! + swept[k + 1]!.away! > total));
    if (j < 1) continue; // The locator reports it: the clock and the score never meet for this goal.

    // Where the score changes. Only an exact before or after moves a bound.
    let lo = segmentAt(stream, swept[j - 1]!.t), hi = segmentAt(stream, swept[j]!.t);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      let moved = false;
      for (const s of [mid, mid + 1, mid - 1].filter((s) => s > lo && s < hi)) {
        await probe(s, 0);
        const r = first(s);
        if (is(r, after)) { hi = s; moved = true; break; }
        if (is(r, before)) { lo = s; moved = true; break; }
      }
      if (!moved) break;
    }
    const scoreSeg = hi;

    // Where the clock reached the goal's time: last reading before the change still short of it.
    const c = parseClock(goal.time);
    const notYet = (r: Reading | undefined) => !!r && r.period !== null && r.clock !== null && (r.period !== goal.period || r.clock > c);
    const reached = (r: Reading | undefined) => !!r && r.period === goal.period && r.clock !== null && r.clock <= c;
    const above = readings().filter((r) => r.t > after0 && r.t < start(scoreSeg) && notYet(r));
    let clo = above.length ? segmentAt(stream, above.at(-1)!.t) : Math.max(0, scoreSeg - 40), chi = scoreSeg;
    while (chi - clo > 1) {
      const mid = (clo + chi) >> 1;
      await probe(mid, 0);
      const r = first(mid);
      if (notYet(r)) clo = mid; else if (reached(r)) chi = mid; else break;
    }

    // Everything between, densely, until the new score has held for three readings.
    const from = Math.max(0, clo - 1);
    let to = scoreSeg;
    for (let s = from; s <= to; s++) await probe(s, 2);
    const held = () => {
      const rows = readings().filter((r) => r.t >= start(from) && r.t < start(Math.min(to + 1, n - 1)) && r.home !== null);
      return rows.some((r, k) => k + 3 <= rows.length && rows.slice(k, k + 3).every((x) => is(x, after)));
    };
    while (!held() && to < Math.min(scoreSeg + 10, n - 1)) await probe(++to, 2);
    after0 = start(scoreSeg) - 6;
  }
  return { layout, readings: readings(), periods, fetched: stream.fetched };
}
