import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecentGames, parseRecentScore } from "../src/sportngin/recent-games.ts";
import { corpusPages } from "./helpers/corpus.ts";

/**
 * Every fixture here is REAL captured bytes. Not one page below was written by
 * hand — a parser in this repo once passed 13 of 13 against an invented
 * fixture and produced 1,064 phantom goals, and this route is exactly the kind
 * that would do it again: it invents nothing, it only reads a table that has
 * been sitting inside pages the build already opens.
 *
 * THE ASSERTIONS THAT MATTER ARE THE CROSS-CHECKS. Three of the games this
 * table describes are already in the archive from completely different routes
 * — one Erie Metro scoresheet and two HarborCenter day-schedule rows — and
 * those three pin the two things a reader could get backwards: which side the
 * score belongs to, and which club was at home.
 */

const pages = corpusPages("%roster_players%");
const parsed = pages
  .map((p) => ({ url: p.url, page: parseRecentGames(p.html) }))
  .filter((x): x is { url: string; page: NonNullable<ReturnType<typeof parseRecentGames>> } =>
    x.page !== null);

const IS_GR = (t: string) => /^(the )?golden retrievers$/i.test(t.trim());
const noCorpus = pages.length === 0 && "corpus unavailable";

/** Every row about this club, from our pages and from our opponents' alike. */
const ours = parsed.flatMap(({ page }) =>
  page.rows
    .filter((r) => IS_GR(page.team) || IS_GR(r.opponent))
    .map((r) => ({ team: page.team, session: page.session, ...r })),
);

test("the corpus holds these tables, and nothing has ever read one", { skip: noCorpus }, () => {
  assert.ok(pages.length > 300, `${pages.length} roster_players pages`);
  assert.ok(parsed.length > 500, `${parsed.length} of them carry a Recent Games table`);
  // Both platforms, both column shapes.
  assert.ok(parsed.some((p) => /eriemetrosports/.test(p.url)), "Erie Metro pages");
  assert.ok(parsed.some((p) => /harborcenter|rinksatharborcenter/.test(p.url)), "HarborCenter pages");
});

test("a row is date, result, score, opponent and the platform's own game id", { skip: noCorpus }, () => {
  for (const { page } of parsed) {
    for (const r of page.rows) {
      assert.match(r.date, /^\d{2}\/\d{2}\/\d{4}$/, `${page.team}: ${r.date}`);
      assert.match(r.result, /^[WLT]$/);
      assert.match(r.score, /^\d+-\d+$/, `${page.team} ${r.date}: ${r.score}`);
      assert.ok(r.opponent.length > 0);
      assert.doesNotMatch(r.opponent, /^at\s/i, "the venue prefix is not part of the club's name");
      if (r.gameId !== null) assert.match(r.gameId, /^\d+$/);
    }
  }
});

test("the venue is real, and it is in the opponent cell", { skip: noCorpus }, () => {
  // "at Bandits" — the PAGE TEAM was away. A bare club name is a home game.
  // Both forms occur in quantity; a reader that ignored the prefix would call
  // every game a home game and never fail a test that only counted rows.
  const away = ours.filter((r) => r.pageTeamAway);
  const home = ours.filter((r) => !r.pageTeamAway);
  assert.ok(away.length > 0 && home.length > 0, "both venues occur");
});

test("THE CROSS-CHECK: three games the archive already holds, from other routes", { skip: noCorpus }, () => {
  const row = (id: string) => ours.find((r) => r.gameId === id);

  // 1. An Erie Metro SCORESHEET says: home Golden Retrievers 7, away Hammers 4.
  //    The table is read off a Retrievers player's page, so a bare opponent
  //    means we were at home, and the score is ours first.
  const sheet = row("16569729");
  assert.ok(sheet, "16569729 is not in the recent-games rows");
  assert.equal(sheet!.date, "03/07/2017");
  assert.equal(sheet!.result, "W");
  assert.equal(sheet!.score, "7-4");
  assert.equal(sheet!.opponent, "Hammers");
  assert.equal(sheet!.pageTeamAway, false, "the sheet says we were home");
  assert.ok(IS_GR(sheet!.team));

  // 2. A HarborCenter DAY SCHEDULE says: home The Golden Retrievers 3, away
  //    Ace 5. This row is off an ACE player's page — so the score is Ace's
  //    first, and "at The Golden Retrievers" says Ace travelled.
  const ace = row("22147490");
  assert.ok(ace, "22147490 is not in the recent-games rows");
  assert.equal(ace!.result, "W", "Ace won it");
  assert.equal(ace!.score, "5-3");
  assert.ok(IS_GR(ace!.opponent));
  assert.equal(ace!.pageTeamAway, true, "Ace was the away side, so we were home");

  // 3. The same schedule says: home Al Ross 4, away The Golden Retrievers 7.
  //    Off an Al Ross player's page, with no "at" — Al Ross were at home.
  const alRoss = row("22152394");
  assert.ok(alRoss, "22152394 is not in the recent-games rows");
  assert.equal(alRoss!.result, "L");
  assert.equal(alRoss!.score, "4-7");
  assert.ok(IS_GR(alRoss!.opponent));
  assert.equal(alRoss!.pageTeamAway, false, "Al Ross were home, so we travelled");
});

