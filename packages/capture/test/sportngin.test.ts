import { test } from "node:test";
import assert from "node:assert/strict";
import {
  urls,
  rosterPlayerIds,
  gameSheetIds,
  gameShowIds,
  teamInstanceIds,
  teamNames,
  isRetrieversPage,
  seasonFromTitle,
} from "../src/sources/sportngin.ts";
import type { TeamSeason } from "../src/sources/sportngin.ts";

const GR_2017: TeamSeason = {
  host: "www.eriemetrosports.com",
  label: "Erie Metro 2017-18",
  pageId: 3667197,
  teamInstance: 3080368,
};

test("urls use pageId and teamInstance where each belongs", () => {
  // These are DIFFERENT ids for the same team in the same season.
  assert.equal(urls.page(GR_2017), "https://www.eriemetrosports.com/page/show/3667197-golden-retrievers");
  assert.equal(urls.roster(GR_2017), "https://www.eriemetrosports.com/roster/show/3667197");
  assert.equal(urls.schedule(GR_2017), "https://www.eriemetrosports.com/schedule/team_instance/3080368");
  assert.ok(urls.teamStats(GR_2017).includes("/stats/team_instance/3080368"));
});

test("teamStats requires the player-stats tab", () => {
  // Without tab=team_instance_player_stats the roster table is absent.
  assert.ok(urls.teamStats(GR_2017).includes("tab=team_instance_player_stats"));
});

test("rosterPlayerIds extracts and dedupes", () => {
  const h = `<a href="/roster_players/22875247">Gugino</a>
             <a href="/roster_players/22875256">Kaplewicz</a>
             <a href="/roster_players/22875247">Gugino</a>`;
  assert.deepEqual(rosterPlayerIds(h), [22875247, 22875256]);
});

test("gameSheetIds extracts and dedupes", () => {
  const h = `<a href="/game/game_sheet/16081790">x</a><a href="/game/game_sheet/16407914">y</a>`;
  assert.deepEqual(gameSheetIds(h), [16081790, 16407914]);
});

test("teamInstanceIds extracts and dedupes", () => {
  assert.deepEqual(
    teamInstanceIds(`<a href="/stats/team_instance/3080368">a</a><a href="/posts/team_instance/3080368">b</a>`),
    [3080368],
  );
});

test("teamNames reads the ATTRIBUTES, not the visible text", () => {
  // The visible text is the abbreviation: the Golden Retrievers render as "83".
  // A parser reading text records this team as "83" and never knows what it found.
  const cell = `<td class="statTeam" sorttable_customkey="Golden Retrievers">
      <a class="teamName" title="Golden Retrievers" href="/page/show/3667197-golden-retrievers?use_abbrev=true">83</a>
    </td>`;
  assert.deepEqual(teamNames(cell), ["Golden Retrievers"]);
  assert.ok(!teamNames(cell).includes("83"), "must never yield the abbreviation");
});

test("isRetrieversPage tests the TITLE, not the body", () => {
  const own = `<title>Golden Retrievers - 2017-18 Regular Season - Statistics</title>`;
  assert.equal(isRetrieversPage(own), true);
  assert.equal(
    isRetrieversPage(`<title>The Golden Retrievers - 2019-20 Regular Season - Roster</title>`),
    true,
  );
});

test("isRetrieversPage rejects a league page that merely MENTIONS the Retrievers", () => {
  // A league-wide stats page lists every team; a body test would match it.
  const league = `<title>Statistics - 2017-18 Regular Season - Erie Metro Hockey League</title>
    <td sorttable_customkey="Golden Retrievers"><a title="Golden Retrievers">83</a></td>`;
  assert.ok(/golden retrievers/i.test(league), "sanity: the name IS in the body");
  assert.equal(isRetrieversPage(league), false, "but this is not a Retrievers page");
});

test("seasonFromTitle handles seasons that contain a hyphen", () => {
  // "2019-20" contains a hyphen, so a [^-]+ match silently drops every season.
  assert.equal(
    seasonFromTitle(`<title>The Golden Retrievers - 2019-20 Regular Season - Roster</title>`),
    "2019-20 Regular Season",
  );
  assert.equal(
    seasonFromTitle(`<title>Golden Retrievers - 2018 Spring/Summer Regular Season - Roster</title>`),
    "2018 Spring/Summer Regular Season",
  );
});

test("seasonFromTitle returns null when there is no season part", () => {
  assert.equal(seasonFromTitle(`<title>Golden Retrievers</title>`), null);
});

test("gameShowIds reads a schedule's game links", () => {
  // A schedule links /game/show/<id> and NEVER /game/game_sheet/<id>, so
  // scanning a schedule with gameSheetIds finds nothing at all.
  const sched = `<a href="http://x/game/show/19077176?subseason=447160">g1</a>
                 <a href="http://x/game/show/19077373?subseason=447160">g2</a>
                 <a href="http://x/game/show/19077176?subseason=447160">dup</a>`;
  assert.deepEqual(gameShowIds(sched), [19077176, 19077373]);
  assert.deepEqual(gameSheetIds(sched), [], "a schedule has no game_sheet links");
});

test("a game's show id and sheet id are the SAME id", () => {
  // Verified live: game/show/19077176 and game/game_sheet/19077176 are one
  // game, so schedule show-ids convert to sheet URLs with no extra request.
  const showId = gameShowIds(`<a href="/game/show/19077176">x</a>`)[0]!;
  assert.equal(
    urls.gameSheet("www.eriemetrosports.com", showId),
    "https://www.eriemetrosports.com/game/game_sheet/19077176",
  );
});
