import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRosterEmail, parseRosterEmails } from "../src/ownsite/roster-email.ts";

/**
 * THE ROSTER EMAILS, AGAINST THE REAL STORED FILES.
 *
 * The repo's rule, paid for the hard way: an invented fixture once passed
 * thirteen of thirteen tests and produced 1,064 phantom goals. So the assertions
 * below run against `docs/research/captain-roster-emails/*.txt` — the bytes
 * actually supplied — and not against strings retyped into this file.
 *
 * FIVE EMAILS, FOUR COLUMN ORDERS, and each one is here because it breaks a
 * reader that assumes the previous one's shape:
 *
 *   2018-summer   name, number, position          — and the alignment collapses
 *   2018-winter   NUMBER FIRST, name in two cells — and six rows end in a USA
 *                                                   Hockey registration number
 *   2019-summer   name and number, NO position
 *   2019-winter   name, number, position
 *   2020-winter   name, number, ROSTER STATUS     — "Taxi Squad" is one cell
 *                                                   written as two words
 *
 * The only hand-written strings here are deliberately MALFORMED inputs, used to
 * prove the parser refuses them. That is the opposite failure mode and is safe.
 */

const DIR = join(process.cwd(), "docs", "research", "captain-roster-emails");
const read = (name: string) => {
  try {
    return readFileSync(join(DIR, name), "utf8");
  } catch {
    return null;
  }
};
const raw = read("2018-summer.txt");
const noFile = raw === null && "roster email file unavailable";

const w18 = read("2018-winter.txt");
const no18 = w18 === null && "2018-winter.txt unavailable";
const s19 = read("2019-summer.txt");
const noS19 = s19 === null && "2019-summer.txt unavailable";
const w19 = read("2019-winter.txt");
const noW19 = w19 === null && "2019-winter.txt unavailable";
const w20 = read("2020-winter.txt");
const noW20 = w20 === null && "2020-winter.txt unavailable";

test("the 2018 Spring/Summer email is on disk and parses", { skip: noFile }, () => {
  const r = parseRosterEmail(raw!);
  assert.equal(r.session, "2018 - Summer");
  assert.equal(r.team, "The Golden Retrievers");
  assert.equal(r.entries.length, 15, "fifteen men were named");
});

test("every row is read — nothing in the table is silently dropped", { skip: noFile }, () => {
  const r = parseRosterEmail(raw!);
  // The email's own prose and column header are the only unread lines, and
  // they are REPORTED rather than swallowed.
  assert.deepEqual(r.unread, [
    "Here's the roster for The Golden Retrievers:",
    "Player Name       Number   Position",
  ]);
});

test("the long name whose column alignment collapses is still read", { skip: noFile }, () => {
  // "Brendan Kaplewicz 9        D" has ONE space where every other row has
  // several. Splitting on runs of whitespace loses him; splitting from the
  // right does not. This is the row the parser exists to get right.
  const r = parseRosterEmail(raw!);
  const b = r.entries.find((e) => e.name === "Brendan Kaplewicz");
  assert.ok(b, "Brendan Kaplewicz is on the roster");
  assert.equal(b!.jersey, "9");
  assert.equal(b!.position, "D");
});

test("TBD is an UNKNOWN number, never a zero and never a guess", { skip: noFile }, () => {
  const r = parseRosterEmail(raw!);
  const tbd = r.entries.filter((e) => e.jersey === null).map((e) => e.name).sort();
  assert.deepEqual(tbd, ["Andy Murphy", "Justin Wheeler"]);
  // And nothing anywhere in this file turned into a 0.
  assert.ok(r.entries.every((e) => e.jersey !== "0"), "no zero jerseys invented");
});

test("names, numbers and positions are exactly what the email says", { skip: noFile }, () => {
  const r = parseRosterEmail(raw!);
  const got = r.entries.map((e) => `${e.name}|${e.jersey ?? "-"}|${e.position}`);
  assert.deepEqual(got, [
    "Corey Muff|1|G",
    "Adam Kaplewicz|96|F",
    "Anthony Christy|44|F",
    "Brent Boeing|80|F",
    "Bryan Karchensky|21|F",
    "Greg Suffoletto|28|F",
    "Jason Kaplewicz|47|F",
    "Justin Wheeler|-|F",
    "Vinny Terrana|89|F",
    "Andy Murphy|-|D",
    "Anthony Gugino|2|D",
    "Brendan Kaplewicz|9|D",
    "Brett Koeppel|18|D",
    "Dan Schmitt|3|D",
    "Rich Fedele|16|D",
  ]);
});

test("one goaltender, named as such by the email itself", { skip: noFile }, () => {
  const r = parseRosterEmail(raw!);
  const g = r.entries.filter((e) => e.position === "G");
  assert.equal(g.length, 1);
  assert.equal(g[0]!.name, "Corey Muff");
});

