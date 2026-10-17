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
