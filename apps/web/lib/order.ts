/**
 * THE ORDER THE ARCHIVE'S TWO SPINE CHARTS DRAW THEIR ROWS IN.
 *
 * `Session history` (`SPANS`, hubs.ts) and `Career timelines` (`TRACES`,
 * stats.ts) sit within a screen of each other on /seasons, on one session axis,
 * answering presence and magnitude. A reader who has just read down one should
 * find the same men in the same places in the other.
 *
 * It lives in a file of its own because it cannot live in either of theirs.
 * hubs.ts already imports SPINE and ROLLUPS from stats.ts, so stating the order
 * in stats.ts and importing it into hubs.ts is fine, but stating it in hubs.ts
 * and importing it back would close a cycle that bites at module init. Stating
 * it twice was the other option and it is the failure this repository keeps
 * finding in itself — a rule corrected in one file and left standing in
 * another. This module imports nothing, so neither can it.
 *
 * The two charts also disagree about what a row IS: a span row carries session
 * SORTS for first and last, a trace carries spine INDICES. Both run the same
 * way, and an order only needs that, so these compare numbers and do not care
 * which scale they are on.
 */

/** What either chart's row must be able to answer to be put in order. */
export type Spanned = {
  name: string;
  sessions: number;
  first: number;
  last: number;
};

/**
 * The archive's own order: by arrival, then by how long the man lasted.
 *
 * It is the order the rows are drawn in below the men still playing, and it is
 * also the order the longest-absence tie is named in — so that figure does not
 * change its wording because the chart above it was re-sorted.
 */
export const byArrival = (a: Spanned, b: Spanned): number =>
  a.first - b.first || b.last - a.last || b.sessions - a.sessions || a.name.localeCompare(b.name);

/**
 * Deepest tenure first — how the men still playing are ordered among themselves.
 *
 * The tiebreaks are not decoration. Measured over the current group on
 * 2026-08-04, ordering on name alone instead of arrival moves four men: Brent
 * Boeing and Brendan Kaplewicz swap on 20 sessions, Anthony Orange and Sean
 * McCormick on one. Arrival is what makes the two charts agree.
 */
export const byTenure = (a: Spanned, b: Spanned): number =>
  b.sessions - a.sessions || a.first - b.first || a.name.localeCompare(b.name);

/**
 * Lift the men still playing to the front, deepest tenure first.
 *
 * A SECOND PASS over `byArrival`, never one compound comparator, because
 * `sort` is stable: everybody who is not current compares equal here and keeps
 * the order the arrival pass put them in. That is what makes the lower two
 * thirds read as a history rather than a list.
 *
 * The predicate is the caller's because the two charts name the window
 * differently — `current` on a span row, `recent` on a trace — and they are
 * derived from different things. If those two ever stop marking the same men,
 * the charts will diverge no matter what this file does.
 */
export const currentFirst =
  <T extends Spanned>(isCurrent: (row: T) => boolean) =>
  (a: T, b: T): number =>
    Number(isCurrent(b)) - Number(isCurrent(a)) ||
    (isCurrent(a) && isCurrent(b) ? byTenure(a, b) : 0);
