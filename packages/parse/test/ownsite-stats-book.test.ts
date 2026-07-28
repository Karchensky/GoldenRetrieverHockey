import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseStatsBook, STATS_BOOK_NAMES, type BookStatLine } from "../src/ownsite/stats-book.ts";

/**
 * THE REAL WORKBOOK, NEVER A FIXTURE.
 *
 * A parser in this repo once passed 13 of 13 against a hand-written fixture and
 * produced 1,064 phantom goals against the bytes it was written for. There is
 * no fixture here and there will not be one: every assertion below is read out
 * of `Golden Retriever Hockey (1).xlsx` as the captain sent it, and the figures
 * are ones a human can check against the sheet in Excel.
 *
 * SO THEY SKIP WHERE THE WORKBOOK IS NOT, which is every machine but one — the
 * same shape `ownsite-roster-email.test.ts` already has. The alternative is a
 * suite that cannot pass on a build server, and this file would rather be
 * honestly absent than quietly satisfied by something that is not the document.
 *
 * NOTHING IS LOST ON THOSE MACHINES. What the site is actually built from is
 * `data/derived/statistics-workbook.json`, the record these 283 lines were
 * stored as, and `packages/build/test/derived-records.test.ts` asserts the
 * load-bearing figures against THAT — everywhere, including here, where the
 * build additionally checks the record against the workbook before it runs.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const BOOK = STATS_BOOK_NAMES.map((n) => join(ROOT, n)).find(existsSync);
const noBook = BOOK === undefined && "the statistics workbook is not on this machine";

const rows: BookStatLine[] = BOOK ? parseStatsBook(BOOK) : [];

const one = (season: string, phase: string, name: string): BookStatLine => {
  const hits = rows.filter((r) => r.season === season && r.phase === phase && r.name === name);
  assert.equal(hits.length, 1, `${hits.length} rows for ${name} in ${season} ${phase}`);
  return hits[0]!;
};

test("the workbook parses", { skip: noBook }, () => {
  assert.ok(BOOK, `no statistics workbook at ${STATS_BOOK_NAMES.join(" or ")}`);
  assert.equal(rows.length, 283);
});

test("thirteen sessions, nineteen phases, and the phases are named", { skip: noBook }, () => {
  const phases = new Set(rows.map((r) => `${r.season}|${r.phase}`));
  assert.equal(phases.size, 19);
  assert.equal(new Set(rows.map((r) => r.season)).size, 13);
  assert.deepEqual(
    [...new Set(rows.map((r) => r.phase))].sort(),
    ["Playoffs", "Regular Season", "Tournament"],
  );
});

test("Winter 2011-12 is a real season, not an empty tab", { skip: noBook }, () => {
  // The club's first, and earlier than anything else in the archive. Fifteen
  // skaters and a goaltender, all with games played.
  const w11 = rows.filter((r) => r.season === "Winter 2011 / 12");
  assert.equal(w11.length, 16);
  assert.equal(w11.filter((r) => r.kind === "skater").length, 15);
  assert.equal(w11.every((r) => Number(r.stats.GP) > 0), true);
  assert.equal(w11.every((r) => r.league === "EMHL"), true);
  assert.equal(w11.every((r) => r.phase === "Regular Season"), true);

  const bk = one("Winter 2011 / 12", "Regular Season", "Bryan Karchensky");
  assert.equal(bk.jersey, "21");
  assert.equal(bk.position, "F");
  assert.deepEqual(
    { GP: bk.stats.GP, G: bk.stats.G, A: bk.stats.A, PTS: bk.stats.PTS, PIM: bk.stats.PIM },
    { GP: "25", G: "44", A: "26", PTS: "70", PIM: "10" },
  );

  const seymour = one("Winter 2011 / 12", "Regular Season", "Brent Seymour");
  assert.equal(seymour.kind, "goalie");
  assert.deepEqual(
    { GP: seymour.stats.GP, W: seymour.stats.W, L: seymour.stats.L, T: seymour.stats.T, GA: seymour.stats.GA, SV: seymour.stats.SV },
    { GP: "21", W: "8", L: "12", T: "1", GA: "148", SV: "976" },
  );
  // A goaltender's row never carries a skater's vocabulary. Reading `GA` as `G`
  // is how a shut-out season becomes a scoring title.
  assert.equal(seymour.stats.G, undefined);
  assert.equal(seymour.stats.PTS, undefined);
});

test("men who exist nowhere else in the archive are on the 2011-12 sheet", { skip: noBook }, () => {
  const names = new Set(rows.filter((r) => r.season === "Winter 2011 / 12").map((r) => r.name));
  for (const n of ["RJ Grampp", "Sam Bachman", "Alex Petrie", "Tim Hull", "Nick Robinson", "Garrett Chambers"]) {
    assert.ok(names.has(n), `${n} missing from Winter 2011 / 12`);
  }
  // Garrett Chambers is "x" in the finance tab's Number column and 11 here, so
  // the jersey-99 default must never be reached for him.
  assert.equal(one("Winter 2011 / 12", "Regular Season", "Garrett Chambers").jersey, "11");
});

test("every skater line's own arithmetic holds: G + A = PTS", { skip: noBook }, () => {
  const skaters = rows.filter((r) => r.kind === "skater");
  assert.equal(skaters.length, 261);
  for (const r of skaters) {
    assert.equal(
      Number(r.stats.G) + Number(r.stats.A),
      Number(r.stats.PTS),
      `${r.name} ${r.season} ${r.phase}: ${r.stats.G}+${r.stats.A} != ${r.stats.PTS}`,
    );
  }
});

test("the goalie block is never read as the skater block", { skip: noBook }, () => {
  // Both tables sit on the SAME ROWS of `Pivot Source`, skaters at column A and
  // goaltenders at column R. A reader that searches the header row rather than
  // walking one table's own run reads a goaltender's wins as a forward's games.
  const goalies = rows.filter((r) => r.kind === "goalie");
  assert.equal(goalies.length, 22);
  assert.equal(goalies.every((r) => r.position === "G"), true);
  assert.equal(goalies.every((r) => r.stats.PTS === undefined), true);
  assert.equal(rows.filter((r) => r.kind === "skater").every((r) => r.stats.GAA === undefined), true);
});

test("the tournaments are named as tournaments and carry four games", { skip: noBook }, () => {
  const t = rows.filter((r) => r.phase === "Tournament");
  assert.equal(new Set(t.map((r) => r.season)).size, 3);
  assert.equal(t.every((r) => r.league === "Performax"), true);
  assert.equal(t.length, 35);
  // Every man who dressed played all four but three: Vinny Terrana and Jim
  // Moore missed one of the 2016 games, and Pat Diebold played one.
  assert.equal(t.filter((r) => r.stats.GP === "4").length, 32);
  assert.deepEqual(
    t.filter((r) => r.stats.GP !== "4").map((r) => `${r.name} ${r.stats.GP}`).sort(),
    ["Jim Moore 3", "Pat Diebold 1", "Vinny Terrana 3"],
  );
});

test("the one row Pivot Source lost is recovered from Stats Archive", { skip: noBook }, () => {
  // The 2016 tournament's eleven skaters are in the pivot and its goaltender is
  // not — the pivot's range was never extended when the block was added.
  const extra = rows.filter((r) => r.sheet === "Stats Archive");
  assert.equal(extra.length, 1);
  const lloyd = extra[0]!;
  assert.equal(lloyd.name, "Corey Lloyd");
  assert.equal(lloyd.season, "GB Invitational 2016");
  assert.equal(lloyd.phase, "Tournament");
  assert.deepEqual(
    { GP: lloyd.stats.GP, W: lloyd.stats.W, L: lloyd.stats.L, SO: lloyd.stats.SO, GA: lloyd.stats.GA, SV: lloyd.stats.SV },
    { GP: "4", W: "3", L: "1", SO: "1", GA: "12", SV: "132" },
  );
});

test("the 45 all-zero playoff placeholders are refused", { skip: noBook }, () => {
  // `Stats Archive` carries a `Playoffs` table for Summer 2014, Winter 2015-16
  // and Summer 2016 in which every cell is nought. A 0 GP playoff line asserts
  // that a playoff was played; none of those three was ever recorded.
  for (const season of ["Summer 2014", "Winter 2015 / 16", "Summer 2016"]) {
    assert.equal(rows.filter((r) => r.season === season && r.phase === "Playoffs").length, 0, season);
  }
  // NOT a blanket ban on nought games played. Nine surviving lines record a man
  // who was on a playoff roster and did not dress — Vinny Caputi and Dan Potter
  // in Summer 2012, Craig Pope in the 2014-15 playoffs — and two of them are
  // already on this site off a captured page. That is a fact about a real
  // playoff; a table in which EVERY row is nought is a table nobody filled in.
  assert.equal(rows.filter((r) => r.stats.GP === "0").length, 9);
  for (const r of rows.filter((r) => r.stats.GP === "0")) {
    const phase = rows.filter((x) => x.season === r.season && x.phase === r.phase);
    assert.ok(phase.some((x) => Number(x.stats.GP) > 0), `${r.season} ${r.phase} is all nought`);
  }
  // And `#DIV/0!` is what a GAA formula prints over nought games. It is not a rate.
  assert.equal(rows.some((r) => Object.values(r.stats).some((v) => v.startsWith("#"))), false);
});

test("nothing in the team's books crosses the parse boundary", { skip: noBook }, () => {
  // Dues, referee fees, the beer blast and the USA Hockey registration numbers
  // live on eleven other sheets and are never read. The stat vocabulary is
  // closed: if a finance column ever leaked in, it would show up here.
  const keys = new Set(rows.flatMap((r) => Object.keys(r.stats)));
  assert.deepEqual(
    [...keys].sort(),
    ["A", "G", "GA", "GAA", "GP", "GWG", "L", "PIM", "PPG", "PPGA", "PTS", "SHG", "SO", "SV", "SV%", "T", "W"],
  );
  assert.equal(rows.every((r) => r.sheet === "Pivot Source" || r.sheet === "Stats Archive"), true);
  // No registration identifier ("111111111NAMEX") can appear in any field.
  assert.equal(rows.some((r) => /\d{6,}[A-Z]{4,}/.test(JSON.stringify(r))), false);
});

test("every line is placeable in time and states its own league", { skip: noBook }, () => {
  assert.equal(rows.every((r) => r.season.trim() !== ""), true);
  assert.deepEqual(
    [...new Set(rows.map((r) => r.league))].sort(),
    ["EMHL", "Harbor Center", "LSHL", "Performax"],
  );
  assert.equal(rows.every((r) => r.jersey !== "" && r.position !== ""), true);
});

test("a missing workbook is empty, not a crash", () => {
  assert.deepEqual(parseStatsBook(join(ROOT, "no-such-workbook.xlsx")), []);
});
