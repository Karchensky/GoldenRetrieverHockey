import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSessionLabel,
  parseGameDate,
  halfFromMonth,
  resolveSession,
  sessionLabel,
} from "../src/sessions.ts";

// Every label below is REAL, taken from the four platforms in the corpus.
// They describe the same kind of thing four different ways.

test("reads every summer label shape in the corpus", () => {
  for (const s of ["Summer 2026", "Sum 2024 Regular Season", "2018 Spring/Summer Regular Season"]) {
    const p = parseSessionLabel(s);
    assert.equal(p?.half, "summer", s);
  }
  assert.equal(parseSessionLabel("Summer 2026")?.year, 2026);
  assert.equal(parseSessionLabel("Sum 2024 Regular Season")?.year, 2024);
  assert.equal(parseSessionLabel("2018 Spring/Summer Regular Season")?.year, 2018);
});

test("reads every fall/winter label shape in the corpus", () => {
  for (const s of ["Fall/Winter 2021-22", "2017-18 Regular Season", "2019-20 Regular Season", "2025-26"]) {
    assert.equal(parseSessionLabel(s)?.half, "fall-winter", s);
  }
  assert.equal(parseSessionLabel("2017-18 Regular Season")?.year, 2017);
  assert.equal(parseSessionLabel("Fall/Winter 2021-22")?.year, 2021);
});

test("sessions sort chronologically — summer precedes its own fall/winter", () => {
  const order = [
    "Summer 2021", "Fall/Winter 2021-22", "Summer 2022", "2022-23 Regular Season", "Summer 2023",
  ].map((s) => parseSessionLabel(s)!);
  const sorted = [...order].sort((a, b) => a.sort - b.sort);
  assert.deepEqual(sorted.map((x) => x.sort), order.map((x) => x.sort), "already in order");
  assert.ok(parseSessionLabel("Summer 2021")!.sort < parseSessionLabel("Fall/Winter 2021-22")!.sort);
  assert.ok(parseSessionLabel("Fall/Winter 2021-22")!.sort < parseSessionLabel("Summer 2022")!.sort);
});

test("halfFromMonth follows the owner's boundaries: summer is June–August", () => {
  assert.equal(halfFromMonth(6), "summer");
  assert.equal(halfFromMonth(7), "summer");
  assert.equal(halfFromMonth(8), "summer");
  assert.equal(halfFromMonth(9), "fall-winter");
  assert.equal(halfFromMonth(5), "fall-winter");
  assert.equal(halfFromMonth(1), "fall-winter");
});

test("parseGameDate reads the long form (which the corpus does not use)", () => {
  // THIS TEST USED TO BE CALLED "reads the corpus's date format" and it was a
  // lie. Neither "July 13, 2026" nor "December 8, 2014" appears anywhere in
  // the archive -- I made both up, then named the test after a claim it never
  // checked, and it passed green while the function could not read a single
  // one of the 65 real dates. See the abbreviated-month tests at the bottom.
  //
  // Third time this exact error has cost this repo: the game-sheet parser
  // passed 13/13 against a page structure that did not exist and produced
  // 1,064 phantom goals; isRetrievers matched the whole partial and labelled
  // three other teams as ours. A test is worth what its fixture is worth.
  assert.deepEqual(parseGameDate("July 13, 2026"), { year: 2026, month: 7 });
  assert.deepEqual(parseGameDate("December 8, 2014"), { year: 2014, month: 12 });
  assert.equal(parseGameDate("not a date"), null);
});

test("a GAME DATE overrides the label — labels lie, dates do not", () => {
  // Owner guidance: check the dates. A session mislabelled by its platform
  // is corrected by the games actually played in it.
  const r = resolveSession("2026 Regular Season", "July 8, 2026");
  assert.equal(r?.half, "summer", "July is summer regardless of what the label says");
  assert.equal(r?.year, 2026);
});

