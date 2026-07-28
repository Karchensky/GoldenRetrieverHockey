import { data, ourSide } from "./data";
import type { Player } from "../../../packages/build/src/types";

export type BestGameResult = {
  date: string;
  session: string;
  opponent: string;
  gf: number;
  ga: number;
  result: "W" | "L" | "T";
  goals: number;
  assists: number;
  points: number;
};

/**
 * EVERY SPELLING A SCOREKEEPER USED FOR HIM, because a scoresheet is not
 * canonicalised and never should be — it says what it says.
 *
 * This matched the canonical name alone, so a man whose sheets spell him
 * another way scored nothing on his own page: Vincent Terrana's best game was a
 * five-point night with a six-point one on file under "Vinny Terana", and Jon
 * Gingrich had no best game at all with a goal on a sheet under "Jonathan".
 * `lib/hubs.ts` has resolved penalties through exactly this set since it was
 * built — the canonical name, every alias, and every form he was recorded
 * under. This is the same set, in the one place that was still comparing
 * strings.
 */
const formsOf = (player: Player): ReadonlySet<string> =>
  new Set([player.name, ...player.aliases, ...player.seasons.map((s) => s.recordedAs)]);

export function bestGame(player: Player): BestGameResult | null {
  const names = formsOf(player);
  let best: BestGameResult | null = null;

  for (const g of data.games) {
    if (!g.goals || g.goals.length === 0) continue;
    if (g.result === null) continue;

    /**
     * OUR GOALS. `game.goals` holds both teams' — every goal on the sheet, in
     * the order the scorekeeper wrote them — and this counted all of them.
     *
     * The section says "here is your best night in a Golden Retrievers shirt",
     * and on four pages it named a night the reader scored on this club: Casey
     * Krug's read "L 3–7 vs Busch League · 13 Jun 2024", a Busch League goal
     * and a Busch League assist, in a session eight years after his last line
     * on file. Jeff Antolos's two goals and two assists were the Burners'. The
     * trap HANDOFF.md opens with — a shared name proves nothing, because these
     * players skate for two and three clubs at once — arriving through the one
     * surface that had no side test in it. `game.gr` is the test, and it is the
     * same one the penalties have always used.
     *
     * Krug now has no best game at all and the section does not render, which
     * is the honest answer: the archive holds no Retrievers goal with his name
     * on it.
     */
    const us = ourSide(g);
    let goals = 0;
    let assists = 0;
    for (const ev of g.goals) {
      if (ev.team !== us) continue;
      if (names.has(ev.scorer)) goals++;
      if (ev.assists.some((who) => names.has(who))) assists++;
    }

    const points = goals + assists;
    if (points === 0) continue;
    if (!best || points > best.points || (points === best.points && goals > best.goals)) {
      best = {
        date: g.date,
        session: g.session,
        opponent: g.opponent,
        gf: g.gf ?? 0,
        ga: g.ga ?? 0,
        result: g.result,
        goals,
        assists,
        points,
      };
    }
  }

  return best;
}
