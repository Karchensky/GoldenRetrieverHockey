import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGameSheet,
  parseGameTitle,
  parseScoringDetail,
} from "../src/sportngin/game-sheet.ts";
import { corpusHtml } from "./helpers/corpus.ts";

/**
 * Mirrors the REAL structure of `game/game_sheet/15935431`, verified against
 * captured bytes.
 *
 * Critically: a period is ONE table containing scoring rows AND penalty rows,
 * separated by an INTERIOR <th> header row — not two tables. An earlier
 * version of this fixture invented two separate tables, and every test passed
 * against a structure that does not exist while the parser mangled the real
 * corpus. Do not "tidy" this fixture; its awkwardness is the point.
 */
const SHEET = `<html><head>
<title>Golden Retrievers 11 at Dark Knights 4 (Final) | Ice Hockey Game Sheet</title>
</head><body>
<div id="period_summaries">
<h3> 1st Period Summary </h3>
<table class="statTable">
<thead><tr><th class="time">Time</th><th class="teamName">Team</th><th class="eventDetail">Scoring Detail</th><th>Score</th></tr></thead>
<tbody>
<tr><td class="time">4:01</td><td class="teamName"> Golden Retrievers </td>
    <td class="eventDetail "> Anthony Christy Goal (even strength) <br/> <em>Assists: Jay Kaplewicz , Brenden Kaplewicz </em> </td>
    <td> 83 1 - 82 0 </td></tr>
<tr><td class="time">7:52</td><td class="teamName"> Dark Knights </td>
    <td class="eventDetail "> Ryan Wagner Goal (even strength) <br/> <em>Assists: Tim Dudas </em> </td>
    <td> 83 1 - 82 1 </td></tr>
<tr><th class="time">Time</th><th class="teamName">Team</th><th class="eventDetail" colspan="2">Penalty Detail</th></tr>
<tr><td class="time">13:51</td><td class="teamName"> Dark Knights </td><td class="eventDetail"> Zack Smith Tripping </td><td>2:00</td></tr>
</tbody>
</table>
<h3> 2nd Period Summary </h3>
<table class="statTable">
<thead><tr><th class="time">Time</th><th class="teamName">Team</th><th class="eventDetail">Scoring Detail</th><th>Score</th></tr></thead>
<tbody>
<tr><td class="time">2:10</td><td class="teamName"> Golden Retrievers </td>
    <td class="eventDetail "> Bryan Karchensky Goal (power play) <br/> <em>Assists: Adam Kaplewicz </em> </td>
    <td> 83 2 - 82 1 </td></tr>
<tr><td class="time">9:30</td><td class="teamName"> Golden Retrievers </td>
    <td class="eventDetail "> Vinny Terrara Goal (short handed) </td>
    <td> 83 3 - 82 1 </td></tr>
<tr><th class="time">Time</th><th class="teamName">Team</th><th class="eventDetail" colspan="2">Penalty Detail</th></tr>
<tr><td class="time">11:02</td><td class="teamName"> Golden Retrievers </td><td class="eventDetail"> served by Brenden Kaplewicz </td><td>0:0</td></tr>
</tbody>
</table>
</div>
<h3> Golden Retrievers </h3>
<h4>Skaters</h4><table class="statTable"><tr><th>#</th><th>Name</th><th>G</th></tr></table>
<h4>Goalies</h4><table class="statTable">
<tr><th>#</th><th>Name</th><th>Min</th><th>Sh</th><th>Sv</th><th>Dec</th></tr>
<tr><td>1</td><td>Brent Seymour</td><td>45:00</td><td>4</td><td>0</td><td>WIN</td></tr>
<tr><td>Totals:</td><td>45:00</td><td>4</td><td>0</td><td>0</td></tr>
</table>
</body></html>`;

// --- title ---

test("parseGameTitle reads teams and scores", () => {
  assert.deepEqual(
    parseGameTitle("Golden Retrievers 11 at Dark Knights 4 (Final) | Ice Hockey Game Sheet"),
    { awayTeam: "Golden Retrievers", awayScore: "11", homeTeam: "Dark Knights", homeScore: "4", final: true },
  );
});

