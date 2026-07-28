import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DERIVED, DERIVED_FILES } from "../src/derived.ts";
import type { RosterEmailsRecord, RosterBookRecord, StatsBookRecord } from "../src/derived.ts";

/**
 * THE STORED RECORDS THEMSELVES — not the parsers that wrote them.
 *
 * `ownsite-stats-book.test.ts` and `ownsite-roster-email.test.ts` prove the
 * PARSE BOUNDARY refuses the club's finances, its members' dues and their USA
 * Hockey registration numbers. Those tests skip on a machine without the
 * private documents, which is every machine but one — and they test a function,
 * not a file.
 *
 * What gets published is the FILE. `data/derived/*.json` is tracked, so it goes
 * to GitHub, and a parser that was right on the day it ran is not evidence
 * about the bytes sitting in the repository today. Everything below reads those
 * bytes and nothing else, so it runs everywhere, including on a runner that has
 * never seen a workbook.
 *
 * THE STAT COLUMNS AND THE RECORD FIELDS ARE CLOSED SETS, deliberately. A
 * blocklist of things that must not appear can only refuse what somebody
 * thought of; an allowlist refuses everything nobody thought of. The workbook
 * has seventeen sheets and eleven of them are the team's books — the day a
 * column called `USA Ins.` or `Owed` reaches this file, this fails by name.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const dir = join(ROOT, "data", DERIVED);
const raw = (f: string) => readFileSync(join(dir, f), "utf8");
const load = <T,>(f: string): T => JSON.parse(raw(f)) as T;

const statsBook = load<StatsBookRecord>(DERIVED_FILES.statsBook);
const emails = load<RosterEmailsRecord>(DERIVED_FILES.rosterEmails);
const rosterBook = load<RosterBookRecord>(DERIVED_FILES.rosterBook);

/**
 * Every stored record, as the text that would be published, with the SHA-256
 * provenance hashes masked out.
 *
 * They are masked because a hash is 64 hex characters and hex is digits and
 * letters, which is exactly the shape the scans below hunt for — the first run
 * of this test failed on a run of digits and letters sitting inside a SHA-256.
 * The hashes are not exempted from scrutiny: every one is asserted to be
 * exactly `^[0-9a-f]{64}$` below, a closed shape that cannot hide anything.
 */
const HASH = /"sha256": "[0-9a-f]{64}"/g;
const ALL_TEXT = [DERIVED_FILES.statsBook, DERIVED_FILES.rosterEmails, DERIVED_FILES.rosterBook]
  .map((f) => ({ file: f, text: raw(f).replace(HASH, '"sha256": "<64 hex>"') }));

/**
 * A USA Hockey registration identifier: a long run of digits with the head of a
 * surname stuck on the end, e.g. `111111111NAMEX`. The same shape both parse
 * boundaries refuse, asserted here against the artefact they produced. The
 * example is invented — a real one written into a test file has escaped just as
 * surely as one written into the data.
 */
const REGISTRATION = /\d{6,}[A-Za-z]{3,}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** A digit run long enough to be an identifier rather than a hockey figure.
 *  Floats are excluded because the workbook's GAA and SV% cells are live
 *  formulas and arrive at full precision ("7.0476190476190474"). */
const LONG_DIGITS = /(?<![\d.])\d{6,}(?![\d.])/;

test("the records are on disk, and they are the ones the build counts on", () => {
  assert.equal(statsBook.count, 283);
  assert.equal(statsBook.lines.length, 283);
  assert.equal(emails.count, 5);
  assert.equal(emails.files.length, 5);
  // TGR.xlsx is gone. The empty array is a FINDING, stored as one, and it is
  // what keeps the build from ever reaching for an empty array of its own.
  assert.equal(rosterBook.count, 0);
  assert.equal(rosterBook.sha256, null);
});

test("NO REGISTRATION IDENTIFIER IS IN ANY STORED RECORD", () => {
  for (const { file, text } of ALL_TEXT) {
    const hit = REGISTRATION.exec(text);
    // The MATCH is never printed. Reporting a personal identifier to prove it
    // leaked would be the leak. The offset is enough to find it.
    assert.equal(hit, null, `${file}: registration-shaped token at offset ${hit?.index}`);
  }
});

