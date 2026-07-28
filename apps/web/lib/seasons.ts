import type { RecapGame, Session, Trophy } from "../../../packages/build/src/types";
import { data, players, recaps, sessions, trophies } from "./data";
import { divisionName, leagueRecord, record } from "./format";
import { ROLLUPS, SPINE, slotLabel } from "./stats";

/* A league half is addressable by arithmetic: 2015 is a summer, 2015.5 the
   winter after it. A tournament is not. It sorts a quarter-step past the half
   it was played in, so "floor the year, and call anything fractional a winter"
   files the 2015 invitational at 2014.75 under `2014-winter` — the slug the
   winter half at 2014.5 already owns. Two sessions, one URL, and the tournament
   is the one that loses: its page is generated over and never reachable.

   So tournaments are named rather than computed. League halves keep the
   arithmetic.

   THE NAME IS NOT ENOUGH, and the same collision came back through it. The club
   played the Greater Buffalo Invitational three years running, and a slug off
   `session.tournament` is that one string three times: one page built three
   times over, `sortFromSeasonSlug` handing every request the first of them, and
   the 2015 and 2016 events unreachable — with the trophies they won pointing at
   the 2014 one. The SESSION ID carries the year ("2014 - Greater Buffalo
   Invitational"), which is exactly what tells the three apart. */
const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const TOURNAMENT_SLUGS: ReadonlyMap<number, string> = new Map(
  sessions.flatMap((session) =>
    session.tournament ? [[session.sort, slugify(session.id)] as const] : [],
  ),
);

export const seasonSlug = (sort: number): string =>
  TOURNAMENT_SLUGS.get(sort) ?? `${Math.floor(sort)}-${Number.isInteger(sort) ? "summer" : "winter"}`;

export const seasonHref = (sort: number): string => `/seasons/${seasonSlug(sort)}`;

export function sortFromSeasonSlug(slug: string): number | null {
  for (const [sort, name] of TOURNAMENT_SLUGS) if (name === slug) return sort;
  const match = slug.match(/^(\d{4})-(summer|winter)$/);
  if (!match) return null;
  const year = Number(match[1]);
  return year + (match[2] === "winter" ? 0.5 : 0);
}

export const sessionAt = (sort: number): Session | undefined =>
  sessions.find((session) => session.sort === sort);

export const seasonHrefForId = (sessionId: string): string | null => {
  const session = sessions.find((item) => item.id === sessionId);
  return session ? seasonHref(session.sort) : null;
};

export const seasonGames = (sort: number) =>
  data.games.filter((game) => game.sessionSort === sort);

/**
 * THE NUMBER HE PLAYED THE SEASON IN.
 *
 * A session can carry two lines for one player, and the lineup tables were
 * taking the LAST of them in corpus order. Adam Kaplewicz has two 2017 - Winter
 * lines — #96 over 23 games and 67 points, and #26 over one game and none — so
 * the season's leading scorer was labelled "26" on the rail while the franchise
 * board, the career timelines, the player index and his own page all said 96.
 * The line carrying the games is the one he played, which is the same tie-break
 * `jerseys[0]` already lands on everywhere else.
 *
 * A jersey is a STRING and one of them is "0", so it is tested for null.
 */
export const jerseyOf = (
  lines: readonly { jersey: string | null; gp: number | null }[],
): string | null =>
  [...lines]
    .filter((line) => line.jersey !== null)
    .sort((a, b) => (b.gp ?? -1) - (a.gp ?? -1))[0]?.jersey ?? null;

export const seasonPlayers = (sessionId: string) =>
  players
    .map((player) => ({
      player,
      lines: player.seasons.filter((line) => line.session === sessionId),
    }))
    .filter((entry) => entry.lines.length > 0);

/* A tournament's session id leads with the year it was played ("2015 - Greater
   Buffalo Invitational"), which is the only place that year is stated: the sort
   deliberately sits in the previous half so the event lands after the season it
   capped. Fall back to the sort if a future tournament id ever breaks the shape. */
const tournamentYear = (session: Session, sort: number): number =>
  Number(session.id.match(/^(\d{4})/)?.[1]) || Math.floor(sort);

/** The tournaments on file, each under the year it was played. Read out of the
 *  sessions, never listed here — the next one recovered places itself. */
const TOURNAMENTS: readonly { sort: number; year: number; name: string }[] = sessions.flatMap(
  (session) =>
    session.tournament
      ? [{ sort: session.sort, year: tournamentYear(session, session.sort), name: session.tournament }]
      : [],
);

const letters = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, "");

/** "gbi", from "Greater Buffalo Invitational". */
const initialsOf = (name: string): string => (name.match(/\b[a-z]/gi) ?? []).join("").toLowerCase();

