/**
 * THE SESSION INVENTORY — what is on the spine, and what is actually in it.
 *
 * Written because "31 sessions" and "two holes" were both true and both
 * misleading: five sessions exist, carry a final team record, and hold four or
 * fewer players out of a roster of sixteen. A gap list cannot see those,
 * because a session that exists is not a gap.
 *
 * Reads `apps/web/data/site.json` and nothing else. Every figure is counted off
 * the rows; nothing here is typed.
 *
 *   node scripts/session-inventory.mjs           # the table
 *   node scripts/session-inventory.mjs --detail  # + the thin ones, named
 *   node scripts/session-inventory.mjs --json    # machine-readable
 *
 * Companion prose: docs/research/session-inventory-2026-07-27/INVENTORY.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(readFileSync(join(ROOT, "apps/web/data/site.json"), "utf8"));

const num = (v) => (typeof v === "number" ? v : null);

/** Player-season lines, indexed by the session they belong to. */
const rowsBySession = new Map();
for (const p of site.players) {
  for (const r of p.seasons) {
    if (!rowsBySession.has(r.session)) rowsBySession.set(r.session, []);
    rowsBySession.get(r.session).push({ ...r, slug: p.slug, name: p.name });
  }
}
const gamesBySession = new Map();
for (const g of site.games) {
  if (!gamesBySession.has(g.session)) gamesBySession.set(g.session, []);
  gamesBySession.get(g.session).push(g);
}

/**
 * The state of a session, decided off the rows.
 *
 * The thresholds are not arbitrary. This team rosters fifteen to eighteen
 * skaters in every season it has whole, so four or fewer is not a thin roster —
 * it is a roster that was never found. Eight is where a session stops being
 * able to ice a line change.
 */
function classify(r) {
  if (r.rows === 0) return "EMPTY SHELL";
  if (r.withPts === 0 || r.sumPts === 0) return "ROSTER-ONLY";
  // A phase whose surviving rows carry a points total and nothing else. Not a
  // gap — a specific KIND of thinness, and the one that caused a real
  // reconciliation dispute rather than a hole.
  if (r.ptsOnlyNoGA === r.rows) return "POINTS-ONLY";
  if (r.people <= 4) return "SKELETON";
  if (r.people <= 8) return "THIN";
  return "FULL";
}

const rec = [];
for (const s of site.sessions) {
  const rows = rowsBySession.get(s.id) ?? [];
  const games = gamesBySession.get(s.id) ?? [];
  const reg = rows.filter((r) => r.phase !== "Playoffs");
  const sum = (rs, f) => rs.reduce((t, r) => t + (num(r[f]) ?? 0), 0);
  const r = {
    id: s.id,
    sort: s.sort,
    half: s.half,
    tournament: s.tournament,
    division: s.division,
    source: s.provenance?.source ?? null,
    archiveOnly: s.provenance?.archiveOnly ?? null,
    record: s.record,
    teamStats: s.teamStats,
    rows: rows.length,
    people: new Set(rows.map((x) => x.slug)).size,
    goalies: rows.filter((x) => x.kind === "goalie").length,
    phases: [...new Set(rows.map((x) => x.phase))],
    sources: [...new Set(rows.map((x) => x.provenance?.source))],
    withPts: rows.filter((x) => num(x.pts) !== null).length,
    ptsOnlyNoGA: rows.filter((x) => num(x.pts) !== null && num(x.g) === null && num(x.a) === null).length,
    sumG: sum(rows, "g"), sumA: sum(rows, "a"), sumPts: sum(rows, "pts"),
    regG: sum(reg, "g"), regA: sum(reg, "a"), regPts: sum(reg, "pts"),
    maxGp: rows.reduce((t, x) => Math.max(t, num(x.gp) ?? 0), 0),
    games: games.length,
    withSheet: games.filter((g) => g.hasDetail).length,
    schedOnly: games.filter((g) => g.scheduleOnly).length,
    names: [...new Set(rows.map((x) => x.name))],
  };
  r.state = classify(r);
  // How much of the team's OWN stated season no named player accounts for.
  // Only meaningful where the platform published a team total.
  r.unaccountedPct = r.teamStats?.pts
    ? Math.round(100 * (1 - r.regPts / r.teamStats.pts))
    : null;
  rec.push(r);
}
rec.sort((a, b) => a.sort - b.sort);