test("the directory reader finds the file and reports its name", { skip: noFile }, () => {
  const all = parseRosterEmails(DIR);
  assert.ok(all.length >= 1);
  const one = all.find((f) => f.file === "2018-summer.txt");
  assert.ok(one, "2018-summer.txt is read");
  assert.equal(one!.entries.length, 15);
});

test("a missing directory is [] — never a throw, never a silent success", () => {
  assert.deepEqual(parseRosterEmails(join(DIR, "no-such-directory")), []);
});

test("a file without the verbatim marker is REFUSED", () => {
  assert.throws(
    () => parseRosterEmail("session: 2018 - Summer\nteam: X\nCorey Muff 1 G\n"),
    /verbatim marker/,
  );
});

test("a file without a session or team header is REFUSED", () => {
  assert.throws(
    () => parseRosterEmail(`team: X\n--- the email, verbatim below this line ---\nA B 1 G\n`),
    /session/,
  );
});

// ---------------------------------------------------------------------------
// 2018-19 — the number comes FIRST, and six rows carry a registration number
// ---------------------------------------------------------------------------

test("the 2018-19 email parses despite putting the number first", { skip: no18 }, () => {
  const r = parseRosterEmail(w18!);
  assert.equal(r.session, "2018 - Winter");
  const got = r.entries.map((e) => `${e.name}|${e.jersey ?? "-"}|${e.position}`);
  assert.deepEqual(got, [
    "Corey Muff|1|G",
    "Adam Kaplewicz|96|F",
    "Anthony Christy|44|F",
    "Brent Boeing|80|F",
    "Bryan Karchensky|21|F",
    "Greg Suffoletto|28|F",
    "Jason Kaplewicz|47|F",
    "Vinny Terrana|89|F",
    "Andy Murphy|-|D",
    "Anthony Gugino|2|D",
    "Brendan Kaplewicz|9|D",
    "Brett Koeppel|18|D",
    "Dan Schmitt|3|D",
    "Rich Fedele|16|D",
  ]);
  // The column heading is the only line not read, and it is REPORTED.
  assert.deepEqual(r.unread, ["Number        Player Name    Position"]);
});

test("NO USA HOCKEY REGISTRATION NUMBER REACHES ANYTHING", { skip: no18 }, () => {
  // The same class the statistics workbook refuses at its own parse boundary,
  // and asserted with the same pattern: a long run of digits with the head of a
  // surname on the end may not appear in any field. Checked over the WHOLE
  // result — entries, names AND `unread`, which is printed to the build log —
  // for every stored email, so a future one cannot slip a new identifier
  // through a path this test does not walk.
  for (const f of parseRosterEmails(DIR)) {
    assert.equal(
      /\d{6,}[A-Za-z]{4,}/.test(JSON.stringify(f)),
      false,
      `${f.file} leaked a registration identifier`,
    );
  }
  // And it is a REFUSAL, not an absence: this email carries six of them.
  const r = parseRosterEmail(w18!);
  assert.equal(r.refused, 6);
  // The refusal did not eat the row it was attached to. Six men keep their
  // names, their numbers and their positions.
  assert.equal(r.entries.length, 14);
  assert.equal(r.entries.find((e) => e.name === "Corey Muff")!.jersey, "1");
});

// ---------------------------------------------------------------------------
// Summer 2019 — the session that held nobody. No position column at all.
// ---------------------------------------------------------------------------

test("the Summer 2019 email parses with no position column", { skip: noS19 }, () => {
  const r = parseRosterEmail(s19!);
  assert.equal(r.session, "2019 - Summer");
  assert.equal(r.entries.length, 17, "seventeen men were named");
  assert.deepEqual(r.unread, [], "the email is nothing but its table");
  // A missing column is NULL, not a guess and not an empty string.
  assert.equal(r.entries.every((e) => e.position === null), true);
  assert.equal(r.entries.every((e) => e.jersey !== null), true);
  const first = r.entries[0]!;
  assert.equal(first.name, "Andy Murphy");
  assert.equal(first.jersey, "12");
});

test("a number is never inherited from a neighbouring season", { skip: noS19 || noW19 }, () => {
  // The proof, inside the supplied files themselves: Greg Suffoletto wears 28
  // in 2018-19 and 26 the following summer, and Mark Lucatra wears that 26 the
  // winter after. Anything filling a TBD from a neighbour would put two men in
  // one number.
  const greg19 = parseRosterEmail(s19!).entries.find((e) => e.name === "Greg Suffoletto");
  const mark = parseRosterEmail(w19!).entries.find((e) => e.name === "Mark Lucatra");
  assert.equal(greg19!.jersey, "26");
  assert.equal(mark!.jersey, "26");
  if (!no18) {
    const greg18 = parseRosterEmail(w18!).entries.find((e) => e.name === "Greg Suffoletto");
    assert.equal(greg18!.jersey, "28");
  }
});