const subsequence = (inner: string, outer: string): boolean => {
  let i = 0;
  for (const character of outer) if (character === inner[i]) i++;
  return i === inner.length;
};

/**
 * Does this trophy name that tournament?
 *
 * Three ways it can, and the archive holds an example of two of them. The
 * competition is written down under whatever short form the person filling in
 * the trophy case used, so the test is against its INITIALS: "GB" drops the
 * Invitational, "GBHI" adds the Hockey the session's own name leaves out, and
 * both keep G, B and I in order. One form has to sit inside the other, and
 * they have to start on the same letter — which is what keeps the PxHL and
 * LSHL titles of the same years where they are.
 */
const namesTournament = (trophy: Trophy, tournament: string): boolean => {
  const said = `${trophy.league} ${trophy.title}`;
  if (said.toLowerCase().includes(tournament.toLowerCase())) return true;
  if (/\btournaments?\b/i.test(trophy.title)) return true;
  const abbreviation = letters(trophy.league);
  const initials = initialsOf(tournament);
  if (abbreviation.length < 2 || initials.length < 2) return false;
  if (abbreviation[0] !== initials[0]) return false;
  return subsequence(abbreviation, initials) || subsequence(initials, abbreviation);
};

/**
 * Which session a trophy belongs to.
 *
 * "2012/13" states its own half and needs no help. A BARE YEAR is the trap:
 * arithmetic reads it as that year's summer, and for seven of the ten trophies
 * on file that is right. It is wrong for a tournament, which sorts a quarter-
 * step BEFORE the half it was played in — so a Greater Buffalo Invitational won
 * in April 2014 was landing on 2014 - Summer, a season it has nothing to do
 * with, and the summer's own page claimed a trophy it never won.
 *
 * So a bare year has two candidates and the trophy decides between them by what
 * it says. 2015 is the year that proves both halves of the rule are needed: it
 * holds an invitational win AND a PxHL summer title, and only one of them moves.
 */
const trophySort = (trophy: Trophy): number | null => {
  const span = trophy.year.match(/^(\d{4})\/(\d{2})$/);
  if (span) return Number(span[1]) + 0.5;
  const year = Number(trophy.year.match(/^\d{4}/)?.[0]);
  if (!Number.isFinite(year)) return null;
  const tournament = /^\d{4}$/.test(trophy.year)
    ? TOURNAMENTS.find((item) => item.year === year && namesTournament(trophy, item.name))
    : undefined;
  return tournament ? tournament.sort : year;
};

/**
 * What an honour is filed under — the `year` field, which for a league half has
 * always been the half's own name.
 *
 * A tournament cannot use that. `slotLabel` is a function of the sort alone and
 * a tournament sorts a quarter-step below the half it was played in, so the
 * 2014 invitational at 2013.75 comes out "2013 - Winter": the wrong session,
 * and one with a page of its own. The session states its own year, and the year
 * is all this needs to say — it is what tells three invitationals apart, on the
 * one line the column has, without setting the tournament's name a third time
 * on a page whose heading is already the tournament's name.
 */
const honorYear = (sort: number): string => {
  const session = sessionAt(sort);
  return session?.tournament ? String(tournamentYear(session, sort)) : slotLabel(sort);
};

export type ArchiveHonor = Trophy & {
  sort: number;
  /** A result established by the playoff schedule rather than trophy-case copy. */
  scheduleEstablished?: boolean;
};

const recordedHonors: ArchiveHonor[] = trophies.flatMap((trophy) => {
  const sort = trophySort(trophy);
  return sort === null ? [] : [{ ...trophy, year: honorYear(sort), sort }];
});

/* Neither HarborCenter nor Erie Metro publishes a trophy-case field. Both
   publish playoff games, and four winter sessions have the championship-series
   shape the captain identified: two playoff wins followed by the final lost.

   THE PROVENANCE TEST IS GONE. It read `/HarborCenter/i` against the session's
   label, which credited 2024 and 2025 and silently dropped 2016-17 and 2017-18
   — the second of which went 22–7, the best regular season in the file, won a
   semi-final 13–0 and lost the championship in three. The rule is about the
   shape of a playoff schedule and a schedule is equally trustworthy from Erie
   Metro; the provenance was carrying a hand-maintained list of years in
   disguise. What the honour is FILED UNDER is the session's own source, so the
   line under it is the thing the result was read off rather than a league name
   typed in here. */