// The half-year grid is the FLOOR, unioned with every sort a session claims —
// a tournament sits a quarter-step off the grid and must not vanish from it.
const marks = new Set();
for (let t = rec[0].sort; t <= rec[rec.length - 1].sort + 1e-9; t += 0.5) marks.add(Math.round(t * 2) / 2);
for (const r of rec) marks.add(r.sort);
const bySort = new Map(rec.map((r) => [r.sort, r]));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ sessions: rec, absent: [...marks].filter((m) => !bySort.has(m)) }, null, 1));
  process.exit(0);
}

const pad = (v, n) => String(v).padEnd(n);
const rpad = (v, n) => String(v).padStart(n);
console.log(
  `${pad("SORT", 7)} | ${pad("SESSION", 35)} | ${pad("STATE", 11)} | PPL | ROWS | ${pad("GAMES", 10)} | MAXGP |   G |   A | PTS | SOURCE`,
);
for (const m of [...marks].sort((a, b) => a - b)) {
  const r = bySort.get(m);
  if (!r) {
    const label = m % 1 === 0 ? `${Math.floor(m)} - Summer` : `${Math.floor(m)} - Winter`;
    console.log(`${pad(m, 7)} | ${pad(label, 35)} | *** ABSENT — no session at all ***`);
    continue;
  }
  console.log(
    `${pad(r.sort, 7)} | ${pad(r.id, 35)} | ${pad(r.state, 11)} | ${rpad(r.people, 3)} | ${rpad(r.rows, 4)} | `
    + `${pad(`${r.games}${r.games ? ` (${r.withSheet}/${r.schedOnly})` : ""}`, 10)} | ${rpad(r.maxGp, 5)} | `
    + `${rpad(r.sumG, 3)} | ${rpad(r.sumA, 3)} | ${rpad(r.sumPts, 3)} | ${r.sources.join(" + ") || "(none)"}`,
  );
}

const counts = {};
for (const r of rec) counts[r.state] = (counts[r.state] ?? 0) + 1;
const absent = [...marks].filter((m) => !bySort.has(m));
console.log(`\nSTATES: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`
  + `, ABSENT ${absent.length}${absent.length ? ` (${absent.join(", ")})` : ""}`);
console.log(`sessions with games: ${rec.filter((r) => r.games > 0).length} of ${rec.length}`);

if (process.argv.includes("--detail")) {
  console.log("\n=== SESSIONS THAT EXIST BUT ARE NOT WHOLE ===");
  for (const r of rec) {
    if (r.state === "FULL") continue;
    console.log(`\n${r.id}  (sort ${r.sort})  ${r.state}`);
    console.log(`  people ${r.people}, rows ${r.rows}, goalies ${r.goalies}, games ${r.games}, division ${r.division ?? "-"}`);
    if (r.record) console.log(`  record ${r.record.record}, ${r.record.gp} GP, ${r.record.place} of ${r.record.of}, final=${r.record.final}`);
    if (r.teamStats) console.log(`  team's own totals  G ${r.teamStats.g} / A ${r.teamStats.a} / PTS ${r.teamStats.pts}`);
    console.log(`  named players account for  G ${r.regG} / A ${r.regA} / PTS ${r.regPts}`
      + (r.unaccountedPct === null ? "" : `  -> ${r.unaccountedPct}% UNACCOUNTED`));
    console.log(`  names: ${r.names.join(", ") || "(none)"}`);
  }
}
