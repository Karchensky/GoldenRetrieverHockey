/**
 * The site's data contract.
 *
 * Everything the website renders is generated from the capture corpus at
 * BUILD time — there is no database and no runtime API. 49 people, 14
 * sessions and 710 goals is not a database's problem; it is a build step's.
 * That buys perfect static output, zero infrastructure, and a site that
 * cannot break because a service is down.
 *
 * Two rules carry over from the archive and are not negotiable here:
 *
 * - **Every rendered fact is traceable.** Each figure below can be walked
 *   back to a stored page. `Provenance` is not decoration — it is what lets
 *   the site claim things.
 * - **Absence is not zero (§2.4).** A session with no data is a HOLE, and
 *   the site draws the hole rather than interpolating across it.
 */

/** Where a fact came from, and whether it still exists at the source. */
export type Provenance = {
  /** eriemetro | harborcenter-sportngin | harborcenter-hockeyshift | team-archive
   *
   *  NOT the capture's own source key. The team's own material arrives in two
   *  files — the dead team site and the captain's roster workbook — and is one
   *  source to a reader: `SOURCES` in generate.ts maps both raw keys onto this
   *  one. Anything grouping by platform groups by THIS. */
  source: string;
  /** Human label: "Erie Metro", "HarborCenter", "The team archive". */
  label: string;
  /**
   * True when the source no longer serves this era and it survives only in
   * the Internet Archive. Six of fourteen sessions are in this state.
   */
  archiveOnly: boolean;
};

/**
 * The team's own row in the league's published standings — the season's
 * result as the league stated it, not as this archive reconstructed it.
 *
 * For two sessions this row is nearly everything that survives: Summer 2019
 * exists as twelve games of standings arithmetic and nothing else, and
 * 2020-21 ("2021 Spring HAHL") was captured once, mid-season, before the
 * league changed platforms and the trail ended. `asOf` and `final` say which
 * kind of row this is; a non-final row is a floor, not a season, and the two
 * must never render as the same claim.
 */
export type SessionRecord = {
  gp: number | null;
  w: number | null;
  l: number | null;
  /** Overtime wins / overtime losses — HAHL's standings vocabulary. Null on a
   *  source that does not track them, which is not nought (§2.4). */
  otw: number | null;
  otl: number | null;
  pts: number | null;
  gf: number | null;
  ga: number | null;
  /** The composite record cell verbatim: "5-7-0-0-0" (W-L-OTW-OTL-...), under
   *  whatever arithmetic the league used. Kept as printed. */
  record: string | null;
  /** Where the row stood in its division table, in the league's own order:
   *  5th of 8. The table is the league's ranking; nothing is recomputed. */
  place: number | null;
  of: number | null;
  /** ISO date of the snapshot the row was read from. */
  asOf: string;
  /**
   * True when the snapshot postdates the session's playing window, so the
   * table had stopped moving. 2020-21 is the false case: captured 20 April
   * 2021 with the season still running, and no later capture exists anywhere
   * — the row is what was recorded, which is the most that can be said.
   */
  final: boolean;
  provenance: Provenance;
};

/**
 * The club's own line from the league's team-statistics tables, where one
 * survives. Season-total goals, assists and penalties as the LEAGUE summed
 * them — for 2018-19 and 2020-21 this is the only offence total in existence,
 * because no game detail was ever recorded or none survives.
 */
export type SessionTeamStats = {
  /** Null where the table has no GP column (Summer 2018), not nought (§2.4). */
  gp: number | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pen: number | null;
  pim: number | null;
  /** The club goalie line, where the league printed one — under its OWN
   *  games-played, which does not always agree with the scoring table's or
   *  the standings' (2018-19: goalie table 25 GP, standings 23). All three
   *  are kept as printed; reconciling them would be the archive deciding
   *  what the scorekeeper meant. */
  goalieGp: number | null;
  goalieGa: number | null;
  goalieSo: number | null;
  /** ISO date of the snapshot all of these cells were read from — one page,
   *  one moment; lines from different snapshots are never mixed. */
  asOf: string;
  provenance: Provenance;
};

