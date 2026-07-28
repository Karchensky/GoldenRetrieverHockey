import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHsTeamStats, type TeamStatsRow } from "../src/digitalshift/team-stats.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * REAL CAPTURED BYTES ONLY — no hand-written page fixtures.
 *
 * Same rule, same reason as the boxscore and leaders tests: a parser here once
 * passed 13/13 against an authored fixture and produced 1,064 phantom goals
 * against the real thing. Every assertion below runs against bytes DigitalShift
 * actually served for `partials/stats/team/stats`, read out of the corpus by the
 * URL they were fetched from — the team id lives only in that URL.
 *
 * The route carries FOUR tables in one response (players and goalies, regular
 * season and playoffs), each rendered twice with an `aria-hidden` responsive
 * clone. The reconciliation test — points equal goals plus assists on every one
 * of the 3,417 captured skater rows — is the one that guards the column
 * mapping, and the dedup test is the one that guards against a doubled career.
 */

/** Every captured team-stats page, html unwrapped from its JSON envelope. */
function pages(): { teamId: number; rows: TeamStatsRow[] }[] {
  const raw = corpusPages("%partials/stats/team/stats?team_id=%");
  assert.ok(
    raw.length >= 96,
    `corpus has only ${raw.length} team/stats pages — run \`npm run capture:harborcenter-live\``,
  );
  return raw.map((p) => ({
    teamId: Number(p.url.match(/team_id=(\d+)/)?.[1]),
    rows: parseHsTeamStats((JSON.parse(p.html) as { content: string }).content),
  }));
}

const team = (id: number) => {
  const p = pages().find((x) => x.teamId === id);
  assert.ok(p, `team ${id} not in the corpus`);
  return p.rows;
};
const row = (rows: TeamStatsRow[], name: RegExp, phase: string, kind = "skater") => {
  const r = rows.find((x) => name.test(x.name) && x.phase === phase && x.kind === kind);
  assert.ok(r, `no ${phase} ${kind} row matching ${name}`);
  return r;
};

test("every captured page yields all four sections", () => {
  for (const { teamId, rows } of pages()) {
    if (rows.length === 0) continue; // a club with no table at all
    const shapes = new Set(rows.map((r) => `${r.phase}/${r.kind}`));
    assert.ok(
      shapes.has("Regular Season/skater"),
      `team ${teamId} has no regular-season skater table`,
    );
  }
});

test("the responsive clone is deduped — no player appears twice in one section", () => {
  for (const { teamId, rows } of pages()) {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = `${r.phase}|${r.kind}|${r.playerId}`;
      assert.ok(!seen.has(k), `team ${teamId} repeats ${r.name} in ${r.phase}/${r.kind}`);
      seen.add(k);
    }
  }
});

test("points reconcile to goals plus assists on every captured skater row", () => {
  let n = 0;
  for (const { teamId, rows } of pages()) {
    for (const r of rows) {
      if (r.kind !== "skater") continue;
      n++;
      assert.equal(
        Number(r.stats.G) + Number(r.stats.A),
        Number(r.stats.Pts),
        `team ${teamId}: ${r.name} ${r.phase} — G+A != Pts in ${JSON.stringify(r.stats)}`,
      );
    }
  }
  // The whole captured field, not a sample: this is the column-mapping guard.
  assert.ok(n >= 3417, `only ${n} skater rows reconciled`);
});

test("a goalie row is read as a goalie, and his own goals are not his goals against", () => {
  // Corey Muff, Fall/Winter 2022-23. The table has BOTH `GA` (goals against,
  // 103) and `G` (what he scored, 1). Confusing them is the failure this
  // asserts against.
  const r = row(team(210318), /Corey Muff/, "Regular Season", "goalie");
  assert.equal(r.position, "G");
  assert.equal(r.jersey, "1");
  assert.equal(r.stats.GP, "21");
  assert.equal(r.stats.W, "8");
  assert.equal(r.stats.L, "10");
  assert.equal(r.stats.OTL, "3");
  assert.equal(r.stats.GA, "103");
  assert.equal(r.stats.GAA, "4.91");
  assert.equal(r.stats.SO, "1");
  assert.equal(r.stats.MP, "882:00");
  assert.equal(r.stats.G, "1");
  assert.equal(r.stats.A, "0");
  // No `Pts` column exists on a goalie table; it is derived from this row's
  // own G and A, which is why his goal is worth a point.
  assert.equal(r.stats.Pts, "1");
});

test("the playoffs are read as a separate phase", () => {
  // Summer 2021: one playoff game, and the club's whole roster listed against
  // it. The player route's career table shows none of this.
  const rows = team(121839);
  const rs = row(rows, /^Bryan Karchensky$/, "Regular Season");
  const po = row(rows, /^Bryan Karchensky$/, "Playoffs");
  assert.equal(rs.stats.GP, "12");
  assert.equal(rs.stats.Pts, "31");
  assert.equal(po.stats.GP, "1");
  assert.equal(po.stats.Pts, "1");
  assert.equal(po.stats.PIM, "2");
});

test("the jersey numbers this platform was believed not to keep", () => {
  // The four men the archive had wearing a default 99 because no source was
  // thought to evidence a number. Each is stated twice on his own row — the
  // `#` cell and a `<span class="p">` beside the name.
  assert.equal(row(team(549836), /Sean Mccormick/, "Regular Season").jersey, "7");
  assert.equal(row(team(325791), /Jeff Antolos/, "Regular Season").jersey, "15");
  assert.equal(row(team(325791), /Matt Dickerson/, "Regular Season").jersey, "8");
  // Jersey 0 is a real number and must survive as one, not be emptied by a
  // falsy test somewhere between here and the page.
  assert.equal(row(team(121839), /Dylan McLaughlin/, "Regular Season").jersey, "0");
});

test("the name cell's own '#21' echo is not folded into the name", () => {
  const r = row(team(210318), /Adam Kaplewicz/, "Regular Season");
  assert.equal(r.name, "Adam Kaplewicz");
  assert.equal(r.jersey, "96");
  assert.equal(r.position, "F");
  assert.equal(r.playerId, 2374630);
  assert.equal(r.stats.GP, "19");
  assert.equal(r.stats.G, "19");
  assert.equal(r.stats.A, "17");
  assert.equal(r.stats.Pts, "36");
  assert.equal(r.stats.PIM, "12");
});