const scheduleHonors: ArchiveHonor[] = sessions.flatMap((session) => {
  if (session.half !== "fall-winter") return [];
  const playoffs = seasonGames(session.sort)
    .filter((game) => game.round !== null && game.result !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const wins = playoffs.filter((game) => game.result === "W").length;
  const reachedFinal = playoffs.length >= 4 && wins >= 2 && playoffs.at(-1)?.result === "L";
  /* WON THE DIVISION AND LOST THE FINAL ARE BOTH TRUE, AND THIS TESTED FOR THE
     WRONG THING. It suppressed a schedule-derived Runner-Up whenever ANY honour
     was already on file for that session — so the moment the 2016-17 Adams
     Division title was ingested, the runner-up the playoff schedule proves went
     quietly off the page. A team can top the table over a season and lose the
     game that ends it; that is not a contradiction, it is most seasons.

     What this guard is actually for is not deriving a second Runner-Up beside a
     stored one, so it tests for a NON-championship honour. A championship at the
     same sort is a different claim and must not silence this one. */
  const alreadyRecorded = recordedHonors.some(
    (honor) => honor.sort === session.sort && !honor.isChampion,
  );
  return reachedFinal && !alreadyRecorded
    ? [{
        year: honorYear(session.sort),
        league: session.provenance.label,
        title: "Runner-Up",
        isChampion: false,
        sort: session.sort,
        scheduleEstablished: true,
      }]
    : [];
});

export const ARCHIVE_HONORS: readonly ArchiveHonor[] = [...recordedHonors, ...scheduleHonors]
  .sort((a, b) => b.sort - a.sort || Number(b.isChampion) - Number(a.isChampion) || a.title.localeCompare(b.title));

export function trophiesAt(sort: number): ArchiveHonor[] {
  return ARCHIVE_HONORS.filter((trophy) => trophy.sort === sort);
}

/**
 * The old site restarts its game numbering when Summer 2013 begins.
 *
 * Every row is a RESULT — date, opponent and both scores — whether or not a
 * write-up survives with it. Filtering on the write-up dropped fifteen of the
 * thirty-two, including ten from a season the archive elsewhere states has no
 * game log at all.
 */
export function recapsAt(sort: number): RecapGame[] {
  let lastWinterGame = -1;
  for (let index = recaps.length - 1; index >= 0; index--) {
    if (recaps[index]?.isPlayoff) {
      lastWinterGame = index;
      break;
    }
  }
  if (lastWinterGame < 0) return [];
  if (sort === 2012.5) return recaps.slice(0, lastWinterGame + 1);
  if (sort === 2013) return recaps.slice(lastWinterGame + 1);
  return [];
}

/**
 * WHICH DIVISION THE CLUB PLAYED IN, from wherever the archive knows it.
 *
 * `Session.division` is set for five sessions — Summer 2018 to 2020-21 — so
 * every recent season page said nothing about the division, while the player
 * pages one click away printed it as a column for 2016-17, 2017-18 and every
 * session from Summer 2021 on. The scoring leaderboards are filed by division
 * and carry it on every ranked line, and what they record is the shape of three
 * seasons: the club dropped to Bronze A for Summer 2024, 2024-25 and Summer
 * 2025, and came back up to Silver for 2025-26. That is the reason a 19–6
 * record looks the way it does, and the season it belongs to never mentioned it.
 *
 * The spelling used most on the session's own lines wins, and " Division" comes
 * off at the render boundary — the source writes the same division both ways.
 */
const DIVISION_VOTES: ReadonlyMap<number, string> = (() => {
  const votes = new Map<number, Map<string, number>>();
  for (const player of players)
    for (const rank of player.scoringRanks) {
      if (!rank.division) continue;
      const forms = votes.get(rank.sessionSort) ?? new Map<string, number>();
      forms.set(rank.division, (forms.get(rank.division) ?? 0) + 1);
      votes.set(rank.sessionSort, forms);
    }
  return new Map(
    [...votes].map(([sort, forms]) => [
      sort,
      [...forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
    ]),
  );
})();

/**
 * A session's division, or null.
 *
 * Null where nothing records one AND where the only thing recording one is the
 * league's own name: Erie Metro files its leaderboards under "Erie Metro", and
 * the kicker that would carry the division already prints "Erie Metro" as the
 * source two words later.
 */
export const divisionAt = (sort: number): string | null => {
  const session = sessionAt(sort);
  const raw = session?.division ?? DIVISION_VOTES.get(sort) ?? null;
  if (raw === null) return null;
  const name = divisionName(raw);
  return name === "" || name === session?.provenance.label ? null : name;
};

export type SeasonAtlasEntry = {
  sort: number;
  label: string;
  year: number;
  /** "Summer" or "Winter" for a league half; the tournament's name for a
   *  tournament, which is the honest answer to "which part of the year" for a
   *  four-day event that belongs to no half. */
  half: string;
  /** The tournament's name, or null for a league half. Anything counting
   *  SEASONS rather than sessions should skip the ones where this is set. */
  tournament: string | null;
  href: string | null;
  players: number;
  /** Games with a result. A postponement is on the schedule, not in the log. */
  games: number;
  /** Every fixture on file, played or not. The season being played has four
   *  that have not happened; the card at the top of the archive prints them as
   *  "Games 11 / 7 played" and the rail has to say the same thing in the same
   *  words. */
  scheduled: number;
  /** The league table's own count of the season, where a table survives. The
   *  record beside it is drawn from that table and from nothing else, so the
   *  two figures on the rail have to belong to each other: Summer 2018's table
   *  says 12 games and the log that opens under it holds 13. */
  standingGames: number | null;
  /** Dated final scores that survive as prose rather than as a game log —
   *  the 2012-13 and Summer 2013 write-ups off the club's own dead site. */
  results: number;
  stats: boolean;
  record: string | null;
  /** The record came off a league standings row, not off the games. */
  recordFromStanding: boolean;
  trophies: number;
  archiveOnly: boolean;
};

export const SEASON_ATLAS: readonly SeasonAtlasEntry[] = SPINE.map((slot) => {
  const session = sessionAt(slot.sort);
  const rollup = ROLLUPS.find((roll) => roll.sort === slot.sort);
  const games = seasonGames(slot.sort);
  const played = games.filter((game) => game.result !== null);
  const wins = played.filter((game) => game.result === "W").length;
  const losses = played.filter((game) => game.result === "L").length;
  const ties = played.filter((game) => game.result === "T").length;
  const results = recapsAt(slot.sort);
  /* A STANDINGS ROW IS CONTENT. 2019 - Summer was the one session in the
     archive with a record and no page: twelve games, 5-7-0, 15 points, 59 goals
     for, 63 against, fifth of eight, all of it in site.json, and the rail gave
     it two figures and a dead row because the test asked for players, games,
     statistics or trophies and it has none of those. It is the season the
     archive worked hardest to prove was played. */
  const hasContent = Boolean(
    (session?.players ?? 0) > 0
      || games.length > 0
      || rollup?.hasStats
      || session?.record
      || trophiesAt(slot.sort).length > 0,
  );

  /* THE RECORD, WHEREVER IT SURVIVES, AND THE LEAGUE'S OWN LINE FIRST.
     Five sessions carry a final league standings row — including 2019-20,
     second of ten, the best finish the club has posted since the Erie Metro
     era. Reading the record off the games alone left four of them blank on the
     page that calls itself the record.

     The fifth is Summer 2018, and it is why the standings now WIN rather than
     fill in: it has both, the schedule gave 9–4 over thirteen rows, and the
     league's final table says 6-2-3-1 over twelve games and third of eleven.
     Gating the stored row on `played.length === 0` threw away a published
     standing in favour of one derived here — the only place in the archive that
     happens — and the third-place finish appeared nowhere on the site. Where a
     league published a table, the league is the record; the game log is still
     printed under it, with its own count. */
  const standing = session?.record ?? null;

  return {
    sort: slot.sort,
    // The slot's own label, not slotLabel(sort): a tournament sorts a
    // quarter-step past its half, so computing the name from the sort gives it
    // the name of the half beside it and the atlas prints the same season
    // twice. `Slot.label` is already the tournament's name where there is one.
    label: slot.label,
    // Same trap as the label, one field over. The 2015 invitational sorts at
    // 2014.75, so flooring the sort dates it 2014 and "is it an integer" calls
    // a late-April event a winter. The session states its own year.
    year: session?.tournament ? tournamentYear(session, slot.sort) : Math.floor(slot.sort),
    half: session?.tournament ?? (Number.isInteger(slot.sort) ? "Summer" : "Winter"),
    tournament: session?.tournament ?? null,
    href: hasContent ? seasonHref(slot.sort) : null,
    players: session?.players ?? 0,
    // Games with a RESULT. Counting schedule rows had 2019 - Winter advertising
    // a postponement as its game log — "1 games" on the row of a season the
    // same file records as 19 games and second of ten.
    //
    // STILL THE GAMES ON FILE, not the league's count of them. The record above
    // may now come off a standings row, and a standings row states a season the
    // archive cannot show: 2018-19's table counts 23 games and no game of it
    // survives. A figure here is a promise that the row opens on those games.
    games: played.length,
    scheduled: games.length,
    standingGames: standing?.gp ?? null,
    results: results.length,
    stats: rollup?.hasStats ?? false,
    record: standing
      ? leagueRecord(standing)
      : played.length > 0
        ? record(wins, losses, ties)
        : null,
    recordFromStanding: standing !== null,
    trophies: trophiesAt(slot.sort).length,
    archiveOnly: session?.provenance.archiveOnly ?? false,
  };
});

export const AVAILABLE_SEASONS = SEASON_ATLAS.filter((entry) => entry.href !== null);