/** One session (NOT a year — two per year, summer and fall/winter). */
export type Session = {
  /** Verbatim label: "2017-18 Regular Season", "Summer 2026". */
  id: string;
  /** Sortable key derived from the label: 2017.5 = fall/winter 2017-18. */
  sort: number;
  /** "summer" | "fall-winter" — derived from the label and game dates. For a
   *  tournament this is the half of the year it was PLAYED in, which is why a
   *  spring event reads "fall-winter". */
  half: "summer" | "fall-winter";
  /**
   * The tournament's name when this session is a tournament rather than a
   * league half, else null.
   *
   * The captain's ruling: "Tournaments can be their own little mini-seasons.
   * We can capture this data & it just fits in chronologically whenever the
   * tournament took place." So a four-day invitational is a session like any
   * other and sorts by when it happened — but it is NOT a season, and anything
   * that counts seasons or draws a season's shape should be able to tell the
   * difference without parsing the label. That is what this is for.
   */
  tournament: string | null;
  division: string | null;
  provenance: Provenance;
  /** The league's own standings row for the team, or null where none was ever
   *  captured. See `SessionRecord` — for two sessions this IS the season. */
  record: SessionRecord | null;
  /** The league's team-statistics line, or null where none survives. */
  teamStats: SessionTeamStats | null;
  /**
   * How many people the archive can NAME for this session. NOT the roster
   * size, and the two are only the same thing when `rosterLost` is false.
   *
   * Zero means nobody survives, not that nobody played. Small-and-nonzero can
   * mean the same kind of hole: Summer 2018 names TWO men — a scorer and the
   * goaltender, both off league-wide tables — from a squad that played
   * thirteen games. Read with the two flags below or this number will be
   * believed.
   */
  players: number;
  /**
   * The breakdown of `players` by what the roster said their standing was,
   * counted off the lines. Null for every session where no line carries one,
   * which is every session but the COVID one.
   *
   * `players` ALONE IS NOT HONEST ABOUT 2020-21. Nineteen names were attached
   * to that team; fifteen were rostered, three were taxi squad, one was on
   * injured reserve, and one of the nineteen — the goaltender, who is on file
   * from a league table rather than from the email — is counted here under the
   * standing the email gives him and nothing else about his line is touched.
   * Anything printing the headline number for that session has this beside it.
   */
  rosterStatus: { status: string; n: number }[] | null;
  /**
   * True when the session is known to have happened but no roster survives.
   *
   * `players` may still be non-zero: a league-wide statistics page can name a
   * man without the roster he was on existing anywhere. The season happened,
   * we can prove it happened, and the list of who played it is gone.
   */
  rosterLost: boolean;
  /**
   * True when the named players are a FRAGMENT and are known to be one.
   *
   * These sessions were recovered from HarborCenter's league-wide statistics
   * tables, of which the Internet Archive holds only page 1 — the top thirty
   * of a 1,220-player league, sorted by goals, with no `page=` snapshot in the
   * CDX index and so no way to reach players 31 and beyond. What is listed is
   * therefore the team's leading scorers and NOTHING ELSE: not the roster, not
   * a sample of it, and not a number to compare against a real roster's.
   *
   * The site must say so wherever it shows these sessions. Two players in
   * 2018-19 rendered like the eighteen in 2022-23 is a lie told with true
   * figures, which is the only kind this archive is capable of.
   */
  rosterPartial: boolean;
};

