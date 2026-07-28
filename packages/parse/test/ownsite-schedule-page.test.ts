import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchedulePage } from "../src/ownsite/schedule-page.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * REAL CAPTURED BYTES ONLY. Not one page below was written by hand — a parser
 * in this repo once passed 13 of 13 against an invented fixture and produced
 * 1,064 phantom goals, and this route is the most invented-fixture-shaped one
 * yet: a hand-typed list on a GoDaddy site builder page, with no table, no
 * year, and a score convention that has to be read out of the page rather than
 * assumed.
 *
 * THE ASSERTION THAT MATTERS IS THE ONE ABOUT ORDER. An earlier pass rejected
 * this page as self-contradictory because `9 - 3 W` and `4 - 2 L` both lead
 * with the larger number, so the pair cannot be (us, them) in both. It is not
 * contradictory — it is written winner first — and the test below proves that
 * from the bytes by killing the two alternatives on their own rows rather than
 * asserting the conclusion.
 */

const pages = corpusPages("%goldenretrieverhockey.com%schedule.html");
const parsed = pages
  .map((p) => parseSchedulePage(p.html))
  .filter((x): x is NonNullable<typeof x> => x !== null);
const noCorpus = pages.length === 0 && "corpus unavailable";

/** The 2014/15 page — the only capture of this route that exists. */
const page = parsed[0];

test("the corpus holds this page and it names its own season", { skip: noCorpus }, () => {
  assert.equal(pages.length, 1, "one capture of schedule.html");
  assert.equal(parsed.length, 1, "and it parses");
  assert.equal(page!.heading, "2014 / 2015 EMHL Season");
  assert.equal(page!.league, "EMHL");
});

test("fifteen fixtures, and nothing that looks like one was skipped", { skip: noCorpus }, () => {
  assert.equal(page!.fixtures.length, 15);
  assert.deepEqual(
    page!.fixtures.map((f) => f.number),
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
  );
  // Everything refused is page furniture, never a line beginning "Game".
  for (const line of page!.unread) assert.doesNotMatch(line, /^Game\s*\d/i);
  assert.deepEqual(page!.unread, [
    "2014 - 2015 EMHL Standings",
    "Copyright © Golden Retriever Hockey . All rights reserved.",
    "View on Mobile",
  ]);
});

test("every fixture carries a weekday, a date, an opponent and its section", { skip: noCorpus }, () => {
  for (const f of page!.fixtures) {
    assert.match(f.weekday, /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/);
    assert.ok(f.month >= 1 && f.month <= 12, `month ${f.month}`);
    assert.ok(f.day >= 1 && f.day <= 31, `day ${f.day}`);
    assert.ok(f.opponent.length > 0);
    // No venue is ever stated: `vs.` is stripped as house style, and nothing
    // that survives it may look like a venue claim.
    assert.doesNotMatch(f.opponent, /^(at|vs\.?)\s/i);
    assert.doesNotMatch(f.opponent, /[()]/, "the score tail is not part of the club's name");
    assert.equal(f.section, "Regular Season");
  }
  // The page prints a time on all fifteen. Not required by the parser; true here.
  assert.equal(page!.fixtures.filter((f) => f.time !== null).length, 15);
});

test("ten scored rows, one result with no score, four with neither", { skip: noCorpus }, () => {
  const scored = page!.fixtures.filter((f) => f.written !== null);
  const resultOnly = page!.fixtures.filter((f) => f.written === null && f.result !== null);
  const bare = page!.fixtures.filter((f) => f.written === null && f.result === null);
  assert.equal(scored.length, 10);
  assert.equal(resultOnly.length, 1);
  assert.equal(bare.length, 4);
  // Game 8: "vs. Barrets (W)". A result and no score, which is a real state
  // and not a parse failure — absence is not nought.
  assert.equal(resultOnly[0]!.number, "8");
  assert.equal(resultOnly[0]!.result, "W");
  assert.equal(resultOnly[0]!.gf, null);
  assert.equal(resultOnly[0]!.ga, null);
});

test("THE SCORES ARE WRITTEN WINNER FIRST — the two alternatives die here", { skip: noCorpus }, () => {
  const scored = page!.fixtures.filter((f) => f.written !== null && f.result !== null);
  assert.equal(scored.length, 10);

  let larger = 0;
  let usFirst = 0;
  let themFirst = 0;
  for (const f of scored) {
    const [a, b] = f.written!;
    if (a > b) larger++;
    // "us - them": the first number is ours.
    if (f.result === "W" ? a > b : f.result === "L" ? a < b : a === b) usFirst++;
    // "them - us": the first number is theirs.
    if (f.result === "W" ? a < b : f.result === "L" ? a > b : a === b) themFirst++;
  }

  // The larger number is written first on every single row, ties included.
  assert.equal(larger, 10, "larger number first");
  // And that is precisely what kills both of the readings a reader reaches for
  // first: each survives only the five rows whose label happens to suit it.
  assert.equal(usFirst, 5, "'us - them' is consistent with only the wins");
  assert.equal(themFirst, 5, "'them - us' is consistent with only the losses");
  // Winner first is consistent with all ten, which is the only reading left.
  for (const f of scored) {
    const [a, b] = f.written!;
    const winner = Math.max(a, b);
    const loser = Math.min(a, b);
    assert.equal(f.gf, f.result === "W" ? winner : loser, `game ${f.number} gf`);
    assert.equal(f.ga, f.result === "W" ? loser : winner, `game ${f.number} ga`);
  }
});

test("the ten scored rows in full, as the page writes them", { skip: noCorpus }, () => {
  assert.deepEqual(
    page!.fixtures
      .filter((f) => f.gf !== null)
      .map((f) => `${f.recorded} ${f.opponent} ${f.gf}-${f.ga} ${f.result}`),
    [
      "September 17 Catholic Health 9-3 W",
      "September 27 The Brownshafts 11-12 L",
      "October 6 Buffalo's Best Grill 2-4 L",
      "October 13 Catholic Health 12-8 W",
      "October 18 Barrets 16-6 W",
      "October 26 Peace Frogs 2-6 L",
      "October 31 Brownshafts 11-6 W",
      "November 17 Indians 7-5 W",
      "November 24 Buffalo's Best Grill 6-10 L",
      "November 28 All Black Sticks 3-13 L",
    ],
  );
});

test("a row that contradicts its own label is refused, not reoriented", () => {
  // Hand-written, and deliberately so: the corpus contains no such row, which
  // is the finding. This asserts what happens the day one appears — the score
  // is not orientable and the archive says so, rather than picking the larger
  // number to make the label come true. `written` survives either way.
  const html =
    "<h1>2014 / 2015 EMHL Season</h1><p>Regular Season</p>" +
    "<p>Game 1: Wednesday, September 17th - 9:20 pm - vs. Catholic Health (3 - 9 W)</p>";
  const out = parseSchedulePage(html)!;
  assert.equal(out.fixtures.length, 1);
  assert.deepEqual(out.fixtures[0]!.written, [3, 9]);
  assert.equal(out.fixtures[0]!.result, "W");
  assert.equal(out.fixtures[0]!.gf, null);
  assert.equal(out.fixtures[0]!.ga, null);
});

test("a page with no season heading is not a schedule", () => {
  assert.equal(parseSchedulePage("<html><body><p>Game 1: Monday, May 4th - vs. X</p></body></html>"), null);
});
