import { test } from "node:test";
import assert from "node:assert/strict";
import { blocksOf, seasonOf, parseRosterStats } from "../src/ownsite/roster-stats.ts";
import { corpusHtml } from "./helpers/corpus.ts";

/**
 * Every fixture here is a REAL capture out of the corpus, never one I wrote.
 *
 * That is not a preference. The game-sheet parser in this repo passed 13/13
 * against a structure that did not exist, because I invented the fixture from
 * my idea of the page instead of reading the page: it produced 1,064 phantom
 * goals and zero penalties, and the tests were green the whole time. A parser
 * test written against imagined bytes tests the imagination.
 */

const pages = corpusHtml("%Team_Roster%");

test("the corpus actually has the keystone captures", () => {
  assert.ok(pages.length > 0, "no Team_Roster captures found — the rescue is gone");
});

test("seasonOf keeps the scorekeeper's own parenthetical", () => {
  const s = seasonOf("EMHL Winter 2012 - 2013 Stats (Still missing game # 2 stats)");
  assert.equal(s?.league, "EMHL");
  assert.equal(s?.session, "Winter 2012 - 2013");
  assert.equal(s?.phase, "Regular Season");
  // The note is provenance, not decoration: it is the team saying which games
  // these totals exclude. Dropping it would make the numbers look complete.
  assert.equal(s?.note, "Still missing game # 2 stats");
});

test("seasonOf separates playoffs from the regular season", () => {
  const p = seasonOf("EMHL Winter 2012 - 2013 Playoff Stats:");
  assert.equal(p?.phase, "Playoffs");
  assert.equal(p?.session, "Winter 2012 - 2013");
  const r = seasonOf("EMHL Winter 2012 - 2013 Stats (Missing Game 25)");
  assert.equal(r?.phase, "Regular Season");
  // Same session, different phase — they must merge into one season later.
  assert.equal(r?.session, p?.session);
});

test("seasonOf reads the Labatt league too, not just Erie Metro", () => {
  const s = seasonOf("LSHL 2013 Summer Stats:");
  assert.equal(s?.league, "LSHL");
  assert.equal(s?.session, "2013 Summer");
});

test("seasonOf rejects headings with no year", () => {
  assert.equal(seasonOf("Team Roster & Stats"), null);
  assert.equal(seasonOf(""), null);
});

test("blocksOf files tables under the heading above them", () => {
  const html = pages.find((p) => p.includes("Still missing game"))!;
  const blocks = blocksOf(html).filter((b) => seasonOf(b.heading));
  assert.ok(blocks.length >= 1);
  // The heading block carries no table of its own; the tables that follow are
  // filed under it. If this inverts, every stat lands on the wrong season.
  assert.ok(blocks[0]!.tables.length >= 1, "heading block picked up no tables");
});

test("parses the 2012-13 skater line the site actually published", () => {
  const html = pages.find((p) => p.includes("Still missing game"))!;
  const rows = parseRosterStats(html);
  const bk = rows.find((r) => r.name === "Bryan Karchensky" && r.phases[0]!.kind === "skater");
  assert.ok(bk, "Bryan Karchensky not parsed from the 2012-13 page");
  assert.equal(bk!.jersey, "21");
  assert.equal(bk!.position, "F");
  assert.equal(bk!.session, "Winter 2012 - 2013");
  assert.equal(bk!.phases[0]!.stats["GP"], "22");
  assert.equal(bk!.phases[0]!.stats["G"], "52");
  assert.equal(bk!.phases[0]!.stats["A"], "35");
  assert.equal(bk!.phases[0]!.stats["PTS"], "87");
});

test("goalie SAVES survive — this era is the only one that recorded them", () => {
  const html = pages.find((p) => p.includes("Brent Seymour"))!;
  const rows = parseRosterStats(html);
  const g = rows.find((r) => r.phases[0]!.kind === "goalie");
  assert.ok(g, "no goalie row parsed");
  assert.equal(g!.name, "Brent Seymour");
  assert.equal(g!.phases[0]!.stats["GP"], "19");
  assert.equal(g!.phases[0]!.stats["W"], "16");
  // 658 saves. Every HarborCenter-era goaltender line on file records saves as
  // zero, including the wins. The team's own site kept better goalie stats
  // than any league ever kept for them, and losing that would be the single
  // most wasteful thing this parser could do.
  assert.equal(g!.phases[0]!.stats["SV"], "658");
  assert.equal(g!.phases[0]!.stats["GA"], "94");
});

test("skaters and goalies are told apart by their columns, not their position cell", () => {
  const html = pages.find((p) => p.includes("Brent Seymour"))!;
  const rows = parseRosterStats(html);
  const kinds = new Set(rows.map((r) => r.phases[0]!.kind));
  assert.ok(kinds.has("skater") && kinds.has("goalie"), "both kinds must appear");
  // A goalie row must never carry PTS, and a skater row must never carry GAA.
  for (const r of rows) {
    if (r.phases[0]!.kind === "goalie") assert.ok(!("PTS" in r.phases[0]!.stats));
    else assert.ok(!("GAA" in r.phases[0]!.stats));
  }
});

test("no blank or header rows leak through as players", () => {
  for (const html of pages) {
    for (const r of parseRosterStats(html)) {
      assert.ok(r.name.trim().length > 1, `junk name: ${JSON.stringify(r.name)}`);
      assert.ok(!/^(name|player name|position)$/i.test(r.name));
      assert.ok(Object.keys(r.phases[0]!.stats).length > 0);
    }
  }
});

test("every rescued capture parses without throwing", () => {
  let total = 0;
  for (const html of pages) total += parseRosterStats(html).length;
  assert.ok(total > 0, "the whole 2012-16 rescue yielded no rows");
});