test("parseGameTitle handles team names that CONTAIN digits", () => {
  // "913 Whalers" and "716 Realty Group" are real teams; a lazy number match
  // binds to the wrong token and silently mangles both team and score.
  const t = parseGameTitle("Golden Retrievers 3 at 913 Whalers 14 (Final) | Ice Hockey Game Sheet")!;
  assert.equal(t.awayTeam, "Golden Retrievers");
  assert.equal(t.awayScore, "3");
  assert.equal(t.homeTeam, "913 Whalers");
  assert.equal(t.homeScore, "14");
});

test("parseGameTitle handles a non-final game", () => {
  const t = parseGameTitle("A 1 at B 2 | Ice Hockey Game Sheet")!;
  assert.equal(t.final, false);
});

test("parseGameTitle returns null for a non-game title", () => {
  assert.equal(parseGameTitle("Standings - 2018 - HAHL"), null);
});

// --- scoring detail ---

test("parseScoringDetail keeps assists IN ORDER: primary then secondary", () => {
  const d = parseScoringDetail(
    " Anthony Christy Goal (even strength) <br/> <em>Assists: Jay Kaplewicz , Brenden Kaplewicz </em> ",
  );
  assert.equal(d.scorer, "Anthony Christy");
  assert.equal(d.strength, "even strength");
  // Order is meaningful: a primary assist is a different act from a secondary.
  assert.deepEqual(d.assists, ["Jay Kaplewicz", "Brenden Kaplewicz"]);
});

test("parseScoringDetail handles a goal with no assists", () => {
  const d = parseScoringDetail(" Vinny Terrara Goal (short handed) ");
  assert.equal(d.scorer, "Vinny Terrara");
  assert.equal(d.strength, "short handed");
  assert.deepEqual(d.assists, [], "unassisted is empty, not a blank name");
});

test("parseScoringDetail reads each strength state", () => {
  assert.equal(parseScoringDetail("X Goal (power play)").strength, "power play");
  assert.equal(parseScoringDetail("X Goal (even strength)").strength, "even strength");
  assert.equal(parseScoringDetail("X Goal (short handed)").strength, "short handed");
});

// --- whole sheet ---

test("parseGameSheet extracts every goal with its period", () => {
  const g = parseGameSheet(SHEET)!;
  assert.equal(g.goals.length, 4);
  assert.equal(g.goals[0]!.period, "1st");
  assert.equal(g.goals[0]!.time, "4:01");
  assert.equal(g.goals[0]!.scorer, "Anthony Christy");
  assert.equal(g.goals[2]!.period, "2nd", "later goals keep the 2nd-period heading");
  assert.equal(g.goals[2]!.scorer, "Bryan Karchensky");
  assert.equal(g.goals[2]!.strength, "power play");
});

test("parseGameSheet yields the assist EDGES that make chemistry computable", () => {
  const g = parseGameSheet(SHEET)!;
  const edges = g.goals.flatMap((x) => x.assists.map((a) => `${a} -> ${x.scorer}`));
  assert.deepEqual(edges, [
    "Jay Kaplewicz -> Anthony Christy",
    "Brenden Kaplewicz -> Anthony Christy",
    "Tim Dudas -> Ryan Wagner",
    "Adam Kaplewicz -> Bryan Karchensky",
  ]);
});

test("penalty rows in the SAME table are not parsed as goals", () => {
  // The regression that mattered: a period is ONE table where an interior <th>
  // row switches from scoring to penalties. Reading only the first header made
  // penalty durations ("0:0", "10:00") parse as goal STRENGTH STATES, and
  // yielded zero penalties across the entire real corpus.
  const g = parseGameSheet(SHEET)!;

  assert.equal(g.penalties.length, 2, "both penalties found, across two periods");
  assert.equal(g.penalties[0]!.period, "1st");
  assert.equal(g.penalties[0]!.team, "Dark Knights");
  assert.match(g.penalties[0]!.detail, /Tripping/);
  assert.equal(g.penalties[1]!.period, "2nd");

  assert.equal(g.goals.length, 4, "exactly the four real goals");
  assert.ok(!g.goals.some((x) => /Tripping|served by/.test(x.scorer)), "a penalty is not a goal");
  // Strength states must be real hockey states, never penalty durations.
  const strengths = new Set(g.goals.map((x) => x.strength));
  assert.deepEqual([...strengths].sort(), ["even strength", "power play", "short handed"]);
  for (const s of strengths) {
    assert.ok(!/^\d+:\d+$/.test(s ?? ""), `"${s}" is a duration, not a strength`);
  }
});

