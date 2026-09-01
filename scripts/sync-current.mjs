/**
 * KEEP THE CURRENT SEASON CURRENT.
 *
 * Fetch what the live league has published since the last run, regenerate the
 * site data, prove nothing was lost, and describe exactly what changed. Meant
 * to run unattended on a schedule (scripts/register-sync-task.ps1).
 *
 * What it may do:      fetch, diff, regenerate, verify, and — only when asked —
 *                      commit onto a branch that is already checked out.
 * What it may NEVER do: commit to the default branch, change branches, push, or
 *                      force anything. There is no `git push` in this file and
 *                      there must not be one.
 *
 * THE HUMAN STEP is stated at the end of every run: a person decides whether
 * the refreshed data ships. Nothing here publishes.
 *
 *   npm run sync:current                  # refresh + verify + report
 *   npm run sync:current -- --commit      # ...and commit it (not on the default branch)
 *   npm run sync:current -- --build-site  # ...and build the static export
 *   npm run sync:current -- --skip-verify # ...capture and guard only (see step 4)
 *   npm run sync:current -- --freshness-hours=6
 *
 * `--build-site` is OFF by default and should stay off for a scheduled run.
 * `next build` and `next dev` share `.next`, and a build that lands while
 * someone has the dev server up corrupts it into 500s that look exactly like a
 * code error. A 05:00 job has no way to know whether anyone is developing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const buildSite = has("--build-site");
const commit = has("--commit");

/**
 * Capture and guard, but leave the suite and the typecheck to the caller.
 *
 * Only for a caller that verifies AFTERWARDS and can say so — the scheduled
 * job does, at .github/workflows/refresh.yml, once the bytes are pushed. A
 * person running this by hand should not pass it: there is nothing to lose at
 * a keyboard, and the whole point of step 4 is to be told before you look.
 */
const skipVerify = has("--skip-verify");

/**
 * The freshness window the live captures run under.
 *
 * The default corpus-wide window is a week, which is correct for archived
 * sources and wrong for a season being played: with it, a refresh scheduled
 * twice a week short-circuits every URL on the second run and reports success
 * having fetched nothing. Twelve hours means a Monday-night game is on disk by
 * Tuesday morning no matter how recently the last run happened.
 */
const freshnessHours = valueOf("freshness-hours", "12");

const SITE = join("apps", "web", "data", "site.json");
const RUNS = join("data", "sync-runs");

/** The generated site data, or null before it has ever been built. */
function readSite() {
  if (!existsSync(SITE)) return null;
  return JSON.parse(readFileSync(SITE, "utf8"));
}

/**
 * The shape of one run, reduced to the numbers a regression would move.
 *
 * Per-player totals are in here on purpose. Corpus-wide totals can hold still
 * while a person's career quietly loses a season to a name-match change — the
 * single most recurring class of bug in this project — and a guard that only
 * watches the grand totals would pass.
 */
function snapshot(site) {
  if (!site) return null;
  const players = {};
  for (const p of site.players ?? []) {
    players[p.name] = {
      gp: p.career?.gp ?? null,
      g: p.career?.g ?? null,
      a: p.career?.a ?? null,
      seasons: (p.seasons ?? []).length,
    };
  }
  return {
    totals: site.totals ?? {},
    sessions: (site.sessions ?? []).map((s) => s.id),
    /** The sort keys, so the run can say how old the newest session is. */
    sessionSorts: (site.sessions ?? []).map((s) => s.sort),
    gameTotals: site.gameTotals ?? {},
    trophies: (site.trophies ?? []).length,
    games: (site.games ?? []).length,
    // The platform's own game id where there is one, falling back to the
    // composite a schedule-only row can still be identified by. Both are
    // currently unique across all 266 games.
    gameKeys: (site.games ?? []).map(
      (g) => g.id ?? `${g.session ?? "?"}|${g.date ?? "?"}|${g.opponent ?? "?"}`,
    ),
    players,
  };
}

/**
 * `shell: true` on Windows, and it is not optional.
 *
 * Node refuses to spawnSync a `.cmd` or `.bat` without a shell — the fix for
 * CVE-2024-27980 — and fails with a bare `EINVAL` that names no cause. Every
 * step of this script is `npm.cmd`, so without this the whole sync dies on its
 * first line. Nothing user-supplied is ever interpolated into these argv
 * arrays; they are literals declared in this file.
 */