test("fourteen games, three of them ONLY on an opponent's page", { skip: noCorpus }, () => {
  const ids = new Set(ours.map((r) => r.gameId));
  assert.equal(ids.size, 14);
  assert.equal(ours.length, 39, "39 rows describe them, from both sides");

  const fromOurs = new Set(ours.filter((r) => IS_GR(r.team)).map((r) => r.gameId));
  const fromTheirs = new Set(ours.filter((r) => !IS_GR(r.team)).map((r) => r.gameId));
  const onlyTheirs = [...fromTheirs].filter((id) => !fromOurs.has(id));
  assert.equal(onlyTheirs.length, 3, "three games survive only on a rival's page");

  // 24687789 — 5 April 2019 — is on MUPPET NATION's page and nowhere else in
  // this corpus. Reading only our own players' pages loses it, and it is one
  // of the eleven games this route recovers.
  assert.ok(!fromOurs.has("24687789"));
  assert.deepEqual(onlyTheirs.sort(), ["22147490", "22152394", "24687789"]);
});

test("both sides of the ice describe the same game identically", { skip: noCorpus }, () => {
  // Five of these games are written up on more than one club's page, and one
  // is written up on six. Read from our side the score comes first and from
  // theirs it comes second; read from our side "at" means we travelled and
  // from theirs it means they did. If either flip were wrong, the two
  // readings of one game would disagree — so this is the check that the
  // orientation is right and not merely self-consistent.
  const seen = new Map<string, Set<string>>();
  for (const { page } of parsed) {
    for (const r of page.rows) {
      if (!r.gameId) continue;
      const pageIsGr = IS_GR(page.team);
      if (!pageIsGr && !IS_GR(r.opponent)) continue;
      const [ps, os] = parseRecentScore(r.score)!;
      const view = JSON.stringify({
        date: r.date,
        gf: pageIsGr ? ps : os,
        ga: pageIsGr ? os : ps,
        grHome: pageIsGr ? !r.pageTeamAway : r.pageTeamAway,
        opponent: pageIsGr ? r.opponent : page.team,
      });
      const set = seen.get(r.gameId) ?? new Set<string>();
      set.add(view);
      seen.set(r.gameId, set);
    }
  }
  assert.equal(seen.size, 14);
  for (const [id, views] of seen) {
    assert.equal(views.size, 1, `game ${id}: ${[...views].join(" || ")}`);
  }
});

test("the page is not evidence of the team", { skip: noCorpus }, () => {
  // 2,800-odd rows are in this corpus and 39 of them are about this club. The
  // rest belong to the other 76 teams whose players' pages were swept in — and
  // that includes the Major's and Classic Cue's, who carry most of this
  // roster and are NOT this club. Neither is ever called "Golden Retrievers",
  // which is why an identity test on the cell is safe where a name search is
  // not.
  const allRows = parsed.flatMap((p) => p.page.rows);
  assert.ok(allRows.length > 2000, `${allRows.length} rows across the corpus`);
  assert.ok(ours.length < 60, `${ours.length} of them are ours`);
  const teams = new Set(parsed.map((p) => p.page.team));
  assert.ok(teams.size > 50, `${teams.size} distinct page teams`);
});

test("parseRecentScore refuses anything that is not two numbers", () => {
  assert.deepEqual(parseRecentScore("7-4"), [7, 4]);
  assert.deepEqual(parseRecentScore("11-10"), [11, 10]);
  assert.deepEqual(parseRecentScore(" 3 - 5 "), [3, 5]);
  assert.equal(parseRecentScore(""), null);
  assert.equal(parseRecentScore("-"), null);
  assert.equal(parseRecentScore("W"), null);
});

test("a page with no Recent Games table is not half-parsed", { skip: noCorpus }, () => {
  assert.equal(parseRecentGames("<html><title>x</title></html>"), null);
  assert.equal(parseRecentGames(""), null);
  // And a table with no readable title yields nothing rather than a team of "".
  assert.equal(parseRecentGames('<table id="recent-game-stats"></table>'), null);
});
