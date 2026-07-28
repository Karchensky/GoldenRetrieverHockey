import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLeaders, type LeaderRow } from "../src/digitalshift/leaders.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * REAL CAPTURED BYTES ONLY — no hand-written page fixtures.
 *
 * Same rule, same reason as the boxscore tests: a parser here once passed 13/13
 * against an authored fixture and produced 1,064 phantom goals against the real
 * thing. Every assertion runs against bytes DigitalShift actually served for the
 * leaders route, read out of the corpus by the URL they were fetched from — the
 * season and division live only in that URL.
 *
 * The leaderboard is PAGED (100 rows/page) and only ever sorted by points, so a
 * standing in goals, assists or penalty minutes is computed off the whole field
 * assembled from every page. The reconciliation test — points equal goals plus
 * assists on every row — is the one that guards the column mapping.
 */

/** Every captured leaders page, html unwrapped from its JSON envelope. */
function pages(): { url: string; html: string }[] {
  const raw = corpusPages("%partials/stats/leaders/table%");
  assert.ok(
    raw.length >= 22,
    `corpus has only ${raw.length} leaders pages — run \`npm run capture:harborcenter-leaders\``,
  );
  return raw.map((p) => ({ url: p.url, html: (JSON.parse(p.html) as { content: string }).content }));
}

const seasonIdOf = (url: string) => Number(url.match(/season_id=(\d+)/)?.[1]);
const divisionIdOf = (url: string) => url.match(/division_id=(\d+)/)?.[1] ?? null;
const pageOf = (url: string) => Number(url.match(/[?&]page=(\d+)/)?.[1] ?? 1);

/** The whole field for one (season, scope), assembled from every captured page
 *  and deduped on player id — exactly what generate.ts ranks against. */
function fullField(seasonId: number, divisionId: number | null): LeaderRow[] {
  const mine = pages().filter(
    (p) => seasonIdOf(p.url) === seasonId && divisionIdOf(p.url) === (divisionId ? String(divisionId) : null),
  );
  const byId = new Map<number, LeaderRow>();
  for (const p of mine)
    for (const row of parseLeaders(p.html).rows)
      if (row.playerId !== null && !byId.has(row.playerId)) byId.set(row.playerId, row);
  return [...byId.values()];
}

/** Competition rank: one plus the number strictly ahead on the stat. */
function compRank(field: LeaderRow[], pick: (r: LeaderRow) => number | null, name: RegExp): number | null {
  const me = field.find((r) => name.test(r.name));
  if (!me) return null;
  const mine = pick(me);
  if (mine === null) return null;
  return 1 + field.filter((r) => (pick(r) ?? -Infinity) > mine).length;
}

test("points equal goals plus assists on every row of every captured page", () => {
  // THE TEST THAT MATTERS — the archive checking our arithmetic against its own.
  let checked = 0;
  const failures: string[] = [];
  for (const { url, html } of pages()) {
    for (const r of parseLeaders(html).rows) {
      if (r.g === null || r.a === null || r.pts === null) continue;
      checked++;
      if (r.g + r.a !== r.pts) failures.push(`${url} ${r.name}: ${r.g}+${r.a}!=${r.pts}`);
    }
  }
  assert.deepEqual(failures.slice(0, 10), [], "G + A must equal Pts");
  assert.ok(checked > 3000, `only ${checked} rows reconciled — corpus too thin`);
});

test("each captured page is points-sorted, with no player repeated", () => {
  for (const { url, html } of pages()) {
    const rows = parseLeaders(html).rows;
    assert.ok(rows.length > 0, `${url} parsed to no rows`);
    // Dedup within the page removed the responsive clone.
    const ids = rows.map((r) => r.playerId);
    assert.equal(new Set(ids).size, ids.length, `${url}: a player id repeats — clone not deduped`);
    // Points never increase down the page (the server sorts by points).
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!.pts, cur = rows[i]!.pts;
      if (prev !== null && cur !== null) assert.ok(cur <= prev, `${url}: points rose ${prev}->${cur}`);
    }
    for (const r of rows) assert.ok(r.teamId !== null, `${url}: ${r.name} has no team id`);
    // Page 1 starts the rank at 1; a later page continues it, never restarts.
    if (pageOf(url) === 1) assert.equal(rows[0]!.rank, 1, `${url}: page 1 does not start at rank 1`);
  }
});

test("the full field assembles across pages to the whole division / league", () => {
  const silver2023 = fullField(5510, 24051);
  assert.ok(silver2023.length >= 150 && silver2023.length <= 160, `Silver 2023 field is ${silver2023.length}, expected ~154`);
  const league2023 = fullField(5510, null);
  assert.ok(league2023.length >= 900, `league 2023 field is ${league2023.length}, expected ~992 — pages missing`);
  // The division is a strict subset of the league.
  assert.ok(league2023.length > silver2023.length);
});

test("a scoring standing computed off the full field matches a known finish", () => {
  // Summer 2023, Silver: Karchensky is 9th in POINTS but 2nd in GOALS — the
  // exact case that a points-only ranking misses and this feature exists to catch.
  const silver = fullField(5510, 24051);
  assert.equal(compRank(silver, (r) => r.pts, /karchensky/i), 9);
  assert.equal(compRank(silver, (r) => r.g, /karchensky/i), 2);

  // ...and league-wide, that goal total is 8th of nearly a thousand.
  const league = fullField(5510, null);
  assert.equal(compRank(league, (r) => r.g, /karchensky/i), 8);
});

test("penalty-minute standings need the whole field, not the points-sorted top", () => {
  // A penalty leader can sit far down a points-sorted table, so this only comes
  // out right because every page was captured. Anthony Galante, 12 PIM, finished
  // top-ten in Silver for penalties in Summer 2023 while 99th in points.
  const silver = fullField(5510, 24051);
  const galantePim = compRank(silver, (r) => r.pim, /galante/i);
  assert.ok(galantePim !== null && galantePim <= 10, `Galante PIM rank was ${galantePim}, expected top-10`);
  const galantePts = compRank(silver, (r) => r.pts, /galante/i);
  assert.ok(galantePts !== null && galantePts > 90, `Galante points rank ${galantePts} — expected deep in the field`);
});

test("a known points finish still reconciles: Karchensky 2nd in Silver, 2023-24", () => {
  const silver = fullField(6218, 28818);
  const k = silver.find((r) => /karchensky/i.test(r.name));
  assert.ok(k, "Karchensky not found in the 2023-24 Silver field");
  assert.equal(k!.pts, 45);
  assert.equal(compRank(silver, (r) => r.pts, /karchensky/i), 2);
});
