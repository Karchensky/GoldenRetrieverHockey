/**
 * Which clip a box score shows beside a goal — the page's rule, here so that
 * the page (`apps/web/app/games/[id]`) and the tests share one copy of it.
 *
 * `goal` in a Highlight is the goal's place on the scoresheet when it was
 * clipped, and names the files; it is NOT how a clip is found. A scoresheet can
 * be corrected after the fact — a missing goal added, the order changed — and
 * a clip attached by position would then sit beside somebody else's goal. So a
 * clip is shown beside the goal of ours with its period and time, and beside
 * nothing at all if no such goal is left.
 */

export type Highlight = { goal: number; period: string; time: string; scorer: string; clip: string; poster: string; seconds: number };

/**
 * A game's recap as the page shows it: its files, how long it runs, what is
 * in it, and the scoresheet it was made from — the daily job makes it again
 * for a corrected one. Here, with the clip's shape, so the page never imports
 * the job.
 */
export type Recap = { clip: string; poster: string; seconds: number; goals: number; of: number; shots: number; whistles: number; sheet: string };

type Goal = { period: string; time: string; team: string };

/** The clip beside goal `n` of this scoresheet, if any: only ever one of `us`, and only the one goal at that period and time. */
export function clipBeside(clips: readonly Highlight[] | undefined, goals: readonly Goal[], n: number, us: string): Highlight | undefined {
  const goal = goals[n];
  if (!goal || goal.team !== us) return undefined;
  // Two goals at one period and time would make it a guess: neither gets it.
  if (goals.filter((x) => x.period === goal.period && x.time === goal.time).length !== 1) return undefined;
  return clips?.find((h) => h.period === goal.period && h.time === goal.time);
}
