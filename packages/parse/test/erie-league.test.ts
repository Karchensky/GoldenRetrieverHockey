import { test } from "node:test";
import assert from "node:assert/strict";
import { parseErieLeagueSkaters, type ErieSkater } from "../src/sportngin/erie-league.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * REAL CAPTURED BYTES ONLY — Erie Metro's live league tables, page by page.
 *
 * The reconciliation test (points equal goals plus assists) guards the column
 * mapping; the team-attribute tests guard the one thing this platform gets
 * wrong if you read the visible cell — the Retrievers render as "83".
 */

/** The captured pages of one EMHL league table (raw HTML, no JSON envelope). */
function fullField(leagueInstance: number): ErieSkater[] {
  const pages = corpusPages(`%league_instance/${leagueInstance}%order_by=hkspts%`);
  assert.ok(pages.length >= 15, `only ${pages.length} pages for ${leagueInstance} — run \`npm run capture:eriemetro-leaders\``);
  const byKey = new Map<string, ErieSkater>();
  for (const p of pages)
    for (const r of parseErieLeagueSkaters(p.html)) {
      const k = `${r.name}|${r.team}`;
      if (!byKey.has(k)) byKey.set(k, r);
    }
  return [...byKey.values()];
}

const rank = (field: ErieSkater[], pick: (r: ErieSkater) => number | null, name: RegExp): number | null => {
  const me = field.find((r) => name.test(r.name) && /golden retrievers/i.test(r.team));
  if (!me) return null;
  const mine = pick(me);
  if (mine === null) return null;
  return 1 + field.filter((r) => (pick(r) ?? -Infinity) > mine).length;
};

test("points equal goals plus assists on every Erie Metro skater row", () => {
  const failures: string[] = [];
  let checked = 0;
  for (const li of [50115, 62160])
    for (const r of fullField(li)) {
      if (r.g === null || r.a === null || r.pts === null) continue;
      checked++;
      if (r.g + r.a !== r.pts) failures.push(`${r.name}: ${r.g}+${r.a}!=${r.pts}`);
    }
  assert.deepEqual(failures.slice(0, 10), []);
  assert.ok(checked > 800, `only ${checked} rows reconciled`);
});

test("the field is the whole league, ~522 skaters in 2016-17", () => {
  const field = fullField(50115);
  assert.ok(field.length >= 500 && field.length <= 560, `field is ${field.length}, expected ~522`);
});

test("the Retrievers' team is read from the row attribute, not the '83' cell", () => {
  const field = fullField(50115);
  const grs = field.filter((r) => /golden retrievers/i.test(r.team));
  assert.ok(grs.length >= 20, `only ${grs.length} Retriever rows — team attribute not read?`);
  // None of them is the visible abbreviation.
  for (const r of grs) assert.notEqual(r.team, "83");
});

test("a known Erie Metro standing reconciles: Adam Kaplewicz, 2016-17", () => {
  const field = fullField(50115);
  const adam = field.find((r) => /adam kaplewicz/i.test(r.name) && /golden retrievers/i.test(r.team));
  assert.ok(adam, "Adam Kaplewicz not found on the Retrievers");
  assert.equal(adam!.pts, 64);
  assert.equal(adam!.g, 36);
  assert.equal(adam!.a, 28);
  // 5th in the league in points, 6th in goals, 9th in assists — top-ten in three
  // races the archived-only tables (page one, sorted by goals) could never show.
  assert.equal(rank(field, (r) => r.pts, /adam kaplewicz/i), 5);
  assert.equal(rank(field, (r) => r.g, /adam kaplewicz/i), 6);
  assert.equal(rank(field, (r) => r.a, /adam kaplewicz/i), 9);
});

test("penalty-minute standings come out of the full field, by the RIGHT team", () => {
  // There are two Sean Lebers — one on 941 Top Shop with 48 PIM, one Retriever
  // with none — so a penalty standing read by name would credit us a stranger's
  // sin bin. The team attribute keeps them apart: our penalty leader is Brenden
  // Kaplewicz, 43 PIM, 8th in the league, while down in the points field.
  const field = fullField(50115);
  const gr = field.filter((r) => /golden retrievers/i.test(r.team));
  const topPimGr = gr.slice().sort((a, b) => (b.pim ?? 0) - (a.pim ?? 0))[0]!;
  assert.match(topPimGr.name, /brenden kaplewicz/i);
  const pimRank = rank(field, (r) => r.pim, /brenden kaplewicz/i);
  assert.ok(pimRank !== null && pimRank <= 10, `Kaplewicz PIM rank ${pimRank}, expected top-10`);
  // The other Sean Leber's 48 PIM is NOT ours.
  const ourLeber = gr.find((r) => /leber/i.test(r.name));
  if (ourLeber) assert.ok((ourLeber.pim ?? 0) < 10, "our Leber is not the 48-PIM one");
});