const useShell = process.platform === "win32";

function run(label, argv, env) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(npm, argv, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: useShell,
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (exit ${result.status}). Nothing was committed.`);
    process.exit(result.status ?? 1);
  }
}

function git(...argv) {
  const r = spawnSync("git", argv, { cwd: process.cwd(), encoding: "utf8", shell: false });
  return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

// ---------------------------------------------------------------------------
// 1. Before
// ---------------------------------------------------------------------------
const before = snapshot(readSite());
if (before) {
  console.log(
    `Baseline: ${before.sessions.length} sessions, ${before.games} games, ` +
      `${before.totals.goals ?? "?"} goals, ${before.totals.captures ?? "?"} captures.`,
  );
} else {
  console.log(`Baseline: no ${SITE} yet — this is a first build, so nothing can be compared.`);
}

// ---------------------------------------------------------------------------
// 2. Capture, then rebuild
// ---------------------------------------------------------------------------
const liveEnv = { GR_FRESHNESS_HOURS: freshnessHours };
console.log(`\nLive captures run with a ${freshnessHours}-hour freshness window.`);

// Order matters. The live walk discovers which teams are ours and stores the
// rosters; games needs those team ids; leaders needs the season and division
// ids the first two stored. A NEW SESSION enters the archive at step one, by
// whichever known player is rostered on it — no id is written down anywhere
// for a season to be picked up.
run("Capture current rosters and season tables", ["run", "capture:harborcenter-live"], liveEnv);
run("Capture schedules and completed boxscores", ["run", "capture:harborcenter-games"], liveEnv);
run("Capture league and division scoring leaderboards", ["run", "capture:harborcenter-leaders"], liveEnv);
run("Regenerate site data", ["run", "build:data"]);

// ---------------------------------------------------------------------------
// 3. After — the diff, and the guard
// ---------------------------------------------------------------------------
const after = snapshot(readSite());
if (!after) {
  console.error(`\nFAILED: ${SITE} does not exist after build:data.`);
  process.exit(1);
}

const changes = [];
const regressions = [];

if (before) {
  // (a) Corpus-wide counters. Every one of these is monotone: an archive that
  //     grows is working, an archive that shrinks has lost something.
  for (const key of Object.keys({ ...before.totals, ...after.totals })) {
    const was = before.totals[key] ?? 0;
    const now = after.totals[key] ?? 0;
    if (now === was) continue;
    const line = `totals.${key}: ${was} -> ${now}`;
    if (now < was) regressions.push(line);
    else changes.push(line);
  }

  // (b) New sessions. This is the one the schedule exists for: a season
  //     rolling over shows up here, named, without anyone having noticed it
  //     started.
  const wasSessions = new Set(before.sessions);
  const newSessions = after.sessions.filter((s) => !wasSessions.has(s));
  const goneSessions = before.sessions.filter((s) => !after.sessions.includes(s));
  for (const s of newSessions) changes.push(`NEW SESSION: ${s}`);
  for (const s of goneSessions) regressions.push(`SESSION DISAPPEARED: ${s}`);

  // (c) New games, by the key a game is recognised on.
  const wasGames = new Set(before.gameKeys);
  const newGames = after.gameKeys.filter((g) => !wasGames.has(g));
  for (const g of newGames) changes.push(`new game: ${g}`);
  if (after.games < before.games) {
    regressions.push(`games: ${before.games} -> ${after.games}`);
  }

  // (d) Per-player. A name-resolution change can move a career without moving
  //     a single corpus total.
  for (const [name, was] of Object.entries(before.players)) {
    const now = after.players[name];
    if (!now) {
      regressions.push(`PLAYER DISAPPEARED: ${name}`);
      continue;
    }
    for (const stat of ["gp", "g", "a", "seasons"]) {
      if (typeof was[stat] !== "number" || typeof now[stat] !== "number") continue;
      if (now[stat] < was[stat]) regressions.push(`${name}.${stat}: ${was[stat]} -> ${now[stat]}`);
      else if (now[stat] > was[stat]) changes.push(`${name}.${stat}: ${was[stat]} -> ${now[stat]}`);
    }
  }
  for (const name of Object.keys(after.players)) {
    if (!(name in before.players)) changes.push(`NEW PLAYER: ${name}`);
  }

  if (after.trophies < before.trophies) {
    regressions.push(`trophies: ${before.trophies} -> ${after.trophies}`);
  }
}

console.log("\n=== What changed ===");
if (!before) {
  console.log("  (first build — nothing to compare against)");
} else if (changes.length === 0 && regressions.length === 0) {
  console.log("  Nothing. The league has published no new results since the last run.");
} else {
  for (const c of changes) console.log(`  + ${c}`);
}

/**
 * THE ONE FAILURE THAT LOOKS EXACTLY LIKE SUCCESS.
 *
 * A season the walk never finds does not fail. `grab` returns null, the queue
 * empties, the diff says "nothing new", and the run exits 0 — which is byte for
 * byte what a quiet week in the middle of a season looks like, and what the
 * close season looks like for months at a time. The guard below cannot help:
 * it fires on a DECREASE, and a session that never arrives never decreased.
 *
 * So the archive states its own age. The club has played a half-year every
 * summer and every fall since 2011 with one COVID exception, so a newest
 * session more than about eight months old is either a genuine gap in play or a
 * walk that silently stopped finding things — and those two are worth telling
 * apart by hand rather than never noticing.
 *
 * A warning, not a failure. Being wrong about this must not stop a refresh that
 * is otherwise working.
 */
{
  const newest = [...after.sessionSorts ?? []].sort((a, b) => b - a)[0];
  if (typeof newest === "number") {
    // A sort is the calendar year the half began: 2026 is that summer, 2026.5
    // the fall/winter after it. Months since it started, at the coarsest.
    const startedYear = Math.floor(newest);
    const startedMonth = Number.isInteger(newest) ? 4 : 8; // summer ~May, winter ~Sep
    const started = new Date(Date.UTC(startedYear, startedMonth, 1));
    const months = (Date.now() - started.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (months > 8) {
      console.warn(
        `\n=== THE NEWEST SESSION IS ${Math.round(months)} MONTHS OLD ===\n` +
          `  Newest on file: ${after.sessions.at(-1) ?? "(none)"}\n` +
          `  This club has played a half-year every summer and every fall since 2011.\n` +
          `  Either it genuinely has not played, or the walk has stopped finding new\n` +
          `  seasons — a platform migration, a retired player id, a changed URL shape.\n` +
          `  Check https://web.api.digitalshift.ca by hand before assuming the former.`,
      );
    }
  }
}