test("a January game belongs to the fall/winter session that STARTED the prior year", () => {
  // Jan 2022 is part of fall/winter 2021-22, not 2022-23.
  const r = resolveSession("2021-22 Regular Season", "January 14, 2022");
  assert.equal(r?.half, "fall-winter");
  assert.equal(r?.year, 2021, "the session is named for the year it began");
});

test("an unparseable date falls back to the label rather than throwing", () => {
  const r = resolveSession("Summer 2026", "sometime last year");
  assert.equal(r?.half, "summer");
  assert.equal(r?.year, 2026);
});

test("sessionLabel renders a stable display form", () => {
  assert.equal(sessionLabel({ year: 2026, half: "summer", sort: 2026 }), "2026 - Summer");
  assert.equal(sessionLabel({ year: 2017, half: "fall-winter", sort: 2017.5 }), "2017 - Winter");
  assert.equal(sessionLabel({ year: 2025, half: "fall-winter", sort: 2025.5 }), "2025 - Winter");
});

test("reads the canonical display labels back into stable session identities", () => {
  assert.deepEqual(parseSessionLabel("2026 - Summer"), { year: 2026, half: "summer", sort: 2026 });
  assert.deepEqual(parseSessionLabel("2025 - Winter"), { year: 2025, half: "fall-winter", sort: 2025.5 });
});

test("an unrecognisable label returns null rather than guessing", () => {
  // Guessing a session would silently file real games under a fabricated year.
  assert.equal(parseSessionLabel("Regular Season"), null);
  assert.equal(parseSessionLabel(""), null);
});

/* ---- the pandemic spring -------------------------------------------------
   HAHL ran exactly one bare-"Spring" season: "2021 Spring HAHL", the half the
   rinks reopened for after the 2020-21 winter never started. It was in play
   in April 2021 — the fall/winter window — so it files as the fall/winter
   half of the PRIOR year, which is the slot its own game dates would pick.
   The ruling lives on ONE branch of parseSessionLabel; if the captain files
   it elsewhere, that branch moves and these tests say what changed.        */

test("2021 Spring is the 2020-21 fall/winter half — the pandemic session", () => {
  // The label as the league's own pages print it, title and table alike.
  const p = parseSessionLabel("2021 Spring HAHL Regular Season");
  assert.deepEqual(p, { year: 2020, half: "fall-winter", sort: 2020.5 });
  assert.equal(sessionLabel(p!), "2020 - Winter");
  // And the short form, in case a schedule ever says it plainly.
  assert.deepEqual(parseSessionLabel("Spring 2021"), { year: 2020, half: "fall-winter", sort: 2020.5 });
});

test("it slots between 2019-20 and Summer 2021 — the gap it fills", () => {
  const spring = parseSessionLabel("2021 Spring HAHL Regular Season")!;
  assert.ok(parseSessionLabel("2019-20 Regular Season")!.sort < spring.sort);
  assert.ok(spring.sort < parseSessionLabel("Summer 2021")!.sort);
});

test("bare Spring never captures HAHL's Spring/Summer labels — those are summers", () => {
  // "Spring/Summer" is what this league calls its SUMMER session; the spring
  // rule must not reach it under either word order.
  assert.deepEqual(parseSessionLabel("2019 Spring/Summer Regular Season"), {
    year: 2019, half: "summer", sort: 2019,
  });
  assert.deepEqual(parseSessionLabel("2018 Spring/Summer Regular Season"), {
    year: 2018, half: "summer", sort: 2018,
  });
  assert.equal(parseSessionLabel("Spring/Summer 2018")?.half, "summer");
});

/* ---- the abbreviated-month regression ------------------------------------
   Every scoresheet in the corpus writes "Sep 19, 2016". parseGameDate wanted a
   full month name, so it returned null for all 65 of them and resolveSession's
   date override -- the whole reason it takes a gameDate -- silently never ran.
   These assert against the format the archive actually contains.            */

