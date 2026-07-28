import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStandings, parseStandingsTitle } from "../src/sportngin/standings.ts";
import { corpusHtml, corpusPages } from "./helpers/corpus.ts";

/**
 * Every fixture here is REAL captured bytes out of the corpus. Not one of
 * them is a page I wrote. (A parser in this repo once passed 13/13 against a
 * hand-authored fixture and produced 1,064 phantom goals; the rule is
 * absolute.)
 *
 * These pages matter more than standings usually would: for Summer 2019 the
 * Silver-table row asserted below is the ENTIRE surviving record of the
 * season, and for 2020-21 ("2021 Spring HAHL") the one mid-season snapshot
 * is the most that will ever be known — the league changed platforms before
 * the season ended and no later capture exists anywhere.
 */

// HarborCenter's host only: Erie Metro's two live standings pages are a
// different column vocabulary and are not ingested by the build. They are
// still exercised by the every-page test at the bottom, via corpusHtml on
// the bare path.
const pages = corpusPages("%rinksatharborcenter.com/standings/show/%");
const allHosts = corpusHtml("%/standings/show/%");

const titled = (t: string) =>
  pages.filter((p) => new RegExp(`<title>[^<]*${t}`).test(p.html));

const gr = (rows: NonNullable<ReturnType<typeof parseStandings>>["rows"]) =>
  rows.filter((r) => /^(the )?golden retrievers$/i.test(r.team));

test("the corpus actually holds the standings these seasons depend on", () => {
  assert.ok(pages.length > 0, "no standings/show captures — the era is gone");
  assert.ok(titled("2019 Spring/Summer").length > 0, "no Summer 2019 standings capture");
  assert.ok(titled("2021 Spring HAHL").length > 0, "no 2021 Spring standings capture");
});

test("parseStandingsTitle reads the session out from between Standings and the site", () => {
  const t = parseStandingsTitle("Standings - 2019 Spring/Summer Regular Season - HAHL");
  assert.equal(t?.session, "2019 Spring/Summer Regular Season");
  assert.equal(t?.site, "HAHL");
  // The session contains hyphens of its own; only the ends are structure.
  const w = parseStandingsTitle("Standings - 2018-19 Fall/Winter - HAHL");
  assert.equal(w?.session, "2018-19 Fall/Winter");
  // The serving site is NOT a league: club sites serve the same tables.
  const d = parseStandingsTitle("Standings - 2018 Spring/Summer Regular Season - District 5");
  assert.equal(d?.site, "District 5");
  assert.equal(parseStandingsTitle("Statistics - 2018-19 Fall/Winter - HAHL"), null);
  assert.equal(parseStandingsTitle("Standings - HAHL"), null);
  assert.equal(parseStandingsTitle(""), null);
});

test("SUMMER 2019: the season's entire surviving record, to the digit", () => {
  // Three snapshots — August, October, December 2019 — and the row is
  // identical in all three: the league had stopped moving it by the first
  // capture. 12 games, 5-7, fifth of eight in Silver. This one row is the
  // whole season; nothing else survives anywhere.
  const snaps = titled("2019 Spring/Summer");
  assert.equal(snaps.length, 3, "expected exactly three Summer 2019 snapshots");
  for (const { html } of snaps) {
    const st = parseStandings(html)!;
    assert.equal(st.session, "2019 Spring/Summer Regular Season");
    const ours = gr(st.rows);
    assert.equal(ours.length, 1, "the Retrievers hold exactly one standings row");
    const row = ours[0]!;
    assert.equal(row.team, "The Golden Retrievers");
    assert.equal(row.division, "Silver");
    assert.equal(row.place, 5);
    assert.equal(row.of, 8);
    assert.equal(row.stats["GP"], "12");
    assert.equal(row.stats["W"], "5");
    assert.equal(row.stats["L"], "7");
    assert.equal(row.stats["OTW"], "0");
    assert.equal(row.stats["OTL"], "0");
    assert.equal(row.stats["PTS"], "15");
    assert.equal(row.stats["GF"], "59");
    assert.equal(row.stats["GA"], "63");
    // "Division" is the platform's header for the composite record cell.
    assert.equal(row.stats["Division"], "5-7-0-0-0");
  }
});

test("2021 SPRING (the 2020-21 half): the mid-season ceiling, to the digit", () => {
  // One snapshot exists, 20 April 2021, season still running — and then the
  // league moved platforms, so this is the most that will ever be known:
  // eight games, 2-4-2, fifth of seven in Silver.
  const snaps = titled("2021 Spring HAHL");
  assert.equal(snaps.length, 1, "expected exactly one 2021 Spring standings snapshot");
  const st = parseStandings(snaps[0]!.html)!;
  assert.equal(st.session, "2021 Spring HAHL Regular Season");
  const ours = gr(st.rows);
  assert.equal(ours.length, 1);
  const row = ours[0]!;
  assert.equal(row.team, "The Golden Retrievers");
  assert.equal(row.division, "Silver");
  assert.equal(row.place, 5);
  assert.equal(row.of, 7);
  assert.equal(row.stats["GP"], "8");
  assert.equal(row.stats["W"], "2");
  assert.equal(row.stats["L"], "4");
  assert.equal(row.stats["OTW"], "2");
  assert.equal(row.stats["OTL"], "0");
  assert.equal(row.stats["PTS"], "10");
  assert.equal(row.stats["GF"], "39");
  assert.equal(row.stats["GA"], "42");
  assert.equal(row.stats["Division"], "2-4-2-0-0");
});

