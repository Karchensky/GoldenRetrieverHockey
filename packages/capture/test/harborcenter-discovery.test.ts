import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverHarborcenter } from "../src/sources/harborcenter-discovery.ts";
import { endpoints, scheduleRows, teamIdentity } from "../src/sources/digitalshift.ts";
import { buildGames } from "../../build/src/games.ts";

const NEW_TEAM = 717325;
const NEW_SEASON = 11355;
const OLD_TEAM = 681628;
const OLD_SEASON = 10919;
const NEW_LABEL = "Fall/Winter 2026-27";
const partial = (content: string) => JSON.stringify({ content });
const escapeAttribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const filters = (seasons = [{ id: NEW_SEASON, name: NEW_LABEL }]) =>
  JSON.stringify({ season: { selected_id: NEW_SEASON, options: seasons } });

// These are the card boundaries and links returned by /teams/table, including
// a separate roster and stats link for the same team.
const card = (id: number, name = "The Golden Retrievers") =>
  `<div class="team"><div class="logo"><img src="logo.png" alt=""></div>
   <div class="team-name bh-black">${name}</div><div class="links">
   <a href="/stats#/team/${id}/roster">Roster</a>
   <a href="/stats#/team/${id}/stats">Stats</a></div></div>`;
const directory = (...cards: string[]) =>
  partial(`<div class="pad-pt pad-ph"><h2 class="h3">Silver Division</h2></div>
           <div class="teams-grid">${cards.join("")}</div>`);
const header = (session = NEW_LABEL, name = "The Golden Retrievers", extra = "") =>
  `<h1 class="sr-only">${name}, ${session}, Silver</h1>${extra}`;
const players = (...ids: number[]) => partial(ids.map((id) =>
  `<a href="#/player/${id}/bio">Player ${id}</a>`).join(""));
const career = (...ids: number[]) => partial(ids.map((id) =>
  `<a href="/stats#/1367/team/${id}/stats">Team</a>`).join(""));

function fixture() {
  const responses = new Map<string, string | null>([
    [endpoints.leagueSeasons(), filters()],
    [endpoints.seasonTeams(NEW_SEASON), directory(card(NEW_TEAM))],
    [endpoints.team(NEW_TEAM), partial(header())],
    [endpoints.teamRoster(NEW_TEAM), partial("<div>No players found.</div>")],
    [endpoints.teamStats(NEW_TEAM), partial("<div>No player statistics found.</div>")],
  ]);
  const requests: string[] = [];
  const warnings: string[] = [];
  const grab = async (url: string) => {
    requests.push(url);
    assert.ok(responses.has(url), `Unexpected request: ${url}`);
    return responses.get(url)!;
  };
  return { responses, requests, warnings, grab, onWarning: (message: string) => warnings.push(message) };
}

test("a preseason schedule survives empty roster/statistics and every retired career id failing", async () => {
  const f = fixture();
  f.responses.set(endpoints.player(2350393), null);
  f.responses.set(endpoints.player(2374630), "{\"error\":\"Player not found\"}");
  const found = await discoverHarborcenter({ ...f, seedPlayers: [2350393, 2374630] });
  assert.equal(found.teams.get(NEW_TEAM), "The Golden Retrievers, Fall/Winter 2026-27, Silver");
  assert.equal(found.playersWalked, 2);
  assert.equal(f.warnings.length, 2, "retired ids are visible without discarding the discovered team");

  // Follow the same handoff as capture -> build: the confirmed team header
  // supplies the season, and schedule rows can stand alone before anyone plays.
  const identity = teamIdentity(JSON.parse(f.responses.get(endpoints.team(NEW_TEAM))!).content)!;
  const rows = scheduleRows(`<tbody ng-init="ctrl.schedule=${escapeAttribute(JSON.stringify([{
    game_id: 1923456, season_id: NEW_SEASON, date: "2026-09-24", time: "22:10",
    home_team_id: NEW_TEAM, home_team: "The Golden Retrievers",
    away_team_id: 717322, away_team: "Buffalo Cigars",
    home_score: 0, away_score: 0, status: "Not Started", game_type: "Regular Season",
    rink: "Rink 2", facility: "LECOM Harborcenter",
  }]))}"></tbody>`);
  const { games, totals } = buildGames({
    sheets: [], teamSchedules: [], daySchedules: [], boxscores: [],
    hsSchedules: [{ teamId: NEW_TEAM, session: identity.session, source: "harborcenter-hockeyshift", rows }],
  }, (source) => ({ source, label: source, archiveOnly: false }));
  assert.equal(games.length, 1);
  assert.equal(games[0]!.session, "2026 - Winter");
  assert.equal(games[0]!.date, "2026-09-24");
  assert.equal(games[0]!.opponent, "Buffalo Cigars");
  assert.equal(games[0]!.result, null, "an unplayed 0-0 is not a tie");
  assert.equal(games[0]!.homeScore, null);
  assert.equal(games[0]!.awayScore, null);
  assert.equal(games[0]!.scheduleOnly, true);
  assert.equal(totals.played, 0);
});

