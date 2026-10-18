import type { Reading } from "./locate.ts";
import type { OverlayReading } from "./overlay.ts";

/**
 * What the overlay calls a period, turned into what the scoresheet calls it.
 *
 * "1st", "2nd" and "3rd" are taken at their word. Anything else is taken by
 * order: on 2026-10-15 the Rink 2 tile labelled the 3rd period "OT2", and the
 * overtime "OT2" as well. So a label that is not an ordinal is the period after
 * the last ordinal seen, and a clock that jumps back up by more than two
 * minutes under that same label is the period after that — 18:00 running down
 * to 0:20 and then 7:00 was the 3rd and then overtime.
 */

const ORDER = ["1st", "2nd", "3rd", "OT1", "OT2", "OT3"];
const ORDINALS = new Set(["1st", "2nd", "3rd"]);

export function normalizePeriods(rows: (OverlayReading & { t: number })[]): Reading[] {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  let last = -1;
  let odd: { label: string; period: string; clock: number | null } | null = null;
  return sorted.map((r) => {
    let period: string | null = null;
    if (r.period !== null && ORDINALS.has(r.period)) {
      period = r.period;
      last = ORDER.indexOf(r.period);
      odd = null;
    } else if (r.period !== null) {
      const reset = odd !== null && r.clock !== null && odd.clock !== null && r.clock > odd.clock + 120;
      if (odd === null || odd.label !== r.period || reset) {
        last = Math.min(last + 1, ORDER.length - 1);
        odd = { label: r.period, period: ORDER[last]!, clock: null };
      }
      period = odd.period;
      if (r.clock !== null) odd.clock = r.clock;
    }
    return { t: r.t, period, clock: r.clock, home: r.home, away: r.away };
  });
}

/**
 * What the CLOCK says the periods are, for boards whose label cannot be
 * trusted. Summer 2026 on Rink 2 showed "1st" all game in June, "OT2" and
 * "OT3" for the 1st and 3rd on 2026-07-01, and opened every recording on the
 * last game's label. The clock was right throughout.
 *
 * A period is a stretch of the clock counting down, ended by a reset to a
 * higher time. The recording has more such stretches than the game has
 * periods — the end of the game before, a warm-up countdown, the next game's
 * warm-up — so the game's periods are the stretches, in order, that its
 * scoresheet fits best: each goal's time inside its period's stretch of the
 * clock, with longer stretches preferred and the board's own label, where it
 * agrees, as the tie-break. A game's periods follow one another, so a choice
 * that skips a stretch between two of them pays for it: on 2026-07-01 the
 * warm-up countdown, 8:42 down to 0:59, fitted the 1st period's goals as well
 * as the 1st did, and taking it as the 1st put the 1st in the 2nd's place.
 */

export type ClockRun = { from: number; to: number; first: number; last: number; samples: number; period: string | null };

/** How far the clock may climb between two samples and still be one stretch: a misread digit, not a reset. */
const RESET = 60;

export function clockRuns(sweep: { t: number; clock: number | null }[]): ClockRun[] {
  const rows = [...sweep].filter((r) => r.clock !== null).sort((a, b) => a.t - b.t) as { t: number; clock: number }[];
  const runs: ClockRun[] = [];
  for (const [i, r] of rows.entries()) {
    const run = runs.at(-1);
    if (run && r.clock <= run.last + RESET) {
      run.to = r.t; run.last = Math.min(run.last, r.clock); run.samples++;
      continue;
    }
    // Up, and the next reading back down where the run was: a misread digit, not a reset.
    const next = rows[i + 1];
    if (run && next && next.clock <= run.last + RESET) continue;
    runs.push({ from: r.t, to: r.t, first: r.clock, last: r.clock, samples: 1, period: null });
  }
  return runs;
}

/** What skipping a stretch between two periods costs: less than one goal fitting, more than every tie-break. */
const SKIP = 5;

/** How far past the last sample a period's clock may have run before the next sample missed it. */
const SLACK = 130;

/**
 * Which runs are the game's periods: `periods` of them, in order, the
 * scoresheet's goals fitting as many as possible. Labels are the board's,
 * taken at their word (`labelled`), only to break a tie.
 */
export function choosePeriods(runs: ClockRun[], goals: { period: string; time: string }[], labelled: Reading[] = []): ClockRun[] {
  const clock = (t: string) => { const [m, s] = t.split(":").map(Number); return m! * 60 + s!; };
  const count = Math.max(3, ...goals.map((g) => ORDER.indexOf(g.period) + 1));
  const periods = ORDER.slice(0, count);
  const worth = (run: ClockRun, period: string) => {
    let w = 0.2 * run.samples;
    for (const g of goals.filter((g) => g.period === period)) {
      const c = clock(g.time);
      if (c <= run.first + SLACK && c >= run.last - SLACK) w += 10;
    }
    w += 0.1 * labelled.filter((r) => r.period === period && r.t >= run.from && r.t <= run.to).length;
    return w;
  };
  // Longest chain: best[k][i] — periods 0..k with period k on run i.
  const best: { w: number; prev: number }[][] = periods.map(() => runs.map(() => ({ w: -Infinity, prev: -1 })));
  for (const [k, period] of periods.entries()) {
    for (const [i, run] of runs.entries()) {
      const here = worth(run, period);
      if (k === 0) { best[k]![i] = { w: here, prev: -1 }; continue; }
      for (let j = 0; j < i; j++) {
        const w = best[k - 1]![j]!.w + here - SKIP * (i - j - 1);
        if (w > best[k]![i]!.w) best[k]![i] = { w, prev: j };
      }
    }
  }
  const last = best[count - 1]!;
  let i = last.reduce((b, x, n) => (x.w > last[b]!.w ? n : b), 0);
  if (!runs.length || last[i]!.w === -Infinity) return [];
  const chosen: ClockRun[] = [];
  for (let k = count - 1; k >= 0 && i >= 0; k--) {
    chosen.unshift({ ...runs[i]!, period: periods[k]! });
    i = best[k]![i]!.prev;
  }
  return chosen;
}

/**
 * Every reading's period, by the chosen runs. Between two runs — the end of a
 * period after its last sample, or the start of the next before its first —
 * the clock says which: still at or under where the one before got to, or
 * already up near where the next began.
 */
export function periodsByClock(rows: Reading[], chosen: ClockRun[]): Reading[] {
  return rows.map((r) => {
    let period: string | null = null;
    const inside = chosen.find((c) => r.t >= c.from && r.t <= c.to);
    if (inside) period = inside.period;
    else if (r.clock !== null) {
      const before = [...chosen].reverse().find((c) => c.to < r.t), after = chosen.find((c) => c.from > r.t);
      if (before && r.t - before.to <= SLACK && r.clock <= before.last + 2) period = before.period;
      else if (after && after.from - r.t <= SLACK && r.clock >= after.first - 2) period = after.period;
    }
    return { ...r, period };
  });
}