test("parseGameSheet names the goalie columns HONESTLY", () => {
  // The column labelled "Sh" holds GOALS AGAINST (it equals the opponent's
  // score), and "Sv" is universally 0 because saves are not recorded. The
  // field names must not propagate the source's mislabelling.
  const g = parseGameSheet(SHEET)!;
  assert.equal(g.goalies.length, 1);
  const k = g.goalies[0]!;
  assert.equal(k.name, "Brent Seymour");
  assert.equal(k.shotsLabelled, "4", "equals the opponent's final score, not shots");
  assert.equal(k.savesLabelled, "0");
  assert.equal(k.decision, "WIN");
});

test("parseGameSheet skips the goalie Totals aggregate row", () => {
  const g = parseGameSheet(SHEET)!;
  assert.ok(!g.goalies.some((k) => /totals/i.test(k.jersey)), "Totals is an aggregate, not a goalie");
});

test("parseGameSheet returns null for a page that is not a game sheet", () => {
  assert.equal(parseGameSheet("<title>Golden Retrievers - 2017-18 - Roster - #1 - X - G</title>"), null);
});

// ---------------------------------------------------------------------------
// AGAINST THE REAL CORPUS.
//
// Everything above this line runs on a fixture, and a fixture can only ever
// contain what its author had already noticed. Every fact below was found by
// reading captured bytes and NONE of them are visible in SHEET: the sheets
// carry a date, a status that contradicts the title, a box score, and four
// games settled by something no player did.
// ---------------------------------------------------------------------------

const SHEETS = corpusHtml("%game_sheet%")
  .map((h) => parseGameSheet(h))
  .filter((g) => g !== null);
const GR = SHEETS.filter((g) => /golden retrievers/i.test(`${g!.awayTeam} ${g!.homeTeam}`));
const noCorpus = SHEETS.length === 0 && "corpus unavailable";

test("every sheet on file carries a DATE", { skip: noCorpus }, () => {
  // Whether these existed at all was an open question. They do — all 92.
  assert.equal(SHEETS.length, 92);
  for (const g of SHEETS) {
    assert.ok(g!.date, `${g!.title} has no date`);
    // "Sep 19, 2016" — abbreviated. Note that sessions.parseGameDate wants a
    // FULL month name and returns null for eleven of these twelve months.
    assert.match(g!.date!, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/, g!.date!);
    assert.ok(g!.time, "and a start time");
  }
});

test("the corpus holds 59 Golden Retrievers games, not 92", { skip: noCorpus }, () => {
  // 33 captured sheets are not this team's games at all — they are the other
  // leagues that share these rinks, swept in whole when
  // `harborcenter.sportngin.com` was rescued. Counting them as the team's
  // would be a fabrication of thirty-three games.
  //
  // 59 is the number under test and has not moved through two host sweeps.
  // The foreign count is expected to rise again.
  assert.equal(GR.length, 59);
  const others = SHEETS.filter((g) => !GR.includes(g));
  assert.equal(others.length, 33);
  assert.ok(others.some((g) => /Squirt/i.test(`${g!.awayTeam} ${g!.homeTeam}`)), "youth hockey");
});

test("the TITLE says (Final) even when the game went past regulation", { skip: noCorpus }, () => {
  const ot = GR.filter((g) => g!.status === "Final/OT");
  assert.ok(ot.length > 0, "the corpus holds overtime games");
  for (const g of ot) {
    assert.equal(g!.final, true, "the title claims a plain Final...");
    assert.equal(g!.status, "Final/OT", "...and only the status knows better");
  }
});

test("a shootout win is recorded, and is attributed to NOBODY", { skip: noCorpus }, () => {
  const so = GR.filter((g) => g!.shootoutWinner !== null);
  assert.equal(so.length, 4, "four games in the corpus were settled this way");

  for (const g of so) {
    assert.equal(g!.status, "Final/OT");
    // The row has no time and no player on it. It is worth a goal on the
    // scoreboard, so the goals recorded fall exactly one short of the score.
    const winner = g!.shootoutWinner!;
    const won = winner === g!.homeTeam ? g!.homeScore : g!.awayScore;
    const events = g!.goals.filter((x) => x.team === winner).length;
    assert.equal(events, Number(won) - 1, `${g!.title}: the shootout is the missing goal`);

    // And it must never become a GoalEvent with an invented scorer.
    assert.ok(!g!.goals.some((x) => /shootout/i.test(x.scorer)), "no phantom scorer");
    assert.ok(g!.goals.every((x) => x.time !== ""), "and no goal without a clock");
  }
});