test("a cold start with no known players discovers all directory seasons", async () => {
  const f = fixture();
  f.responses.set(endpoints.leagueSeasons(), filters([
    { id: NEW_SEASON, name: NEW_LABEL }, { id: OLD_SEASON, name: "Summer 2026" },
  ]));
  f.responses.set(endpoints.seasonTeams(OLD_SEASON), directory(card(OLD_TEAM, "Golden Retrievers")));
  f.responses.set(endpoints.team(OLD_TEAM), partial(header("Summer 2026", "Golden Retrievers")));
  f.responses.set(endpoints.teamRoster(OLD_TEAM), players());
  f.responses.set(endpoints.teamStats(OLD_TEAM), players());
  const found = await discoverHarborcenter({ ...f, seedPlayers: [] });
  assert.deepEqual([...found.teams.keys()], [NEW_TEAM, OLD_TEAM]);
  assert.equal(found.seasonsSearched, 2);
  assert.equal(found.playersWalked, 0);
  assert.equal(found.directoryComplete, true);
  assert.equal(f.warnings.length, 0);
});

test("failed league filters preserve the existing player-history discovery path", async () => {
  const f = fixture();
  f.responses.set(endpoints.leagueSeasons(), null);
  f.responses.set(endpoints.player(2350393), career(OLD_TEAM));
  f.responses.set(endpoints.team(OLD_TEAM), partial(header("Summer 2026", "Golden Retrievers")));
  f.responses.set(endpoints.teamRoster(OLD_TEAM), players());
  f.responses.set(endpoints.teamStats(OLD_TEAM), players());
  const found = await discoverHarborcenter({ ...f, seedPlayers: [2350393] });
  assert.deepEqual([...found.teams.keys()], [OLD_TEAM]);
  assert.equal(found.directoryComplete, false);
  assert.ok(f.warnings.some((warning) => warning.includes(endpoints.leagueSeasons())),
    "a usable historical refresh must still report incomplete season discovery");
  assert.ok(!f.requests.includes(endpoints.seasonTeams(NEW_SEASON)),
    "season ids are never guessed after the selector fails");
});

test("one failed season directory does not discard healthy directories or player history", async () => {
  const f = fixture();
  // Put the failed season first so the next directory must still be visited.
  f.responses.set(endpoints.leagueSeasons(), filters([
    { id: OLD_SEASON, name: "Summer 2026" }, { id: NEW_SEASON, name: NEW_LABEL },
  ]));
  f.responses.set(endpoints.seasonTeams(OLD_SEASON), null);
  f.responses.set(endpoints.player(2350393), career(OLD_TEAM));
  f.responses.set(endpoints.team(OLD_TEAM), partial(header("Summer 2026", "Golden Retrievers")));
  f.responses.set(endpoints.teamRoster(OLD_TEAM), players());
  f.responses.set(endpoints.teamStats(OLD_TEAM), players());
  const found = await discoverHarborcenter({ ...f, seedPlayers: [2350393] });
  assert.deepEqual(new Set(found.teams.keys()), new Set([NEW_TEAM, OLD_TEAM]));
  assert.equal(found.directoryComplete, false);
  assert.ok(f.warnings.some((warning) => warning.includes(endpoints.seasonTeams(OLD_SEASON))));
});

