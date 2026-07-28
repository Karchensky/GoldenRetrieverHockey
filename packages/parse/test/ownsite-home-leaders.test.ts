import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHomeLeaders } from "../src/ownsite/home-leaders.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * REAL CAPTURED BYTES ONLY — the Internet Archive's copies of
 * goldenretrieverhockey.com, read out of the corpus by the URL they were
 * fetched from. The Wayback timestamp in that URL is load-bearing here: the
 * team re-edited ONE page for four years, so the same address holds a different
 * competition at each snapshot, and the timestamp is the only thing that tells
 * them apart.
 *
 * For four of the five tables below this page is the only surviving statistical
 * record anywhere.
 */

const snap = (ts: string): string => {
  const all = corpusPages("%goldenretrieverhockey%");
  assert.ok(all.length >= 30, `corpus has only ${all.length} keystone pages`);
  const p = all.find((x) => x.url.includes(`/web/${ts}`));
  assert.ok(p, `snapshot ${ts} not in the corpus`);
  return p.html;
};

test("the regular-season table that was already being read still reads the same", () => {
  const r = parseHomeLeaders(snap("20141220154139"));
  assert.ok(r);
  assert.equal(r.session, "2014-15");
  assert.equal(r.league, "EMHL");
  assert.equal(r.phase, "Regular Season");
  assert.equal(r.leaders.length, 15);
  assert.deepEqual(r.leaders[0], { name: "Adam Kaplewicz", pts: 30 });
  assert.deepEqual(r.leaders.at(-1), { name: "Alex Suffoletto", pts: 1 });
});

test("'Playoff' in the heading is the page stating its own phase", () => {
  // Same season, same address, two months later — and a different table. Read
  // as "Regular Season" it would have collided with the row above on the
  // builder's dedup key and silently replaced it.
  const r = parseHomeLeaders(snap("20150428005134"));
  assert.ok(r);
  assert.equal(r.session, "2014-15");
  assert.equal(r.phase, "Playoffs");
  assert.equal(r.leaders.length, 15);
  assert.deepEqual(r.leaders[0], { name: "Brent Boeing", pts: 10 });
});

test("a summer season has no year span at all", () => {
  // Summer 2015, and a different league: Performax, not the EMHL. The same
  // page's banner reads "The Golden Retrievers are your 2015 Summer PxHL
  // Champions!".
  const r = parseHomeLeaders(snap("20150831173706"));
  assert.ok(r);
  assert.equal(r.session, "2015 Summer");
  assert.equal(r.league, "PxHL");
  assert.equal(r.phase, "Playoffs");
  assert.equal(r.leaders.length, 13);
  assert.deepEqual(r.leaders[0], { name: "Vinny Terrana", pts: 4 });
  // Two men who appear nowhere else in this session.
  assert.ok(r.leaders.some((l) => l.name === "Jon Gingrich"));
  assert.ok(r.leaders.some((l) => l.name === "Marc DeGiulio"));
});

test("a heading split across two <h3> elements is still one heading", () => {
  // By 2016 the season and the words "Point Leaders" sit in separate absolutely
  // positioned blocks. A visual line is not a markup line.
  const r = parseHomeLeaders(snap("20160415113018"));
  assert.ok(r);
  assert.equal(r.session, "2015-2016");
  assert.equal(r.league, "EMHL");
  assert.equal(r.phase, "Regular Season");
  assert.equal(r.leaders.length, 14);
  assert.deepEqual(r.leaders[0], { name: "Bryan Karchensky", pts: 93 });
  assert.deepEqual(r.leaders.at(-1), { name: "Matt Phalzer", pts: 4 });
});

test("the four-digit second year is read as a year, not as two digits", () => {
  // "2015 / 2016" — the old reader's `\d{2}` matched the "20" of 2016 and then
  // failed, so this whole season was invisible.
  const mid = parseHomeLeaders(snap("20160129132019"));
  assert.ok(mid);
  assert.equal(mid.session, "2015-2016");
  // Mid-season, and lower than the settled table above — the same season at two
  // moments, which is what the builder's latest-snapshot-wins rule is for.
  assert.deepEqual(mid.leaders[0], { name: "Bryan Karchensky", pts: 23 });
});

test("a tournament heading names no league and no half, and is still read", () => {
  // "2015 gREATER bUFFALO iNVITATIONAL pOINT lEADERS" — the odd one out: an
  // event name where every other heading has a league and a season. The page
  // shouts it in alternating case and the parser hands it on VERBATIM; naming
  // and placement belong to sessions.ts, which is the only thing that knows
  // this tournament is played in late April.
  const r = parseHomeLeaders(snap("20150529160954"));
  assert.ok(r);
  assert.equal(r.session, "2015 gREATER bUFFALO iNVITATIONAL");
  assert.equal(r.phase, "Regular Season");
  assert.equal(r.leaders.length, 10);
  assert.deepEqual(r.leaders[0], { name: "Marc DeGiulio", pts: 11 });
  // The only page in the archive that names this man.
  assert.deepEqual(r.leaders[8], { name: "Michael Graber", pts: 2 });
});

test("a league heading is never mistaken for an event", () => {
  // Both patterns start with a year. The league one must win every time, or
  // "2015 Summer PxHL Playoff Point Leaders" becomes a tournament called
  // "Summer PxHL Playoff".
  for (const [ts, session] of [
    ["20141220154139", "2014-15"],
    ["20150428005134", "2014-15"],
    ["20150831173706", "2015 Summer"],
    ["20160415113018", "2015-2016"],
  ] as const) {
    assert.equal(parseHomeLeaders(snap(ts))?.session, session);
  }
});

test("a page with no leaders table at all returns null", () => {
  assert.equal(parseHomeLeaders(snap("20130703022433")), null);
});
