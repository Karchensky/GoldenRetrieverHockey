import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRosterPlayer,
  parseTitle,
  isAggregateLabel,
  tableKind,
  bioField,
} from "../src/sportngin/roster-player.ts";

/**
 * Fixtures below mirror the real structure of captured pages, verified against
 * `roster_players/16110290` (Golden Retrievers 2016-17, #1 Brent Seymour, G)
 * and `roster_players/22875256` (2017-18, #96 Adam Kaplewicz).
 */

const GOALIE_PAGE = `<html><head>
<title>Golden Retrievers - 2016-17 Regular Season - Roster - #1 - Brent Seymour - G</title>
</head><body>
<dl><dt>Weight</dt><dd>195</dd><dt>Date of Birth</dt><dd>03/14/1986</dd></dl>
<table class="dataTable statTable NginTable">
<tr><th>Date</th><th>GP</th><th>MIN</th><th>W</th><th>L</th><th>SOL</th><th>GA</th><th>GAA</th><th>SO</th></tr>
<tr><td>Regular Season</td><td>22</td><td>990:00</td><td>15</td><td>6</td><td>1</td><td>142</td><td>6.45</td><td>0</td></tr>
<tr><td>2016-17 Totals</td><td>22</td><td>990:00</td><td>15</td><td>6</td><td>1</td><td>142</td><td>6.45</td><td>0</td></tr>
</table></body></html>`;

const SKATER_PAGE = `<html><head>
<title>Golden Retrievers - 2017-18 Regular Season - Roster - #96 - Adam Kaplewicz - </title>
</head><body>
<dl><dt>Weight</dt><dd>180</dd><dt>Date of Birth</dt><dd>08/04/1990</dd></dl>
<table class="dataTable statTable NginTable">
<tr><th>Date</th><th>GP</th><th>G</th><th>A</th><th>PTS</th><th>PIM</th><th>GW</th></tr>
<tr><td>Regular Season</td><td>23</td><td>35</td><td>32</td><td>67</td><td>8</td><td>4</td></tr>
<tr><td>2017-18 Totals</td><td>23</td><td>35</td><td>32</td><td>67</td><td>8</td><td>4</td></tr>
</table></body></html>`;

// --- title parsing ---

test("parseTitle reads team, session, jersey, name and position", () => {
  const t = parseTitle("Golden Retrievers - 2016-17 Regular Season - Roster - #1 - Brent Seymour - G");
  assert.deepEqual(t, {
    team: "Golden Retrievers",
    session: "2016-17 Regular Season",
    jersey: "1",
    name: "Brent Seymour",
    position: "G",
  });
});

test("parseTitle handles a session containing a hyphen", () => {
  // "2019-20" contains a hyphen; a hyphen-excluding pattern drops every season.
  const t = parseTitle("The Golden Retrievers - 2019-20 Regular Season - Roster - #1 - Corey Muff - G");
  assert.equal(t?.session, "2019-20 Regular Season");
  assert.equal(t?.team, "The Golden Retrievers");
});

test("parseTitle handles a missing position (trailing separator)", () => {
  const t = parseTitle("Golden Retrievers - 2017-18 Regular Season - Roster - #96 - Adam Kaplewicz - ");
  assert.equal(t?.name, "Adam Kaplewicz");
  assert.equal(t?.position, null, "an empty trailing part means no position, not ''");
});

test("parseTitle preserves misspellings verbatim — they are evidence", () => {
  // Terrara/Terrana/Terana are the same man; normalising here would destroy
  // the evidence identity resolution needs.
  const t = parseTitle("Golden Retrievers - 2017-18 Regular Season - Roster - #89 - Vinny Terrara - ");
  assert.equal(t?.name, "Vinny Terrara");
});

test("parseTitle keeps a jersey that is not a plain number", () => {
  // "#0" and "#A15" both occur in the wild.
  assert.equal(parseTitle("X - S - Roster - #0 - Pat Gillen - F")?.jersey, "0");
  assert.equal(parseTitle("X - S - Roster - #A15 - Brett Kazmierski - ")?.jersey, "A15");
});