test("the overtime period exists and is EMPTY on every shootout game", { skip: noCorpus }, () => {
  // Not one goal has ever been scored in overtime in this corpus. The period
  // is on the sheet, with a column in the box score, and it is always nought.
  for (const g of GR.filter((x) => x!.shootoutWinner !== null)) {
    assert.deepEqual(g!.periodLabels, ["1", "2", "3", "OT1"]);
    assert.ok(!g!.goals.some((x) => /^OT/i.test(x.period)), "no goal is recorded in overtime");
    for (const row of g!.linescore) {
      assert.equal(row.periods.at(-1), "0", "the OT column is nought for both teams");
    }
  }
});

test("nine sheets carry a score and NOTHING else", { skip: noCorpus }, () => {
  const bare = GR.filter((g) => !g!.hasScoringDetail);
  assert.equal(bare.length, 9);

  for (const g of bare) {
    assert.equal(g!.goals.length, 0, "no goals");
    assert.equal(g!.penalties.length, 0, "no penalties");
    // The box score is dashes — not zeroes. Even the periods are gone.
    for (const row of g!.linescore) {
      assert.equal(row.final, null, `${g!.title}: the box score final is a dash`);
      assert.deepEqual(row.periods, [null, null, null]);
    }
    // The score survives in exactly one place: the page's own <title>.
    assert.match(g!.title, /\d+ at .* \d+/);
  }
});

test("the box score reconciles with the title on every game that has one", { skip: noCorpus }, () => {
  for (const g of GR.filter((x) => x!.hasScoringDetail)) {
    assert.equal(g!.linescore.length, 2);
    const [away, home] = g!.linescore;
    assert.equal(away!.final, g!.awayScore, `${g!.title}: away box score vs title`);
    assert.equal(home!.final, g!.homeScore, `${g!.title}: home box score vs title`);

    // Periods sum to the final — with the shootout bundled into the 3rd.
    for (const row of g!.linescore) {
      const sum = row.periods.reduce((a, b) => a + Number(b ?? 0), 0);
      assert.equal(sum, Number(row.final), `${g!.title}: ${row.team} periods sum to final`);
    }
  }
});

test("goal events equal the score on every game that is not a shootout", { skip: noCorpus }, () => {
  // The whole point of the parser. If this drifts, the assist network is
  // fiction. 1,064 phantom goals is what the failure looked like last time.
  for (const g of GR.filter((x) => x!.hasScoringDetail && x!.shootoutWinner === null)) {
    const away = g!.goals.filter((x) => x.team === g!.awayTeam).length;
    const home = g!.goals.filter((x) => x.team === g!.homeTeam).length;
    assert.equal(away, Number(g!.awayScore), `${g!.title}: away goals vs score`);
    assert.equal(home, Number(g!.homeScore), `${g!.title}: home goals vs score`);
  }
});

test("the title's team names are decoded to match the names on the goal rows", { skip: noCorpus }, () => {
  // "M&amp;M Forwarding" in the <title>, "M&M Forwarding" on every goal row
  // below it. Undecoded, grouping a box score by team silently drops one
  // whole side of that game — and it is a real game the team won 9-6.
  const mm = GR.find((g) => /M&M Forwarding/.test(g!.title));
  assert.ok(mm, "the M&M Forwarding game is on file");
  assert.equal(mm!.homeTeam, "M&M Forwarding", "no raw entity survives into a team name");
  assert.ok(mm!.goals.some((x) => x.team === mm!.homeTeam), "and it matches the goal rows");

  for (const g of SHEETS) {
    assert.ok(!/&(amp|#39|quot|nbsp);/.test(`${g!.awayTeam}${g!.homeTeam}`), g!.title);
  }
});

test("saves are nought in every goaltender line on file, including the wins", { skip: noCorpus }, () => {
  const lines = GR.flatMap((g) => g!.goalies);
  assert.ok(lines.length > 0);
  for (const k of lines) assert.equal(k.savesLabelled, "0");
  assert.ok(lines.some((k) => k.decision === "WIN"), "including the wins");
});
