import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStatsTitle, tableKind, phaseOf, parseLeagueStats, parseTeamStats,
} from "../src/sportngin/league-stats.ts";
import { corpusHtml } from "./helpers/corpus.ts";

/**
 * Every fixture here is REAL captured bytes out of the corpus. Not one of them
 * is a page I wrote.
 *
 * The rule is absolute in this repo because breaking it is undetectable: a
 * parser here once passed 13/13 against a hand-authored fixture and produced
 * 1,064 phantom goals against the pages that actually exist, green the whole
 * way. A test written against imagined bytes tests the imagination.
 *
 * It matters especially for THIS source, whose column sets are the surprise:
 * had I invented the 2018-19 skater table I would have given it a GP column —
 * it hasn't got one, no source for that season has one, and every "obvious"
 * games-played figure for 2018-19 would have been a number I made up.
 */

// Scoped to HarborCenter's host: Erie Metro's live league tables live at the
// same `/stats/league_instance/` path but are a different era, a different
// shape, and parsed by `erie-league.ts` — this file is the HAHL SportsEngine
// canary and must count only its own pages.
const pages = corpusHtml("%rinksatharborcenter.com/stats/league_instance%");

const titled = (t: string) => pages.filter((p) => new RegExp(`<title>[^<]*${t}`).test(p));

/**
 * Both tabs of a session share one title, so a title alone picks the wrong
 * page half the time: `tab=league_instance_team_stats` carries only the
 * `team-sm-*` totals and not one player. The player tables are selected
 * structurally, by the id SportsEngine gives them.
 */