test("NO BARE IDENTIFIER-LENGTH NUMBER IS IN ANY STORED RECORD", () => {
  // A registration number with its surname suffix stripped is still a
  // registration number. Nothing this archive publishes is a six-digit whole
  // number: the largest figure in it is Brent Seymour's 976 saves.
  for (const { file, text } of ALL_TEXT) {
    const hit = LONG_DIGITS.exec(text);
    assert.equal(hit, null, `${file}: ${hit?.[0].length}-digit run at offset ${hit?.index}`);
  }
});

test("NO EMAIL ADDRESS IS IN ANY STORED RECORD", () => {
  for (const { file, text } of ALL_TEXT) {
    const hit = EMAIL.exec(text);
    assert.equal(hit, null, `${file}: email-shaped token at offset ${hit?.index}`);
  }
});

test("NO FINANCE VOCABULARY IS IN ANY STORED RECORD", () => {
  // The workbook's own words for the eleven sheets that are the team's books.
  // Word-bounded, because "Cost" must not be found inside a surname and "SO" is
  // a goaltender's shutouts.
  const FINANCE = [
    "USA Ins", "USA Hockey #", "Dues", "Cost", "Collected", "Owed", "Balance",
    "Paid", "Venmo", "Beer", "Franchise", "Referee", "Invoice", "Deposit",
  ];
  for (const { file, text } of ALL_TEXT) {
    for (const word of FINANCE) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      assert.equal(re.test(text), false, `${file}: contains ${JSON.stringify(word)}`);
    }
  }
  // And no currency, in either notation the sheets use.
  for (const { file, text } of ALL_TEXT) {
    assert.equal(/[$£€]/.test(text), false, `${file}: contains a currency symbol`);
  }
});

test("the workbook record's STAT COLUMNS are a closed set", () => {
  // Skater: GP G A PTS PIM PPG SHG GWG PPGA. Goaltender: GP W L T SO GA GAA SV
  // SV%. Nothing else is a hockey figure and nothing else may be stored.
  //
  // `SV%` IS CARRIED AND NEVER PUBLISHED. The workbook's formula divides by a
  // hundred too many, so the cell is wrong by two orders of magnitude; the
  // build drops it (see bookGoalie in generate.ts). It stays in the record
  // because the record is what the parser read, verbatim — the place to decide
  // what a cell means is the build, and that decision cannot be made at all if
  // the cell was thrown away here.
  const allowed = new Set([
    "GP", "G", "A", "PTS", "PIM", "PPG", "SHG", "GWG", "PPGA",
    "W", "L", "T", "SO", "GA", "GAA", "SV", "SV%",
  ]);
  const seen = new Set(statsBook.lines.flatMap((l) => Object.keys(l.stats)));
  for (const key of seen) assert.ok(allowed.has(key), `unexpected stat column ${JSON.stringify(key)}`);
  // And the whole set is accounted for — a column that quietly stopped being
  // read is a regression too.
  assert.deepEqual([...seen].sort(), [...allowed].sort());
});

test("the workbook record's FIELDS are a closed set", () => {
  assert.deepEqual(
    Object.keys(statsBook).sort(),
    ["count", "derivedBy", "derivedFrom", "sha256", "lines"].sort(),
  );
  for (const l of statsBook.lines) {
    assert.deepEqual(
      Object.keys(l).sort(),
      ["jersey", "kind", "league", "name", "phase", "position", "season", "sheet", "stats"].sort(),
    );
  }
  // Two sheets, and only two. Nine of the workbook's seventeen tabs are the
  // books; `Player Stats` and `Goalie Stats` are pivots OF `Pivot Source`, so
  // reading them would double what is already here.
  assert.deepEqual([...new Set(statsBook.lines.map((l) => l.sheet))].sort(), ["Pivot Source", "Stats Archive"]);
});

test("the email record's FIELDS are a closed set — a name, a number, a position, a standing", () => {
  assert.deepEqual(Object.keys(emails).sort(), ["count", "derivedBy", "derivedFrom", "files"].sort());
  for (const f of emails.files) {
    assert.deepEqual(
      Object.keys(f).sort(),
      ["entries", "file", "refused", "session", "sha256", "team", "unread"].sort(),
    );
    for (const e of f.entries) {
      assert.deepEqual(
        Object.keys(e).sort(),
        ["jersey", "name", "position", "session", "status", "team"].sort(),
      );
    }
  }
});

