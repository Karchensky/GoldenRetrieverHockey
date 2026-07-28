/**
 * SportsEngine / NGIN — the platform behind Erie Metro, Performax, Holiday &
 * Leisure Rinks, and HarborCenter's pre-2021 era. One adapter, four sources.
 *
 * Two properties of this platform drive the whole design and are easy to get
 * wrong:
 *
 * 1. **No persistent player identity.** `roster_players/<id>` identifies a
 *    player ON A TEAM IN A SEASON — a different id every season, with no
 *    career page. You cannot follow a person through the site (contrast
 *    HarborCenter's HockeyShift era, which does have career pages). Identity
 *    must be reconstructed by us, downstream.
 * 2. **Team names live only in HTML attributes.** The visible text of a team
 *    link is the ABBREVIATION — the Golden Retrievers render as "83". The
 *    name is in `title` / `sorttable_customkey` / the href slug. A parser
 *    reading visible text records this team as "83" and never knows what it
 *    found.
 */

/** A season key on this platform is a (league_instance, subseason) PAIR. */
export type SeasonKey = { leagueInstance: number; subseason: number };

/**
 * One Golden Retrievers season on a SportsEngine site.
 *
 * `pageId` is the team's `page/show/<id>-golden-retrievers` id; `teamInstance`
 * is its per-season stats id. They are DIFFERENT numbers for the same team in
 * the same season — a persistent trap.
 */
export type TeamSeason = {
  host: string;
  label: string;
  pageId: number;
  teamInstance: number;
};

const q = (host: string, path: string) => `https://${host}${path}`;

export const urls = {
  page: (t: TeamSeason) => q(t.host, `/page/show/${t.pageId}-golden-retrievers`),
  roster: (t: TeamSeason) => q(t.host, `/roster/show/${t.pageId}`),
  standings: (t: TeamSeason) => q(t.host, `/standings/show/${t.pageId}`),
  schedule: (t: TeamSeason) => q(t.host, `/schedule/team_instance/${t.teamInstance}`),
  /**
   * Team stats. `tab=team_instance_player_stats` is required — without it the
   * page renders a different tab and the roster table is absent.
   */
  teamStats: (t: TeamSeason) =>
    q(t.host, `/stats/team_instance/${t.teamInstance}?tab=team_instance_player_stats`),
  rosterPlayer: (host: string, id: number) => q(host, `/roster_players/${id}`),
  gameSheet: (host: string, id: number) => q(host, `/game/game_sheet/${id}`),
};

const ids = (html: string, re: RegExp): number[] => {
  const out = new Set<number>();
  for (const m of html.matchAll(re)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
};

/** `roster_players/<id>` — a player-on-a-team-in-a-season, not a person. */
export const rosterPlayerIds = (html: string) => ids(html, /roster_players\/(\d+)/g);

/** `game/game_sheet/<id>` — a full scoring summary. */
export const gameSheetIds = (html: string) => ids(html, /game\/game_sheet\/(\d+)/g);

/**
 * `game/show/<id>` — the game ids on a team's SCHEDULE page.
 *
 * A schedule links `/game/show/<id>`; it never links `/game/game_sheet/<id>`,
 * so scanning a schedule for game-sheet links finds nothing. Verified: the
 * SAME id addresses both views — `game/show/19077176` and
 * `game/game_sheet/19077176` are the same game — so a schedule's show ids can
 * be turned straight into game-sheet URLs with no extra request.
 */
export const gameShowIds = (html: string) => ids(html, /game\/show\/(\d+)/g);

/** `team_instance/<id>` — a team in one season. */
export const teamInstanceIds = (html: string) => ids(html, /team_instance\/(\d+)/g);

/**
 * The team names on a page, read from the ATTRIBUTES where they actually live.
 *
 * Reading visible text instead yields the abbreviation ("83" for the Golden
 * Retrievers), which is why this exists.
 */
export function teamNames(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/sorttable_customkey="([^"]+)"/g)) out.add(m[1]!);
  for (const m of html.matchAll(/<a[^>]*class="teamName"[^>]*title="([^"]+)"/g)) out.add(m[1]!);
  return [...out].sort();
}

/**
 * Does a page's own title identify a Golden Retrievers page?
 *
 * Titles look like "Golden Retrievers - 2017-18 Regular Season - Statistics".
 * Tests the title, not the body: a league-wide page mentions every team, so a
 * body test would match any page the Retrievers merely appear on.
 */
export function isRetrieversPage(html: string): boolean {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  return /^\s*(the\s+)?golden\s+retrievers\s*-/i.test(title);
}

/**
 * The season label from a page title, e.g. "2017-18 Regular Season".
 *
 * NOTE the season itself contains a hyphen ("2019-20"), so the parts must be
 * split on " - " rather than matched with a hyphen-excluding character class.
 * Getting this wrong silently drops every season.
 */
export function seasonFromTitle(html: string): string | null {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const parts = title.split(" - ").map((s) => s.trim());
  return parts[1] ?? null;
}