/** A season line for one person. */
export type PlayerSession = {
  session: string;
  /**
   * Which part of the season this line is — "Regular Season", "Playoffs".
   *
   * Carried because the player page renders one row per line, and Winter
   * 2012-13 has two: the regular season and the playoffs, both real, both
   * counted. Without this they render as two identical rows with the same
   * label and different numbers, which reads as a duplicate rather than as
   * the playoffs. The build has always known; the type simply dropped it.
   */
  phase: string;
  team: string;
  /** The name AS RECORDED in this session. Kept: it is the evidence. */
  recordedAs: string;
  jersey: string | null;
  position: string | null;
  /**
   * What the roster said this man's standing on it was: "Rostered", "Taxi
   * Squad", "IR". Null on every line no source states one for, which is all but
   * nineteen of them.
   *
   * ONE SOURCE IN THE ARCHIVE HAS EVER SAID. The captain's roster email for the
   * COVID season carries a column no other roster does, and it separates
   * fifteen rostered men from three on the taxi squad and one on injured
   * reserve. Those were not the same thing to the men involved, and a season
   * that reads "19 players" without them is the archive flattening the only
   * detail that season has.
   *
   * NULL IS NOT "ROSTERED". Defaulting the other thirty sessions to it would be
   * this archive asserting something none of its sources says (§2.4).
   */
  status: string | null;
  /**
   * "skater" or "goalie". Goalie lines have a different shape and used to have
   * no home at all: the ingest dropped every row where kind !== "skater", so
   * Brent "the cat" Seymour — 34 games and 1,073 saves across 2012-13 and
   * Summer 2013, the only real save totals anywhere in this archive — did not
   * exist on a site that is a record of this team.
   */
  kind: "skater" | "goalie";
  /**
   * A goaltender's line, verbatim from the source. Null for skaters.
   *
   * Kept as strings, deliberately: `gaa` is 4.95 on a page whose own games are
   * 45 minutes long, and `svPct` arrives as "0.875%" — a percentage sign on a
   * ratio. Both are what the source says. Parsing them into numbers would be
   * the archive quietly deciding what the scorekeeper meant.
   */
  goalie: {
    w: string | null; l: string | null; t: string | null;
    so: string | null; ga: string | null; gaa: string | null;
    sv: string | null; svPct: string | null;
  } | null;
  gp: number | null;
  /**
   * TRUE where `gp` is a team-games figure filled in, not a figure a source
   * recorded for this man.
   *
   * HAHL's SportsEngine era never counted skater games. The column does not
   * exist — not on the league table, not on the division table, not on any of
   * the 24 team statistics pages in the corpus for those sessions, and not on
   * a player's own page. Goaltenders got GP; skaters got G, A, PTS, PEN, PIM
   * and nothing else. So four lines carry points with no denominator, and the
   * captain ruled that they should carry one anyway: "Put in the GP numbers
   * even though we don't have them exactly."
   *
   * This flag is the condition he was given it on. A filled figure is the
   * number of games the TEAM is evidenced to have played, which is not the
   * number this man played — he may have missed six of them — so anything
   * computing a rate off `gp` is computing it off a denominator the archive
   * inferred, and both the data and the page have to be able to say so.
   * FALSE on every line any source actually recorded.
   */
  gpInferred: boolean;
  /** How a filled `gp` was arrived at, in one clause, for display. Null on
   *  every recorded line. */
  gpBasis: string | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pim: number | null;
  provenance: Provenance;
};

/** The four things a skater is ranked on. Points is the scoring title; goals,
 *  assists and penalty minutes are the other three races a season has. */
export type StatKey = "points" | "goals" | "assists" | "pim";

/**
 * Where one player placed for one season — his standing relative to the field,
 * across every stat, in his division AND in the whole league. The source of a
 * personal trophy case AND of a "where he stood" marker on his timeline; the
 * two are the same fact told at two volumes.
 *
 * NOT authored and NOT a career aggregate. Each rank is computed off the WHOLE
 * captured field for that season by the honest definition — one plus the number
 * of players strictly ahead on that stat — because the platform only ever sorts
 * its leaderboard by points, so a goals or penalty-minutes standing is nowhere
 * on the page and has to be derived from every row of it.
 *
 * Because a Silver- or Bronze-division team barely registers against the whole
 * league, the DIVISION rank is the one that usually means something; a LEAGUE
 * rank is rarer and the bigger honour. Either can be absent: a rank is null
 * where the player did not appear in that field, which is not rank zero (§2.4)
 * but no rank at all. A rank counts as an AWARD when it is in the top ten; that
 * threshold is applied where these render, so the data stays a measurement.
 *
 * These appear ONLY on the individual player's page. They are personal.
 */
export type ScoringRank = {
  /** Display session label, e.g. "2023 - Winter". Matches the season rows. */
  session: string;
  /** Sort key derived from the season, to order the standings. */
  sessionSort: number;
  /** The division the team played that season ("Silver", "Bronze A"). */
  division: string | null;
  /** His rank in each stat WITHIN the division; null where he did not appear.
   *  1 = led the division in that stat. */
  divisionRanks: Record<StatKey, number | null>;
  /** His rank in each stat across the WHOLE league; null where outside it. */
  leagueRanks: Record<StatKey, number | null>;
  /** How many skaters were in each field, for "2nd of 154" context. */
  divisionField: number | null;
  leagueField: number | null;
  /** The line behind the standing, verbatim from the leaderboard row. */
  pts: number;
  g: number | null;
  a: number | null;
  pim: number | null;
  gp: number | null;
  provenance: Provenance;
};

