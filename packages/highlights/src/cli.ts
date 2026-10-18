import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { daily, gamesWithWork, type Highlights, type Ledger } from "./daily.ts";
import { locateGoals, type Location, type Reading, type ScoredGoal } from "./locate.ts";

/**
 * Our goals, clipped from the rink's recordings onto the box scores.
 *
 *   daily   the scheduled job — see daily.ts and .github/workflows/highlights.yml
 *   locate  overlay readings + scoresheet -> where every goal is, for looking into one game by hand
 *
 * Anything written for a person lands in tmp/highlights/<game>/ — gitignored,
 * because the recording and anything cut from it never belong in a public
 * repository.
 */

/**
 * The first game clipped: the opener of the 2026 Winter season. Older games are
 * never looked at — each clip costs one of the month's download credits, and
 * these start from this season.
 */
const SINCE = "2026-10-07";

const USAGE = `
@gr/highlights

  locate --game <id> --readings <file.jsonl>
      Find every goal of that game in the overlay readings. Writes located.json.
      Exits 1 unless every goal is found once and confirmed by the score.

  daily [--dry-run] [--wait 25] [--check]
      The scheduled job: clip every one of OUR goals from ${SINCE} on, from the
      rink's recording, onto its line on the box score. Needs HARBORCENTER_EMAIL
      and HARBORCENTER_PASSWORD, and for the upload CLOUDFLARE_API_TOKEN and
      CLOUDFLARE_ACCOUNT_ID. Writes packages/highlights/ledger.json and
      apps/web/data/highlights.json. --dry-run spends and uploads nothing —
      run it that way anywhere but the workflow: without it, it spends the
      month's REAL download credits. --check only says whether there is anything to do, from the files alone —
      no sign-in, no network, no dependencies — for the workflow to stop early.
`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const BUCKET = "grh-highlights";
const LEDGER = path.join(ROOT, "packages/highlights/ledger.json");
const HIGHLIGHTS = path.join(ROOT, "apps/web/data/highlights.json");

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
    "dry-run": { type: "boolean" },
    check: { type: "boolean" },
    wait: { type: "string" },
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
} else if (command === "daily") {
  const env = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/data/site.json"), "utf8")) as { games: Parameters<typeof daily>[0]["games"] };
  const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger;
  const highlights = JSON.parse(fs.readFileSync(HIGHLIGHTS, "utf8")) as Highlights;
  const dryRun = values["dry-run"] === true;
  if (values.check) {
    const work = gamesWithWork({ since: SINCE, games: site.games, ledger, highlights });
    console.log(work.length ? `Work on ${work.length} game(s): ${work.map((g) => `${g.date} ${g.id}`).join(", ")}` : "Nothing to do.");
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `work=${work.length > 0}\n`);
    process.exit(0);
  }
  const write = () => {
    if (dryRun) return;
    // Sorted keys: a run that changes nothing changes no byte, and commits nothing.
    const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(LEDGER, JSON.stringify(sorted(ledger), null, 2) + "\n");
    fs.writeFileSync(HIGHLIGHTS, JSON.stringify(sorted(highlights), null, 2) + "\n");
  };
  // A cancelled run — the job's hour up — still records what it spent and asked for.
  process.once("SIGTERM", () => { write(); process.exit(1); });
  process.once("SIGINT", () => { write(); process.exit(1); });
  try {
    const report = await daily({
      since: SINCE, games: site.games, ledger, highlights, dryRun,
      today: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
      waitMinutes: values.wait ? Number(values.wait) : 25,
      credentials: () => ({ email: env("HARBORCENTER_EMAIL"), password: env("HARBORCENTER_PASSWORD") }),
      upload: (key, file, contentType) => {
        env("CLOUDFLARE_API_TOKEN");
        env("CLOUDFLARE_ACCOUNT_ID");
        const r = spawnSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", contentType, "--remote"], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
        if (r.status !== 0) throw new Error(`upload of ${key} failed: ${r.error?.message ?? (r.stderr || r.stdout).slice(-400)}`);
      },
      log: (line) => console.log(line),
    });
    if (report.nothingToDo) console.log("Nothing to do: every goal of ours from " + SINCE + " is on its box score.");
    else console.log(`${report.published} goal(s) published, ${report.requested} clip(s) asked for, ${report.queued} waiting for credit.`);
    for (const p of report.problems) console.log(`PROBLEM ${p}`);
    // Red once, for a new problem — the email is the notification. The ledger remembers it,
    // so tomorrow's run does not search that game again and stays green.
    process.exitCode = report.problems.length ? 1 : 0;
  } finally {
    write();
  }
} else {
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}
