/**
 * HarborCenter's live stats platform: HockeyShift, on the DigitalShift API.
 *
 * Reverse-engineered 2026-07-15 by observing the SPA's own network calls.
 * Two things here are counter-intuitive and cost real time to discover, so
 * they are documented rather than left to be rediscovered:
 *
 * 1. `stats.api.digitalshift.ca` — advertised in the site's own
 *    `window.config` as `stats_api_url` — is a RED HERRING. The SPA never
 *    calls it, and it rejects the site's own ticket with
 *    `invalid_ticket_service`. All stats traffic goes to the WEB api under a
 *    `/partials/stats/` prefix.
 * 2. The ticket is DETERMINISTIC per `client_service_id`, not per session:
 *    two independent logins return byte-identical tickets. It is an
 *    anonymous token every visitor mints, not a credential.
 */

/** HarborCenter's service id, from `window.config` on /stats. */
export const HARBORCENTER_CLIENT_SERVICE_ID = "d21c1c19-b175-4199-bd01-52fc0deebe52";

const WEB_API = "https://web.api.digitalshift.ca";

/** Seneca HAHL — the Golden Retrievers' league at HarborCenter. */
export const HAHL_LEAGUE_ID = 1367;

/**
 * Mint an anonymous guest ticket.
 *
 * This is NOT authentication in the credentials sense: the token is issued to
 * any anonymous caller by design and grants only what a visitor to the public
 * stats page already sees. Callers must pass it as `CaptureOpts.authorization`
 * (which deliberately does not set `authenticated`), never as a session cookie.
 */
export async function guestTicket(
  fetchFn: typeof fetch = fetch,
  clientServiceId: string = HARBORCENTER_CLIENT_SERVICE_ID,
): Promise<string> {
  const res = await fetchFn(`${WEB_API}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_service_id: clientServiceId }),
  });
  if (!res.ok) {
    throw new Error(`digitalshift: login failed with status ${res.status}`);
  }
  const body = (await res.json()) as { ticket?: { hash?: string } };
  const hash = body.ticket?.hash;
  if (!hash) {
    // Fail loud: a missing ticket must never degrade into unauthenticated
    // requests that all 401 and look like "this data does not exist".
    throw new Error(
      `digitalshift: login returned no ticket hash: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return hash;
}

/** The `Authorization` header value for a ticket. */
export function authHeader(ticket: string): string {
  return `ticket="${ticket}"`;
}

/**
 * URL for a stats partial.
 *
 * Note the endpoints are nested under `team/`, not siblings of it:
 * `team/stats`, not `stats`. Guessing the flat shape returns 404.
 */
export function partialUrl(endpoint: string, params: Record<string, string | number>): string {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );
  return `${WEB_API}/partials/stats/${endpoint}?${qs}`;
}

