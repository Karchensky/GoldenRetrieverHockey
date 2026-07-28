/**
 * How a figure is set, everywhere.
 *
 * Three shapes were being written out by hand at every point of render and
 * drifting apart as they went: a thousands separator applied to `1,239 pts` and
 * omitted from the `1239` at the other end of the same row; a record printed
 * `141–120` in the masthead and `141–120–2` two sections down; a count printed
 * `1 seasons` on half the tiles in the player index. None of those are opinions,
 * so none of them belong to a component.
 */

/** A count with its noun, agreeing. */
export const plural = (n: number, word: string, many = `${word}s`): string =>
  `${num(n)} ${n === 1 ? word : many}`;

/** Thousands separated above 999, and never below it. */
export const num = (n: number): string => n.toLocaleString("en-GB");

/**
 * A won–lost record, WITH ITS TIES.
 *
 * The hero used to drop them, so the same 263 games read 141–120 at the top of
 * the archive and 141–120–2 nine thousand pixels down. A tie is a result; the
 * only reason to leave the third figure off is that there were none.
 */
export const record = (w: number, l: number, t = 0): string =>
  `${w}–${l}${t > 0 ? `–${t}` : ""}`;

/**
 * A league standings row, IN THE SAME GRAMMAR AS A GAME LOG.
 *
 * The standings publish five columns — W-L-OTW-OTL-SOL — and printing that
 * string verbatim put two record grammars in one column of the season record.
 * "11–6–2" is eleven wins, six losses and two ties on every row counted off the
 * games, and on this one it meant eleven regulation wins, six losses and two
 * OVERTIME WINS. That team went 13–6, and the best fall/winter finish in the
 * file was published two wins short with two ties nobody played. 2018-19 grew a
 * fourth figure — "9–12–1–1" — that no other row in the column has.
 *
 * A win in overtime is a win and a loss in overtime is a loss, which is what
 * the league's own points column says: 11×3 + 2×2 = 37, and 9×3 + 1×2 + 1×1 =
 * 30. Ties stay ties; no source on file records one in this form.
 */
export const leagueRecord = (row: {
  w: number | null;
  l: number | null;
  otw: number | null;
  otl: number | null;
}): string => record((row.w ?? 0) + (row.otw ?? 0), (row.l ?? 0) + (row.otl ?? 0));

/**
 * A division as the archive should set it, not as four platforms spell it.
 *
 * One source writes "Bronze A" and another "Bronze A Division" for the same
 * three seasons, so a player's own page read "Bronze A · Points" beside
 * "Bronze A Division · Goals" — two names on adjacent rows for one division. The
 * stored value is untouched; this is the render boundary, like `positionsOf`.
 */
export const divisionName = (division: string): string =>
  division.replace(/\s+Division$/i, "").trim();