test("parseTitle returns null for a non-roster page", () => {
  assert.equal(parseTitle("Statistics - 2017-18 Regular Season - Erie Metro Hockey League"), null);
  assert.equal(parseTitle("Golden Retrievers 11 at Dark Knights 4 (Final) | Ice Hockey Game Sheet"), null);
});

// --- aggregates and table kinds ---

test("isAggregateLabel identifies Totals rows, not phases", () => {
  assert.equal(isAggregateLabel("2017-18 Totals"), true);
  assert.equal(isAggregateLabel("Summer League 2019 Totals"), true);
  assert.equal(isAggregateLabel("Regular Season"), false);
  assert.equal(isAggregateLabel("2017-18 Playoff"), false);
});

test("tableKind distinguishes goalie tables from skater tables", () => {
  assert.equal(tableKind(["Date", "GP", "MIN", "W", "L", "GA", "GAA", "SO"]), "goalie");
  assert.equal(tableKind(["Date", "GP", "G", "A", "PTS", "PIM", "GW"]), "skater");
});

test("bioField reads a labelled bio value", () => {
  assert.equal(bioField(GOALIE_PAGE, "Date of Birth"), "03/14/1986");
  assert.equal(bioField(GOALIE_PAGE, "Weight"), "195");
  assert.equal(bioField(GOALIE_PAGE, "Height"), null);
});

// --- whole-page parsing ---

test("parseRosterPlayer reads a goalie page end to end", () => {
  const p = parseRosterPlayer(GOALIE_PAGE)!;
  assert.equal(p.team, "Golden Retrievers");
  assert.equal(p.session, "2016-17 Regular Season");
  assert.equal(p.jersey, "1");
  assert.equal(p.name, "Brent Seymour");
  assert.equal(p.position, "G");
  assert.equal(p.dob, "03/14/1986");
  assert.equal(p.weight, "195");
  assert.equal(p.phases.length, 2);

  const reg = p.phases[0]!;
  assert.equal(reg.label, "Regular Season");
  assert.equal(reg.isAggregate, false);
  assert.equal(reg.kind, "goalie");
  assert.equal(reg.stats.GP, "22");
  assert.equal(reg.stats.MIN, "990:00");
  assert.equal(reg.stats.GA, "142");
  assert.equal(reg.stats.GAA, "6.45");
});

test("parseRosterPlayer FLAGS the Totals row rather than treating it as a phase", () => {
  // Ingesting "2016-17 Totals" as a session invents a phantom season AND
  // double-counts every stat in it (§2.8.1).
  const p = parseRosterPlayer(GOALIE_PAGE)!;
  const agg = p.phases.find((x) => x.isAggregate)!;
  assert.equal(agg.label, "2016-17 Totals");
  assert.equal(p.phases.filter((x) => !x.isAggregate).length, 1, "exactly one REAL phase");
});

test("the corpus's own arithmetic holds: GAA == GA / GP, on 45-minute games", () => {
  // The rule that a previous spec draft got wrong by assuming 60-minute games,
  // and then blamed on a scorekeeper. Verify the model before accusing anyone.
  const reg = parseRosterPlayer(GOALIE_PAGE)!.phases[0]!;
  const gp = Number(reg.stats.GP);
  const ga = Number(reg.stats.GA);
  const gaa = Number(reg.stats.GAA);
  const [mm] = reg.stats.MIN!.split(":");
  assert.equal(Number(mm) / gp, 45, "these leagues play 45-minute games");
  assert.ok(Math.abs(ga / gp - gaa) < 0.01, "GAA is GA per GAME");
  assert.ok(Math.abs((ga * 60) / Number(mm) - gaa) > 0.5, "GA*60/MIN is the WRONG formula");
});