// ---------------------------------------------------------------------------
// 2019-20 — fifteen names, and the archive already holds sixteen
// ---------------------------------------------------------------------------

test("the 2019-20 email parses, and is SMALLER than the roster on file", { skip: noW19 }, () => {
  const r = parseRosterEmail(w19!);
  assert.equal(r.session, "2019 - Winter");
  assert.equal(r.entries.length, 15);
  assert.deepEqual(r.unread, ["Player Name    Number    Position"]);
  // Alex Wapinewski is on the league's own roster for this session and is NOT
  // in the email. An email is a roster as it stood the day it was sent; a
  // season can add a man after it. Nothing here may be read as him not playing.
  assert.equal(r.entries.some((e) => /wapinewski/i.test(e.name)), false);
});

// ---------------------------------------------------------------------------
// 2020-21 — the COVID season, and the one roster with a status column
// ---------------------------------------------------------------------------

test("the COVID roster separates rostered, taxi squad and injured", { skip: noW20 }, () => {
  const r = parseRosterEmail(w20!);
  assert.equal(r.session, "2020 - Winter");
  assert.equal(r.entries.length, 19, "nineteen names were attached to this team");
  const by = (s: string) => r.entries.filter((e) => e.status === s).map((e) => e.name);
  assert.equal(by("Rostered").length, 15);
  assert.deepEqual(by("Taxi Squad"), ["Seth Hamilton", "Brent Boeing", "Ryan Neidrauer"]);
  assert.deepEqual(by("IR"), ["Vinny Terrana"]);
  // "Taxi Squad" is ONE cell written as two words. Taking the last token alone
  // leaves "Taxi" behind and reads it as part of a surname.
  assert.equal(r.entries.find((e) => e.name === "Seth Hamilton")!.jersey, "19");
  // The column heading is not a player. "Rostered" is the heading, never a value.
  assert.deepEqual(r.unread, ["Player Name         Number   Rostered"]);
  assert.equal(r.entries.some((e) => e.name === "Player Name"), false);
});

test("four TBD numbers stay unknown in the COVID roster", { skip: noW20 }, () => {
  const r = parseRosterEmail(w20!);
  const tbd = r.entries.filter((e) => e.jersey === null).map((e) => e.name);
  assert.deepEqual(tbd, ["John Rein", "Dave Tornabene", "Darryl McLaughlin", "Ryan Neidrauer"]);
  assert.equal(r.entries.some((e) => e.jersey === "0"), false, "no zero jerseys invented");
});

// ---------------------------------------------------------------------------
// Across every stored email
// ---------------------------------------------------------------------------

// The one test in this file that reads the DIRECTORY rather than a named file,
// and it needs the same guard as the rest: the emails are unpublished, so on a
// build server this directory does not exist and `parseRosterEmails` correctly
// returns []. What the site is actually built from is the record those five
// files were parsed into — `data/derived/roster-emails.json` — and
// `packages/build/test/derived-records.test.ts` asserts all of this against
// that, everywhere, including the assertion below that no entry has grown a
// field that could hold a statistic.
test("every stored email is read, and none of them is a statistic", { skip: noFile }, () => {
  const all = parseRosterEmails(DIR);
  assert.equal(all.length, 5, "five emails are on file");
  // NOT ONE FIGURE. The type has no field for a statistic and this is the check
  // that nothing has quietly grown one: name, number, position, status, and the
  // two header fields, and nothing else.
  for (const f of all) {
    for (const e of f.entries) {
      assert.deepEqual(
        Object.keys(e).sort(),
        ["jersey", "name", "position", "session", "status", "team"],
      );
    }
  }
  assert.deepEqual(
    all.map((f) => `${f.file}=${f.entries.length}`),
    [
      "2018-summer.txt=15",
      "2018-winter.txt=14",
      "2019-summer.txt=17",
      "2019-winter.txt=15",
      "2020-winter.txt=19",
    ],
  );
  // A status is stated by ONE email and is null on every line of the others.
  for (const f of all) {
    if (f.file === "2020-winter.txt") continue;
    assert.equal(f.entries.every((e) => e.status === null), true, f.file);
  }
});

test("a line of prose that ends in a number is NOT a player", () => {
  // The guard behind "the name is two or more name-shaped words". Anything
  // refused lands in `unread` and is printed by the build — loud, never silent.
  const r = parseRosterEmail(
    "session: 2018 - Summer\nteam: X\n--- the email, verbatim below this line ---\n"
    + "we finished the year 15\nThanks, 21\nCorey Muff 1 G\n",
  );
  assert.deepEqual(r.entries.map((e) => e.name), ["Corey Muff"]);
  assert.deepEqual(r.unread, ["we finished the year 15", "Thanks, 21"]);
});