/** A resolved human. */
export type Player = {
  /** url-safe id from the canonical name. */
  slug: string;
  /** Canonical name — the longest recorded form (registered beats nickname). */
  name: string;
  /**
   * Every other form the archive recorded. NOT noise: this is why the
   * Department of Historical Accuracy has cases.
   */
  aliases: string[];
  /** Jersey numbers worn, most-used first. Stable within this team. */
  jerseys: string[];
  positions: string[];
  career: {
    sessions: number;
    gp: number; g: number; a: number; pts: number; pim: number;
    ppg: number;
    /**
     * TRUE where any season feeding `gp` — and therefore `ppg` — carries an
     * inferred games figure (`PlayerSession.gpInferred`). Two men are affected
     * and nobody else: the archive holds points for them in sessions whose
     * league never counted a skater's games.
     */
    gpInferred: boolean;
  };
  seasons: PlayerSession[];
  /**
   * Where he finished in scoring, one entry per season the archive can rank
   * him, oldest first. The top-ten finishes among these are his awards; the
   * rest are where he stood. Empty for players who predate the leaderboards or
   * never appeared on one — honest, not a gap. Shown only on his own page.
   */
  scoringRanks: ScoringRank[];
};

/** A directed pass: `from` assisted `to`, `n` times. */
export type AssistEdge = { from: string; to: string; n: number };

/**
 * One game, as the archive has it — which is not the same as how it was played.
 *
 * The dates are REAL. Every scoresheet carries its own date field and every
 * HarborCenter schedule row carries an ISO date, so these order properly and a
 * calendar is possible. Nothing here is inferred: a game the archive cannot
 * place in time is not placed.
 *
 * The gaps are the interesting part and each is load-bearing:
 * - `round` marks a playoff game. 24 of the 26 games with a score and no goal
 *   detail are playoffs: these leagues stop writing goals down in the spring.
 * - `shootoutWinner` is a goal on the scoreboard that no player scored.
 * - `scheduleOnly` marks a game known from a schedule row and nothing else:
 *   a score, and not one thing about how it happened.
 * - `linescore` cells are null where the source recorded nothing. Erie Metro
 *   prints a dash for that; HarborCenter prints a ZERO next to a real total,
 *   which is the same hole told as a fact and is discarded the same way.
 */