test("NOT ONE FIGURE comes off a roster email", () => {
  // The emails state who was on the team. They state no statistic whatever, and
  // none may be invented from them — the archive's standing rule that absence is
  // not nought. There is no field here that could hold one, and this asserts the
  // stronger thing: the closed set above has no stat key in it at all.
  const fields = new Set(emails.files.flatMap((f) => f.entries.flatMap((e) => Object.keys(e))));
  for (const stat of ["gp", "g", "a", "pts", "pim", "GP", "G", "A", "PTS", "PIM"]) {
    assert.equal(fields.has(stat), false, `roster email entries carry ${stat}`);
  }
});

test("the six refused registration identifiers are counted, and only counted", () => {
  const byFile = Object.fromEntries(emails.files.map((f) => [f.file, f.refused]));
  // The 2018-19 email is the one whose rows end in a registration number.
  assert.equal(byFile["2018-winter.txt"], 6);
  assert.equal(emails.files.reduce((n, f) => n + f.refused, 0), 6);
  // The refusal is provable from a count. The values are nowhere — asserted
  // over the whole file by the registration test above.
});

test("every unread line is a column heading or the email's own prose", () => {
  // `unread` is the parser refusing to pretend it read something, and it is
  // printed by the build. It carries lines OUT OF A PRIVATE EMAIL, so what is
  // in it matters: a line naming a man's number is fine, a line naming his
  // registration is not. Registration identifiers are stripped from these
  // before they are recorded; this asserts what actually survived.
  const unread = emails.files.flatMap((f) => f.unread);
  assert.deepEqual(unread.sort(), [
    "Here's the roster for The Golden Retrievers:",
    "Number        Player Name    Position",
    "Player Name    Number    Position",
    "Player Name       Number   Position",
    "Player Name         Number   Rostered",
  ].sort());
});

test("the five emails hold the squads nothing else in the archive names", () => {
  // The counts the build depends on, off the artefact. Empty these and
  // 2019 - Summer falls from 17 players to none and 2020 - Winter from 19 to
  // one — measured, not assumed.
  assert.deepEqual(
    emails.files.map((f) => [f.file, f.session, f.entries.length]),
    [
      ["2018-summer.txt", "2018 - Summer", 15],
      ["2018-winter.txt", "2018 - Winter", 14],
      ["2019-summer.txt", "2019 - Summer", 17],
      ["2019-winter.txt", "2019 - Winter", 15],
      ["2020-winter.txt", "2020 - Winter", 19],
    ],
  );
});

/* ---- the figures themselves, on every machine ---------------------------
 *
 * `ownsite-stats-book.test.ts` checks these against the workbook and skips
 * where the workbook is not, which is every machine but the captain's. These
 * are the same facts checked against the RECORD the site is built from, and
 * they run everywhere — a build server included. Each is one a human can look
 * up in the sheet.
 */

const line = (season: string, phase: string, name: string) => {
  const hits = statsBook.lines.filter(
    (l) => l.season === season && l.phase === phase && l.name === name,
  );
  assert.equal(hits.length, 1, `${hits.length} lines for ${name} in ${season} ${phase}`);
  return hits[0]!;
};

test("thirteen sessions, nineteen phases, three phase names", () => {
  assert.equal(new Set(statsBook.lines.map((l) => `${l.season}|${l.phase}`)).size, 19);
  assert.equal(new Set(statsBook.lines.map((l) => l.season)).size, 13);
  assert.deepEqual(
    [...new Set(statsBook.lines.map((l) => l.phase))].sort(),
    ["Playoffs", "Regular Season", "Tournament"],
  );
  assert.deepEqual(
    [...new Set(statsBook.lines.map((l) => l.league))].sort(),
    ["EMHL", "Harbor Center", "LSHL", "Performax"],
  );
});