export const endpoints = {
  /** Team header: name, division, session label, sibling teams. */
  team: (teamId: number) => partialUrl("team", { team_id: teamId }),
  /** Full roster with positions and season stats. */
  teamStats: (teamId: number) => partialUrl("team/stats", { team_id: teamId }),
  /**
   * A player's ENTIRE career across every session, plus game-by-game logs.
   *
   * HarborCenter has persistent player identity — unlike SportsEngine, where
   * a player has a different id every season and no career page exists. One
   * call here yields the full season list and every per-session team id.
   */
  player: (playerId: number) => partialUrl("player", { player_id: playerId }),
  /**
   * EVERY GAME A TEAM PLAYED, with its `game_id`. The enumeration route.
   *
   * How game ids are listed was the open question that blocked this whole era,
   * and every obvious guess is a dead end: `schedule/games`, `games` and
   * `team/games` are 404, while `team/schedule?team_id=N` and
   * `schedule?league_id=N` return 200 and are ANGULAR SHELLS — a toolbar and a
   * season dropdown, no data. The shell is not the answer; it names it. Inside
   * `team/schedule` sits
   *
   *   data-infinite-scroll="partials/stats/schedule/table"
   *   data-options="{"type":null,"order":"datetime","all":null,"team_id":"681628"}"
   *
   * so the data table is a SIBLING route, `schedule/table`, and `data-options`
   * is the parameter list, written out. Found by pointing the repo's own
   * Playwright recon harness (recon/harborcenter-observe.ts) at the schedule
   * route and reading the calls the SPA made — the same method that found the
   * ticket flow.
   *
   * `all=true` IS LOAD-BEARING. Without it the route answers with UPCOMING
   * games only: four rows for Summer 2026, all "Not Started", and not one game
   * that has actually been played. A capture built on the default would have
   * enumerated nothing and looked like it worked.
   *
   * NOT PAGINATED, despite the infinite-scroll directive: `offset`, `limit`,
   * `per_page` and `page` are all ignored and the complete set comes back in
   * one response. Verified against the longest season (Fall/Winter 2024-25,
   * 25 games) — `offset=25` returns the same 25 rows starting at the same
   * date, so the 25 is the season, not a cap. Corroborated independently:
   * every session's row count is >= its highest player games-played figure
   * already in the corpus, and Summer 2026's five finished games match its
   * top games-played of five exactly.
   */
  teamSchedule: (teamId: number) =>
    partialUrl("schedule/table", { team_id: teamId, all: "true", header: "false" }),
  /**
   * A game's complete scoring summary: every goal, its ordered assists, its
   * strength state, and the penalties.
   *
   * `game?game_id=N` is the HEADER only — teams, date, rink, no tables. The
   * tables are here. `game/plays`, `game/scoring`, `game/summary`, `game/stats`
   * and `game/roster` are all 404; this is the one.
   */
  gameBoxscore: (gameId: number) => partialUrl("game/boxscore", { game_id: gameId }),
  /**
   * THE LEAGUE-WIDE SCORING LEADERBOARD for one season — every player, ranked.
   *
   * This is where a Retriever's standing "relative to the league" comes from,
   * and it is the modern era's answer to the SportsEngine `league_instance`
   * tables. Reverse-engineered 2026-07-18 the same way the schedule route was:
   * the SPA route `#/1367/leaders/...` mounts `partials/stats/leaders`, an
   * Angular SHELL that nests `<partial slug="stats/leaders/{{view}}">` where
   * view is `table`. So the DATA route is `leaders/table`, and every visible
   * ranking on the official site is one call to it.
   *
   * FOUR PARAMS ARE LOAD-BEARING, and the API is unforgiving about them:
   *   - `game_type` ("Regular Season" | "Playoffs") is REQUIRED. Omit it and
   *     the response is a 400 naming the field.
   *   - `player_type` ("players" | "goalies") is REQUIRED. It is `player_type`,
   *     NOT `type` — `type=players` returns a 500 "Internal database error",
   *     one of several plausible spellings the API answers with a stack rather
   *     than a hint.
   *   - `season_id` selects the season. Omitted, the route answers the ALL-TIME
   *     leaders, which is a different and much larger claim.
   *   - `division_id` is optional and changes what "ranked" MEANS. Without it
   *     the table is league-wide across every division, so it is dominated by
   *     the top tier and a Silver-division team barely appears. WITH it the API
   *     re-ranks within that division and numbers the rows 1..N — which is the
   *     ranking that matters for a team that plays Silver or Bronze. Both are
   *     captured: a league-wide top-ten is rarer and worth more when it happens,
   *     a divisional top-ten is where most of this team's finishes actually are.
   *
   * The table is sorted by points, carries an explicit `Rk` column, and — like
   * every scrollable table on this platform — is RENDERED TWICE, the second an
   * `aria-hidden` responsive clone. The parser dedupes on player id; see
   * `parse/src/digitalshift/leaders.ts`.
   *
   * SORTING IS CLIENT-SIDE, PAGING IS SERVER-SIDE. The column headers carry
   * `orderBy('goals')` etc., but no request parameter re-sorts the response —
   * the SPA sorts the rows it already has in the browser. The table always
   * comes back sorted by points. So a standing in GOALS, ASSISTS or PENALTY
   * MINUTES is not something the API will rank for you; it is computed off the
   * WHOLE FIELD, which is why every page is fetched. `page` is 100 rows and is
   * the only working pager (`limit`, `offset`, `per_page`, `all` are ignored).
   * Past the last real page the API WRAPS — an out-of-range page repeats page
   * one rather than returning empty — so the caller stops when a page adds no
   * new player, not when a page is blank.
   */
  leaders: (opts: {
    leagueId: number;
    seasonId: number;
    gameType: "Regular Season" | "Playoffs";
    playerType: "players" | "goalies";
    divisionId?: number;
    /** 1-based page of 100. Omit for page 1 (keeps that URL stable). */
    page?: number;
  }) =>
    partialUrl("leaders/table", {
      league_id: opts.leagueId,
      season_id: opts.seasonId,
      game_type: opts.gameType,
      player_type: opts.playerType,
      ...(opts.divisionId ? { division_id: opts.divisionId } : {}),
      ...(opts.page && opts.page > 1 ? { page: opts.page } : {}),
    }),
};

