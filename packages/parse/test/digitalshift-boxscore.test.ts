import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBoxscore, parseScorerCell, parseStrength } from "../src/digitalshift/boxscore.ts";
import { corpusHtml } from "./helpers/corpus.ts";

/**
 * REAL CAPTURED BYTES ONLY — no hand-written page fixtures.
 *
 * This rule is not stylistic. A parser in this repo once passed 13/13 against
 * an authored fixture and produced 1,064 phantom goals against the real thing,
 * green throughout. Every assertion below runs against bytes DigitalShift
 * actually served, and the helpers fail loudly when the corpus is missing
 * rather than passing vacuously.
 *
 * The reconciliation test at the bottom is the one that matters: it re-derives
 * every game's final score from the goals this parser found and checks it
 * against the score the source itself printed. It is not a unit test of a
 * regex; it is the archive checking our arithmetic against its own.
 */

/** One captured boxscore body, unwrapped from its JSON envelope. */
function box(gameId: number): string {
  // No trailing %: the id ends the URL, so this cannot match a longer id.
  const raws = corpusHtml(`%game/boxscore?game_id=${gameId}`);
  assert.equal(
    raws.length,
    1,
    `expected exactly 1 captured boxscore for game ${gameId}, got ${raws.length} — ` +
      `these tests are worthless without the corpus`,
  );
  return (JSON.parse(raws[0]!) as { content: string }).content;
}

/** Every captured boxscore. */
function allBoxes(): { raw: string; content: string }[] {
  const raws = corpusHtml("%game/boxscore?game_id=%");
  assert.ok(
    raws.length >= 180,
    `corpus has only ${raws.length} boxscores — expected ~189; the archive is missing`,
  );
  return raws.map((r) => ({ raw: r, content: (JSON.parse(r) as { content: string }).content }));
}

/** The captain's own example game: Tall Boys Love Em 4 at Retrievers 4, OT. */
const CAPTAIN = 1288561;
/** Al Ross Kings 4 at Golden Retrievers 3 — decided by a shootout. */
const SHOOTOUT = 465055;
/** A real game with a real score and no goal-by-goal record at all. */
const NO_DETAIL = 668589;

test("parses the scoring summary of a real game, assists in source order", () => {
  const g = parseBoxscore(box(CAPTAIN));
  assert.equal(g.hasScoringDetail, true);
  assert.equal(g.goals.length, 8);

  const first = g.goals[0]!;
  assert.equal(first.period, "1st");
  assert.equal(first.time, "08:43");
  assert.equal(first.team, "Tall Boys Love Em");
  assert.equal(first.scorer.name, "Anthony Venditti");
  assert.equal(first.scorer.jersey, "72");
  assert.equal(first.scorer.playerId, 905719);
  // ORDER IS MEANING: primary then secondary, never sorted.
  assert.deepEqual(
    first.assists.map((a) => a.name),
    ["Caidon Evancho", "Brady Eich"],
  );
  assert.deepEqual(
    first.assists.map((a) => a.jersey),
    ["13", "9"],
  );

  // An unassisted goal has no assists — not an empty-string assist.
  const unassisted = g.goals.find((x) => x.scorer.name === "Adam Kaplewicz")!;
  assert.deepEqual(unassisted.assists, []);
  assert.equal(unassisted.team, "The Golden Retrievers");
});

test("the team on a goal comes from that row's own cell, never the page", () => {
  // Every goal in this game belongs to one of the two teams that played it.
  // A page-level test would match any team merely NAMED on the page.
  const g = parseBoxscore(box(CAPTAIN));
  const teams = new Set(g.goals.map((x) => x.team));
  assert.deepEqual([...teams].sort(), ["Tall Boys Love Em", "The Golden Retrievers"]);
  // The row's own team id is carried too — a stronger key than a spelling.
  for (const x of g.goals) assert.ok(x.teamId === 681627 || x.teamId === 681628);
});

test("the responsive clone table is not read twice", () => {
  // The SPA renders each scrollable table twice: the real one, then a
  // `table-fixed aria-hidden="true"` clone with identical rows. Reading both
  // would double every goal — and so every assist edge on the site.
  const content = box(CAPTAIN);
  const sections = content.split(/<h3[^>]*>/).slice(1);
  const scoring = sections.find((s) => s.slice(0, s.indexOf("</h3>")).includes("Scoring Summary"))!;
  const tables = scoring.match(/<table[\s\S]*?<\/table>/g) ?? [];
  assert.equal(tables.length, 2, "the clone should still be present in the captured bytes");
  assert.match(scoring, /aria-hidden="true"/);
  // Eight goals on the page; eight parsed, not sixteen.
  assert.equal(parseBoxscore(content).goals.length, 8);
});