if (regressions.length > 0) {
  console.error("\n=== THE ARCHIVE LOST SOMETHING ===");
  for (const r of regressions) console.error(`  - ${r}`);
  console.error(
    "\nEvery figure above is meant to be monotone: this archive only ever learns more.\n" +
      "A decrease is a real regression — a source that changed shape, a name that stopped\n" +
      "resolving, a capture that failed and was parsed as an empty page. Investigate before\n" +
      "accepting this run. Nothing was committed.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Prove it still holds together
// ---------------------------------------------------------------------------
//
// THESE RUN BEFORE THE COMMIT, AND THAT IS ONLY RIGHT WHEN NOTHING IS AT STAKE.
//
// A red suite exits here, so the captures never reach step 6 at all. At a
// keyboard that is exactly what you want: the corpus is on your disk either
// way, and being stopped before you look is the point. On a runner it is the
// opposite — the bytes exist nowhere else and the machine is about to be
// destroyed.
//
// One stale assertion cost seven days of capture that way, 25 to 31 August
// 2026. The fetch worked perfectly every morning; a test that assumed a season
// was in progress failed once the last game was played; each day's bytes were
// thrown away. A page cannot be re-fetched as it was yesterday, and the archive
// is the one thing here that cannot be rebuilt.
//
// So the scheduled job passes --skip-verify and runs all of this AFTER it has
// pushed, where a failure still turns the run red — which is the notification —
// with the bytes already safe on origin/main.
//
// THE GUARD ABOVE IS NOT SKIPPABLE and still blocks the commit. Losing data is
// a regression; failing a test is news. They are not the same event.
if (skipVerify) {
  console.log("\n=== Verification skipped (--skip-verify) ===");
  console.log("  The caller runs the suite and the typecheck itself, once these captures are safe.");
} else {
  run("Run corpus tests", ["test"]);
  run("Run typecheck", ["run", "typecheck"]);
}
if (buildSite) run("Build the static export", ["run", "build:site"]);

// ---------------------------------------------------------------------------
// 5. The run record
// ---------------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(RUNS, { recursive: true });
const recordPath = join(RUNS, `${stamp}.json`);
writeFileSync(
  recordPath,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      freshnessHours: Number(freshnessHours),
      before: before && { totals: before.totals, sessions: before.sessions.length, games: before.games },
      after: { totals: after.totals, sessions: after.sessions.length, games: after.games },
      newSessions: before ? after.sessions.filter((s) => !before.sessions.includes(s)) : [],
      changes,
      regressions,
    },
    null,
    2,
  ),
);
console.log(`\nRun record: ${recordPath}`);