test("a failed new-team header does not prevent other directory teams or historical teams", async () => {
  const f = fixture();
  const historicalTeam = 121839;
  f.responses.set(endpoints.leagueSeasons(), filters([
    { id: NEW_SEASON, name: NEW_LABEL }, { id: OLD_SEASON, name: "Summer 2026" },
  ]));
  f.responses.set(endpoints.seasonTeams(OLD_SEASON), directory(card(OLD_TEAM, "Golden Retrievers")));
  f.responses.set(endpoints.team(NEW_TEAM), null);
  f.responses.set(endpoints.team(OLD_TEAM), partial(header("Summer 2026", "Golden Retrievers")));
  f.responses.set(endpoints.teamRoster(OLD_TEAM), players());
  f.responses.set(endpoints.teamStats(OLD_TEAM), players());
  f.responses.set(endpoints.player(2350393), career(historicalTeam));
  f.responses.set(endpoints.team(historicalTeam), partial(header("Summer 2021", "Golden Retrievers")));
  f.responses.set(endpoints.teamRoster(historicalTeam), players());
  f.responses.set(endpoints.teamStats(historicalTeam), players());
  const found = await discoverHarborcenter({ ...f, seedPlayers: [2350393] });
  assert.deepEqual(new Set(found.teams.keys()), new Set([OLD_TEAM, historicalTeam]));
  assert.equal(found.directoryComplete, false);
  assert.ok(f.warnings.some((warning) => warning.includes(endpoints.team(NEW_TEAM))));
  assert.ok(!f.requests.includes(endpoints.teamRoster(NEW_TEAM)),
    "an unconfirmed directory name must not authorize a roster crawl");
});

test("new roster identities are visited even when their careers do not link back to the new team", async () => {
  const f = fixture();
  f.responses.set(endpoints.teamRoster(NEW_TEAM), players(4000001, 4000002));
  f.responses.set(endpoints.teamStats(NEW_TEAM), null);
  f.responses.set(endpoints.player(4000001), career());
  f.responses.set(endpoints.player(4000002), null);
  const found = await discoverHarborcenter({ ...f, seedPlayers: [] });
  assert.deepEqual([...found.teams.keys()], [NEW_TEAM]);
  assert.equal(found.playersWalked, 2);
  assert.ok(f.requests.includes(endpoints.player(4000001)));
  assert.ok(f.requests.includes(endpoints.player(4000002)));
  assert.equal(f.warnings.length, 2);
});

test("player careers still recover historical teams absent from the current directory", async () => {
  const f = fixture();
  f.responses.set(endpoints.player(2350393), career(OLD_TEAM));
  f.responses.set(endpoints.team(OLD_TEAM), partial(header("Summer 2026", "Golden Retrievers")));
  f.responses.set(endpoints.teamRoster(OLD_TEAM), null);
  f.responses.set(endpoints.teamStats(OLD_TEAM), players(2406784));
  f.responses.set(endpoints.player(2406784), career(OLD_TEAM));
  const found = await discoverHarborcenter({ ...f, seedPlayers: [2350393] });
  assert.deepEqual([...found.teams.keys()], [NEW_TEAM, OLD_TEAM]);
  assert.equal(found.playersWalked, 2, "the statistics fallback still supplies historical players");
  assert.equal(found.directoryTeams, 1);
});

test("duplicate directory entries, roster/stat links, and cyclic careers are each fetched once", async () => {
  const f = fixture();
  f.responses.set(endpoints.leagueSeasons(), filters([
    { id: NEW_SEASON, name: NEW_LABEL }, { id: NEW_SEASON, name: NEW_LABEL },
  ]));
  f.responses.set(endpoints.seasonTeams(NEW_SEASON), directory(card(NEW_TEAM), card(NEW_TEAM)));
  f.responses.set(endpoints.teamRoster(NEW_TEAM), players(4000001, 4000001));
  f.responses.set(endpoints.teamStats(NEW_TEAM), players(4000001));
  f.responses.set(endpoints.player(4000001), career(NEW_TEAM, NEW_TEAM));
  const announced: number[] = [];
  const found = await discoverHarborcenter({
    ...f, seedPlayers: [4000001, 4000001], onTeam: (id) => announced.push(id),
  });
  assert.deepEqual(announced, [NEW_TEAM]);
  assert.equal(found.playersWalked, 1);
  assert.equal(found.teamsInspected, 1);
  assert.equal(new Set(f.requests).size, f.requests.length);
});

