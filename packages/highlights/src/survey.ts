import fs from "node:fs";
import path from "node:path";
import { checkClip, LEAD, matchRinkGame, TAIL, type Options } from "./daily.ts";
import { findGoals } from "./find.ts";
import { locateGoals, type LocatedGoal } from "./locate.ts";
import { gameDetails, ourTeams, recordedGames, signIn } from "./rink.ts";
import { cutClip, openStream } from "./stream.ts";

/**
 * How well the goal search holds up: every game in a stretch of dates searched
 * the way the daily job searches it, and each goal — ours and theirs — reported
 * found and confirmed, or why not. Theirs count too: the search is the same,
 * and twice the goals is twice the test.
 *
 * Read only. Spends no download, uploads nothing, writes nothing but each
 * game's readings and result to `dir(game)` (tmp/highlights/<id>/), so the
 * locator can be run again on them by hand with `cli.ts locate`.
 */

type SiteGame = Options["games"][number];
export type SurveyRow = {
  game: string; date: string; index: number; label: string; ours: boolean; t: number | null; confirmed: boolean; problem?: string;
  /** With `clips`: what the clip checks said of a clip of it cut from the recording — true, or why not. */
  clip?: true | string;
};

export async function survey(o: {
  games: SiteGame[];
  credentials: Options["credentials"];
  dir: (game: string) => string;
  log: (line: string) => void;
  /** Games searched at once. */
  parallel?: number;
  /** Cut each goal found from the recording, as the backup would, and put it through the clip checks. Kept in `dir(game)`. */
  clips?: boolean;
}): Promise<SurveyRow[]> {
  const s = await signIn(o.credentials().email, o.credentials().password);
  const since = o.games.map((g) => g.date).sort()[0]!;
  const rinkGames = await recordedGames(await ourTeams(), since);
  const rows: SurveyRow[] = [];
  const queue = [...o.games];

  async function one(game: SiteGame): Promise<void> {
    const label = `${game.date} ${game.away} at ${game.home} (${game.id})`;
    const us = game.gr === "home" ? game.home : game.away;
    const all = (problem: string) => game.goals.forEach((g, index) =>
      rows.push({ game: game.id, date: game.date, index, label: `${g.period} ${g.time}`, ours: g.team === us, t: null, confirmed: false, problem }));
    const hit = matchRinkGame(game, rinkGames);
    if (!hit) { o.log(`${label}: not on the rink's video site`); return all("not on the rink's video site"); }
    const d = await gameDetails(s, hit.id);
    if (d.live || !d.streamUrl) { o.log(`${label}: no recording`); return all("no recording"); }
    const stream = await openStream(d.streamUrl);
    const started = Date.now();
    const found = await findGoals(stream, game.goals, game.home, game.away);
    const dir = o.dir(game.id);
    fs.mkdirSync(dir, { recursive: true });
    if ("problem" in found) { o.log(`${label}: ${found.problem}`); return all(found.problem); }
    fs.writeFileSync(path.join(dir, "readings.jsonl"), found.readings.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const located = locateGoals(found.readings, game.goals, game.home, game.away);
    fs.writeFileSync(path.join(dir, "located.json"), JSON.stringify({ rinkGame: hit.id, board: found.layout.name, ...located }, null, 2) + "\n");
    const ok = located.goals.filter((g: LocatedGoal) => g.t !== null && g.confirmed).length;
    o.log(`${label}: board ${found.layout.name}, ${found.fetched.segments} of ${stream.segments.length} segments fetched in ${Math.round((Date.now() - started) / 1000)}s — ${ok} of ${game.goals.length} goals found`);
    const best = o.clips ? await openStream(d.streamUrl, "best") : null;
    for (const g of located.goals) {
      const row: SurveyRow = { game: game.id, date: game.date, index: g.index, label: `${g.goal.period} ${g.goal.time}`, ours: g.goal.team === us, t: g.t, confirmed: g.confirmed, ...(g.problem ? { problem: g.problem } : {}) };
      if (best && g.t !== null && g.confirmed) {
        const start = Math.round(Math.max(0, g.t - LEAD) * 10) / 10;
        const file = path.join(dir, `${g.index}-${g.goal.period}-${g.goal.time.replace(":", "")}.mp4`);
        try {
          await cutClip(best, start, LEAD + TAIL, file);
          const checked = await checkClip(game, { at: [g.t], clocks: [g.clock], start, seconds: LEAD + TAIL }, [g.index], file, stream);
          row.clip = typeof checked === "string" ? checked : true;
        } catch (e) {
          row.clip = (e as Error).message;
        }
      }
      rows.push(row);
    }
  }

  await Promise.all(Array.from({ length: o.parallel ?? 3 }, async () => {
    for (let game = queue.shift(); game; game = queue.shift()) {
      try { await one(game); } catch (e) { o.log(`${game.date} ${game.id}: ${(e as Error).message}`); }
    }
  }));
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
}