test("the columns are not fixed: Summer 2018 carries an SO column, verbatim", () => {
  // The 2018 table has a shootout column the later seasons drop. Had this
  // fixture been invented it would not have one — same lesson as the
  // league tables' missing GP.
  const st = parseStandings(titled("2018 Spring/Summer")[0]!.html)!;
  const row = gr(st.rows)[0]!;
  assert.equal(row.stats["SO"], "0");
  assert.equal(row.stats["GP"], "12");
  assert.equal(row.stats["Division"], "6-2-3-1-0");
  assert.equal(row.division, "Silver");
  assert.equal(row.place, 3);
  assert.equal(row.of, 11);
});

test("one season, two moments: 2019-20 was captured mid-season AND settled", () => {
  // December 2019: 9 games, 2-6-1, eighth. From September 2020 on: 19 games,
  // 11-6-2, second. Both rows are REAL and the parser must return each as
  // its page states it — choosing between them is the build's job (latest
  // snapshot wins), and this is the evidence that choice is made over.
  const states = new Set(
    titled("2019-20 Regular Season - HAHL")
      .map(({ html }) => gr(parseStandings(html)!.rows)[0])
      .filter(Boolean)
      .map((r) => `${r!.stats["GP"]}|${r!.stats["PTS"]}|${r!.place}`),
  );
  assert.deepEqual([...states].sort(), ["19|37|2", "9|8|8"]);
});

test("rows anchor to their OWN division heading — a Silver row is never Bronze", () => {
  // Every captured HAHL page that carries the Retrievers puts them in
  // Silver, under four different serving sites. A parser that read division
  // headings out of order would misfile them long before it misread a stat.
  for (const { html } of pages) {
    const st = parseStandings(html);
    if (!st) continue;
    for (const row of gr(st.rows)) {
      assert.equal(row.division, "Silver", st.session);
      assert.ok(row.place >= 1 && row.place <= row.of);
    }
  }
});

test("the page is not evidence of the team: club sites serve the same tables", () => {
  // "District 5", "Bandits", "Angels with Filthy Souls" — SportsEngine club
  // sites serving the league's standings under their own banner. The row
  // still belongs to the team named IN the row, and the same season parses
  // to the same digits regardless of who served it.
  const bandits = pages.find((p) => /<title>[^<]*Standings[^<]*Bandits/.test(p.html));
  assert.ok(bandits, "expected the Bandits-served 2018-19 standings in the corpus");
  const st = parseStandings(bandits!.html)!;
  const row = gr(st.rows)[0]!;
  assert.equal(st.session, "2018-19 Fall/Winter");
  assert.equal(row.stats["GP"], "23");
  assert.equal(row.stats["PTS"], "30");
  assert.equal(row.place, 10);
  assert.equal(row.of, 15);
});

test("every row is one real standing row: counts match the platform's own ids", () => {
  // Each team's row carries its own id ("standing_4626809_603556"), once.
  // The parser must return exactly one row per id — no responsive-view
  // doubles, no header leaks, no totals rows — and every row must name a
  // club, not a number that drifted in from a stat column.
  for (const { html } of pages) {
    const st = parseStandings(html);
    if (!st) continue;
    const ids = new Set(
      [...html.matchAll(/id=['"](standing_\d+_\d+)['"]/g)].map((m) => m[1]),
    );
    assert.equal(st.rows.length, ids.size, "row count must match the page's standing ids");
    for (const r of st.rows) {
      assert.match(r.team, /[a-z]/i, `numeric team — columns shifted: ${JSON.stringify(r.team)}`);
      assert.ok(!/^(team|gp|w|l)$/i.test(r.team), `header leaked: ${r.team}`);
      assert.ok(Object.keys(r.stats).length > 0, `no stats: ${r.team}`);
      assert.ok(r.division.length > 0, "a row without a division heading");
    }
  }
});

test("every captured standings page parses without throwing — Erie Metro's included", () => {
  // The two eriemetrosports.com pages speak a different vocabulary
  // (OTL/For/Against/L10). The build does not ingest them yet; the parser
  // must still read them rather than fall over when someone does.
  assert.ok(allHosts.length >= pages.length + 2, "expected the two Erie Metro standings pages");
  for (const html of allHosts) assert.doesNotThrow(() => parseStandings(html));
  const erie = allHosts
    .map((h) => parseStandings(h))
    .filter((s) => s && /^(golden retrievers)$/i.test(s.site));
  assert.equal(erie.length, 2, "the team's own two Erie standings pages");
  for (const st of erie) {
    const row = st!.rows.find((r) => /golden retrievers/i.test(r.team));
    assert.ok(row, "the Retrievers row is on their own standings page");
    assert.equal(row!.stats["OTL"] !== undefined, true, "Erie vocabulary: OTL");
    assert.equal(row!.stats["For"] !== undefined, true, "Erie vocabulary: For");
  }
});