test("directory neighbours and a historical opponent mentioning the Retrievers are excluded", async () => {
  const f = fixture();
  f.responses.set(endpoints.seasonTeams(NEW_SEASON), directory(
    card(717322, "Buffalo Cigars"), card(NEW_TEAM), card(717319, "Golden Seals"),
  ));
  f.responses.set(endpoints.player(2350393), career(717322));
  f.responses.set(endpoints.team(717322), partial(header(NEW_LABEL, "Buffalo Cigars",
    `<div ng-init="ctrl.teams_by_division=[${escapeAttribute(JSON.stringify({
      id: 52206, name: "Silver Division", teams: [{ id: NEW_TEAM, name: "The Golden Retrievers" }],
    }))}]"></div>`)));
  const found = await discoverHarborcenter({ ...f, seedPlayers: [2350393] });
  assert.deepEqual([...found.teams.keys()], [NEW_TEAM]);
  assert.equal(found.teamsInspected, 2);
  assert.ok(!f.requests.includes(endpoints.team(717319)), "directory neighbours need no team capture");
  assert.ok(!f.requests.includes(endpoints.teamRoster(717322)), "opponent's sibling list is not its identity");
});

test("directory failures remain fatal when no team can be independently confirmed", async (t) => {
  const cases: [string, string, string | null, RegExp][] = [
    ["failed league filters", endpoints.leagueSeasons(), null, /could not read/],
    ["invalid filter JSON", endpoints.leagueSeasons(), "<html>Unavailable</html>", /could not read/],
    ["missing season selector", endpoints.leagueSeasons(), "{}", /missing season.options/],
    ["empty season selector", endpoints.leagueSeasons(), filters([]), /missing season.options/],
    ["unrelated league", endpoints.leagueSeasons(), JSON.stringify({ season: {
      options: [{ id: NEW_SEASON, name: NEW_LABEL, league_id: 9999 }],
    } }), /invalid or unrelated season/],
    ["failed team directory", endpoints.seasonTeams(NEW_SEASON), null, /could not read/],
    ["missing directory HTML", endpoints.seasonTeams(NEW_SEASON), "{}", /no HTML content/],
    ["changed directory markup", endpoints.seasonTeams(NEW_SEASON), partial("<p>New layout</p>"), /no team cards/],
    ["card without team links", endpoints.seasonTeams(NEW_SEASON), directory(
      '<div class="team"><div class="team-name">The Golden Retrievers</div></div>',
    ), /unreadable team card/],
    ["card with conflicting team ids", endpoints.seasonTeams(NEW_SEASON), directory(
      card(NEW_TEAM).replace(`/team/${NEW_TEAM}/stats`, `/team/${OLD_TEAM}/stats`),
    ), /unreadable team card/],
    ["no club in directory", endpoints.seasonTeams(NEW_SEASON), directory(card(717319, "Golden Seals")),
      /contain no Golden Retrievers team/],
  ];
  for (const [name, url, response, error] of cases) {
    await t.test(name, async () => {
      const f = fixture();
      f.responses.set(url, response);
      await assert.rejects(() => discoverHarborcenter({ ...f, seedPlayers: [] }), error);
    });
  }
});

test("a matching directory card requires confirmation from the team's own header", async (t) => {
  for (const [name, response] of [
    ["failed header request", null],
    ["missing header", partial("<p>The Golden Retrievers</p>")],
    ["opponent header", partial(header(NEW_LABEL, "Buffalo Cigars"))],
  ] as const) {
    await t.test(name, async () => {
      const f = fixture();
      f.responses.set(endpoints.team(NEW_TEAM), response);
      await assert.rejects(() => discoverHarborcenter({ ...f, seedPlayers: [] }),
        /could not read|could not be confirmed/);
    });
  }
});