test("Winter 2011-12 — the club's first season, and the earliest thing in the archive", () => {
  const w11 = statsBook.lines.filter((l) => l.season === "Winter 2011 / 12");
  assert.equal(w11.length, 16);
  assert.equal(w11.filter((l) => l.kind === "skater").length, 15);
  const bk = line("Winter 2011 / 12", "Regular Season", "Bryan Karchensky");
  assert.deepEqual(
    { GP: bk.stats.GP, G: bk.stats.G, A: bk.stats.A, PTS: bk.stats.PTS, PIM: bk.stats.PIM },
    { GP: "25", G: "44", A: "26", PTS: "70", PIM: "10" },
  );
  // The franchise goaltender, and the one man who proves the site's best fact:
  // no league's own line ever recorded a save for anybody.
  const seymour = line("Winter 2011 / 12", "Regular Season", "Brent Seymour");
  assert.equal(seymour.kind, "goalie");
  assert.deepEqual(
    { GP: seymour.stats.GP, W: seymour.stats.W, L: seymour.stats.L, GA: seymour.stats.GA, SV: seymour.stats.SV },
    { GP: "21", W: "8", L: "12", GA: "148", SV: "976" },
  );
  // A goaltender's line never carries a skater's vocabulary. Reading `GA` as
  // `G` is how a shut-out season becomes a scoring title.
  assert.equal(seymour.stats.G, undefined);
  assert.equal(seymour.stats.PTS, undefined);
});

test("261 skaters, 22 goaltenders, and every skater line's own arithmetic holds", () => {
  const skaters = statsBook.lines.filter((l) => l.kind === "skater");
  const goalies = statsBook.lines.filter((l) => l.kind === "goalie");
  assert.equal(skaters.length, 261);
  assert.equal(goalies.length, 22);
  for (const l of skaters) {
    assert.equal(
      Number(l.stats.G) + Number(l.stats.A), Number(l.stats.PTS),
      `${l.name} ${l.season} ${l.phase}: ${l.stats.G}+${l.stats.A} != ${l.stats.PTS}`,
    );
  }
  assert.equal(goalies.every((l) => l.stats.PTS === undefined), true);
  assert.equal(skaters.every((l) => l.stats.GAA === undefined), true);
});

test("the one line Pivot Source lost is in the record, and it is the only one", () => {
  const extra = statsBook.lines.filter((l) => l.sheet === "Stats Archive");
  assert.equal(extra.length, 1);
  const lloyd = extra[0]!;
  assert.equal(lloyd.name, "Corey Lloyd");
  assert.equal(lloyd.season, "GB Invitational 2016");
  assert.deepEqual(
    { GP: lloyd.stats.GP, W: lloyd.stats.W, L: lloyd.stats.L, SO: lloyd.stats.SO, GA: lloyd.stats.GA, SV: lloyd.stats.SV },
    { GP: "4", W: "3", L: "1", SO: "1", GA: "12", SV: "132" },
  );
});

test("no all-nought phase, and no spreadsheet error, survived into the record", () => {
  // A 0 GP playoff line asserts a playoff was played. Three of them never were.
  for (const season of ["Summer 2014", "Winter 2015 / 16", "Summer 2016"]) {
    assert.equal(
      statsBook.lines.filter((l) => l.season === season && l.phase === "Playoffs").length, 0, season,
    );
  }
  // NOT a ban on nought games played: nine lines record a man who was on a
  // playoff roster and did not dress, and each sits in a phase somebody played.
  const noughts = statsBook.lines.filter((l) => l.stats.GP === "0");
  assert.equal(noughts.length, 9);
  for (const l of noughts) {
    const phase = statsBook.lines.filter((x) => x.season === l.season && x.phase === l.phase);
    assert.ok(phase.some((x) => Number(x.stats.GP) > 0), `${l.season} ${l.phase} is all nought`);
  }
  // `#DIV/0!` is what a GAA formula prints over nought games. It is not a rate.
  assert.equal(
    statsBook.lines.some((l) => Object.values(l.stats).some((v) => v.startsWith("#"))), false,
  );
});

test("the records name what they were derived from, and how to do it again", () => {
  assert.equal(statsBook.derivedFrom, "Golden Retriever Hockey (1).xlsx");
  assert.equal(emails.derivedFrom, "docs/research/captain-roster-emails/*.txt");
  assert.equal(rosterBook.derivedFrom, "TGR.xlsx");
  for (const r of [statsBook, emails, rosterBook]) {
    assert.equal(r.derivedBy, "npm run derive:private");
  }
  // A hash identifies the input without repeating a byte of it, so a record and
  // the document it claims to come from can be told apart by a build that has
  // both — see assertNoDrift.
  assert.match(statsBook.sha256 ?? "", /^[0-9a-f]{64}$/);
  for (const f of emails.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
});