const withPlayers = (t: string) => titled(t).filter((p) => /id="player-sm-/.test(p));
const fw1819 = withPlayers("2018-19 Fall/Winter");
const ss2018 = withPlayers("2018 Spring/Summer");
const rs1920 = withPlayers("2019-20 Regular Season - HAHL");

const gr = (rows: ReturnType<typeof parseLeagueStats>) =>
  rows.filter((r) => /^(the )?golden retrievers$/i.test(r.team));

test("the corpus actually holds the league tables these seasons depend on", () => {
  assert.ok(pages.length > 0, "no stats/league_instance captures — the era is gone");
  assert.ok(fw1819.length > 0, "no 2018-19 Fall/Winter capture");
  assert.ok(ss2018.length > 0, "no 2018 Spring/Summer capture");
  assert.ok(rs1920.length > 0, "no 2019-20 capture");
});

test("parseStatsTitle reads the session out from between Statistics and the league", () => {
  const t = parseStatsTitle("Statistics - 2018-19 Fall/Winter - HAHL");
  assert.equal(t?.session, "2018-19 Fall/Winter");
  assert.equal(t?.league, "HAHL");
  // The league name has spaces of its own; only the LAST part is the league.
  const m = parseStatsTitle("Statistics - 2020-21 Regular Season - HarborCenter Mite League");
  assert.equal(m?.session, "2020-21 Regular Season");
  assert.equal(m?.league, "HarborCenter Mite League");
});

test("parseStatsTitle rejects pages that are not statistics pages", () => {
  assert.equal(parseStatsTitle("The Golden Retrievers - Roster - #21"), null);
  assert.equal(parseStatsTitle("Statistics - HAHL"), null);
  assert.equal(parseStatsTitle(""), null);
});

test("every title in the corpus parses, and the four other leagues stay distinct", () => {
  const leagues = new Set<string>();
  for (const p of pages) {
    const raw = p.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    const t = parseStatsTitle(raw.replace(/\s+/g, " ").trim());
    assert.ok(t, `unparsed title: ${JSON.stringify(raw)}`);
    leagues.add(t!.league);
  }
  // The same Wayback crawl swept HarborCenter's mite league, the BEHL, a
  // Catholic league and a prospects camp into the corpus alongside ours.
  assert.ok(leagues.has("HAHL"), "our league is missing");
  assert.ok(leagues.size > 1, "the other leagues should still be readable, not dropped");
});

test("tableKind reads the real header sets — including the goalie tables with no GAA", () => {
  // Verbatim from the corpus. `# Name Team GP W L GA` is HarborCenter's
  // goaltender table for 2018-19 and 2019-20: no GAA, no MIN. The house
  // helpers in roster-player.ts and ownsite/roster-stats.ts both call this a
  // skater, which is exactly how a goalie's GP becomes a skater's season.
  assert.equal(tableKind(["#", "Name", "Team", "GP", "W", "L", "GA"]), "goalie");
  assert.equal(tableKind(["#", "Name", "Team", "GP", "W"]), "goalie");
  assert.equal(tableKind(["#", "Name", "Team", "W"]), "goalie");
  assert.equal(tableKind(["#", "Name", "Team", "GP", "W", "L", "T", "SOL", "GA", "SO"]), "goalie");
  assert.equal(tableKind(["#", "Name", "Team", "GP", "MIN", "W", "GA", "GAA"]), "goalie");
  assert.equal(tableKind(["#", "Name", "Team", "G", "A", "PTS", "PEN", "PIM"]), "skater");
  assert.equal(tableKind(["#", "Name", "Team", "GP", "G", "A", "PTS", "PEN", "PIM"]), "skater");
  assert.equal(tableKind(["#", "Name", "Team", "G", "A", "PTS"]), "skater");
  assert.equal(tableKind(["Team", "1", "2", "3", "Overtime", "Total"]), null);
});

test("phaseOf matches the label roster pages use for the same season", () => {
  // roster_players tables label 2018-19 as "Fall/Winter" and 2019-20 as
  // "Regular Season". If these two ever disagree, one man's season becomes two.
  assert.equal(phaseOf("2018-19 Fall/Winter"), "Fall/Winter");
  assert.equal(phaseOf("2019-20 Regular Season"), "Regular Season");
  assert.equal(phaseOf("2014-15 Playoffs"), "Playoffs");
});

test("the 2018-19 line the league actually published, to the digit", () => {
  const rows = parseLeagueStats(fw1819[0]!);
  const bk = gr(rows).find((r) => r.name === "Bryan Karchensky");
  assert.ok(bk, "Bryan Karchensky is not in the 2018-19 table");
  assert.equal(bk!.jersey, "21");
  assert.equal(bk!.team, "The Golden Retrievers");
  assert.equal(bk!.session, "2018-19 Fall/Winter");
  assert.equal(bk!.phases[0]!.kind, "skater");
  assert.equal(bk!.phases[0]!.stats["G"], "47");
  assert.equal(bk!.phases[0]!.stats["A"], "25");
  assert.equal(bk!.phases[0]!.stats["PTS"], "72");
  assert.equal(bk!.phases[0]!.stats["PEN"], "4");
  assert.equal(bk!.phases[0]!.stats["PIM"], "8");

  const ak = gr(rows).find((r) => r.name === "Adam Kaplewicz");
  assert.ok(ak, "Adam Kaplewicz is not in the 2018-19 table");
  assert.equal(ak!.jersey, "96");
  assert.equal(ak!.phases[0]!.stats["PTS"], "54");
});

test("2018-19 records NO games played, and none is invented", () => {
  const rows = parseLeagueStats(fw1819[0]!);
  const bk = gr(rows).find((r) => r.name === "Bryan Karchensky")!;
  // The 2018-19 skater table has no GP column at all. Absent, not nought
  // (§2.4) — the key must simply not be there, so `num()` yields null and the
  // career total stays honest instead of gaining a fabricated zero.
  assert.equal("GP" in bk.phases[0]!.stats, false, "2018-19 has no GP column — one was invented");
  assert.equal(bk.phases[0]!.stats["GP"], undefined);
  // 2019-20, the very next season on the same platform, DOES carry GP. The
  // column set is a property of the session, not of the source.
  const later = parseLeagueStats(rs1920[0]!);
  const bk20 = gr(later).find((r) => r.name === "Bryan Karchensky" && r.phases[0]!.kind === "skater")!;
  assert.equal("GP" in bk20.phases[0]!.stats, true, "2019-20 does carry GP");
});

test("THE TRAP: one man, two teams, one table — only his own row is his", () => {
  // Asserted on EVERY captured 2018-19 player page, not a chosen one.
  for (const page of fw1819) {
    const all = parseLeagueStats(page).filter((r) => r.name === "Bryan Karchensky");
    // He really is on this page twice, and the parser must return BOTH: the
    // evidence is the point. It is the build layer's job to take one.
    assert.equal(all.length, 2, "Karchensky should appear exactly twice in 2018-19");
    assert.deepEqual(
      all.map((r) => r.team).sort(),
      ["Classic Cue's Billiards", "The Golden Retrievers"],
    );
  }
  const all = parseLeagueStats(fw1819[0]!).filter((r) => r.name === "Bryan Karchensky");
  // Filtering on the ROW's team takes one row and one set of stats.
  //
  // A page-level match takes BOTH, and there is no version of that which is
  // his season for us: summed he scores 90, and under the build's actual dedup
  // key — name|session|phase|source, which carries no team — one row simply
  // overwrites the other and his 72 points quietly become Classic Cue's 66.
  // Nothing downstream can tell either apart from the truth.
  const ours = gr(all);
  assert.equal(ours.length, 1);
  assert.equal(ours[0]!.jersey, "21");
  assert.equal(ours[0]!.phases[0]!.stats["PTS"], "72");
  const theirs = all.find((r) => r.team === "Classic Cue's Billiards")!;
  assert.equal(theirs.jersey, "12");
  assert.equal(theirs.phases[0]!.stats["PTS"], "66");
});

test("the page naming a team is not evidence the team is on it", () => {
  // The team-stats tab carries "The Golden Retrievers" in its own tables and
  // its logo markup — and not one Retrievers PLAYER row. A page-level
  // substring test says yes to this page; the row-level test says no, which is
  // the truth. This is the shape of the bug that once made Classic Cue's,
  // Burners and 716 Realty into Retrievers.
  const teamTab = titled("2018-19 Fall/Winter").find((p) => !/id="player-sm-/.test(p));
  assert.ok(teamTab, "expected the 2018-19 team-stats tab in the corpus");
  // The string is on the page — in a team totals row and a logo URL.
  assert.match(teamTab!, /Golden Retrievers/, "the page really does contain the string");
  // And not one row of it is a Retrievers player. Page-level match: yes.
  // Row-level match: no. The row-level answer is the true one.
  assert.equal(gr(parseLeagueStats(teamTab!)).length, 0, "but it has no Retrievers players");
});

test("a club is never read as a player: one row per player cell, exactly", () => {
  // `team-sm-ice_hockey_skater-table` is headed `Team | G | A | PTS | PEN |
  // PIM` — the same stat vocabulary as the player table, one column short. Any
  // reader keyed on "has PTS" reads it, and every column lands one place left:
  // the CLUB becomes the jersey number and a goal count becomes the player's
  // name. So the test is not "no row is named Golden Retrievers" — that
  // passes even when the bug is present, which I found out by putting the bug
  // back. The real invariant is a count: SportsEngine marks each player cell
  // `<td class="statPlayer">`, and the parser must return one row per such
  // cell — no more (the team totals) and no fewer.
  let rows = 0;
  for (const p of pages) {
    const parsed = parseLeagueStats(p);
    const players = (p.match(/<td class="statPlayer/g) ?? []).length;
    assert.equal(parsed.length, players, "row count does not match the page's player cells");
    rows += parsed.length;
    for (const r of parsed) {
      // A name with no letter in it is a statistic that has been read as a man.
      assert.match(r.name, /[a-z]/i, `numeric name — columns are shifted: ${JSON.stringify(r.name)}`);
      assert.notEqual(r.name, r.team, `name and team identical: ${r.name}`);
    }
  }
  // 2,333 player rows across the 72 captures. Asserted so that a change which
  // quietly stops reading the tables is a failure and not a silence.
  assert.equal(rows, 2333, "the corpus holds 2,333 league player rows");
});

test("the goalie table survives, and never lands in skater columns", () => {
  const rows = parseLeagueStats(ss2018[0]!);
  const muff = gr(rows).find((r) => r.phases[0]!.kind === "goalie");
  assert.ok(muff, "no Retrievers goalie parsed from Summer 2018");
  assert.equal(muff!.name, "Corey Muff");
  assert.equal(muff!.jersey, "1");
  assert.equal(muff!.phases[0]!.stats["GP"], "13");
  assert.equal(muff!.phases[0]!.stats["W"], "9");
  assert.equal(muff!.phases[0]!.stats["L"], "4");
  // GA is goals AGAINST. It is emphatically not 64 goals scored, and a reader
  // that maps it onto G says a goaltender outscored the league.
  assert.equal(muff!.phases[0]!.stats["GA"], "64");
  assert.equal("G" in muff!.phases[0]!.stats, false);
  assert.equal("PTS" in muff!.phases[0]!.stats, false);
});

test("skater and goalie vocabularies never mix, on any captured page", () => {
  const kinds = new Set<string>();
  for (const p of pages) {
    for (const r of parseLeagueStats(p)) {
      const ph = r.phases[0]!;
      kinds.add(ph.kind);
      if (ph.kind === "goalie") {
        assert.ok(!("PTS" in ph.stats), "a goalie row carried PTS");
        assert.ok(!("G" in ph.stats), "a goalie row carried G");
      } else {
        assert.ok(!("W" in ph.stats), "a skater row carried W");
        assert.ok(!("GAA" in ph.stats), "a skater row carried GAA");
      }
    }
  }
  assert.ok(kinds.has("skater") && kinds.has("goalie"), "both kinds must appear");
});

test("no junk rows, no blank names, no aggregates, across all 72 captures", () => {
  for (const p of pages) {
    for (const r of parseLeagueStats(p)) {
      assert.ok(r.name.trim().length > 1, `junk name: ${JSON.stringify(r.name)}`);
      assert.ok(!/^(name|player name|team|#)$/i.test(r.name), `header leaked: ${r.name}`);
      assert.ok(r.team.trim().length > 0, "blank team");
      assert.ok(Object.keys(r.phases[0]!.stats).length > 0, `no stats: ${r.name}`);
      // A leaderboard has no totals rows; if one ever appears it must not be
      // silently ingested as a season (§2.8.1).
      assert.equal(r.phases[0]!.isAggregate, false);
      assert.equal(r.position, null, "these pages carry no position column");
    }
  }
});

test("every captured page parses without throwing, including the other leagues", () => {
  for (const p of pages) assert.doesNotThrow(() => parseLeagueStats(p));
});

test("2021 SPRING, the 2020-21 half: one goaltender is the entire recovered roster", () => {
  // The season's player tables were captured once, mid-season, 20 April
  // 2021 — and page 1 names exactly ONE Retriever: the goaltender, 8 games,
  // 4-4, 42 against. No roster page for the season was ever archived, so
  // this line is the only human being the archive can put on that ice.
  const s21 = withPlayers("2021 Spring HAHL");
  assert.equal(s21.length, 1, "expected exactly one 2021 Spring player-stats capture");
  const ours = gr(parseLeagueStats(s21[0]!));
  assert.equal(ours.length, 1, "exactly one Retriever on the captured page");
  const muff = ours[0]!;
  assert.equal(muff.name, "Corey Muff");
  assert.equal(muff.jersey, "1");
  assert.equal(muff.session, "2021 Spring HAHL Regular Season");
  const ph = muff.phases[0]!;
  assert.equal(ph.kind, "goalie");
  assert.equal(ph.stats["GP"], "8");
  assert.equal(ph.stats["W"], "4");
  assert.equal(ph.stats["L"], "4");
  assert.equal(ph.stats["T"], "0");
  assert.equal(ph.stats["SOL"], "0");
  assert.equal(ph.stats["GA"], "42");
  assert.equal(ph.stats["SO"], "0");
  // GA is goals AGAINST; a skater vocabulary here would be a fabrication.
  assert.equal("G" in ph.stats, false);
  assert.equal("PTS" in ph.stats, false);
});

test("parseTeamStats reads the club's own lines — 2021 Spring, to the digit", () => {
  // The team-statistics tab, same 20 April 2021 snapshot: the club's season
  // totals as the league summed them. With no boxscores and no skater lines
  // surviving, these cells are the season's entire offensive record.
  const teamTab = titled("2021 Spring HAHL").find((p) => !/id="player-sm-/.test(p));
  assert.ok(teamTab, "expected the 2021 Spring team-stats tab in the corpus");
  const ts = parseTeamStats(teamTab!)!;
  assert.equal(ts.session, "2021 Spring HAHL Regular Season");
  const ours = ts.teams.filter((t) => /^the golden retrievers$/i.test(t.team));
  const scoring = ours.find((t) => t.kind === "scoring")!;
  assert.ok(scoring, "no scoring line for the club");
  assert.equal(scoring.stats["GP"], "8");
  assert.equal(scoring.stats["G"], "37");
  assert.equal(scoring.stats["A"], "27");
  assert.equal(scoring.stats["PTS"], "64");
  assert.equal(scoring.stats["PEN"], "14");
  assert.equal(scoring.stats["PIM"], "36");
  const goalie = ours.find((t) => t.kind === "goalie")!;
  assert.ok(goalie, "no club goalie line");
  assert.equal(goalie.stats["GA"], "42");
  assert.equal(goalie.stats["SO"], "0");
  // The page renders each table more than once (viewport variants); one
  // line per (team, kind) — the repeats are the same table, not more games.
  assert.equal(ours.length, 2);
});

test("parseTeamStats: Summer 2018's scoring table has NO GP column, and none is invented", () => {
  const teamTab = titled("2018 Spring/Summer").find(
    (p) => !/id="player-sm-/.test(p) && /team-sm-|<th[^>]*>\s*&nbsp;Team/.test(p),
  );
  assert.ok(teamTab, "expected a 2018 Spring/Summer team-stats page in the corpus");
  const ts = parseTeamStats(teamTab!)!;
  const scoring = ts.teams.find(
    (t) => /^the golden retrievers$/i.test(t.team) && t.kind === "scoring",
  )!;
  assert.ok(scoring, "no 2018 club scoring line");
  assert.equal("GP" in scoring.stats, false, "2018 has no team GP column — one was invented");
  assert.equal(scoring.stats["G"], "76");
  assert.equal(scoring.stats["A"], "79");
  assert.equal(scoring.stats["PTS"], "155");
});

test("parseTeamStats never reads a player as a club, on any captured page", () => {
  // The team tables lead "Team |"; the player tables lead "# | Name | Team".
  // The same positional contract as the player reader, applied from the
  // other side: no line returned here may carry a player cell's name.
  for (const p of pages) {
    const ts = parseTeamStats(p);
    if (!ts) continue;
    for (const line of ts.teams) {
      assert.match(line.team, /[a-z]/i, `numeric club: ${JSON.stringify(line.team)}`);
      if (line.kind === "goalie") {
        assert.ok(!("PTS" in line.stats), "a club goalie line carried PTS");
      } else {
        assert.ok("PTS" in line.stats, "a scoring line without PTS");
      }
    }
  }
});

test("the whole HAHL era yields exactly the Retrievers we can prove", () => {
  // Page 1 only, sorted by goals: this is the top thirty of a 1,220-player
  // league. Three men is what survives, and the count is asserted so that a
  // future change that quietly recovers fewer — or invents more — is caught.
  const found = new Map<string, Set<string>>();
  for (const p of pages) {
    for (const r of gr(parseLeagueStats(p))) {
      if (!found.has(r.session)) found.set(r.session, new Set());
      found.get(r.session)!.add(r.name);
    }
  }
  assert.deepEqual(
    [...found.get("2018-19 Fall/Winter")!].sort(),
    ["Adam Kaplewicz", "Bryan Karchensky"],
  );
  assert.deepEqual(
    [...found.get("2018 Spring/Summer Regular Season")!].sort(),
    ["Bryan Karchensky", "Corey Muff"],
  );
  assert.deepEqual(
    [...found.get("2019-20 Regular Season")!].sort(),
    ["Adam Kaplewicz", "Bryan Karchensky", "Corey Muff"],
  );
  // The 2020-21 half ("2021 Spring HAHL"): the goaltender, and nobody else.
  assert.deepEqual(
    [...found.get("2021 Spring HAHL Regular Season")!].sort(),
    ["Corey Muff"],
  );
  // Summer 2019 is a real season the team played and it is NOT here: no
  // Retriever reached the top thirty by goals, so page 1 does not name one.
  // The league table cannot recover a single player of it — the season
  // survives as its standings row alone (see sportngin-standings.test.ts).
  assert.equal(found.has("2019 Spring/Summer Regular Season"), false);
});
