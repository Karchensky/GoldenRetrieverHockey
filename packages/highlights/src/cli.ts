import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { locateGoals, type Location, type Reading, type ScoredGoal } from "./locate.ts";
import { chapters, planClips, render } from "./reel.ts";

/**
 * Highlights for one game, from the rink's recording.
 *
 *   locate  overlay readings + scoresheet  ->  where every goal is in the video
 *   reel    recording + located goals      ->  clips, reel.mp4, poster.jpg, reel.json
 *
 * Everything lands in tmp/highlights/<game>/ — gitignored, because the
 * recording and anything cut from it never belong in a public repository.
 * Publishing the reel is a separate, deliberate step.
 */

const USAGE = `
@gr/highlights

  locate --game <id> --readings <file.jsonl>
      Find every goal of that game in the overlay readings. Writes located.json.
      Exits 1 unless every goal is found once and confirmed by the score.

  reel --game <id> --recording <video> --font <file.ttf> [--lead 15] [--tail 8] [--force]
      Cut the located goals into one captioned reel. Refuses a game that
      'locate' could not finish unless --force.
`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

type Game = { id: string; home: string; away: string; goals: ScoredGoal[] };

function loadGame(id: string): Game {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/data/site.json"), "utf8")) as { games: Game[] };
  const game = site.games.find((g) => g.id === id);
  if (!game) throw new Error(`No game ${id} in site.json`);
  if (!game.goals?.length) throw new Error(`Game ${id} has no goals on its scoresheet`);
  return game;
}

const outDir = (id: string) => path.join(ROOT, "tmp/highlights", id);
const mmss = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function report(location: Location): void {
  console.log(`Clock runs ${location.direction}.`);
  for (const g of location.goals) {
    const at = g.t === null ? "   not found" : `${mmss(g.t).padStart(12)}`;
    const mark = g.t !== null && g.confirmed ? "ok" : "!!";
    console.log(`${mark} ${String(g.index + 1).padStart(2)}  ${g.goal.period} ${g.goal.time}  ${at}  ${g.goal.scorer} (${g.goal.team})`);
    if (g.problem) console.log(`        ${g.problem}`);
  }
  console.log(location.ready ? "Every goal found and confirmed." : "NOT READY — see the goals marked !!.");
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    game: { type: "string" },
    readings: { type: "string" },
    recording: { type: "string" },
    font: { type: "string" },
    lead: { type: "string" },
    tail: { type: "string" },
    force: { type: "boolean" },
  },
});

if (command === "locate" && values.game && values.readings) {
  const game = loadGame(values.game);
  const readings = fs.readFileSync(values.readings, "utf8").split("\n").filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Reading);
  const location = locateGoals(readings, game.goals, game.home, game.away);
  fs.mkdirSync(outDir(game.id), { recursive: true });
  fs.writeFileSync(path.join(outDir(game.id), "located.json"), JSON.stringify(location, null, 2) + "\n");
  report(location);
  process.exitCode = location.ready ? 0 : 1;
} else if (command === "reel" && values.game && values.recording && values.font) {
  const game = loadGame(values.game);
  const dir = outDir(game.id);
  const location = JSON.parse(fs.readFileSync(path.join(dir, "located.json"), "utf8")) as Location;
  if (!location.ready && !values.force) {
    report(location);
    throw new Error("Refusing to cut a reel with goals missing or unconfirmed. Fix the readings, or pass --force to cut what was found.");
  }
  const clips = planClips(location.goals, {
    lead: values.lead ? Number(values.lead) : undefined,
    tail: values.tail ? Number(values.tail) : undefined,
  });
  const files = render(clips, location.goals, game.home, game.away, { recording: values.recording, outDir: dir, font: values.font });
  const reel = {
    game: game.id,
    clips: clips.map((c) => ({ ...c, start: Number(c.start.toFixed(2)), end: Number(c.end.toFixed(2)) })),
    duration: Number(clips.reduce((s, c) => s + c.end - c.start, 0).toFixed(2)),
    chapters: chapters(clips, location.goals),
  };
  fs.writeFileSync(path.join(dir, "reel.json"), JSON.stringify(reel, null, 2) + "\n");
  console.log(`${clips.length} clips, ${reel.duration.toFixed(0)}s:`);
  for (const f of [...files, path.join(dir, "reel.json")]) console.log("  " + f);
} else {
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}
