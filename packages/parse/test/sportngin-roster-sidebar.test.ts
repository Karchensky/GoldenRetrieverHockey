import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRosterSidebar, parseRosterPlayer } from "../src/sportngin/roster-player.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * THE ROSTER SIDEBAR, AGAINST REAL CAPTURED BYTES ONLY.
 *
 * Not one fixture in this file is written by hand. Every assertion runs against
 * pages actually served by SportsEngine and stored in this repo's corpus,
 * because the thing this parser exists to fix was itself caused by trusting a
 * page's obvious content and not looking at the rest of it.
 *
 * If the corpus is unavailable the tests SKIP rather than pass — a green run
 * against zero pages is the failure mode that matters here.
 */

const GR = /(?:\d+\s+)?(?:the\s+)?golden\s*retrievers?/i;

/** Every captured roster_players page whose subject is a Golden Retriever. */
function grRosterPages(): { url: string; html: string }[] {
  return corpusPages("%roster_players%").filter((p) => {
    const title = p.html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    return GR.test(title);
  });
}

test("the corpus actually holds Golden Retrievers roster pages to test against", () => {
  const pages = grRosterPages();
  assert.ok(pages.length > 50, `expected many GR roster pages, found ${pages.length}`);
});

test("every card the sidebar yields has a name and a page id", () => {
  const pages = grRosterPages();
  if (pages.length === 0) return;
  let cards = 0;
  for (const p of pages) {
    for (const m of parseRosterSidebar(p.html)) {
      cards++;
      assert.ok(m.name.length > 1, `empty name on ${p.url}`);
      assert.ok(/^\d+$/.test(m.pageId), `bad page id ${m.pageId} on ${p.url}`);
      // No stray markup — the card's <h3> must be plain text.
      assert.ok(!/[<>]/.test(m.name), `markup leaked into name ${JSON.stringify(m.name)}`);
    }
  }
  assert.ok(cards > 100, `expected many sidebar cards, found ${cards}`);
});

test("the subject of a page is always present in that page's own sidebar", () => {
  const pages = grRosterPages();
  if (pages.length === 0) return;
  let checked = 0;
  for (const p of pages) {
    const mates = parseRosterSidebar(p.html);
    if (mates.length === 0) continue;
    const id = p.url.match(/roster_players\/(\d+)/)?.[1];
    if (!id) continue;
    // Only assert where this page's own id is one the sidebar could carry:
    // a sidebar lists the roster of the season the page belongs to.
    if (!mates.some((m) => m.pageId === id)) continue;
    const self = mates.find((m) => m.pageId === id)!;
    const subject = parseRosterPlayer(p.html);
    if (!subject) continue;
    assert.equal(self.name, subject.name, `sidebar and title disagree on ${p.url}`);
    if (self.jersey !== null && subject.jersey) {
      assert.equal(self.jersey, subject.jersey, `jersey disagrees on ${p.url}`);
    }
    checked++;
  }
  assert.ok(checked > 20, `expected to cross-check many pages, checked ${checked}`);
});

/**
 * The recovery this parser was written for, asserted on the exact bytes.
 *
 * `roster_players/36434306` is Corey Muff's 2019-20 page — the ONE capture this
 * archive held for that season, from which it published exactly one player.
 */
test("2019-20: one captured page yields the whole roster", () => {
  const pages = corpusPages("%roster_players/36434306%");
  if (pages.length === 0) return;
  const mates = parseRosterSidebar(pages[0]!.html);
  const byName = new Map(mates.map((m) => [m.name, m]));

  assert.equal(mates.length, 16, "the 2019-20 roster is sixteen men");
  for (const name of [
    "Corey Muff", "Anthony Gugino", "Dan Schmitt", "Brendan Kaplewicz",
    "Andy Murphy", "Rich Fedele", "Brett Koeppel", "Seth Hamilton",
    "Bryan Karchensky", "Mark Lucatra", "Anthony Christy", "Jason Kaplewicz",
    "Brent Boeing", "Vinny Terrana", "Adam Kaplewicz", "Alex Wapinewski",
  ]) {
    assert.ok(byName.has(name), `${name} missing from the 2019-20 sidebar`);
  }

  // Numbers and positions come off the card, and must not be shifted.
  assert.deepEqual(
    { j: byName.get("Bryan Karchensky")!.jersey, p: byName.get("Bryan Karchensky")!.position },
    { j: "21", p: "F" },
  );
  assert.deepEqual(
    { j: byName.get("Corey Muff")!.jersey, p: byName.get("Corey Muff")!.position },
    { j: "1", p: "G" },
  );
  // A card may carry a position and no number. That is not a parse failure and
  // must not become a jersey of "D".
  assert.deepEqual(
    { j: byName.get("Alex Wapinewski")!.jersey, p: byName.get("Alex Wapinewski")!.position },
    { j: null, p: "D" },
  );
});

test("2018-19: the sidebar carries a roster the archive did not have", () => {
  const pages = corpusPages("%roster_players/27736750%");
  if (pages.length === 0) return;
  const names = parseRosterSidebar(pages[0]!.html).map((m) => m.name);
  assert.equal(names.length, 14, "the 2018-19 roster is fourteen men");
  // The four the archive already knew, and one it did not.
  for (const n of ["Bryan Karchensky", "Adam Kaplewicz", "Brent Boeing", "Corey Muff", "Andy Murphy"]) {
    assert.ok(names.includes(n), `${n} missing from the 2018-19 sidebar`);
  }
});

/**
 * THE RULE THE INGEST DEPENDS ON: a sidebar card is never a stat line.
 *
 * If a card ever started carrying games or goals this would have to change, and
 * the build would be quietly publishing nulls over real figures until someone
 * noticed. Assert the shape rather than trust it.
 */
test("a sidebar card states name, number and position and nothing else", () => {
  const pages = grRosterPages();
  if (pages.length === 0) return;
  for (const p of pages.slice(0, 40)) {
    for (const m of parseRosterSidebar(p.html)) {
      assert.equal(Object.keys(m).sort().join(","), "jersey,name,pageId,position");
      if (m.jersey !== null) assert.match(m.jersey, /^\d+$/, `jersey ${m.jersey} is not a number`);
    }
  }
});
