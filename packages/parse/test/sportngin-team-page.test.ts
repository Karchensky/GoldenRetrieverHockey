import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeamPageClaims } from "../src/sportngin/team-page.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * Real captured bytes. The two claims below are the whole reason this parser
 * exists and the whole reason it reports rather than decides: they are typed
 * into the same page, they describe the same season, and they name two
 * different divisions. The build checks each against the league's own
 * standings row; nothing here picks a winner.
 */

const pages = corpusPages("%eriemetrosports.com/page/show/%");
const noCorpus = pages.length === 0 && "corpus unavailable";
const claims = pages.flatMap((p) => parseTeamPageClaims(p.html));

test("both Erie Metro team pages carry both claims", { skip: noCorpus }, () => {
  assert.equal(pages.length, 2, "the 2016-17 and 2017-18 team pages");
  // Two claims per page, and the same two on each.
  assert.equal(claims.length, 4);
  assert.deepEqual(
    [...new Set(claims.map((c) => c.recorded))].sort(),
    [
      "2016-17 Adams Division Champions",
      "2016-17 EMHL Norris Division President's Trophy Champions",
    ],
  );
});

test("THE DIVISION EACH CLAIM NAMES IS ITS OWN FIELD", { skip: noCorpus }, () => {
  const adams = claims.find((c) => c.division === "Adams")!;
  const norris = claims.find((c) => c.division === "Norris")!;
  assert.ok(adams && norris, "both divisions are read, neither is dropped here");

  assert.equal(adams.season, "2016-17");
  assert.equal(adams.title, "Adams Division Champions");
  assert.equal(adams.league, null, "this claim names no league, and none is invented");

  assert.equal(norris.season, "2016-17");
  assert.equal(norris.league, "EMHL");
  assert.equal(norris.title, "Norris Division President's Trophy Champions");
});

test("the page's other headings are not honours", { skip: noCorpus }, () => {
  // "2017-18 Erie Metro Hockey League Schedule", "Recent 23 Golden Retrievers
  // News", "Golden Retreivers" — all headings in the same text blocks, none a
  // claim about winning anything.
  for (const c of claims) assert.match(c.recorded, /Champion|Trophy|Runner|Finalist/i);
  assert.equal(claims.filter((c) => /Schedule|News/i.test(c.recorded)).length, 0);
});

test("one honour is reported once, however many tags wrap it", { skip: noCorpus }, () => {
  // The Adams claim is `<p><em><strong>…</strong></em></p>`. Reading each
  // level would report it two or three times under one page.
  for (const page of pages) {
    const perPage = parseTeamPageClaims(page.html);
    const keys = perPage.map((c) => `${c.season}|${c.title}`);
    assert.equal(new Set(keys).size, keys.length, "a claim is not counted twice");
    assert.equal(perPage.length, 2);
  }
});

test("a heading with no season is not a claim", () => {
  assert.deepEqual(parseTeamPageClaims("<h3>League Champions</h3>"), []);
});
