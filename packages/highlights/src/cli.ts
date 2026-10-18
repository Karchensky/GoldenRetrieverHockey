import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compare } from "./compare.ts";
import { daily, gamesWithWork, type Highlights, type Ledger, type Options, type Recaps } from "./daily.ts";
import { MAX_SECONDS, recapFromSite } from "./recap.ts";
import { survey } from "./survey.ts";
import { locateGoals, type Location, type Reading, type ScoredGoal } from "./locate.ts";

/**
 * Our goals, clipped from the rink's recordings onto the box scores.
 *
 *   daily   the scheduled job — see daily.ts and .github/workflows/highlights.yml
 *   compare one game's downloaded clips beside the same clips cut from the recording
 *   survey  how well the goal search holds up over a stretch of games, read only
 *   recap   one game's goals and shots, cut from the recording into a short video
 *   locate  overlay readings + scoresheet -> where every goal is, for looking into one game by hand
 *
 * Anything written for a person lands in tmp/highlights/<game>/ — gitignored,
 * because the recording and anything cut from it never belong in a public
 * repository.
 */

/**
 * The first game clipped: the opener of the 2026 Winter season. The daily job
 * starts here. An older game is only looked at when a run is given an earlier
 * --since — the one-time look back — and is only ever cut from the recording:
 * the month's downloads are for this season.
 */
const SINCE = "2026-10-07";

const USAGE = `
@gr/highlights

  locate --game <id> --readings <file.jsonl>
      Find every goal of that game in the overlay readings. Writes located.json.
      Exits 1 unless every goal is found once and confirmed by the score.

  daily [--dry-run] [--wait 25] [--check] [--source auto|download|recording] [--since YYYY-MM-DD]
      The scheduled job: clip every one of OUR goals from ${SINCE} on, from the
      rink's recording, onto its line on the box score. Needs HARBORCENTER_EMAIL
      and HARBORCENTER_PASSWORD, and for the upload CLOUDFLARE_API_TOKEN and
      CLOUDFLARE_ACCOUNT_ID. Writes packages/highlights/ledger.json and
      apps/web/data/highlights.json, and a recap of each game once its goals are
      searched to apps/web/data/recaps.json. --dry-run spends and uploads nothing —
      run it that way anywhere but the workflow: without it, it spends the
      month's REAL download credits. --check only says whether there is anything to do, from the files alone —
      no sign-in, no network, no dependencies — for the workflow to stop early.
      --source is where a clip comes from: "download", the rink renders it, one
      credit each, and with none left it waits for next month; "recording", cut
      from the recording the job already reads, no credit; "auto" (the
      default) downloads while credit lasts, then cuts. --since looks back
      before ${SINCE}, once: those older games are cut from the recording only.

  compare --game <id>
      One game's clips, cut again from the recording and checked the way a
      published clip is, with the rink's own download beside each when its link
      still works — to see the difference before trusting the backup. Writes to
      tmp/highlights/<id>/. Spends and uploads nothing.

  survey --since YYYY-MM-DD [--until YYYY-MM-DD] [--clips]
      Every played game of ours in those dates searched the way the daily job
      does, each goal — ours and theirs — reported found or why not. Writes
      each game's readings to tmp/highlights/<id>/ and the table to
      tmp/highlights/survey.json. --clips also cuts each goal found from the
      recording, as the backup would, and puts it through the clip checks,
      keeping the clips there to watch. Spends and uploads nothing.

  recap --game <id> [--budget 480]
      A recap of one game: every goal found, both teams', then its shots on
      goal where the board counts them and the plays its whistles ended, the
      best first, up to --budget seconds. Cut from the recording into one
      video, tmp/highlights/<id>/recap.mp4. Spends and uploads nothing.
`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const BUCKET = "grh-highlights";
const LEDGER = path.join(ROOT, "packages/highlights/ledger.json");
const HIGHLIGHTS = path.join(ROOT, "apps/web/data/highlights.json");
const RECAPS = path.join(ROOT, "apps/web/data/recaps.json");

type Game = { id: string; home: string; away: string; goals: ScoredGoal[] };

function loadGame(id: string): Game {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/data/site.json"), "utf8")) as { games: Game[] };
  const game = site.games.find((g) => g.id === id);
  if (!game) throw new Error(`No game ${id} in site.json`);
  if (!game.goals?.length) throw new Error(`Game ${id} has no goals on its scoresheet`);
  return game;
}

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