test("strength states are real, and expanded from the source's own tooltip", () => {
  assert.equal(parseStrength('<span tooltip="Power Play"> PP </span>'), "Power Play");
  // No tooltip: fall back to the abbreviation rather than inventing one.
  assert.equal(parseStrength("<td> Ev </td>"), "Ev");
  assert.equal(parseStrength("<td></td>"), null);

  const g = parseBoxscore(box(CAPTAIN));
  for (const x of g.goals) assert.equal(x.strength, "Even Strength");
});

test("a game with a score and no goal-by-goal record is an absence, not a failure", () => {
  const g = parseBoxscore(box(NO_DETAIL));
  assert.equal(g.hasScoringDetail, false);
  assert.deepEqual(g.goals, []);
  // The score survives even though the goals do not.
  assert.deepEqual(
    g.linescore.map((l) => `${l.team} ${l.final}`),
    ["Golden Retrievers 2", "Rec Room 5"],
  );
});

test("a no-detail game's period cells are an absence, not nought", () => {
  // The source prints "0" in every period of these games and a real number in
  // the total: 0-0-0 = 8, eight goals in no periods. Those cells are the
  // platform counting a scoring summary that does not exist. Passing them
  // through would put a fabricated linescore on the site — the same hole the
  // SportsEngine sheets print an honest dash for.
  const raws = corpusHtml("%game/boxscore?game_id=1104635");
  assert.equal(raws.length, 1, "corpus missing");
  const g = parseBoxscore((JSON.parse(raws[0]!) as { content: string }).content);
  assert.equal(g.hasScoringDetail, false);
  for (const l of g.linescore) {
    assert.deepEqual(l.periods, [null, null, null], `${l.team}: a zero-fill is not a score`);
  }
  // The finals are real and are kept — they are all these games have left.
  assert.deepEqual(g.linescore.map((l) => l.final), ["8", "5"]);
});

test("a game WITH detail keeps its real zeroes", () => {
  // The nulling above must not eat a genuine scoreless period. Tall Boys were
  // held off the board in the third, and that 0 is a fact.
  const g = parseBoxscore(box(CAPTAIN));
  const tb = g.linescore.find((l) => l.team === "Tall Boys Love Em")!;
  assert.deepEqual(tb.periods, ["2", "2", "0"]);
  assert.equal(tb.final, "4");
});

test("across the corpus, period cells sum to the final wherever they exist", () => {
  // The proof that these cells are derived from the scoring summary rather
  // than stored: where the summary exists they reconcile, every time.
  for (const { content } of allBoxes()) {
    const g = parseBoxscore(content);
    if (!g.hasScoringDetail) continue;
    const soIdx = g.periodLabels.indexOf("SO");
    for (const l of g.linescore) {
      const sum = l.periods
        .filter((_, i) => i !== soIdx)
        .reduce((n, x) => n + Number(x ?? 0), 0);
      const so =
        soIdx === -1 ? 0 : Number(String(l.periods[soIdx] ?? "").match(/^(\d+)/)?.[1] ?? 0);
      assert.equal(sum + so, Number(l.final), `${l.team}: periods do not sum to the final`);
    }
  }
});

test("a shootout goal belongs to no player and is not invented into one", () => {
  const g = parseBoxscore(box(SHOOTOUT));
  // The linescore carries an SO column; the shootout is not a scoring row.
  assert.ok(g.periodLabels.includes("SO"));
  const kings = g.linescore.find((l) => l.team === "Al Ross Kings")!;
  assert.equal(kings.final, "4");
  // Four on the board, three scored by somebody, one by the shootout.
  assert.equal(g.goals.filter((x) => x.team === "Al Ross Kings").length, 3);
  assert.equal(kings.periods[g.periodLabels.indexOf("SO")], "1 (2 - 0)");
});