test("parseRosterPlayer reads a skater page and keeps DOB", () => {
  const p = parseRosterPlayer(SKATER_PAGE)!;
  assert.equal(p.name, "Adam Kaplewicz");
  assert.equal(p.jersey, "96");
  assert.equal(p.position, null);
  // DOB is the only field that reliably separates the Kaplewicz siblings.
  assert.equal(p.dob, "08/04/1990");
  const reg = p.phases[0]!;
  assert.equal(reg.kind, "skater");
  assert.equal(reg.stats.PTS, "67");
  assert.ok(!("MIN" in reg.stats), "a skater row has no goalie columns");
});

test("stats stay RAW — never coerced, and an empty cell is not zero", () => {
  const page = SKATER_PAGE.replace("<td>8</td>", "<td></td>");
  const reg = parseRosterPlayer(page)!.phases[0]!;
  assert.equal(reg.stats.PIM, "", "empty stays empty");
  assert.notEqual(reg.stats.PIM, "0", "an untracked column must NEVER become zero");
  assert.equal(typeof reg.stats.PTS, "string", "values are raw strings, not numbers");
});

test("an empty cell does not shift the columns after it", () => {
  // Dropping empty cells misaligns every subsequent value — the hazard that
  // corrupted a player's row during the spike (§2.9).
  const page = SKATER_PAGE.replace("<td>35</td>", "<td></td>");
  const reg = parseRosterPlayer(page)!.phases[0]!;
  assert.equal(reg.stats.G, "", "the blanked column");
  assert.equal(reg.stats.A, "32", "the NEXT column must be unshifted");
  assert.equal(reg.stats.PTS, "67");
});

test("parseRosterPlayer returns null for a page that is not a roster player", () => {
  assert.equal(parseRosterPlayer("<title>Standings - 2018 - HAHL</title>"), null);
  assert.equal(parseRosterPlayer("<html>no title</html>"), null);
});

/* ---- the eighth goalie shape --------------------------------------------
   tableKind checked only GAA/MIN. Across the real corpus there are EIGHT
   distinct goalie header shapes and one of them carries neither: Corey Muff's
   2019-20 page is `Date | GP | W | L | GA`. It classified as "skater", slipped
   past generate.ts's kind filter, and left the last 4 nulls in the archive plus
   a phantom gp:9. Asserted against measured reality, not a fixture.        */

test("a goalie table with neither GAA nor MIN is still a goalie table", () => {
  // The real shape, verbatim from roster_players/36434306 (Muff, 2019-20).
  assert.equal(tableKind(["Date", "GP", "W", "L", "GA"]), "goalie");
  assert.equal(tableKind(["Date", "Result", "Opponent", "GP", "W", "L", "GA"]), "goalie");
});

test("every other real goalie shape still reads as a goalie", () => {
  for (const h of [
    ["Date", "GP", "MIN", "W", "GA", "GAA"],
    ["Date", "GP", "MIN", "W", "L", "SOL", "GA", "GAA", "SO"],
    ["Date", "GP", "MIN", "W", "L", "T", "SOG", "GA", "GAA", "SV %"],
    ["Date", "Result", "Opponent", "GP", "MIN", "W", "GA", "GAA"],
  ]) {
    assert.equal(tableKind(h), "goalie", h.join("|"));
  }
});

test("no real skater shape is dragged over by the W+L rule", () => {
  // Verified across the whole corpus: ZERO skater tables carry both W and L.
  for (const h of [
    ["Date", "G", "A", "PTS", "PEN", "PIM"],
    ["Date", "Result", "Opponent", "G", "A", "PTS", "PEN", "PIM"],
    ["Date", "G", "A", "PTS"],
    ["Date", "GP", "G", "A", "PTS", "PIM", "GW"],
    ["Date", "GP", "G", "A", "PTS", "PIM", "AVG PTS"],
    ["Date", "Result", "Opponent", "GP", "G", "A", "PTS", "PIM", "AVG PTS"],
  ]) {
    assert.equal(tableKind(h), "skater", h.join("|"));
  }
});