export type Game = {
  /**
   * The source platform's own game id — SportsEngine's or DigitalShift's, and
   * on both it is the id the sheet is addressed by. Unique across the two: the
   * eras do not overlap and no id is reused.
   */
  id: string;
  /** ISO, e.g. "2016-09-19". Derived from the source's own date field. */
  date: string;
  /** That field VERBATIM: "Sep 19, 2016", or "5/17/2018" from a schedule. */
  dateRecorded: string;
  /** "10:50 PM EST", verbatim. Null on the schedule-only games. */
  time: string | null;
  /** Joins to `Session.sort`. The DATE decides this, never the label. */
  sessionSort: number;
  /** Display label derived from the date: "2016-17", "Summer 2018". */
  session: string;
  league: string;
  /**
   * Playoff round. Null on a regular-season game.
   *
   * Two platforms, two very different levels of confidence. Erie Metro's is
   * verbatim — "Semi 1", "Semi2 Final", "Final1", "Final 2" — spelled
   * inconsistently because a human typed it into a field headed "Game ID", and
   * ONE page in the archive knows it. HarborCenter simply has a field for it,
   * so its playoff games say "Playoffs" and nothing finer: the round is not
   * recorded there, and a semi-final is not invented out of a date.
   */
  round: string | null;
  away: string;
  awayScore: number | null;
  home: string;
  homeScore: number | null;
  /** Which side the Retrievers were. */
  gr: "home" | "away";
  /**
   * TRUE when NO SOURCE RECORDS WHICH CLUB WAS THE HOME SIDE.
   *
   * The club's own dead site wrote its game recaps as "Game 23: February 16
   * vs. Top Shop", then the two scores. Date, opponent, both scores, and not
   * one word about a venue — and it writes "vs." for every game it ever
   * played, so the word is not evidence either. Thirty-four games are in this
   * state and they are the earliest the archive holds.
   *
   * WHAT THIS FLAG MEANS FOR THE FIELDS AROUND IT. `home`, `away`,
   * `homeScore`, `awayScore` and `gr` are then a SLOT PAIR and not a venue:
   * the archive knows the two clubs and the two scores and does not know who
   * was at home. `gr` still points at the Retrievers' slot — that is the fact
   * this whole build tests on, and `ourSide` reads `home` when `gr` is
   * `"home"`, so the club is put in the slot its own `gr` names and the
   * pointer and the slot cannot drift apart. `opponent`, `gf`, `ga` and
   * `result` are recorded facts on these games exactly as on every other.
   *
   * SO: ANYTHING THAT IDENTIFIES A TEAM MAY IGNORE THIS. Anything that
   * RENDERS A VENUE — "vs" / "at", "X at Y" — MUST READ IT FIRST, or it
   * states something no source says. That is the one claim this flag exists
   * to stop, and it is the reason the flag is here rather than the home side
   * being guessed at.
   *
   * FALSE on every game any source placed, which is every game from a
   * scoresheet, a schedule row, a boxscore or a recent-games table.
   */
  venueUnknown: boolean;
  opponent: string;
  /** Goals for and against, from the Retrievers' side. */
  gf: number | null;
  ga: number | null;
  /**
   * Null when the game was not played — a postponement is not a loss.
   *
   * NOT DERIVABLE FROM `gf`/`ga`, and one game proves it: game 8 of the
   * 2014-15 schedule is a `W` with no score printed beside it. A result is
   * what the source states, and a source can state one without stating a
   * score.
   */
  result: "W" | "L" | "T" | null;
  /** Verbatim: "Final", "Final/OT", "Postponed". */
  status: string;
  /** The TITLE says "(Final)" even on the overtime games. Only status knows. */
  ot: boolean;
  /** The team credited a shootout win: one goal, attributable to nobody. */
  shootoutWinner: string | null;
  rink: string | null;
  /** ["1","2","3"] or ["1","2","3","OT1"]. Empty when no box score survives. */
  periodLabels: string[];
  /** Per-period goals. A null cell is a dash on the sheet, and is NOT nought. */
  linescore: { team: string; periods: (string | null)[]; final: string | null }[];
  goals: {
    period: string; time: string; team: string; scorer: string;
    assists: string[]; strength: string | null;
  }[];
  penalties: { period: string; time: string; team: string; detail: string }[];
  goalies: {
    team: string; jersey: string; name: string; minutes: string;
    shotsLabelled: string; savesLabelled: string; decision: string;
  }[];
  /** False when the sheet carries a score and no goal-by-goal detail at all. */
  hasDetail: boolean;
  /**
   * True when there is no sheet and no boxscore behind this game — a score,
   * and not one thing about how it happened.
   *
   * Three routes land here: a league day-schedule row (Summer 2018), a row of
   * a player page's "Recent Games" table, and the club's own written game
   * recaps. The last of those can carry several hundred words of prose and
   * still belongs in this set: the prose is not a scoresheet, and
   * `totals.withSheet` has to keep meaning "games we hold a sheet for".
   */
  scheduleOnly: boolean;
  provenance: Provenance;
};