/**
 * One row of `schedule/table` — a game, as the league's own schedule has it.
 *
 * Only the fields this project reads are typed. The response carries ~50 per
 * row (logo urls in four sizes, `created_by_id`, `tickets_url`); typing them
 * would be transcription, not documentation.
 */
export type ScheduleRow = {
  /** "2026-07-13". ISO already — no month-name parsing needed here. */
  date: string;
  /** "22:40", 24-hour. */
  time: string | null;
  gameId: number;
  seasonId: number;
  homeTeamId: number;
  homeTeam: string;
  awayTeamId: number;
  awayTeam: string;
  /**
   * Final score. Null when the game has not been played: the API reports 0-0
   * for a game that has not happened, and 0-0 is a recorded tie (§2.4).
   *
   * The row also carries `home_shots`/`away_shots`, DELIBERATELY not typed
   * here. They are not shots. Across all 193 games of the eleven sessions they
   * are exactly equal to the score in 176 — and in the other 17 they are 0-0
   * beside a real score, which is not a coincidence: those 17 are precisely the
   * games whose boxscore has no scoring summary. The field is the goal rows
   * counted up and relabelled, so where there are no goal rows it is nought and
   * where there are it is the score. It has never been a count of shots.
   *
   * The same lie the SportsEngine sheets tell in their column headed "Sh" (see
   * `GoalieLine.shotsLabelled`). This league does not record shots; surfacing
   * these would put a fabricated statistic on the site.
   */
  homeScore: number | null;
  awayScore: number | null;
  /** "Final" | "Not Started". The ONLY thing that separates a real 0-0. */
  status: string;
  /** "Regular Season" | "Playoffs". The league states this outright. */
  gameType: string;
  overtime: boolean;
  shootout: boolean;
  rink: string | null;
  facility: string | null;
};

/** Decode the entities an ng-init attribute uses. `&amp;` LAST (see html.ts). */
const decodeAttr = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * The games on a `schedule/table` response.
 *
 * The rows are NOT scraped out of the rendered table — they are lifted whole
 * from the JSON the partial hands Angular to render it with:
 *
 *   <tbody ng-init="ctrl.schedule=[{&quot;date&quot;:&quot;2026-07-16&quot;,...}]">
 *
 * Every value inside is `&quot;`-encoded, so the attribute's own closing quote
 * is the first literal `"` after the `=` and `[^"]*` delimits it exactly.
 *
 * Returns [] when the attribute is absent — a team with no schedule, or a
 * response shape that changed. The caller reports that; it must never read as
 * "this team played no games".
 */
export function scheduleRows(content: string): ScheduleRow[] {
  const m = content.match(/ng-init="ctrl\.schedule=([^"]*)"/);
  if (!m) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(decodeAttr(m[1]!));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: ScheduleRow[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const gameId = Number(r.game_id);
    if (!Number.isFinite(gameId) || gameId === 0) continue;
    const played = String(r.status ?? "") === "Final";
    // A game that has not been played reports 0-0. Recording that as a scoreless
    // draw invents a result for a game nobody has skated yet — four of them in
    // Summer 2026 alone, on the schedule right now.
    const score = (v: unknown) => (played && v !== null && v !== undefined ? Number(v) : null);
    out.push({
      date: String(r.date ?? ""),
      time: (r.time as string) || null,
      gameId,
      seasonId: Number(r.season_id),
      homeTeamId: Number(r.home_team_id),
      homeTeam: String(r.home_team ?? ""),
      awayTeamId: Number(r.away_team_id),
      awayTeam: String(r.away_team ?? ""),
      homeScore: score(r.home_score),
      awayScore: score(r.away_score),
      status: String(r.status ?? ""),
      gameType: String(r.game_type ?? ""),
      overtime: r.overtime === true,
      shootout: r.shootout === true,
      rink: (r.rink as string) || null,
      facility: (r.facility as string) || null,
    });
  }
  return out;
}