// ---------------------------------------------------------------------------
// 6. Open a change for review — never publish one
// ---------------------------------------------------------------------------
if (!commit) {
  console.log(
    "\n--- THE HUMAN STEP ---\n" +
      "  This run refreshed and verified only. The captures and the rebuilt site data are\n" +
      "  on disk. To turn that into something reviewable: check out a branch and re-run\n" +
      "  with --commit, or commit by hand. Nothing here ships anything.",
  );
} else {
  const head = git("rev-parse", "--abbrev-ref", "HEAD").out;
  const def =
    git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD").out.replace(
      /^origin\//,
      "",
    ) || "main";

  // A scheduled job must never write to the branch the site ships from.
  //
  // AND IT MUST NEVER CHANGE BRANCHES EITHER. An earlier draft of this ran
  // `git checkout -b data/refresh-<date>` when it found itself on the default
  // branch, which is a plausible-looking way to be helpful and a genuinely
  // dangerous one here: this repo routinely has several agents editing the app
  // at the same time, and yanking the worktree onto another branch underneath
  // them — unattended, at 05:00 — is a far worse outcome than declining to
  // commit. Refusing is the whole feature.
  if (head === def || head === "HEAD") {
    console.error(
      `\nRefusing to commit: HEAD is ${head === "HEAD" ? "detached" : `the default branch (${def})`}.\n` +
        "  A scheduled refresh does not decide what ships. Make a branch and re-run with\n" +
        "  --commit, or commit by hand. The captures and the rebuilt data are already on\n" +
        "  disk, so nothing is lost by declining here.",
    );
    process.exit(1);
  }
  console.log(`\nOn ${head}, which is not the default branch (${def}). Committing here.`);

  // Stage EXACTLY the two paths a refresh produces, named individually.
  //
  // Not `git add -A`, and deliberately not the `apps/web/data` DIRECTORY: that
  // directory also holds `products.json`, which is hand-written store source
  // owned by whoever is working on the shop. Adding the directory would sweep
  // their uncommitted edit into an automated data commit at five in the
  // morning.
  for (const p of ["data", SITE]) git("add", "--", p);

  const staged = git("diff", "--cached", "--name-only").out;
  if (!staged) {
    console.log(
      "\nNothing staged, so nothing to commit.\n" +
        "  `data/` and `apps/web/data/site.json` are both tracked now, so this means what\n" +
        "  it says: the league published nothing new and the rebuild reproduced the\n" +
        "  committed file byte for byte. That is the expected result six runs in seven.",
    );
  } else {
    const summary =
      changes.length === 0
        ? "no new results"
        : `${changes.filter((c) => c.startsWith("new game")).length} new game(s), ` +
          `${changes.filter((c) => c.startsWith("NEW SESSION")).length} new session(s)`;
    const body = [
      `chore(data): current-season refresh — ${summary}`,
      "",
      ...changes.slice(0, 40).map((c) => `- ${c}`),
      changes.length > 40 ? `- ...and ${changes.length - 40} more` : "",
      "",
      `Run record: ${recordPath}`,
      "Automated by scripts/sync-current.mjs. Not pushed, not merged.",
    ]
      .filter((l) => l !== "")
      .join("\n");
    const c = git("commit", "-m", body);
    if (c.status !== 0) {
      console.error(`\nCommit failed: ${c.err || c.out}`);
      process.exit(1);
    }
    console.log(`\nCommitted to ${git("rev-parse", "--abbrev-ref", "HEAD").out}.`);
  }

  console.log(
    "\n--- THE HUMAN STEP ---\n" +
      "  Nothing has been pushed and nothing has been merged. A person reviews what is above\n" +
      "  and decides whether it ships. This script contains no `git push` and must never\n" +
      "  grow one.",
  );
}

console.log("\nCurrent-season sync complete.");