export type GameTotals = {
  games: number;
  played: number;
  /**
   * Games with no result on file. THREE different kinds of nothing, and no
   * kind of them is a nil-nil draw — HarborCenter reports an unplayed game as
   * 0-0 and that zero is discarded at capture (§2.4).
   *
   * One was postponed and never made up (10 April 2020). Four are Summer 2026
   * fixtures not yet skated. And six had their scores never written down — two
   * in the 2013 Erie Metro playoffs, where the club's own site printed a
   * player's quote in the place the score goes, and four at the stale end of
   * the 2014-15 schedule. `scoreUnrecorded` counts that third kind, because
   * "not played" and "nobody recorded it" are not the same hole.
   */
  unplayed: number;
  /**
   * Games whose SCORE no source records.
   *
   * Two come from the 2012-13 Erie Metro playoffs: Championship Game #3 on
   * 10 April, where the recap page prints a Justin Wheeler quote where the
   * score belongs, and Playoffs Game 1 on 25 March against "Neth & Sons /
   * Encore", listed the day before it was played and never written up. The
   * captain's own statistics workbook counts six playoff games for that
   * season and the archive can name all six; it holds the score of four.
   *
   * FIVE MORE ARE 2014-15's, off the club's typed `schedule.html`, and one of
   * them is a state nothing else in this archive is in: game 8 reads `(W)` and
   * prints no score at all. It has a RESULT and no score — the club recorded
   * that it won and never recorded by how much — so it counts here AND as
   * played, because both of those are what the page says. The other four are
   * the tail of a page that went stale: fixtures dated December 2014 on a
   * capture taken in February 2015, listed with neither score nor result.
   *
   * They are recorded rather than dropped because a game that happened is a
   * fact, and the archive draws holes rather than closing them.
   */
  scoreUnrecorded: number;
  withSheet: number;
  scheduleOnly: number;
  w: number;
  l: number;
  t: number;
  gf: number;
  ga: number;
  /**
   * Goal EVENTS on file for the Retrievers.
   *
   * Lower than `gf`, and the difference is not an error: it is the goals from
   * nine playoff games that nobody wrote down, plus two shootout wins.
   */
  goalsRecorded: number;
  penalties: number;
  /**
   * Goaltender lines on file. Saves are nought in every one of them.
   *
   * All 103 are Erie Metro's. A HockeyShift boxscore has no goalie table at
   * all, so eleven sessions contribute none — absent, not zero (§2.4).
   */
  goalieLines: number;
  shootouts: number;
  /** Shootouts the Retrievers won: goals on the scoreboard that nobody scored. */
  shootoutWins: number;
  otGames: number;
  playoffGames: number;
  /**
   * Goal events on file from playoff games — BOTH teams, unlike the field
   * below.
   *
   * Nearly nought, and that is the finding rather than a defect: these leagues
   * stop writing down goals in the playoffs. Erie Metro recorded not one goal
   * in nine playoff games; HAHL recorded them in 3 of 18. The scores survive
   * for all 27. What happened in them does not.
   */
  playoffGoalsRecorded: number;
  /** Goals the team SCORED in those playoff games, per the final scores. */
  playoffGoalsScored: number;
  /** Goals scored in games with no sheet and no boxscore behind them — see
   *  `Game.scheduleOnly` for the three routes that produce one. */
  scheduleOnlyGoalsScored: number;
  sheetsWithoutDetail: number;
  sessionsWithGames: number;
  /** True when every game on the team's own schedule has a sheet on file. */
  scheduleComplete: boolean;
  scheduledGames: number;
};

/* `Case` is gone — 2026-08-04.
   It held the archive's reconciliation matters: which spelling of a name won,
   and which of two sources stated a table. The site rendered them under
   `On the record`; the captain took that off, and the type goes with the field
   because `site.json` is imported whole into the client bundle and the five
   cases shipped inside it whether or not anything drew them.
   The reconciliation itself is unchanged. It decides which figures the archive
   publishes and it still does — see "THE FULLER RECORD WINS" in generate.ts.
   Only the written-up account of it is gone. */

export type Trophy = {
  year: string;
  league: string;
  title: string;
  isChampion: boolean;
};

export type RecapGame = {
  number: string;
  date: string;
  opponent: string;
  grScore: number;
  opScore: number;
  recap: string | null;
  isPlayoff: boolean;
};

export type SiteData = {
  generatedAt: string;
  totals: {
    sessions: number;
    playerSeasons: number;
    recordedNames: number;
    people: number;
    goals: number;
    assistEdges: number;
    gameSheets: number;
    captures: number;
    archiveOnlySessions: number;
  };
  sessions: Session[];
  players: Player[];
  /** Directed edges, canonical names, strongest first. */
  assists: AssistEdge[];
  /** Both directions combined — "established lines". */
  partnerships: { a: string; b: string; n: number }[];
  /** Every game the archive can place in time, oldest first. */
  games: Game[];
  gameTotals: GameTotals;
  trophies: Trophy[];
  recaps: RecapGame[];
};
