import fs from "node:fs";
import path from "node:path";
import { clipBeside, type Highlight } from "./beside.ts";
import { describe } from "./clip.ts";
import { checkClip, currentGoals, download, type GameEntry, type Options } from "./daily.ts";
import { gameDetails, myMoments, signIn } from "./rink.ts";
import { cutClip, openStream } from "./stream.ts";

/**
 * The backup beside the download, for a person to look at before trusting it:
 * every clip of one game the rink rendered, cut again from the recording and
 * put through the same two checks a published clip gets, and the rink's own
 * file saved next to it when its link still works.
 *
 * Writes to `dir` (tmp/highlights/<game>/, gitignored) and nowhere else. Spends
 * no download — fetching a file the rink already rendered is not asking for one
 * — and uploads nothing. Returns how many cuts failed a check.
 */
export async function compare(o: {
  game: Options["games"][number];
  entry: GameEntry;
  highlights: Highlight[] | undefined;
  credentials: Options["credentials"];
  dir: string;
  log: (line: string) => void;
}): Promise<number> {
  const { game, entry } = o;
  if (entry.rinkGame === null) throw new Error(`game ${game.id} has no rink game in the ledger yet`);
  const clips = entry.clips.filter((c) => c.status === "published" || c.status === "requested");
  if (!clips.length) throw new Error(`game ${game.id} has no clip the rink rendered to compare with`);

  const s = await signIn(o.credentials().email, o.credentials().password);
  const d = await gameDetails(s, entry.rinkGame);
  if (d.live || !d.streamUrl) throw new Error(`game ${game.id}: no recording on the rink's video site`);
  const [lightest, best] = [await openStream(d.streamUrl), await openStream(d.streamUrl, "best")];
  o.log(`Read the board on ${lightest.variant}; cutting from ${best.variant}.`);
  const moments = await myMoments(s, entry.rinkGame);
  fs.mkdirSync(o.dir, { recursive: true });

  let failed = 0;
  for (const c of clips) {
    const which = c.labels?.join(", ") ?? `goal ${c.goals.join(",")}`;
    const now = currentGoals(game, c);
    if (now.some((n) => n === null)) { o.log(`${which}: the scoresheet has changed since it was clipped — skipped`); continue; }
    const name = `${c.start}s+${c.seconds}s`;
    const cut = path.join(o.dir, `${name}-recording.mp4`);
    await cutClip(best, c.start, c.seconds, cut);
    o.log(`${which}`);
    o.log(`  cut from the recording  ${describe(cut)}  ${path.relative(process.cwd(), cut)}`);

    const url = moments.find((m) => m.id === c.moment)?.download?.url;
    if (url) {
      const rink = path.join(o.dir, `${name}-download.mp4`);
      try {
        await download(url, rink);
        o.log(`  the rink's download     ${describe(rink)}  ${path.relative(process.cwd(), rink)}`);
      } catch (e) {
        o.log(`  the rink's download     ${(e as Error).message}`);
      }
    } else {
      o.log(`  the rink's download     no link from the rink any more`);
    }
    for (const n of now as number[]) {
      const shown = clipBeside(o.highlights, game.goals, n);
      if (shown) o.log(`  on the site             /highlights/${shown.clip}`);
    }

    const checked = await checkClip(game, c, now as number[], cut, lightest);
    if (typeof checked === "string") { failed++; o.log(`  CHECK FAILED: ${checked}`); }
    else o.log(`  both checks pass: ${checked.map((g) => `${g.goal.period} ${g.goal.time} at ${g.goalAt.toFixed(1)}s`).join(", ")}`);
  }
  return failed;
}