test("parseGameDate reads the abbreviated months the sheets actually use", () => {
  assert.deepEqual(parseGameDate("Sep 19, 2016"), { year: 2016, month: 9 });
  assert.deepEqual(parseGameDate("Oct 03, 2016"), { year: 2016, month: 10 });
  assert.deepEqual(parseGameDate("Aug 23, 2018"), { year: 2018, month: 8 });
  assert.deepEqual(parseGameDate("Jul 4, 2019"), { year: 2019, month: 7 });
  // still reads the long form nothing in the corpus uses
  assert.deepEqual(parseGameDate("July 13, 2026"), { year: 2026, month: 7 });
});

test("May parses either way — it is the one month that is its own abbreviation", () => {
  // And therefore the only date this function ever parsed before the fix.
  assert.deepEqual(parseGameDate("May 10, 2018"), { year: 2018, month: 5 });
});

test("a game date overrides a label that disagrees with it", () => {
  // Summer 2018's first games are in MAY. This is the override existing at all.
  const r = resolveSession("2018 Spring/Summer", "May 10, 2018");
  assert.ok(r);
  assert.equal(r!.half, "fall-winter", "May is not summer by the June-August rule");
});

test("garbage is still null, not a guess", () => {
  assert.equal(parseGameDate("Smarch 4, 2019"), null);
  assert.equal(parseGameDate("2016-09-19"), null);
  assert.equal(parseGameDate(""), null);
});

/* ---- tournaments as sessions -------------------------------------------
   The captain's ruling: "Tournaments can be their own little mini-seasons.
   We can capture this data & it just fits in chronologically whenever the
   tournament took place."

   The Greater Buffalo Invitational is played late April — a fact off
   Performax's own page, captured 20160423012111: "the 32nd Annual Greater
   Buffalo Senior Hockey Invitational, April 27th - May 1st". That is a SPRING
   event, so it belongs to the fall/winter half that started the previous
   September, and it sorts a quarter-step after that half's league season.  */

test("a tournament sorts between the season it capped and the next summer", () => {
  const t = parseSessionLabel("2015 Greater Buffalo Invitational");
  assert.ok(t);
  assert.equal(t!.tournament, "Greater Buffalo Invitational");
  assert.equal(t!.year, 2015, "the year it was PLAYED, not the half it sits in");
  assert.equal(t!.half, "fall-winter", "late April is not summer by the June-August rule");

  const prev = parseSessionLabel("2014-15");   // the season it capped
  const next = parseSessionLabel("Summer 2015");
  assert.ok(prev && next);
  assert.equal(prev!.sort, 2014.5);
  assert.equal(t!.sort, 2014.75);
  assert.equal(next!.sort, 2015);
  assert.ok(prev!.sort < t!.sort && t!.sort < next!.sort);
});

test("the sources shout the tournament's name three different ways", () => {
  // The team's own home page, its trophy case, and Performax. One event.
  for (const label of [
    "2015 gREATER bUFFALO iNVITATIONAL",
    "2015 Greater Buffalo Senior Hockey Invitational",
    "2015 GB Tournament",
    "2015 GBHI",
  ]) {
    const p = parseSessionLabel(label);
    assert.ok(p, `${label} did not parse`);
    assert.equal(p!.tournament, "Greater Buffalo Invitational");
    assert.equal(p!.sort, 2014.75, `${label} placed wrong`);
  }
});

test("a tournament label round-trips — it is re-parsed downstream", () => {
  // sessionLabel's output is fed back through parseSessionLabel when player
  // seasons are sorted. If it did not round-trip, every tournament season
  // would sort at 0 and land in front of 1993.
  const once = parseSessionLabel("2015 Greater Buffalo Invitational");
  const label = sessionLabel(once!);
  assert.equal(label, "2015 - Greater Buffalo Invitational");
  const twice = parseSessionLabel(label);
  assert.ok(twice);
  assert.equal(twice!.sort, once!.sort);
  assert.equal(sessionLabel(twice!), label);
});

test("a league half is never read as a tournament", () => {
  for (const label of ["2014-15", "Summer 2015", "2015 Summer", "Fall/Winter 2021-22", "2026 - Summer"]) {
    assert.equal(parseSessionLabel(label)?.tournament, undefined, label);
  }
});
