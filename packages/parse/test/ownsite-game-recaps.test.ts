import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGameRecaps, parseRecapFixtures } from "../src/ownsite/game-recaps.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * The club's own written game recaps — goldenretrieverhockey.com, four
 * captures out of the Internet Archive, and the ONLY game-by-game record that
 * survives from the club's first five years.
 *
 * Real bytes only. The page is the reason this file exists at all: it has been
 * parsed into `site.json.recaps` and rendered as prose since the beginning,
 * and never once read as GAMES — dates, opponents and both scores were on
 * disk for a decade while the archive said it held no result before 2016.
 */

const pages = corpusPages("%goldenretrieverhockey.com%Game_Recaps%");
const noCorpus = pages.length === 0 && "corpus unavailable";

const at = (stamp: string) => pages.find((p) => p.url.includes(stamp))?.html ?? "";

test("the corpus holds four captures of the page, taken as the season ran", { skip: noCorpus }, () => {
  assert.equal(pages.length, 4);
  for (const stamp of ["20130221", "20130324", "20130425", "20130526"]) {
    assert.ok(at(stamp).length > 0, `no ${stamp} capture`);
  }
});

test("what each capture holds — the page grew, then started again", { skip: noCorpus }, () => {
  // February: 23 games. March: 27, the last of them a playoff fixture listed
  // the day before it was played. April: 28, the playoff opener replaced by
  // the championship series. May: FIVE, numbered from one — a different
  // season, on the same page, at the same address.
  assert.equal(parseRecapFixtures(at("20130221")).length, 23);
  assert.equal(parseRecapFixtures(at("20130324")).length, 27);
  assert.equal(parseRecapFixtures(at("20130425")).length, 28);
  assert.equal(parseRecapFixtures(at("20130526")).length, 5);
});

test("THE TWO GAMES THE PAGE NEVER SCORED, kept rather than dropped", { skip: noCorpus }, () => {
  const march = parseRecapFixtures(at("20130324")).filter((f) => f.grScore === null);
  assert.equal(march.length, 1);
  assert.equal(march[0]!.number, "1");
  assert.equal(march[0]!.date, "March 25");
  assert.equal(march[0]!.opponent, "Neth & Sons / Encore");
  assert.equal(march[0]!.opScore, null, "absence is not nought");
  // AND IT IS A PLAYOFF GAME. Nothing in the row says so — the club numbers
  // its playoffs from one, exactly like its regular season. Only the heading
  // standing over it knows.
  assert.equal(march[0]!.section, "Playoffs");
  assert.equal(march[0]!.isPlayoff, true);

  const april = parseRecapFixtures(at("20130425")).filter((f) => f.grScore === null);
  assert.equal(april.length, 1);
  assert.equal(april[0]!.number, "Championship 3");
  assert.equal(april[0]!.date, "April 10");
  assert.equal(april[0]!.opponent, "Papa Jake's Iceholes");
  // The page prints a quote where the score goes. The quote is the recap.
  assert.match(april[0]!.recap ?? "", /bunch of potatoes dressed up as ice hockey players/);
  assert.match(april[0]!.recap ?? "", /Justin Wheeler/);
});

test("the section heading is read, and it never leaks into a write-up", { skip: noCorpus }, () => {
  const april = parseRecapFixtures(at("20130425"));
  const sections = [...new Set(april.map((f) => f.section))];
  assert.deepEqual(sections, ["Playoffs", "Regular Season"]);
  // Every regular-season game on that capture sits under the second heading,
  // and none of them is marked a playoff.
  const regular = april.filter((f) => f.section === "Regular Season");
  assert.equal(regular.length, 26, "the season was 26 games");
  assert.ok(regular.every((f) => !f.isPlayoff));
  for (const f of april) assert.doesNotMatch(f.recap ?? "", /^(Playoffs|Regular Season)\b/);
});

test("the numbering restarts, which is the only witness to a second season", { skip: noCorpus }, () => {
  const may = parseRecapFixtures(at("20130526"));
  assert.deepEqual(may.map((f) => f.number), ["5", "4", "3", "2", "1"]);
  assert.deepEqual(may.map((f) => f.date), ["May 8", "May 3", "May 1", "April 24", "April 19"]);
  assert.ok(may.every((f) => f.section === null), "this capture prints no headings at all");
  // 19 April 2013 is game ONE while 15 March 2013 was game TWENTY-SIX. Dates
  // alone cannot tell those apart — both fall in a fall/winter half by the
  // month rule — and the club played two leagues that year.
  const april = parseRecapFixtures(at("20130425"));
  assert.equal(april.find((f) => f.date === "March 15")?.number, "26");
});

test("parseGameRecaps is unchanged: the RESULTS, and only the results", { skip: noCorpus }, () => {
  // This is what site.json.recaps has always been and what the season pages
  // render. A fixture with no score is a game, not a result.
  for (const stamp of ["20130221", "20130324", "20130425", "20130526"]) {
    const html = at(stamp);
    const scored = parseRecapFixtures(html).filter((f) => f.grScore !== null && f.opScore !== null);
    const recaps = parseGameRecaps(html);
    assert.equal(recaps.length, scored.length, stamp);
    for (const r of recaps) {
      assert.equal(typeof r.grScore, "number");
      assert.equal(typeof r.opScore, "number");
    }
  }
  assert.equal(parseGameRecaps(at("20130324")).length, 26);
  assert.equal(parseGameRecaps(at("20130425")).length, 27);
});

test("the whole page, merged and deduped, is 32 results and 34 games", { skip: noCorpus }, () => {
  // Exactly as generate.ts merges them: on number|date|opponent.
  const key = (f: { number: string; date: string; opponent: string }) =>
    `${f.number}|${f.date}|${f.opponent}`;

  const results = new Map<string, unknown>();
  const fixtures = new Map<string, unknown>();
  for (const p of pages) {
    for (const g of parseGameRecaps(p.html)) if (!results.has(key(g))) results.set(key(g), g);
    for (const f of parseRecapFixtures(p.html)) if (!fixtures.has(key(f))) fixtures.set(key(f), f);
  }
  assert.equal(results.size, 32, "the results the site has rendered all along");
  assert.equal(fixtures.size, 34, "and two more games it has never counted");
});

test("a page that is not a recap page yields nothing", () => {
  assert.deepEqual(parseRecapFixtures(""), []);
  assert.deepEqual(parseGameRecaps("<html><body><p>Nothing here.</p></body></html>"), []);
});