/** Response envelope: an Angular HTML partial, with data also in ng-init JSON. */
export type Partial = { content: string };

/**
 * A team partial's OWN identity, from its `<h1 class="sr-only">`:
 *   "The Golden Retrievers, Summer 2026, Silver" -> name / session / division
 *
 * Returns null when the header is absent.
 */
export function teamIdentity(
  content: string,
): { name: string; session: string; division: string } | null {
  const h1 = content.match(/<h1 class="sr-only">\s*([^<]+?)\s*<\/h1>/)?.[1];
  if (!h1) return null;
  const parts = h1.split(",").map((s) => s.trim());
  return {
    name: parts[0] ?? "",
    session: parts[1] ?? "",
    division: parts[2] ?? "",
  };
}

/**
 * Is this team partial the Golden Retrievers?
 *
 * MUST test the team's OWN name, never the whole document: a team partial
 * embeds `teams_by_division` listing every sibling team in the division, so
 * searching the raw content matches ANY team that merely shares a division
 * with the Retrievers. That bug labelled Classic Cue's Billiards, Burners,
 * 716 Realty Group and Wurlitzer Blues as Retrievers teams.
 *
 * Accepts both live variants: "Golden Retrievers" and "The Golden
 * Retrievers" alternate across consecutive sessions and are the same team.
 */
export function isRetrievers(content: string): boolean {
  const id = teamIdentity(content);
  if (!id) return false;
  return /^(the\s+)?golden\s+retrievers$/i.test(id.name.trim());
}

/**
 * Every division in this team's SEASON, each with its teams, from the team
 * partial's own `ng-init="ctrl.teams_by_division=[...]"`.
 *
 * The whole season's division structure is embedded here, not just the team's
 * own division — Premier, Silver, Bronze A/B/C, Weekend — so the caller can
 * look up the id of the division a given team belongs to. That id is what the
 * leaders route needs to re-rank scoring WITHIN a division, which for a team
 * that plays a lower tier is the ranking that means something.
 *
 * The values are `&quot;`-encoded inside the attribute, exactly as the schedule
 * rows are, and decoded the same way. Returns [] when the attribute is absent
 * rather than guessing — a caller that gets nothing captures league-wide only.
 */
export function teamsByDivision(
  content: string,
): { id: number; name: string; teams: { id: number; name: string }[] }[] {
  const m = content.match(/ng-init="ctrl\.teams_by_division\s*=\s*([^"]*)"/);
  if (!m) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(decodeAttr(m[1]!));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: { id: number; name: string; teams: { id: number; name: string }[] }[] = [];
  for (const d of raw as Record<string, unknown>[]) {
    const id = Number(d.id);
    if (!Number.isFinite(id)) continue;
    const teams = Array.isArray(d.teams)
      ? (d.teams as Record<string, unknown>[])
          .map((t) => ({ id: Number(t.id), name: String(t.name ?? "") }))
          .filter((t) => Number.isFinite(t.id))
      : [];
    out.push({ id, name: String(d.name ?? ""), teams });
  }
  return out;
}

/** Extract every `#/player/<id>` referenced by a partial's markup. */
export function playerIdsIn(content: string): number[] {
  const ids = new Set<number>();
  for (const m of content.matchAll(/#\/player\/(\d+)/g)) ids.add(Number(m[1]));
  return [...ids].sort((a, b) => a - b);
}

/** Extract every `#/<league>/team/<id>` referenced by a partial's markup. */
export function teamIdsIn(content: string): number[] {
  const ids = new Set<number>();
  for (const m of content.matchAll(/\/team\/(\d+)/g)) ids.add(Number(m[1]));
  return [...ids].sort((a, b) => a - b);
}
