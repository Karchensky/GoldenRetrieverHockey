import {
  endpoints, leagueSeasons, seasonTeams, isRetrieversName, isRetrievers,
  teamIdentity, teamIdsIn, playerIdsIn,
} from "./digitalshift.ts";

type DiscoveryOptions = {
  /** Capture and return the raw JSON response; null means the fetch failed. */
  grab: (url: string) => Promise<string | null>;
  seedPlayers: readonly number[];
  onTeam?: (teamId: number, label: string) => void;
  onWarning?: (message: string) => void;
};

/**
 * Team ids and player ids can both be recreated by the league. Search every
 * published season for the club's name first, then follow players for history.
 * Neither an empty preseason roster nor retired career ids can prevent the
 * directory's teams from reaching the schedule capture that follows this walk.
 */
export async function discoverHarborcenter({ grab, seedPlayers, onTeam, onWarning }: DiscoveryOptions) {
  let calls = 0;
  const json = async (url: string, required = false): Promise<unknown> => {
    calls++;
    const raw = await grab(url);
    if (raw !== null) {
      try { return JSON.parse(raw) as unknown; } catch { /* Report below. */ }
    }
    const message = `HarborCenter discovery could not read ${url}`;
    if (required) throw new Error(message);
    onWarning?.(message);
    return null;
  };
  const partial = async (url: string, required = false): Promise<string | null> => {
    const body = await json(url, required) as { content?: unknown } | null;
    if (typeof body?.content === "string") return body.content;
    const message = `HarborCenter discovery found no HTML content at ${url}`;
    if (required) throw new Error(message);
    if (body !== null) onWarning?.(message);
    return null;
  };

  // A directory outage must not disable the established career walk. Keep
  // every independently confirmed team and report which discovery was missed.
  const directoryErrors: string[] = [];
  const directoryWarning = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    directoryErrors.push(message);
    onWarning?.(`Team directory incomplete: ${message}`);
  };
  let seasons: ReturnType<typeof leagueSeasons> = [];
  try {
    seasons = leagueSeasons(await json(endpoints.leagueSeasons(), true));
  } catch (error) {
    directoryWarning(error);
  }
  const directory = new Set<number>();
  for (const season of seasons) {
    try {
      const content = await partial(endpoints.seasonTeams(season.id), true);
      for (const team of seasonTeams(content!)) {
        if (isRetrieversName(team.name)) directory.add(team.id);
      }
    } catch (error) {
      directoryWarning(error);
    }
  }
  if (directory.size === 0) {
    directoryWarning("HarborCenter season directories contain no Golden Retrievers team; check discovery and the club's name.");
  }

  const playerQueue = [...new Set(seedPlayers)];
  const seenPlayers = new Set<number>();
  const seenTeams = new Set<number>();
  const teams = new Map<number, string>();
  const inspectTeam = async (teamId: number, fromDirectory = false) => {
    if (seenTeams.has(teamId)) return;
    seenTeams.add(teamId);
    const content = await partial(endpoints.team(teamId), fromDirectory);
    if (!content || !isRetrievers(content)) {
      if (fromDirectory) throw new Error(`HarborCenter directory team ${teamId} could not be confirmed as the Golden Retrievers.`);
      return;
    }
    const id = teamIdentity(content)!;
    const label = `${id.name}, ${id.session}, ${id.division}`;
    teams.set(teamId, label);
    onTeam?.(teamId, label);
    // The roster exists before stats. Either page can supply fresh player ids;
    // empty stats or a failed career page must not cut the other path off.
    for (const url of [endpoints.teamRoster(teamId), endpoints.teamStats(teamId)]) {
      const roster = await partial(url);
      if (roster === null) continue;
      for (const playerId of playerIdsIn(roster)) {
        if (!seenPlayers.has(playerId)) playerQueue.push(playerId);
      }
    }
  };

  for (const teamId of directory) {
    try {
      await inspectTeam(teamId, true);
    } catch (error) {
      directoryWarning(error);
    }
  }
  while (playerQueue.length > 0) {
    const playerId = playerQueue.shift()!;
    if (seenPlayers.has(playerId)) continue;
    seenPlayers.add(playerId);
    const content = await partial(endpoints.player(playerId));
    if (content === null) continue;
    for (const teamId of teamIdsIn(content)) await inspectTeam(teamId);
  }
  if (teams.size === 0) {
    throw new Error(`HarborCenter discovery confirmed no Golden Retrievers teams. ${directoryErrors.join(" ")}`);
  }
  return {
    teams, calls, playersWalked: seenPlayers.size, teamsInspected: seenTeams.size,
    seasonsSearched: seasons.length, directoryTeams: directory.size,
    directoryComplete: directoryErrors.length === 0,
  };
}