test("parseScorerCell reads assists from the parentheses, not from position", () => {
  const cell =
    ' #72 <a class="person-inline" href="/stats#/player/905719">Anthony Venditti</a> ' +
    '(#13 <a class="person-inline" href="/stats#/player/1753318">Caidon Evancho</a>, ' +
    '#9 <a class="person-inline" href="/stats#/player/807477">Brady Eich</a>) ';
  const r = parseScorerCell(cell);
  assert.equal(r.scorer!.name, "Anthony Venditti");
  assert.deepEqual(r.assists.map((a) => a.name), ["Caidon Evancho", "Brady Eich"]);

  // No parentheses means no assists were recorded — not "the rest are assists".
  const solo = ' #96 <a class="person-inline" href="/stats#/player/2374630">Adam Kaplewicz</a>';
  const s = parseScorerCell(solo);
  assert.equal(s.scorer!.name, "Adam Kaplewicz");
  assert.deepEqual(s.assists, []);
});

test("EVERY captured boxscore's goals add up to its own final score", () => {
  // THE TEST THAT MATTERS. Each game states its final score in a linescore the
  // parser does not derive; the goals are read from a different table. If the
  // clone table were counted, if a goal were attributed to the wrong side, or
  // if a shootout were promoted into a real goal, these two would disagree.
  //
  // A shootout win is a goal on the scoreboard that nobody scored, so it is
  // added back from the SO column rather than hunted for among the scorers.
  const boxes = allBoxes();
  let reconciled = 0;
  let withoutDetail = 0;
  const failures: string[] = [];

  for (const { content } of boxes) {
    const g = parseBoxscore(content);
    if (!g.hasScoringDetail) {
      withoutDetail++;
      continue;
    }
    const soIdx = g.periodLabels.indexOf("SO");
    for (const line of g.linescore) {
      const scored = g.goals.filter((x) => x.team === line.team).length;
      const soCell = soIdx === -1 ? null : line.periods[soIdx];
      const soGoal = soCell ? Number(String(soCell).match(/^(\d+)/)?.[1] ?? 0) : 0;
      const expected = Number(line.final);
      if (scored + soGoal === expected) reconciled++;
      else failures.push(`${line.team}: final ${expected}, goals ${scored}, shootout ${soGoal}`);
    }
  }

  assert.deepEqual(failures, [], "every team-line must reconcile against the source's own score");
  // Both sides of every game with detail, and nothing quietly skipped.
  assert.equal(reconciled, (boxes.length - withoutDetail) * 2);
  assert.ok(reconciled > 300, `only ${reconciled} team-lines checked`);
});

test("'No penalties recorded.' is not parsed into a penalty", () => {
  // A clean game still renders the penalty table, with one row that is a
  // sentence in a colspan=6 cell. Seventeen games say it. Read positionally
  // the sentence becomes a period and "" becomes a team.
  const raws = corpusHtml("%game/boxscore?game_id=399477");
  assert.equal(raws.length, 1, "corpus missing");
  const content = (JSON.parse(raws[0]!) as { content: string }).content;
  assert.match(content, /No penalties recorded\./, "the source really does say this");
  const g = parseBoxscore(content);
  assert.deepEqual(g.penalties, []);
  // ...and the game itself is intact: fourteen goals, none of them lost.
  assert.equal(g.goals.length, 14);
});

test("penalties carry the offender, the infraction and the length", () => {
  // Seventeen rows in the source's own penalty table, counted off the raw
  // bytes and not off the parser's opinion of them.
  const g = parseBoxscore(box(CAPTAIN));
  assert.equal(g.penalties.length, 17);
  const first = g.penalties[0]!;
  assert.equal(first.period, "1st");
  assert.equal(first.time, "01:29");
  assert.equal(first.team, "The Golden Retrievers");
  assert.equal(first.player.name, "Jason Kaplewicz");
  assert.equal(first.player.jersey, "47");
  assert.equal(first.infraction, "Hooking (Minor)");
  assert.equal(first.length, "02:00");

  // A ten-minute misconduct is not a two-minute minor, and the length says so.
  const misconduct = g.penalties.find((p) => /Misconduct/.test(p.infraction))!;
  assert.equal(misconduct.length, "10:00");

  // Overtime is a period like any other, verbatim from the row's own cell.
  assert.ok(g.penalties.some((p) => p.period === "OT1"), "OT1 penalties survive");
});

test("no goal is recorded without a scorer, and assists are never blank", () => {
  for (const { content } of allBoxes()) {
    for (const g of parseBoxscore(content).goals) {
      assert.ok(g.scorer.name.length > 0, "a goal with no scorer is not attributable");
      assert.ok(g.period.length > 0 && g.time.length > 0);
      for (const a of g.assists) assert.ok(a.name.length > 0, "a blank assist is not an assist");
    }
  }
});