function loadSiteGame(id: string): Options["games"][number] {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/data/site.json"), "utf8")) as { games: Options["games"] };
  const game = site.games.find((g) => g.id === id);
  if (!game) throw new Error(`No game ${id} in site.json`);
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
    source: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    clips: { type: "boolean" },
    budget: { type: "string" },
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
} else if (command === "compare" && values.game) {
  const game = loadSiteGame(values.game);
  const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger;
  const highlights = JSON.parse(fs.readFileSync(HIGHLIGHTS, "utf8")) as Highlights;
  const entry = ledger[game.id];
  if (!entry) throw new Error(`No game ${game.id} in the ledger: nothing has been clipped from it`);
  const failed = await compare({
    game, entry, highlights: highlights[game.id], dir: outDir(game.id), log: (line) => console.log(line),
    credentials: () => ({ email: env("HARBORCENTER_EMAIL"), password: env("HARBORCENTER_PASSWORD") }),
  });
  process.exitCode = failed ? 1 : 0;
} else if (command === "recap" && values.game) {
  const game = loadSiteGame(values.game);
  fs.mkdirSync(outDir(game.id), { recursive: true });
  const out = path.join(outDir(game.id), "recap.mp4");
  const made = await recapFromSite({
    game, out, poster: out.replace(/\.mp4$/, ".jpg"), budget: values.budget ? Number(values.budget) : MAX_SECONDS, log: (line) => console.log(line),
    credentials: () => ({ email: env("HARBORCENTER_EMAIL"), password: env("HARBORCENTER_PASSWORD") }),
  });
  if (typeof made === "string") { console.log(`No recap: ${made}`); process.exitCode = 1; }
  else console.log(`Wrote ${path.relative(ROOT, out)}: ${made.seconds}s, ${made.goals} of ${made.of} goals, ${made.shots} shots, ${made.chances} chances, ${made.whistles} whistles`);
} else if (command === "survey" && values.since) {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/data/site.json"), "utf8")) as { games: Options["games"] };
  const until = values.until ?? "9999";
  const games = site.games.filter((g) => g.date >= values.since! && g.date <= until && g.gr !== null && /^final/i.test(g.status) && g.goals.length);
  const rows = await survey({
    games, dir: outDir, log: (line) => console.log(line), clips: values.clips === true,
    credentials: () => ({ email: env("HARBORCENTER_EMAIL"), password: env("HARBORCENTER_PASSWORD") }),
  });
  fs.writeFileSync(path.join(ROOT, "tmp/highlights/survey.json"), JSON.stringify(rows, null, 2) + "\n");
  const ok = (r: (typeof rows)[number]) => r.t !== null && r.confirmed;
  for (const r of rows.filter((r) => !ok(r))) console.log(`!! ${r.date} ${r.game} ${r.label}${r.ours ? " (ours)" : ""}: ${r.problem ?? "not confirmed"}`);
  for (const r of rows.filter((r) => typeof r.clip === "string")) console.log(`!! clip ${r.date} ${r.game} ${r.label}${r.ours ? " (ours)" : ""}: ${r.clip}`);
  if (values.clips) console.log(`${rows.filter((r) => r.clip === true).length} of ${rows.filter(ok).length} clips cut from the recording pass both checks.`);
  const ours = rows.filter((r) => r.ours);
  console.log(`${rows.filter(ok).length} of ${rows.length} goals found and confirmed; ours ${ours.filter(ok).length} of ${ours.length}, in ${games.length} games.`);
} else if (command === "daily") {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/data/site.json"), "utf8")) as { games: Parameters<typeof daily>[0]["games"] };
  const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger;
  const highlights = JSON.parse(fs.readFileSync(HIGHLIGHTS, "utf8")) as Highlights;
  const recaps = JSON.parse(fs.readFileSync(RECAPS, "utf8")) as Recaps;
  const dryRun = values["dry-run"] === true;
  const source = (values.source ?? "auto") as Options["source"];
  if (!["auto", "download", "recording"].includes(source)) throw new Error(`--source is auto, download or recording, not "${source}"`);
  const since = values.since || SINCE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since is a date, YYYY-MM-DD, not "${since}"`);
  if (values.check) {
    const work = gamesWithWork({ since, games: site.games, ledger, highlights, recaps });
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
    fs.writeFileSync(RECAPS, JSON.stringify(sorted(recaps), null, 2) + "\n");
  };
  // A cancelled run — the job's hour up — still records what it spent and asked for.
  process.once("SIGTERM", () => { write(); process.exit(1); });
  process.once("SIGINT", () => { write(); process.exit(1); });
  try {
    const report = await daily({
      since, seasonStart: SINCE, source, games: site.games, ledger, highlights, recaps, dryRun,
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
    if (report.nothingToDo) console.log("Nothing to do: every goal of ours from " + since + " is on its box score.");
    else console.log(`${report.published} goal(s) published, ${report.requested} clip(s) asked for, ${report.cut} cut from the recording, ${report.queued} waiting, ${report.recaps} recap(s) made.`);
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
