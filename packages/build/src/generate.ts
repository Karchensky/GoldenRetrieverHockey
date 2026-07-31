import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { BlobStore } from "../../capture/src/store/blobs.ts";
import { CaptureLog } from "../../capture/src/store/log.ts";
import { parseRosterPlayer, parseRosterSidebar } from "../../parse/src/sportngin/roster-player.ts";
import { parseLeagueStats, parseStatsTitle, parseTeamStats } from "../../parse/src/sportngin/league-stats.ts";
import { parseStandings } from "../../parse/src/sportngin/standings.ts";
import { parseErieLeagueSkaters, type ErieSkater } from "../../parse/src/sportngin/erie-league.ts";
import { parseGameSheet, type GameSheet } from "../../parse/src/sportngin/game-sheet.ts";
import {
  parseTeamSchedule, parseDaySchedule,
  type TeamSchedule, type DaySchedule,
} from "../../parse/src/sportngin/game-schedule.ts";
import { parseHsPlayer, isRetrieversRow } from "../../parse/src/digitalshift/player.ts";
import { parseHsTeamStats, type TeamStatsRow } from "../../parse/src/digitalshift/team-stats.ts";
import { parseBoxscore, type Boxscore } from "../../parse/src/digitalshift/boxscore.ts";
import { parseLeaders, type LeaderRow } from "../../parse/src/digitalshift/leaders.ts";
import {
  scheduleRows,
  isRetrievers as isRetrieversTeam,
  teamIdentity,
} from "../../capture/src/sources/digitalshift.ts";
import type { ScheduleRow } from "../../capture/src/sources/digitalshift.ts";
import { parseRosterStats } from "../../parse/src/ownsite/roster-stats.ts";
import { readRosterBook, readStatsBook, readRosterEmails } from "./derived.ts";
import { parseHomeLeaders } from "../../parse/src/ownsite/home-leaders.ts";
import { parseGameRecaps, parseRecapFixtures, type RecapFixture } from "../../parse/src/ownsite/game-recaps.ts";
import { parseSchedulePage, type SchedulePage } from "../../parse/src/ownsite/schedule-page.ts";
import { parseRecentGames, type RecentGames } from "../../parse/src/sportngin/recent-games.ts";
import { parseTrophyCase } from "../../parse/src/ownsite/trophy-case.ts";
import { parseTeamPageClaims, type TeamPageClaim } from "../../parse/src/sportngin/team-page.ts";
import { namesMatch } from "../../resolve/src/names.ts";
import { parseSessionLabel, sessionLabel } from "./sessions.ts";
import { buildGames } from "./games.ts";

/** "Mccormick" -> "McCormick". Nothing else: the pattern requires a lowercase
 *  letter directly after "Mc" at the head of a word, which no correctly-set
 *  surname has. */
const properSurname = (name: string): string =>
  name.replace(/\bMc([a-z])/g, (_, letter: string) => `Mc${letter.toUpperCase()}`);
import type {
  SiteData, Player, PlayerSession, Provenance, Session, AssistEdge, Case,
  Trophy, RecapGame, ScoringRank, SessionRecord, SessionTeamStats, StatKey,
} from "./types.ts";

/**
 * Generate the website's entire dataset from the capture corpus.
 *
 * No database. 49 people and 14 sessions is a build step's problem, not a
 * service's. Everything the site renders is produced here, once, and can be
 * traced back to a stored page.
 */

const DATA = process.env.GR_DATA_DIR ?? "data";
const OUT = process.env.GR_SITE_DATA ?? "apps/web/data";

const IS_GR = (t: string | undefined) => /^(the )?golden retrievers$/i.test((t ?? "").trim());
const num = (x: string | undefined): number | null => {
  // "" is NOT 0 — an untracked column must never become a zero (§2.4).
  if (x === undefined || x.trim() === "") return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

const SOURCES: Record<string, Provenance> = {
  eriemetro: { source: "eriemetro", label: "Erie Metro", archiveOnly: false },
  "harborcenter-hockeyshift": { source: "harborcenter-hockeyshift", label: "HarborCenter", archiveOnly: false },
  "harborcenter-sportngin": { source: "harborcenter-sportngin", label: "HarborCenter (former system)", archiveOnly: true },
  // THE TEAM'S OWN MATERIAL IS ONE SOURCE, whatever medium it survives on.
  // The dead team site and the captain's roster workbook were labelled
  // "Golden Retriever Archive" and "The team's own roster book" and listed as
  // two platforms beside Erie Metro and HarborCenter — which are outside
  // systems and genuinely distinct. These are not: they are the club's own
  // record of itself, kept in two files. One name, on every surface that reads
  // a provenance. The MAP KEYS stay as they are, because they are the raw
  // capture's own words and the build matches on them; only what the site says
  // is merged. `archiveOnly` is still per-source, so the season that survives
  // in the Internet Archive alone keeps its gold rule.
  goldenretrieverhockey: { source: "team-archive", label: "The team archive", archiveOnly: true },
  "roster-book": { source: "team-archive", label: "The team archive", archiveOnly: false },
  // THE CAPTAIN'S CORRESPONDENCE — a roster he sent at the time, not a page a
  // league served. Labelled so the site can never imply otherwise: everything
  // else on it traces to bytes stored in the corpus, and this does not.
  "captain-roster-email": {
    source: "captain-roster-email",
    label: "The captain's roster email",
    archiveOnly: false,
  },
};

/**
 * THE ROSTER BOOK — the first source here that is not a website.
 *
 * TGR.xlsx, the captain's own spreadsheet, one tab per session. It is the only
 * record anywhere of what number these men actually wore: no league has
 * collected one since 2019-20, so fourteen players on this site had no number
 * from any published source at all.
 *
 * It is deliberately NOT treated as a stat source. It carries dues, a beer
 * ledger and USA Hockey registration ids, none of which belong on a website,
 * and its game counts are a man's notes rather than a league's record. Three
 * columns are read — name, number, position — and nothing else crosses the
 * parse boundary. Numbers and positions only.
 *
 * READ FROM `data/derived/roster-book.json`, NOT FROM `TGR.xlsx`. See
 * `derived.ts`: the three columns are parsed once by `npm run derive:private`
 * and stored in the corpus, so this build has no private input. The record is
 * empty today — the spreadsheet itself is gone — and the reader stays because
 * the numbers it held are the only ones fourteen men on this site have ever
 * had, and the day a copy surfaces one command puts them back.
 */
const BOOK = (() => {
  const entries = readRosterBook(DATA, process.cwd());
  // Tabs are chronological in the workbook, so the last one that names a man
  // holds his current number. That is the captain's own rule, verbatim.
  const jersey = new Map<string, string>();
  const position = new Map<string, string>();
  for (const e of entries) {
    const k = e.name.trim().toLowerCase();
    if (e.jersey) jersey.set(k, e.jersey);
    if (e.position) position.set(k, e.position);
  }
  return { entries, jersey, position };
})();

/**
 * THE STATISTICS WORKBOOK — `Golden Retriever Hockey (1).xlsx`.
 *
 * The second spreadsheet, and unlike the roster book this one IS a stat source.
 * It is the file the team's own `statistics.html` framed its pivot tables out
 * of, off the captain's OneDrive, and it holds nineteen season-phases from
 * Winter 2011-12 to Summer 2016 — the era with the least coverage anywhere.
 *
 * Seven of its thirteen sessions exist in no captured page: Winter 2011-12,
 * Summer 2012, Winter 2013-14, Summer 2014, and the 2014 and 2016 Greater
 * Buffalo Invitationals, plus Summer 2016. Winter 2011-12 is EARLIER than
 * anything the archive had, and it is the reason the site no longer says the
 * club was founded in 2012.
 *
 * See `stats-book.ts` for what is deliberately not read — the team's books,
 * their dues and their USA Hockey registration numbers, none of which belong on
 * a website. And see the reconciliation in `generate()`: where a captured page
 * states a figure, the page keeps it and the disagreement is printed, because a
 * page that was served on the internet and a cell in a man's spreadsheet are
 * not the same kind of fact.
 */
/**
 * THE WORKBOOK IS NOT PUBLISHED. ITS RECORD IS.
 *
 * The workbook carries the club's finances, its members' dues and their USA
 * Hockey registration numbers, so it is gitignored and a public clone does not
 * have it. This build used to read the file itself, which meant only one
 * machine in the world could regenerate `site.json` — and falling back to an
 * empty array when the file was absent emitted 63 people instead of 80 and 478
 * player-seasons instead of 649, silently, exit 0, writing a `site.json` that
 * looked entirely plausible and that somebody would commit.
 *
 * The stat lines were never the sensitive part: `stats-book.ts` refuses the
 * finances and the registration column at the parse boundary. So they are
 * parsed once by `npm run derive:private` and stored in the tracked corpus at
 * `data/derived/statistics-workbook.json`, and this reads that. A clone and a
 * build server now produce the same file this machine does, byte for byte,
 * having never seen the workbook.
 *
 * Its absence is still loud — `readStatsBook` throws rather than return [] —
 * and where the workbook IS on this disk the record is checked against it, so
 * the two can never drift apart unnoticed. See `derived.ts`.
 */
const STATS_BOOK = readStatsBook(DATA, process.cwd());

/**
 * A goaltender's line from the workbook, in the vocabulary the rest of the
 * build reads.
 *
 * TWO CELLS ARE FORMULAS AND ARE HANDLED HERE, at the build boundary, never in
 * the parser — the parser's job is to read bytes faithfully and it does, which
 * is what makes this possible at all.
 *
 * `GAA` arrives at full float precision ("7.0476190476190474") because it is a
 * live division. Every other goals-against average in this archive is the two
 * places its league printed. It is rounded to match, and nothing is lost: GA
 * and GP are both stored verbatim beside it.
 *
 * `SV%` IS DROPPED. The workbook's formula divides by a hundred too many —
 * Corey Lloyd's 155 saves on 185 shots is written "8.3783783783783778E-3", and
 * the pivot table built on the same column renders 0.8378. Publishing the raw
 * cell would put a figure that is wrong by two orders of magnitude on a site
 * whose one claim is that its figures can be trusted; publishing a corrected
 * one would be this archive deciding what the scorekeeper meant. Saves and
 * goals against are both here, and a save percentage is what they make.
 */
function bookGoalie(stats: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["W", "L", "T", "SO", "GA", "SV"]) if (stats[k] !== undefined) out[k] = stats[k]!;
  const gaa = Number(stats.GAA);
  if (stats.GAA !== undefined && Number.isFinite(gaa)) out.GAA = gaa.toFixed(2);
  return out;
}

/** The book's number first, then whatever the leagues recorded. */
function bookJersey(name: string, tallied: string[]): string[] {
  const mine = BOOK.jersey.get(name.trim().toLowerCase());
  if (!mine) return tallied;
  return [mine, ...tallied.filter((j) => j !== mine)];
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * How good a page is as evidence for ONE player-season. Higher wins.
 *
 * A roster page STATES a man's season — his team, his number, his games
 * played. A league leaderboard merely RANKS him: same numbers, minus the games
 * played for two of the three seasons it covers, and only because he happened
 * to finish in the league's top thirty by goals. Where both exist for one
 * player-season, the roster page is the better witness and must win; the
 * leaderboard's job is to fill holes, not to overwrite.
 */
const ROSTER = 2;
const LEADERBOARD = 1;

type Raw = {
  name: string; session: string; team: string; jersey: string | null;
  position: string | null; source: string;
  /** Which part of the season. Regular season and playoffs BOTH count and are
   *  summed — they are two parts of one season — so this is not a filter. It
   *  exists so dedup can tell them apart and never collapse one into the other. */
  phase: string;
  /** ROSTER | LEADERBOARD. NOT the player's rank on the leaderboard — this is
   *  how much the PAGE is to be believed about him. */
  authority: number;
  /**
   * The SOURCE PAGE's own id, when it has one.
   *
   * A man can hold two roster pages for one season, and both are real. Anthony
   * Christy has roster_players/22875254 (GP 2) and /23085100 (GP 9) for
   * 2017-18; Adam Kaplewicz has /22875256 (GP 23) and a /23158659 stub. The
   * dedup key was name|session|phase|source, so one of each pair was silently
   * discarded — and for Christy it discarded the nine-game line and kept the
   * two-game one. That single dropped row IS the whole 444-against-438 assist
   * discrepancy the site has been reporting as an unresolved scorekeeping
   * dispute. It was never a dispute. It was this.
   */
  pageId: string | null;
  /** "skater" | "goalie". See PlayerSession.kind — the ingest used to drop
   *  goalies entirely and lost a franchise goaltender for the whole project. */
  kind: "skater" | "goalie";
  /** A goaltender's line, verbatim. Null for skaters. */
  goalie: Record<string, string> | null;
  /** Wayback snapshot time, when the row came from an archived page. The
   *  keystone site was captured repeatedly as it was being updated, so the
   *  same season exists at several stages of completeness; this is how the
   *  team's LAST word wins. 0 for live sources. */
  snap: number;
  gp: number | null; g: number | null; a: number | null; pts: number | null; pim: number | null;
  /** Set by the games-played fill, and by nothing else. See PlayerSession.
   *  Absent on every row as it comes off a page — a source never says this. */
  gpInferred?: boolean;
  gpBasis?: string | null;
  /** "Rostered" | "Taxi Squad" | "IR". See PlayerSession.status. Set by the
   *  captain's roster emails and by nothing else; no league page in this
   *  archive has ever published a man's standing on a roster. */
  status?: string | null;
};

/** The 14-digit timestamp in a Wayback URL: /web/20130703022433id_/... */
function snapOf(url: string): number {
  const m = url.match(/\/web\/(\d{14})/);
  return m ? Number(m[1]) : 0;
}

/** A capture's own `fetchedAt` in the same 14-digit shape, so a live page and
 *  an archived one can be ordered against each other. */
function stampOf(fetchedAt: string): number {
  const digits = fetchedAt.replace(/\D/g, "").slice(0, 14);
  return digits.length === 14 ? Number(digits) : 0;
}

export async function generate(): Promise<SiteData> {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));

  // ONE RECORD PER URL — THE NEWEST. The archive's last word, not its first.
  //
  // `log.all()` returns every capture RECORD, and a live URL captured twice is
  // two records of the same page at two moments. Everything below was written
  // as though each URL appeared once, and the two places that noticed —
  // `boxByGame` and the leaders row merge — each solved it locally by keeping
  // the FIRST, which is the OLDEST.
  //
  // That inverted the whole point of refreshing. The current-season sync
  // captured Summer 2026's roster table on 26 July showing Bryan Karchensky at
  // 7 GP and 10 points; the site kept rendering the 15 July capture's 5 GP and
  // 4 points, because the older row won the dedupe. New evidence arrived, was
  // stored correctly, and was then discarded at the last step. Nothing failed
  // and no total moved — the site was simply, quietly, eleven days stale.
  //
  // SAFE FOR THE ARCHIVED ERA, and measured rather than assumed: of 462 URLs
  // in this corpus captured more than once, ZERO are Wayback URLs. A Wayback
  // URL embeds its own timestamp (`/web/20200923000236id_/...`), so two
  // snapshots of one page are two DIFFERENT urls here and both survive this.
  // That matters — Summer 2019 and 2020-21 exist only because the same
  // standings page was captured at several moments, and `settledBy` reads
  // exactly that difference. This collapses repeats of ONE moment, never a
  // sequence of moments.
  const allRecs = await log.all();
  const newestByUrl = new Map<string, (typeof allRecs)[number]>();
  for (const r of allRecs) {
    if (!r.contentHash) continue; // a failure is history, but it is not a page
    const prev = newestByUrl.get(r.url);
    if (!prev || r.fetchedAt >= prev.fetchedAt) newestByUrl.set(r.url, r);
  }
  const recs = allRecs.filter((r) => !r.contentHash || newestByUrl.get(r.url) === r);

  const raw: Raw[] = [];
  /** League-leaderboard rows, held back until the roster pages have spoken. */
  const league: Raw[] = [];
  /**
   * Roster-sidebar cards, held back until EVERY other source has spoken.
   *
   * A card proves a man was on the team and states nothing else. It is the
   * weakest evidence in this build and is applied last, only where a session
   * has no line for him at all. See the sidebar block in the scan below for
   * what happened when these were pushed inline.
   */
  const sidebarMates: {
    name: string; session: string; team: string; jersey: string | null;
    position: string | null; source: string; phase: string; snap: number;
    pageId: string; kind: "skater" | "goalie";
  }[] = [];
  const goals: { team: string; scorer: string; assists: string[] }[] = [];
  let sheets = 0;

  // The game record, collected alongside the roster pass rather than in a
  // second walk of 1,592 blobs. The sheets were already being opened here and
  // then thrown away down to their assists — the scores, the dates, the
  // penalties and the box scores were all read and discarded.
  const gameSheets: { url: string; source: string; sheet: GameSheet }[] = [];
  const teamSchedules: { url: string; source: string; sched: TeamSchedule }[] = [];
  const daySchedules: { url: string; source: string; day: DaySchedule }[] = [];

  // ---- the HarborCenter game record ------------------------------------
  //
  // Three kinds of page, joined on team id and game id:
  //   team partial   -> which team ids are ours, and which SESSION each is
  //   schedule/table -> that team's games, with their game ids
  //   game/boxscore  -> every goal of one game, with its ordered assists
  //
  // The team partials come first because they answer "is this us?" — via
  // `isRetrieversTeam`, which reads the partial's OWN header and never the
  // document. A team partial lists every sibling team in its division, so a
  // content test here returns the Retrievers' whole division.
  const hsTeamSession = new Map<number, string>();
  /** GR team id -> the division that team played in, from its partial's own
   *  header. Names a divisional scoring finish. */
  const hsTeamDivision = new Map<number, string>();
  const hsScheduleRows = new Map<number, { source: string; rows: ScheduleRow[] }>();
  const boxscores: { gameId: number; source: string; box: Boxscore }[] = [];
  /**
   * Captured league/division scoring leaderboards, held back until the season
   * and team maps are built below. Each keeps the URL it was fetched from: the
   * season id and division id live ONLY there, not in the table's own markup,
   * and they are how a table is placed in time and told league from division.
   */
  const leaderPages: { url: string; content: string }[] = [];
  /** Erie Metro's live LEAGUE-WIDE skater tables, one file per page, held for
   *  the same standings pass. Distinct from the archived HAHL `league_instance`
   *  tables above: these are the whole field, sortable on any stat. */
  const erieLeaderPages: { url: string; html: string }[] = [];
  /**
   * The league's own STANDINGS pages — `standings/show/<id>` — and every
   * archived HAHL `league_instance` page (whose team-statistics tables are
   * read in a second pass). Between them they carry the two seasons this
   * archive filed as gone while their bytes sat in the corpus:
   *
   *   - Summer 2019: one standings row — 12 games, 5-7, Silver — captured
   *     three times as the league updated it, and NOTHING else anywhere.
   *   - 2020-21 ("2021 Spring HAHL"): standings + the club's stat lines +
   *     one goaltender, snapshotted mid-season on 20 April 2021 and never
   *     migrated to the next platform. The snapshot is the ceiling.
   *
   * ERIE METRO'S TWO ARE IN HERE NOW, and the day they were held back for
   * has arrived. They speak a different column vocabulary (OTL / For /
   * Against / +/- / L10 in place of OTW/OTL/GF/GA), which is exactly what
   * `parseStandings` refuses to map to a schema — every cell is carried
   * verbatim under its own header — so nothing had to change to read them.
   *
   * They are worth reading because the game record CANNOT say what they say.
   * The two seasons' logs are complete and the standings agree with them to
   * the game: 26 regular-season games in 2016-17 and 24 in 2017-18, exactly
   * the counts on file once the playoffs are set aside. What the log has
   * never held is the league's ORDERING — first of five in the Erie Metro
   * Hockey Adams Division in 2016-17, second of five in 2017-18 — and a
   * division identity for two seasons that rendered without one.
   *
   * The site prefers a published table to a record derived here (see
   * SEASON_ATLAS), so these two seasons now show the league's regular-season
   * record with their full game log printed underneath it, at its own count.
   * That is the archive's rule, not an exception made for them.
   */
  const standingsPages: { url: string; html: string; source: string; snap: number }[] = [];
  const hahlStatsPages: { url: string; html: string }[] = [];
  /**
   * The DigitalShift TEAM ROSTER TABLES, held back until `hsTeamSession` and
   * `hsTeamDivision` are built: the session a team belongs to lives in the
   * TEAM partial's header, not in this response, and the loop below has no
   * guaranteed order between the two. Keyed by team id, which is the join.
   */
  const hsTeamStatsPages: { teamId: number; source: string; rows: TeamStatsRow[] }[] = [];

  /**
   * The "Recent Games" table off EVERY captured player page, ours and the
   * opposition's alike — the identity test happens in `buildGames`, on each
   * row's own cells, and six of the fourteen games this yields exist only on
   * a rival's page. Filtering to Retrievers pages here would lose them.
   */
  const recentGamePages: { source: string; page: RecentGames }[] = [];
  const trophies: Trophy[] = [];
  const recaps: RecapGame[] = [];
  /** One entry per CAPTURE of the recap page. The page carries no years, so
   *  the snapshot's timestamp is the only clock the games have. */
  const recapCaptures: { source: string; snap: number; fixtures: RecapFixture[] }[] = [];
  const seenRecapHashes = new Set<string>();
  /** The club's own `schedule.html`, one entry per distinct body captured. */
  const schedulePages: { source: string; page: SchedulePage }[] = [];
  const seenScheduleHashes = new Set<string>();
  /** Free-typed championship claims off SportsEngine team pages. Checked
   *  against the league's own standings row in the honours pass below. */
  const teamPageClaims: { source: string; claims: TeamPageClaim[] }[] = [];
  const subseasonMeta = new Map<string, { session: string; league: string }>();

  for (const r of recs) {
    if (!r.contentHash) continue;
    const buf = await store.get(r.contentHash);
    if (!buf) continue;
    const s = buf.toString("utf8");

    if (/roster_players/.test(r.url)) {
      // BEFORE the team test below, and deliberately. This table is read for
      // GAMES, not for players, and a Retrievers game is on our opponents'
      // pages too — 24687789 (5 April 2019) survives on Muppet Nation's page
      // and nowhere else in this corpus.
      const rg = parseRecentGames(s);
      if (rg) recentGamePages.push({ source: r.source, page: rg });

      const p = parseRosterPlayer(s);
      if (!p || !IS_GR(p.team)) continue;
      for (const ph of p.phases) {
        // "<season> Totals" is an AGGREGATE, not a phase. Ingesting it invents
        // a phantom session AND double-counts every stat in it (§2.8.1).
        //
        // GOALIES ARE NO LONGER DROPPED. This line used to end
        // `|| ph.kind !== "skater"`, and that clause cost the archive a
        // franchise goaltender: Brent "the cat" Seymour, 34 games and 1,073
        // saves across 2012-13 and Summer 2013, absent from a site that exists
        // to be the record of this team. He is also the ONLY goaltender any
        // source ever recorded a save for — every one of the leagues' own lines
        // reads zero, including the wins — so the one man who proves the site's
        // best fact was the one man the site had thrown away.
        if (ph.isAggregate) continue;
        raw.push({
          name: p.name, session: p.session, team: p.team, jersey: p.jersey,
          position: ph.kind === "goalie" ? "G" : p.position,
          source: r.source, phase: ph.label, snap: snapOf(r.url),
          pageId: (r.url.match(/roster_players\/(\d+)/) ?? [])[1] ?? null,
          authority: ROSTER,
          kind: ph.kind,
          goalie: ph.kind === "goalie" ? ph.stats : null,
          gp: num(ph.stats.GP), g: num(ph.stats.G), a: num(ph.stats.A),
          pts: num(ph.stats.PTS), pim: num(ph.stats.PIM),
        });
      }

      // AND THE FIFTEEN MEN BESIDE HIM — held back, not pushed.
      //
      // The same page carries the whole roster in its sidebar, and reading only
      // its subject is what left five HarborCenter seasons showing two to four
      // players out of sixteen. The names were on this disk the entire time.
      //
      // THESE ARE NOT PUSHED INTO `raw` HERE, and the first version of this
      // that did cost 31 games and 71 goals off Bryan Karchensky alone. Two
      // reasons, both of which the guard caught rather than review:
      //
      //   1. EVERY page of a season carries the SAME sidebar. Erie Metro
      //      2016-17 has 26 captured pages listing 29 men each — 754 rows for
      //      one season, each with a different `pageId`, so the dedup key
      //      `name|session|phase|source|pageId` sees them as distinct roster
      //      spots and keeps them all.
      //   2. A sidebar card HAS NO STATS. Those null rows then stood beside
      //      the real ones and won, blanking seasons that were fully recorded.
      //
      // So they are collected and applied AFTER the dedup, and only for men who
      // have no line at all for that session. A sidebar is the weakest possible
      // evidence — it proves a man was on the team, not that he played — and it
      // must never displace a page that counted his games.
      const sidebarPhase = p.phases.find((ph) => !ph.isAggregate)?.label ?? "Regular Season";
      for (const mate of parseRosterSidebar(s)) {
        sidebarMates.push({
          name: mate.name, session: p.session, team: p.team, jersey: mate.jersey,
          position: mate.position, source: r.source, phase: sidebarPhase,
          snap: snapOf(r.url), pageId: mate.pageId,
          // A sidebar card states "G" and nothing else for a goaltender — no
          // table, so no columns to decide on. `tableKind` cannot be consulted
          // and the position cell is all there is.
          kind: mate.position === "G" ? "goalie" : "skater",
        });
      }
    } else if (/partials\/stats\/player\?/.test(r.url)) {
      let content: string;
      try { content = (JSON.parse(s) as { content: string }).content; } catch { continue; }
      const p = parseHsPlayer(content);
      if (!p.name) continue;
      for (const row of p.career.filter(isRetrieversRow)) {
        raw.push({
          name: p.name, session: row.session, team: row.team, jersey: null,
          position: row.position || null, source: r.source, phase: "Regular Season", snap: snapOf(r.url), pageId: null,
          authority: ROSTER,
          // This branch never filtered on kind, which is why Corey Muff exists
          // on the site and Brent Seymour did not. `kind` comes off the table's
          // own columns; see digitalshift/player.ts tableKind.
          kind: row.kind ?? "skater",
          goalie: row.kind === "goalie" ? row.stats : null,
          gp: num(row.stats.GP), g: num(row.stats.G), a: num(row.stats.A),
          pts: num(row.stats.Pts), pim: num(row.stats.PIM),
        });
      }
    } else if (/Team_Roster___Stats/.test(r.url)) {
      // THE KEYSTONE. goldenretrieverhockey.com, the team's own dead site, and
      // the only surviving reach into 2012-2016 — Erie Metro's pages from that
      // era are gone and Pointstreak is dead. Rescued from the Internet Archive
      // at the start of this project and then, for far too long, never read:
      // the homepage promised "an entire era held only by the Internet Archive
      // — all of it retrieved" while this branch did not exist.
      for (const p of parseRosterStats(s)) {
        for (const ph of p.phases) {
          // Goalies kept — see the roster_players branch above for why.
          if (ph.isAggregate) continue;
          raw.push({
            name: p.name, session: p.session, team: p.team, jersey: p.jersey || null,
            position: ph.kind === "goalie" ? "G" : p.position,
            source: r.source, phase: ph.label, snap: snapOf(r.url), pageId: null,
            authority: ROSTER,
            kind: ph.kind,
            goalie: ph.kind === "goalie" ? ph.stats : null,
            gp: num(ph.stats.GP), g: num(ph.stats.G), a: num(ph.stats.A),
            pts: num(ph.stats.PTS), pim: num(ph.stats.PIM),
          });
        }
      }
    } else if (r.source === "eriemetro" && /\/stats\/league_instance/.test(r.url)) {
      // ERIE METRO'S LIVE LEAGUE TABLES — the whole field, held for the scoring
      // standings pass. Matched on source BEFORE the archived-HAHL branch below,
      // which the same `league_instance` URL would otherwise claim and hand to a
      // parser expecting HarborCenter's page shape.
      erieLeaderPages.push({ url: r.url, html: s });
    } else if (/\/stats\/league_instance/.test(r.url)) {
      // THE LEAGUE-WIDE TABLES. HarborCenter's SportsEngine era, and the only
      // page in the archive that names anybody at all for 2018-19 Fall/Winter
      // or Summer 2018. Both were filed as MISSING for the life of the project
      // while these captures sat in the corpus: nothing parsed them, so the
      // seasons did not exist.
      //
      // These are not rosters. They are every player in the league, ranked by
      // goals, and they are read here under two rules that this repo has
      // already paid for:
      //
      //   - The TEAM COMES FROM THE ROW. Never from the page. A table of 1,220
      //     players, thirty-seven clubs deep on page one alone, of course
      //     contains the string "Golden Retrievers"; testing for it once turned
      //     Classic Cue's, Burners and 716 Realty — the three teams explicitly
      //     out of scope — into Retrievers. Bryan Karchensky is on every one of
      //     these pages TWICE, #21 for us and #12 for Classic Cue's, and only
      //     the row's own cell tells them apart. Taking both doubles a career.
      //   - GOALTENDERS ARE INGESTED AS GOALTENDERS, exactly as on the roster
      //     pages above: kind "goalie", their line verbatim, and never a
      //     single cell mapped into a skater column. A goalie row's GA is
      //     goals AGAINST, and there is no honest way to add it to a column
      //     headed G — which is why this branch used to drop goalies
      //     entirely, back when no goalie counted anywhere. That filter
      //     outlived its reason: the roster branches have carried goalie
      //     lines since Brent Seymour was recovered, and the league table is
      //     the ONLY witness to Corey Muff's Summer 2018 (13 games, 9-4) and
      //     to the whole of his 2020-21 — a franchise goaltender's two
      //     seasons, refused for the crime of not being a skater.
      const leagueParsed = parseLeagueStats(s);
      // The same pages carry the CLUB's own statistics tables (`team-sm-*`),
      // which the player read above must refuse and a session summary needs.
      // Held whole for the standings pass below.
      hahlStatsPages.push({ url: r.url, html: s });
      const sub = r.url.match(/subseason=(\d+)/)?.[1];
      if (sub && leagueParsed.length > 0) {
        subseasonMeta.set(sub, { session: leagueParsed[0]!.session, league: "HAHL" });
      }
      for (const p of leagueParsed) {
        if (!IS_GR(p.team)) continue;
        for (const ph of p.phases) {
          if (ph.isAggregate) continue;
          league.push({
            name: p.name, session: p.session, team: p.team, jersey: p.jersey || null,
            position: ph.kind === "goalie" ? "G" : p.position,
            source: r.source, phase: ph.label, snap: snapOf(r.url), pageId: null,
            authority: LEADERBOARD,
            kind: ph.kind,
            goalie: ph.kind === "goalie" ? ph.stats : null,
            // A goalie's phase carries no G/A/PTS keys at all (asserted in the
            // parser's tests), so these are null for him by construction —
            // absent, not nought, and never his GA misread as goals.
            gp: num(ph.stats.GP), g: num(ph.stats.G), a: num(ph.stats.A),
            pts: num(ph.stats.PTS), pim: num(ph.stats.PIM),
          });
        }
      }
    } else if (/\/stats\/division_instance/.test(r.url)) {
      const sub = r.url.match(/subseason=(\d+)/)?.[1];
      const meta = sub ? subseasonMeta.get(sub) : undefined;
      if (!meta) continue;
      for (const p of parseLeagueStats(s, meta)) {
        if (!IS_GR(p.team)) continue;
        for (const ph of p.phases) {
          if (ph.isAggregate) continue;
          league.push({
            name: p.name, session: p.session, team: p.team, jersey: p.jersey || null,
            position: ph.kind === "goalie" ? "G" : p.position,
            source: r.source, phase: ph.label, snap: snapOf(r.url), pageId: null,
            authority: LEADERBOARD,
            kind: ph.kind,
            goalie: ph.kind === "goalie" ? ph.stats : null,
            gp: num(ph.stats.GP), g: num(ph.stats.G), a: num(ph.stats.A),
            pts: num(ph.stats.PTS), pim: num(ph.stats.PIM),
          });
        }
      }
    } else if (/\/standings\/show\//.test(r.url)) {
      // THE LEAGUE'S OWN STANDINGS. Held whole for the pass below — the rows
      // are read there, latest snapshot per session, GR row only, by the
      // row's OWN team cell.
      //
      // A LIVE CAPTURE HAS NO WAYBACK TIMESTAMP, and the pass below sorts
      // snapshots to keep the archive's last word. Erie Metro's two pages
      // were fetched directly, so their `snap` is the moment WE read them —
      // which is the same fact the Wayback stamp records for the others, and
      // is what `SessionRecord.asOf` means.
      standingsPages.push({ url: r.url, html: s, source: r.source, snap: snapOf(r.url) || stampOf(r.fetchedAt) });
    } else if (/partials\/stats\/team\/stats\?team_id=/.test(r.url)) {
      // THE TEAM'S OWN ROSTER TABLE — jersey numbers, positions, and the
      // PLAYOFFS. Held for the fold below, which needs the team partials read
      // in this same loop to say which session a team id is.
      //
      // MUST be matched before the `team?team_id=` branch beneath it. The two
      // routes are siblings — `team/stats` is nested UNDER `team`, not a
      // sibling of it (see the DigitalShift adapter's `partialUrl` note) — and
      // while today's pattern happens not to collide, ordering it here means a
      // roster table can never be handed to the team-header reader.
      let content: string;
      try { content = (JSON.parse(s) as { content: string }).content; } catch { continue; }
      const tid = Number(r.url.match(/team_id=(\d+)/)?.[1]);
      if (!Number.isFinite(tid)) continue;
      hsTeamStatsPages.push({ teamId: tid, source: r.source, rows: parseHsTeamStats(content) });
    } else if (/partials\/stats\/team\?team_id=/.test(r.url)) {
      // Which HarborCenter team ids are ours, and what session each one is.
      let content: string;
      try { content = (JSON.parse(s) as { content: string }).content; } catch { continue; }
      if (!isRetrieversTeam(content)) continue;
      const tid = Number(r.url.match(/team_id=(\d+)/)?.[1]);
      const id = teamIdentity(content);
      // The session comes from the team's OWN header. Never from the games'
      // dates: HAHL plays its summer from May to September (see `HsSchedule`).
      if (Number.isFinite(tid) && id?.session) hsTeamSession.set(tid, id.session);
      // And the division that header names — "Silver", "Bronze A" — which is
      // what a divisional scoring finish is a finish IN.
      if (Number.isFinite(tid) && id?.division) hsTeamDivision.set(tid, id.division);
    } else if (/partials\/stats\/schedule\/table/.test(r.url)) {
      let content: string;
      try { content = (JSON.parse(s) as { content: string }).content; } catch { continue; }
      const tid = Number(r.url.match(/team_id=(\d+)/)?.[1]);
      if (!Number.isFinite(tid)) continue;
      hsScheduleRows.set(tid, { source: r.source, rows: scheduleRows(content) });
    } else if (/partials\/stats\/game\/boxscore/.test(r.url)) {
      // BEFORE the /game/ branch below, which would otherwise take this URL
      // and hand a JSON envelope to the SportsEngine sheet parser.
      let content: string;
      try { content = (JSON.parse(s) as { content: string }).content; } catch { continue; }
      const gid = Number(r.url.match(/game_id=(\d+)/)?.[1]);
      if (!Number.isFinite(gid)) continue;
      boxscores.push({ gameId: gid, source: r.source, box: parseBoxscore(content) });
    } else if (/partials\/stats\/leaders\/table/.test(r.url)) {
      // THE LEAGUE-WIDE SCORING LEADERBOARD — held for the accolade pass below.
      //
      // MUST be matched before the `/game/` catch-all at the end of this chain:
      // this URL carries `&game_type=Regular Season`, so a bare /game/ test
      // claims it and hands a JSON envelope to the SportsEngine sheet parser.
      let content: string;
      try { content = (JSON.parse(s) as { content: string }).content; } catch { continue; }
      leaderPages.push({ url: r.url, content });
    } else if (/schedule\/team_instance/.test(r.url)) {
      const sc = parseTeamSchedule(s);
      if (sc) teamSchedules.push({ url: r.url, source: r.source, sched: sc });
    } else if (/schedule\/day/.test(r.url)) {
      const d = parseDaySchedule(s);
      if (d) daySchedules.push({ url: r.url, source: r.source, day: d });
    } else if (/Game_Recaps/.test(r.url)) {
      if (seenRecapHashes.has(r.contentHash)) continue;
      seenRecapHashes.add(r.contentHash);
      // The fuller reading, for the game record: it keeps the two fixtures
      // the page never scored, and the section heading that says which of its
      // "Game 1"s is a playoff opener. `recaps` below stays exactly what it
      // has always been — the results, which is what the season pages render.
      recapCaptures.push({ source: r.source, snap: snapOf(r.url), fixtures: parseRecapFixtures(s) });
      for (const g of parseGameRecaps(s)) {
        const key = `${g.number}|${g.date}|${g.opponent}`;
        if (!recaps.some((r) => `${r.number}|${r.date}|${r.opponent}` === key)) {
          recaps.push(g);
        }
      }
    } else if (r.source === "goldenretrieverhockey" && /\/schedule\.html$/.test(r.url)) {
      // THE CLUB'S TYPED FIXTURE LIST. One capture, of 2014/15 — the only
      // game-by-game record that season has, in a session that held none.
      //
      // Deduped on CONTENT, like the recaps: two snapshots of an unchanged
      // page are one state of it. Unlike the recaps this page names its own
      // season, so no snapshot timestamp is carried and none is needed.
      if (seenScheduleHashes.has(r.contentHash)) continue;
      seenScheduleHashes.add(r.contentHash);
      const sched = parseSchedulePage(s);
      if (sched) schedulePages.push({ source: r.source, page: sched });
    } else if (
      r.source === "goldenretrieverhockey" &&
      /goldenretrieverhockey\.com(?::80)?\/?$|\/home\.html$/.test(r.url)
    ) {
      // THE HOME PAGE, EVERY TIME IT WAS CAUGHT — not just `home.html`.
      //
      // The team re-edited this one page for four years and the Internet
      // Archive caught it holding a different competition each time. This
      // branch used to read `home.html` only: ONE capture, of THIRTEEN, and
      // the twelve copies of the site ROOT — the same page at the same address
      // without the filename — were never opened. Two whole sessions were
      // sitting in them:
      //
      //   Summer 2015  — "2015 Summer PxHL Playoff Point Leaders", 13 men.
      //                  A Performax league; the same page's banner reads
      //                  "The Golden Retrievers are your 2015 Summer PxHL
      //                  Champions!"
      //   2015-16      — "2015 / 2016 EMHL" + "Point Leaders", 14 men,
      //                  captured mid-season (Jan) and settled (Apr).
      //
      // plus the 2014-15 PLAYOFFS, a second phase of a season the site already
      // had, and which its regular-season table alone could not show.
      //
      //   2015 GBHI    — "2015 gREATER bUFFALO iNVITATIONAL pOINT lEADERS",
      //                  10 men. A TOURNAMENT, and tournaments are sessions
      //                  now: "Tournaments can be their own little
      //                  mini-seasons ... it just fits in chronologically
      //                  whenever the tournament took place." It is the only
      //                  page in the archive naming Michael Graber.
      //
      // A SESSION `sessions.ts` CANNOT PLACE IS STILL NOT PLACED — the same
      // rule the league tables below follow. Nothing is filed at sort 0 in
      // front of 1993 because a heading was unreadable.
      const leaders = parseHomeLeaders(s);
      if (!leaders || !parseSessionLabel(leaders.session)) continue;
      for (const l of leaders.leaders) {
        raw.push({
          name: l.name, session: leaders.session, team: "Golden Retrievers",
          jersey: null, position: null,
          // The heading states its own phase ("... EMHL Playoff Point
          // Leaders"). Hardcoding "Regular Season" here would have collapsed
          // the 2014-15 playoffs into the 2014-15 regular season on the dedup
          // key and silently overwritten one with the other.
          source: r.source, phase: leaders.phase, snap: snapOf(r.url), pageId: null,
          authority: LEADERBOARD, kind: "skater", goalie: null,
          gp: null, g: null, a: null, pts: l.pts, pim: null,
        });
      }
    } else if (/about\.html/.test(r.url) && r.source === "goldenretrieverhockey") {
      const t = parseTrophyCase(s);
      if (t.length > trophies.length) trophies.length = 0, trophies.push(...t);
    } else if (/\/page\/show\/\d+/.test(r.url)) {
      // THE CLUB'S OWN HONOURS, TYPED INTO A SPORTSENGINE TEXT BOX. Held for
      // the honours pass below, which is where the league's standings row is
      // available to check them against — two claims on this page name two
      // different divisions for one season and only the row can settle it.
      const claims = parseTeamPageClaims(s);
      if (claims.length > 0) teamPageClaims.push({ source: r.source, claims });
    } else if (/game/.test(r.url)) {
      const g = parseGameSheet(s);
      if (!g) continue;
      sheets++;
      gameSheets.push({ url: r.url, source: r.source, sheet: g });
      for (const x of g.goals) if (IS_GR(x.team)) goals.push({ team: x.team, scorer: x.scorer, assists: x.assists });
    }
  }

  // The 2016 GBHI Tier 1 win is not in about.html — the page was last captured
  // Sep 2015. Confirmed on performaxsports.com/gbhi/ (the three-peat: 2014,
  // 2015, 2016). Added here because the source is a live page, not the corpus.
  if (!trophies.some((t) => t.year === "2016" && /GBHI/i.test(t.league))) {
    trophies.push({ year: "2016", league: "GBHI", title: "Tier 1 Champions", isChampion: true });
  }

  // ---- the DigitalShift team roster tables, joined --------------------
  //
  // A roster table is ours only if its team id belongs to a team whose OWN
  // partial header says Golden Retrievers — `hsTeamSession`, the same test the
  // schedules use below, and never a name on the page.
  //
  // THESE ROWS CARRY NO `pageId`, DELIBERATELY, AND THAT IS THE WHOLE SAFETY
  // ARGUMENT. The dedup key downstream is name|session|phase|source|pageId, and
  // these rows share every one of those fields with the rows the PLAYER route
  // already produced for the same man's same season. So a regular-season line
  // that both routes describe collides and is kept ONCE. Give these a pageId —
  // the team id, say — and the key would differ, both rows would survive, and
  // every modern career on the site would silently double. That is the
  // 1,064-phantom-goals failure mode, and the corpus says it would have fired:
  // all 180 regular-season lines here already exist under the other route,
  // reading identically.
  //
  // What survives the collision is what only this route has:
  //   - PLAYOFF rows, a phase the player route's career table never shows;
  //   - JERSEY NUMBERS, which the archive believed this platform did not keep.
  //
  // The session is the TEAM PARTIAL'S OWN session string, which is spelled
  // identically by both routes ("Summer 2021", "Fall/Winter 2021-22") — checked
  // across all 11 sessions. A different spelling here would defeat the
  // collision above and double everything, so this must not become a guess.
  //
  // A PHASE WHOSE EVERY ROW IS NOUGHT WAS NOT PLAYED. The platform renders the
  // playoff tables for every club all season long, listing the full roster with
  // zeros until a playoff game happens — and for seven of these ten sessions
  // that is all they ever hold. Ingesting them would file ~120 player-seasons
  // for playoffs nobody skated, and would state on each of those men's pages
  // that the club had a playoff phase in a season where it did not.
  //
  // So the test is applied to the SECTION, not the row: if no row in a phase
  // records a game played, the club did not play that phase and none of it is
  // read. Inside a phase that WAS played, a nought is kept — a man who dressed
  // for none of it is a real roster fact, and "" is still not 0 (§2.4).
  for (const { teamId, source, rows } of hsTeamStatsPages) {
    const session = hsTeamSession.get(teamId);
    if (!session) continue; // not one of ours
    const played = new Set(
      rows.filter((x) => (num(x.stats.GP) ?? 0) > 0).map((x) => x.phase),
    );
    for (const row of rows) {
      if (!played.has(row.phase)) continue;
      raw.push({
        name: row.name, session, team: "Golden Retrievers",
        jersey: row.jersey, position: row.kind === "goalie" ? "G" : row.position || null,
        source, phase: row.phase, snap: 0, pageId: null,
        authority: ROSTER,
        kind: row.kind,
        goalie: row.kind === "goalie" ? row.stats : null,
        // `G` AND `A` ARE READ FOR GOALTENDERS TOO, and that is not a slip.
        // Unlike the SportsEngine league tables — where a goalie's phase
        // carries no G/A keys at all and reading one would take his goals
        // AGAINST as goals — this platform's goalie table has BOTH: `GA` for
        // goals against and a separate `G`/`A` for what the goaltender himself
        // scored. Corey Muff's Fall/Winter 2022-23 goal is on that page and in
        // the table's own totals row. Nulling these cost him it.
        // `Pts` is derived by the parser from this row's own G and A, exactly
        // as the player route does it, because the table has no Pts column.
        gp: num(row.stats.GP), g: num(row.stats.G), a: num(row.stats.A),
        pts: num(row.stats.Pts), pim: num(row.stats.PIM),
      });
    }
  }

  // ---- the HarborCenter game record, joined --------------------------
  //
  // A schedule is ours only if its team id belongs to a team whose OWN partial
  // header says Golden Retrievers. Anything else in `hsScheduleRows` is not
  // this team and is dropped here rather than filtered by name downstream.
  const hsSchedules = [...hsScheduleRows]
    .filter(([tid]) => hsTeamSession.has(tid))
    .map(([tid, v]) => ({
      teamId: tid,
      session: hsTeamSession.get(tid)!,
      source: v.source,
      rows: v.rows,
    }));

  // DEDUPED ON GAME ID, and this is load-bearing. `log.all()` returns every
  // capture RECORD, not every distinct URL: capture the same boxscore twice —
  // which is exactly what a re-run past the freshness window does — and its
  // goals would be counted twice. The assist network is built by counting goal
  // events, so that would not fail anything. It would silently double an edge
  // and render as a decade of chemistry.
  const boxByGame = new Map(boxscores.map((b) => [b.gameId, b]));

  // A boxscore counts only if the game is on one of those schedules. Ties the
  // assist network to the game record: a boxscore left in the corpus by a
  // fixture the league later withdrew cannot contribute goals to a game that
  // no longer exists.
  const hsGameIds = new Set(hsSchedules.flatMap((s) => s.rows.map((r) => r.gameId)));
  const hsBoxscores = [...boxByGame.values()].filter((b) => hsGameIds.has(b.gameId));

  for (const b of hsBoxscores) {
    sheets++;
    // IS_GR reads the GOAL ROW'S OWN team cell — the row states its own team,
    // and a boxscore names both sides.
    for (const g of b.box.goals) {
      if (!IS_GR(g.team)) continue;
      goals.push({
        team: g.team,
        scorer: g.scorer.name,
        assists: g.assists.map((a) => a.name),
      });
    }
  }

  // ---- scoring finishes: where each Retriever placed relative to the field --
  //
  // The modern era's answer to "where did our guy stand" — in points, goals,
  // assists AND penalty minutes, within the division the team actually played
  // (the ranking that means anything for a Silver or Bronze side) AND across the
  // whole league (rarer, and the bigger honour). One standing per player per
  // season carries all of it.
  //
  // The platform only ever sorts its leaderboard by points, so three of those
  // four races are nowhere on the page: they are computed off the WHOLE field,
  // which is why every page of it was captured. A finish is attributed by TEAM
  // ID, never by a name on the page — a league table lists every club, and a
  // Retriever who also skated for another team that season has a separate row
  // under that other team's id which is correctly NOT counted here. Two things
  // are placed from the URL, because the markup carries neither: the season
  // (from `season_id`, via the team's schedule) and whether it is a division
  // field (from `division_id`). A season the schedule cannot place is not
  // placed — the same rule the league tables below follow.
  const grTeamIds = new Set(hsTeamSession.keys());
  const seasonToGrTeam = new Map<number, number>();
  for (const [tid, { rows }] of hsScheduleRows) {
    if (!grTeamIds.has(tid)) continue;
    const counts = new Map<number, number>();
    for (const row of rows) {
      if (Number.isFinite(row.seasonId)) counts.set(row.seasonId, (counts.get(row.seasonId) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestN = 0;
    for (const [sid, n] of counts) if (n > bestN) (best = sid), (bestN = n);
    if (best !== null) seasonToGrTeam.set(best, tid);
  }

  // Aggregate the captured pages into one FULL FIELD per (season, scope). The
  // leaderboard is paged 100 at a time and only ever sorted by points, so every
  // page is needed and the rows are keyed on player id (the responsive clone
  // and the wrap-around both repeat ids, and dedup absorbs both).
  const fieldsBySeasonScope = new Map<
    string,
    { seasonId: number; isDivision: boolean; rows: Map<number, LeaderRow> }
  >();
  for (const { url, content } of leaderPages) {
    const seasonId = Number(url.match(/season_id=(\d+)/)?.[1]);
    if (!Number.isFinite(seasonId)) continue;
    const isDivision = /division_id=\d+/.test(url);
    const key = `${seasonId}|${isDivision ? "div" : "league"}`;
    const bucket = fieldsBySeasonScope.get(key) ?? { seasonId, isDivision, rows: new Map() };
    for (const row of parseLeaders(content).rows) {
      if (row.playerId !== null && !bucket.rows.has(row.playerId)) bucket.rows.set(row.playerId, row);
    }
    fieldsBySeasonScope.set(key, bucket);
  }

  // A player's standing on one stat = one plus the number of players strictly
  // ahead of him on it. Competition ranking: ties share the better rank, which
  // is the honest way to say "led the division in penalties" when three men
  // did. Points is the same idea the platform's own Rk column expresses.
  const STAT_KEYS: StatKey[] = ["points", "goals", "assists", "pim"];
  const STAT_OF: Record<StatKey, (r: LeaderRow) => number | null> = {
    points: (r) => r.pts,
    goals: (r) => r.g,
    assists: (r) => r.a,
    pim: (r) => r.pim,
  };
  const ranksOf = (field: LeaderRow[], row: LeaderRow): Record<StatKey, number | null> => {
    const out: Record<StatKey, number | null> = { points: null, goals: null, assists: null, pim: null };
    for (const stat of STAT_KEYS) {
      const mine = STAT_OF[stat](row);
      if (mine === null) continue;
      // -Infinity so an untracked stat on another row never counts as "ahead".
      out[stat] = 1 + field.filter((r) => (STAT_OF[stat](r) ?? -Infinity) > mine).length;
    }
    return out;
  };

  // One standing per (player, season), division and league ranks folded in.
  const standings = new Map<string, { name: string; rank: ScoringRank }>();
  for (const { seasonId, isDivision, rows } of fieldsBySeasonScope.values()) {
    const grTeamId = seasonToGrTeam.get(seasonId);
    if (grTeamId === undefined) continue;
    const parsed = parseSessionLabel(hsTeamSession.get(grTeamId) ?? "");
    if (!parsed) continue;
    const division = hsTeamDivision.get(grTeamId) ?? null;
    const field = [...rows.values()];
    for (const row of field) {
      // OUR rows only, by the team id the corpus already vouched for.
      if (row.teamId !== grTeamId || row.pts === null || row.playerId === null) continue;
      const key = `${row.name}|${parsed.sort}`;
      const entry =
        standings.get(key) ??
        {
          name: row.name,
          rank: {
            session: sessionLabel(parsed),
            sessionSort: parsed.sort,
            division,
            divisionRanks: { points: null, goals: null, assists: null, pim: null },
            leagueRanks: { points: null, goals: null, assists: null, pim: null },
            divisionField: null,
            leagueField: null,
            // Same line in both fields; take it once.
            pts: row.pts,
            g: row.g,
            a: row.a,
            pim: row.pim,
            gp: row.gp,
            provenance: SOURCES["harborcenter-hockeyshift"]!,
          } as ScoringRank,
        };
      const ranks = ranksOf(field, row);
      if (isDivision) {
        entry.rank.divisionRanks = ranks;
        entry.rank.division = division;
        entry.rank.divisionField = field.length;
      } else {
        entry.rank.leagueRanks = ranks;
        entry.rank.leagueField = field.length;
      }
      standings.set(key, entry);
    }
  }

  // ---- Erie Metro standings fold into the same map ---------------------
  //
  // The 2016-18 EMHL had no divisions: the whole league WAS the field a
  // Retriever competed in. So its rank is carried as the DIVISIONAL standing —
  // their tier — with no separate league rank, and renders beside the modern
  // Silver and Bronze seasons as just another season they placed in. The team
  // is read from each row's own attribute (IS_GR), never the "83" the cell shows
  // — the same rule that keeps the two Sean Lebers, ours and 941 Top Shop's,
  // from being confused.
  const erieByLeague = new Map<number, string[]>();
  for (const { url, html } of erieLeaderPages) {
    const li = Number(url.match(/league_instance\/(\d+)/)?.[1]);
    if (Number.isFinite(li)) erieByLeague.set(li, [...(erieByLeague.get(li) ?? []), html]);
  }
  const erieStat: Record<StatKey, (r: ErieSkater) => number | null> = {
    points: (r) => r.pts,
    goals: (r) => r.g,
    assists: (r) => r.a,
    pim: (r) => r.pim,
  };
  for (const htmls of erieByLeague.values()) {
    // The season from the page's own title: "Statistics - 2016-17 Regular
    // Season - Erie Metro Hockey League".
    const title = htmls.map((h) => h.match(/<title>([^<]*)<\/title>/)?.[1]).find(Boolean) ?? "";
    const t = parseStatsTitle(title);
    const parsed = t ? parseSessionLabel(t.session) : null;
    if (!parsed) continue;
    const byKey = new Map<string, ErieSkater>();
    for (const h of htmls)
      for (const row of parseErieLeagueSkaters(h)) {
        const k = `${row.name}|${row.team}`;
        if (!byKey.has(k)) byKey.set(k, row);
      }
    const field = [...byKey.values()];
    for (const row of field) {
      if (!IS_GR(row.team) || row.pts === null) continue;
      const ranks: Record<StatKey, number | null> = { points: null, goals: null, assists: null, pim: null };
      for (const stat of STAT_KEYS) {
        const mine = erieStat[stat](row);
        if (mine !== null) ranks[stat] = 1 + field.filter((x) => (erieStat[stat](x) ?? -Infinity) > mine).length;
      }
      standings.set(`${row.name}|${parsed.sort}`, {
        name: row.name,
        rank: {
          session: sessionLabel(parsed),
          sessionSort: parsed.sort,
          division: "Erie Metro",
          divisionRanks: ranks,
          leagueRanks: { points: null, goals: null, assists: null, pim: null },
          divisionField: field.length,
          leagueField: null,
          pts: row.pts,
          g: row.g,
          a: row.a,
          pim: row.pim,
          gp: row.gp,
          provenance: SOURCES["eriemetro"]!,
        } as ScoringRank,
      });
    }
  }

  // ---- the league tables fill holes, and only holes ---------------------
  //
  // Held back until now because a leaderboard row may only be added where no
  // roster page speaks. `raw` at this point is roster pages, the team's own
  // site and HockeyShift — every source that states a season outright.
  //
  // Two things have to be right here, and both are about the SESSION rather
  // than the player.
  //
  // 1. THE LABEL IS NOT THE SESSION. These pages call a season "2018 Spring/
  //    Summer Regular Season"; the day schedules that recovered its thirteen
  //    games call it "Summer 2018"; the roster pages say "2019-20 Regular
  //    Season" where the scoresheets say "2019-20". Push a league row under
  //    its own spelling and the site grows a second Summer 2018 sitting beside
  //    the first, each holding half the evidence — the exact fault that once
  //    forged duplicate 2016-17, 2017-18 and 2019-20 sessions here. So the
  //    session is resolved through `sessions.ts` to a `sort` and matched on
  //    THAT, taking the id an existing session already uses. Where none does,
  //    `sessionLabel` names it — which is the same function, and so the same
  //    string, the game record would produce for that sort.
  // 2. A SESSION `sessions.ts` CANNOT PLACE IS NOT PLACED. "2021 Spring HAHL
  //    Regular Season" parses to nothing, and a row filed at sort 0 would sort
  //    itself in front of 1993. It is dropped rather than guessed at.
  const idBySort = new Map<number, string>();
  for (const r of raw) {
    const p = parseSessionLabel(r.session);
    if (p && !idBySort.has(p.sort)) idBySort.set(p.sort, r.session);
  }

  // Snapshot: only these may veto a leaderboard row. Taken before the pushes
  // below so that no league row can ever be the reason another is dropped.
  const stated = [...raw];
  for (const r of league) {
    const p = parseSessionLabel(r.session);
    if (!p) continue;
    r.session = idBySort.get(p.sort) ?? sessionLabel(p);

    // ALREADY KNOWN, FROM A BETTER PAGE. Matched on the parsed session and on
    // `namesMatch` — the same matcher identity resolution uses further down —
    // because a row that slips through under a second spelling of one man's
    // name gets merged into him ten lines later and silently doubles the
    // season. Cheap: eighteen leaderboard rows against a few hundred.
    const known = stated.some(
      (x) =>
        x.authority > r.authority &&
        x.phase === r.phase &&
        parseSessionLabel(x.session)?.sort === p.sort &&
        namesMatch(x.name, r.name).match,
    );
    if (known) continue;
    raw.push(r);
  }

  // ---- one row per player-season-phase --------------------------------
  //
  // The keystone site was archived FOUR times while the 2012-13 season was
  // still being written up: one snapshot is captioned "Still missing game # 2
  // stats" and a later one "Missing Game 25". They are the same season at two
  // stages of completeness, and summing them would have handed Bryan two
  // seasons he never played. Career totals are a plain sum over these rows,
  // so a duplicate here is not a display bug, it is a fabricated statistic.
  //
  // The latest snapshot wins: the team's last word on a season is the one they
  // meant. Keyed on phase as well as session so that a regular season and its
  // playoffs — which are two real, separate, both-countable things — never
  // collapse into each other.
  //
  // AUTHORITY OUTRANKS RECENCY. The league tables were archived in 2020 and
  // 2021, years after the roster pages they overlap, so on snapshot date alone
  // a leaderboard row would beat a roster page and take a real games-played
  // figure down to null with it. "Latest wins" answers "which of these is the
  // team's final word"; it cannot answer "which of these is the better page".
  // Every roster-shaped row carries the same authority, so this is a no-op for
  // every source that existed before the league tables did.
  //
  // AND WHERE EVERYTHING ELSE TIES, THE FULLER PAGE WINS. Two DigitalShift
  // routes describe the same modern season — the player's career table and the
  // team's roster table — and they collide here by design (see the fold above).
  // Both are live sources, so both carry snap 0 and both are ROSTER authority:
  // nothing above can separate them, and the winner would be decided by which
  // capture the corpus happened to list first. One of them records the man's
  // JERSEY NUMBER and the other does not, so that is the tie-break, and it is
  // the same principle as the two rules above rather than a new one: prefer the
  // page that says more. Without it, the four men this archive had wearing a
  // default 99 keep it for every season whose playoffs have not been played.
  const best = new Map<string, Raw>();
  for (const r of raw) {
    // pageId keyed IN, deliberately. Two distinct roster pages for one man in
    // one season are two real roster spots and both count; two CAPTURES of the
    // same page are one row and the later snapshot wins. Keying on the page's
    // own id tells those apart, which name|session|phase|source could not.
    const k = `${r.name}|${r.session}|${r.phase}|${r.source}|${r.pageId ?? ""}`;
    const prev = best.get(k);
    const better = !prev
      || r.authority > prev.authority
      || (r.authority === prev.authority && r.snap > prev.snap)
      || (r.authority === prev.authority && r.snap === prev.snap
          && r.jersey !== null && prev.jersey === null);
    if (better) best.set(k, r);
  }
  const deduped = [...best.values()];
  raw.length = 0;
  raw.push(...deduped);

  // ---- the roster sidebar, applied last and only where nothing else speaks --
  //
  // A man named in a team's sidebar was on that team. That is the whole claim,
  // and it is worth publishing: five HarborCenter seasons stood on this site
  // holding two to four players out of sixteen while their rosters sat in the
  // corpus, inside pages the build was already reading and was throwing the
  // sidebar away from.
  //
  // ADDED ONLY WHERE THE SESSION HAS NO LINE FOR HIM. Matched on `namesMatch`,
  // the same resolver identity uses, so a man already on file under a second
  // spelling is not added again beside himself. Never displaces, never merges,
  // never fills a figure — every stat stays null, because the card states none
  // and a zero would be an invention.
  {
    let addedN = 0;
    const seen = new Set<string>();
    for (const m of sidebarMates) {
      const p = parseSessionLabel(m.session);
      if (!p) continue;
      // One card per man per session, however many pages carried the sidebar.
      const k = `${m.name}|${p.sort}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const already = raw.some(
        (x) => parseSessionLabel(x.session)?.sort === p.sort && namesMatch(x.name, m.name).match,
      );
      if (already) continue;
      raw.push({
        name: m.name, session: m.session, team: m.team, jersey: m.jersey,
        position: m.position, source: m.source, phase: m.phase, snap: m.snap,
        pageId: m.pageId, authority: ROSTER, kind: m.kind, goalie: null,
        gp: null, g: null, a: null, pts: null, pim: null,
      });
      addedN++;
    }
    if (sidebarMates.length > 0) {
      console.log(
        `roster sidebars: ${sidebarMates.length} cards read across ${seen.size} man-seasons — `
        + `${addedN} added as roster-only lines, ${seen.size - addedN} already on file with figures`,
      );
    }
  }

  // ---- the captain's roster emails, applied on exactly the sidebar's terms --
  //
  // A roster the captain sent at the time, stored verbatim in
  // `docs/research/captain-roster-emails/*.txt` and read HERE from the record
  // those files were parsed into — `data/derived/roster-emails.json`, written
  // by `npm run derive:private`. The emails are unpublished because six rows of
  // one of them end in a USA Hockey registration number; the record is not,
  // because the parser strips them before anything else sees the row and the
  // stored artefact is asserted clean. See `derived.ts`.
  //
  // It is the only source here that was never on the internet, so it is
  // labelled `captain-roster-email` and the site says so wherever it appears.
  //
  // THE SAME THREE RULES AS THE SIDEBAR, FOR THE SAME REASONS:
  //
  //   1. APPLIED AFTER THE DEDUP, and only where the session holds no line for
  //      that man at all. Matched with `namesMatch`, the resolver identity
  //      itself uses, so "Andy Murphy" does not appear beside "Andrew Murphy"
  //      and "Greg Suffoletto" is not mistaken for his brother Alex.
  //   2. EVERY FIGURE NULL. The email states a name, a number and a position
  //      and no statistic whatever. A zero here would be this archive claiming
  //      thirteen men played a season and got nothing out of it.
  //   3. NEVER DISPLACES. Bryan Karchensky and Corey Muff are already on file
  //      for 2018 Spring/Summer WITH figures, off the league's own scoring
  //      table. The email names them too, and is ignored for both.
  //
  // A number the email did not know is null, not a guess and not last season's:
  // numbers are reused in this club, and this very email gives 2 to Anthony
  // Gugino where Justin Wheeler wore 2 in 2011. The five emails prove it twice
  // more between themselves — Greg Suffoletto is 28 in 2018-19 and 26 in Summer
  // 2019, and Mark Lucatra wears that 26 the winter after.
  //
  // THE ONE THING AN EXISTING LINE DOES TAKE FROM AN EMAIL is its roster
  // STATUS, and only where it has none. That is not a displacement: no league
  // page in this archive has ever published who was rostered, who was taxi
  // squad and who was hurt, so there is nothing on the line to displace. Corey
  // Muff is on file for the COVID season off a goaltender table and is
  // "Rostered" at #1 in the email; without this he would be the one man in a
  // nineteen-man squad whose standing the archive holds and does not say. Not
  // one figure, number, position or provenance is touched.
  {
    let files = 0;
    let cards = 0;
    let addedN = 0;
    let refusedN = 0;
    const skipped: string[] = [];
    const statuses: string[] = [];
    for (const f of readRosterEmails(DATA, process.cwd())) {
      files++;
      refusedN += f.refused;
      if (f.unread.length > 0) {
        // No silent truncation: say what in the stored email was not read.
        console.log(
          `roster email ${f.file}: ${f.unread.length} line(s) not read as roster rows `
          + `(${f.unread.map((u) => JSON.stringify(u.slice(0, 40))).join(", ")})`,
        );
      }
      const p = parseSessionLabel(f.session);
      if (!p) {
        console.warn(`roster email ${f.file}: unparseable session ${JSON.stringify(f.session)} — SKIPPED`);
        continue;
      }
      for (const e of f.entries) {
        cards++;
        // Every line this session already holds for this man — BOTH of them
        // where a season has a regular season and a playoff line, because a
        // status belongs to the man's standing on the squad, not to a phase.
        const mine = raw.filter(
          (x) => parseSessionLabel(x.session)?.sort === p.sort && namesMatch(x.name, e.name).match,
        );
        if (mine.length > 0) {
          for (const x of mine) {
            if (e.status && !x.status) {
              x.status = e.status;
              statuses.push(`${e.name} (${e.status})`);
            }
          }
          skipped.push(e.name);
          continue;
        }
        raw.push({
          name: e.name, session: f.session, team: e.team, jersey: e.jersey,
          position: e.position, source: "captain-roster-email", phase: "Regular Season",
          status: e.status,
          // snap 0: this is not a snapshot of a page, and it must never win a
          // recency tie-break against one.
          snap: 0, pageId: f.file, authority: ROSTER,
          kind: e.position === "G" ? "goalie" : "skater", goalie: null,
          gp: null, g: null, a: null, pts: null, pim: null,
        });
        addedN++;
      }
    }
    if (files > 0) {
      console.log(
        `roster emails: ${files} file(s), ${cards} roster line(s) — ${addedN} added with every figure null, `
        + `${skipped.length} already on file (${skipped.join(", ") || "none"})`,
      );
      if (statuses.length > 0) {
        console.log(`roster emails: roster status added to ${statuses.length} existing line(s): ${statuses.join(", ")}`);
      }
      // The COUNT of refused registration identifiers, never one of the values.
      // Printing a personal identifier to prove it was refused would be the
      // leak the refusal exists to prevent. The refusal happened when the
      // emails were derived; the count is carried in the record so that the
      // build can still say it, which is the point of saying it.
      console.log(
        `roster emails: ${refusedN} USA Hockey registration identifier(s) refused at the parse boundary`,
      );
    }
  }

  // ---- the statistics workbook, reconciled against the captured pages ----
  //
  // THE FULLER RECORD WINS. The captain's ruling, in his words: "favor the
  // source with more data."
  //
  // The workbook and the corpus overlap on six sessions, and where they overlap
  // they mostly agree exactly — Winter 2012-13's thirty lines are identical to
  // the team's own archived roster page, cell for cell, which is the strongest
  // check this file has that the workbook is the same record and not a second
  // draft of it.
  //
  // Where they differ they differ in one direction. The surviving capture is a
  // snapshot of a season still being played: `Team_Roster___Stats` was last
  // archived on 26 May 2013 with Summer 2013 seven games into sixteen, and the
  // home page's 2014-15 point leaders were caught in December and February and
  // never again — while the PLAYOFF table beside them was updated in April and
  // matches the workbook exactly, all fifteen rows. The workbook holds those
  // seasons finished. Preferring it is not preferring a spreadsheet over the
  // internet; it is preferring the reading taken later, and `fuller()` below
  // decides that off the figures rather than off the name of the source, so a
  // page that turns out to hold more than the book beats the book.
  //
  // THE FOUR OUTCOMES, and each is decided by the evidence rather than a rule
  // about sources:
  //
  //   ADDED       No page has this man in this phase of this season. 171 lines,
  //               seven whole sessions among them, and for those the workbook is
  //               all there is.
  //   SUPERSEDED  A page has him, states FEWER figures, and agrees with the book
  //               on every one it states. That page is the home-page point
  //               leaders: a name and a points total, nothing else. The book's
  //               line is the same fact with games, goals, assists and penalty
  //               minutes attached, so it stands in — and because the points
  //               agree, no total moves; nulls become numbers.
  //   FULLER      A page states a figure the book contradicts, and the book is
  //               the fuller record of the two. The book's line stands in whole
  //               and the page's figures are kept as evidence, in the case the
  //               Department raises below.
  //   THINNER     The same disagreement the other way up: the PAGE is the fuller
  //               record. Its figures stand and the book's line is dropped.
  //
  // WHICHEVER SIDE WINS TAKES THE WHOLE LINE. Never half of each. Fill a
  // mid-season points total with a full season's goals and assists and G + A no
  // longer makes PTS — a row that was never true anywhere, in any source.
  const bookNotes: string[] = [];
  /** Every line the workbook and a captured page state differently, for §the
   *  Department's cases below. Structured rather than scraped back out of the
   *  log: a case that reads its own evidence out of a printed string is a case
   *  that goes quietly wrong the first time the string is reworded. */
  const bookClashes: {
    session: string; phase: string; name: string; pageSource: string;
    bookWon: boolean;
    fields: { key: string; book: unknown; page: unknown }[];
  }[] = [];
  {
    // The label already in use for each session, so the workbook's own spelling
    // ("Winter 2015 / 16") never opens a SECOND session at a sort that already
    // has one. `sessMap` below is keyed on the raw label, so two spellings of
    // one season become two sessions with the same id — the exact bug the
    // session block downstream carries a paragraph about.
    const labelBySort = new Map<number, string>();
    for (const r of raw) {
      const p = parseSessionLabel(r.session);
      if (p && !labelBySort.has(p.sort)) labelBySort.set(p.sort, r.session);
    }

    const same = (a: unknown, b: unknown): boolean => {
      const na = Number(a), nb = Number(b);
      return Number.isFinite(na) && Number.isFinite(nb) ? na === nb : String(a) === String(b);
    };
    const told = (v: unknown) => v !== null && v !== undefined && String(v) !== "";

    /**
     * A COLUMN NOBODY FILLED IN IS NOT A COLUMN OF NOUGHTS — §2.4, applied to a
     * whole block instead of a single cell.
     *
     * Summer 2016's penalty-minute column is nought in all thirteen skater rows
     * of an eleven-game season. It is the only one of the workbook's nineteen
     * blocks that is: every other one carries penalty minutes, including three
     * four-day tournaments and five short playoff runs, and the neighbours
     * either side of this block are 74 and 168. Vincent Terrana takes 28 the
     * summer before and 24 the winter after and nothing in between; the same
     * block's power-play and short-handed columns are nought too, which is the
     * shape of a captain who stopped filling three columns that summer.
     *
     * Read literally it was printed as fact in a season row on thirteen player
     * pages and summed into thirteen career totals — the same defect the site
     * already refuses twice over in DigitalShift's `sv: "0"` and `.000`, which
     * `savesOf` and `savePctOf` catch a cell at a time. A cell cannot be caught
     * a cell at a time here: one man with no penalties in a season is ordinary.
     * A whole team, all season, is a column.
     *
     * REPORTED, NOT REPAIRED. Nothing is invented and no figure moves — a sum
     * over noughts is the same sum — the cells simply stop claiming to be
     * measurements, and `bookNotes` says which. The floor keeps it from firing
     * on a block too small to mean anything.
     */
    const BLOCK_FLOOR = 5;
    const COUNTING = ["G", "A", "PTS", "PIM"] as const;
    const unfilled = new Set<string>();
    {
      const blocks = new Map<string, (typeof STATS_BOOK)[number][]>();
      for (const l of STATS_BOOK) {
        if (l.kind === "goalie") continue;
        const key = `${l.season}|${l.phase}`;
        blocks.set(key, [...(blocks.get(key) ?? []), l]);
      }
      for (const [key, block] of blocks) {
        for (const column of COUNTING) {
          const values = block
            .map((l) => l.stats[column])
            .filter((v): v is string => v !== undefined && v !== "");
          if (values.length < BLOCK_FLOOR) continue;
          if (values.every((v) => Number(v) === 0)) {
            unfilled.add(`${key}|${column}`);
            bookNotes.push(
              `UNFILLED COLUMN  ${key.replace("|", " · ")} — ${column} is nought in all `
              + `${values.length} skater rows; read as unrecorded, not as zero`,
            );
          }
        }
      }
    }
    const bookColumn = (
      l: (typeof STATS_BOOK)[number],
      column: (typeof COUNTING)[number],
    ): number | null =>
      l.kind === "goalie" || unfilled.has(`${l.season}|${l.phase}|${column}`)
        ? null
        : num(l.stats[column]);

    let addedN = 0, supersededN = 0, agreedN = 0, fullerN = 0, thinnerN = 0;
    for (const l of STATS_BOOK) {
      const p = parseSessionLabel(l.season);
      if (!p) {
        // A SESSION `sessions.ts` CANNOT PLACE IS NOT PLACED — the same rule
        // every other source here follows.
        bookNotes.push(`UNPLACEABLE  ${l.season} — ${l.name} dropped`);
        continue;
      }
      const b: Raw = {
        name: l.name,
        session: labelBySort.get(p.sort) ?? sessionLabel(p),
        team: "Golden Retrievers",
        jersey: l.jersey || null,
        position: l.kind === "goalie" ? "G" : (l.position || null),
        source: "roster-book",
        // The workbook heads a tournament's one phase "Tournament". The archive
        // records that a session IS a tournament on the session itself, and the
        // ten 2015 Invitational lines already on the site are filed "Regular
        // Season". Left as written, the same event would carry two phase names
        // depending on which year it was, and the 2015 lines would not match
        // their own workbook rows and would double.
        phase: l.phase === "Tournament" ? "Regular Season" : l.phase,
        snap: 0,
        pageId: null,
        authority: ROSTER,
        kind: l.kind,
        goalie: l.kind === "goalie" ? bookGoalie(l.stats) : null,
        gp: num(l.stats.GP),
        // A goaltender's row carries no G/A/PTS at all, and his GA is goals
        // AGAINST. There is no honest way to add it to a column headed G.
        g: bookColumn(l, "G"),
        a: bookColumn(l, "A"),
        pts: bookColumn(l, "PTS"),
        pim: bookColumn(l, "PIM"),
      };

      // Matched on the PARSED session and on `namesMatch` — the same matcher
      // identity resolution uses — so a line that slips through under a second
      // spelling does not get merged into the same man ten lines later and
      // silently double his season.
      const i = raw.findIndex(
        (x) =>
          x.source !== "roster-book" &&
          x.kind === b.kind &&
          x.phase === b.phase &&
          parseSessionLabel(x.session)?.sort === p.sort &&
          namesMatch(x.name, b.name).match,
      );
      if (i < 0) {
        raw.push(b);
        addedN++;
        continue;
      }

      const page = raw[i]!;
      const fields: [string, unknown, unknown][] = b.kind === "skater"
        ? [["GP", b.gp, page.gp], ["G", b.g, page.g], ["A", b.a, page.a],
           ["PTS", b.pts, page.pts], ["PIM", b.pim, page.pim]]
        : [["GP", b.gp, page.gp],
           ...["W", "L", "T", "SO", "GA", "SV"].map(
             (k): [string, unknown, unknown] => [k, b.goalie?.[k] ?? null, page.goalie?.[k] ?? null]),
          ];

      const clash = fields.filter(([, mine, theirs]) => told(theirs) && !same(mine, theirs));
      if (clash.length > 0) {
        // WHICH OF THE TWO IS THE FULLER RECORD, measured on the row and on
        // nothing else. No session is named here and neither is a source: the
        // same two numbers would settle a future disagreement the same way.
        //
        // BREADTH first — how many of these figures the line states at all.
        // A points-leaders row states a name and a points total; the book's
        // line states games, goals, assists and penalty minutes beside it. Five
        // figures is a fuller account of a season than one, whoever holds it.
        // This is the same test `SUPERSEDED` above already applies and the same
        // one the roster tie-break applies — prefer the source that says more.
        //
        // DEPTH on a tie — the total of the figures BOTH lines state. Every
        // column in play is a COUNTING column: games, goals, assists, points,
        // penalty minutes; wins, losses, ties, shutouts, goals against, saves.
        // Not one is a rate or an average, so a bigger total means more of the
        // season is in the line, NOT that the line flatters anyone. A table
        // frozen seven games into sixteen is smaller in every column at once,
        // which is the signature being read. Restricted to shared figures so
        // breadth is not counted twice.
        //
        // DEAD HEAT — the page keeps it. Nothing separates them, so nothing
        // moves, and the published figure stays where it was.
        const stated = (side: 0 | 1) => fields.filter((f) => told(f[side + 1])).length;
        const shared = fields.filter(
          ([, mine, theirs]) =>
            told(mine) && told(theirs) &&
            Number.isFinite(Number(mine)) && Number.isFinite(Number(theirs)),
        );
        const depth = (side: 0 | 1) =>
          shared.reduce((t, f) => t + Number(f[side + 1]), 0);
        const bookWon = stated(0) !== stated(1)
          ? stated(0) > stated(1)
          : depth(0) > depth(1);

        bookClashes.push({
          session: b.session, phase: b.phase, name: b.name, pageSource: page.source,
          bookWon,
          fields: clash.map(([key, book, page]) => ({ key, book, page })),
        });
        bookNotes.push(
          `${bookWon ? "FULLER     " : "THINNER    "} ${b.session} ${b.phase} · ${b.name} — ` +
          clash.map(([k, mine, theirs]) => `${k} book ${mine} / page ${theirs}`).join(", ") +
          `  [${bookWon ? "book kept" : `page kept: ${page.source}`}` +
          `; states ${stated(0)}v${stated(1)}, totals ${depth(0)}v${depth(1)}]`,
        );
        // WHOLE LINE OR NOTHING. `raw[i] = b` replaces the page's row outright,
        // carrying the book's provenance with it, so what the site prints and
        // what it says the figure came from can never come apart.
        if (bookWon) { raw[i] = b; fullerN++; } else { thinnerN++; }
        continue;
      }
      const adds = fields.filter(([, mine, theirs]) => !told(theirs) && told(mine));
      if (adds.length === 0) {
        agreedN++;
        continue;
      }
      raw[i] = b;
      supersededN++;
      bookNotes.push(
        `SUPERSEDED  ${b.session} ${b.phase} · ${b.name} — ` +
        `${page.source} stated ${fields.filter(([, , t]) => told(t)).map(([k]) => k).join("/") || "nothing"} and agrees; ` +
        `book adds ${adds.map(([k, mine]) => `${k} ${mine}`).join(", ")}`,
      );
    }

    if (STATS_BOOK.length > 0) {
      console.log(
        `statistics workbook: ${STATS_BOOK.length} lines read — ` +
        `${addedN} added, ${supersededN} superseded a points-only row, ` +
        `${agreedN} already on file and identical, ` +
        `${fullerN} disagreed and the book was the fuller record, ` +
        `${thinnerN} disagreed and the page was`,
      );
      for (const n of bookNotes.filter((x) => !x.startsWith("SUPERSEDED"))) console.log(`  ${n}`);
    }
  }

  // ---- identity: 57 recorded names -> 49 people -----------------------
  const names = [...new Set(raw.map((r) => r.name))];
  const parent = new Map(names.map((n) => [n, n]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p); parent.set(x, r); return r;
  };
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      if (namesMatch(names[i]!, names[j]!).match) {
        const a = find(names[i]!), b = find(names[j]!);
        if (a !== b) parent.set(a, b);
      }

  // Canonical = the longest recorded form: a registered name beats a nickname,
  // and "Vincent Terrana" beats "Vinny Terana".
  //
  // ONE THING THE LONGEST FORM CANNOT DECIDE IS THE CAPITAL IN A SURNAME.
  // Every platform that files a Mc- name lowercases the letter after it, so the
  // archive spells one of its own players "Sean Mccormick" while the handoff
  // and the identity rules spell him McCormick. That is not a disagreement
  // between sources — it is a form nobody uses, in the one place the person it
  // belongs to will notice first. It restores nothing else: the rule fires only
  // on "Mc" followed by a lowercase letter, so Macdonald, Macey and every
  // ordinary surname pass through untouched.
  //
  // AND WHERE LENGTH CANNOT DECIDE, THE RECORD DOES — never the alphabet.
  // Two spellings of one surname are usually the same length, and the tie-break
  // was `localeCompare`: "Alex Suffaletto" beat "Alex Suffoletto" because an a
  // sorts before an o. Seven lines of the team's own roster book spell him
  // Suffoletto and one Erie Metro table spells him Suffaletto, so the site
  // filed a man under the one form the record uses least, and slugged his page
  // with it. The count of how often a spelling was actually written down is
  // evidence; alphabetical order is not evidence of anything. This decides one
  // name in the archive today (§2.5, owner-confirmed: he is Alex Suffoletto,
  // and he is NOT his brother Gregory — see `namesMatch`, which vetoes that
  // merge on the given name and is untouched by any spelling of the surname).
  const recordedTimes = new Map<string, number>();
  for (const r of raw) recordedTimes.set(r.name, (recordedTimes.get(r.name) ?? 0) + 1);
  const members = new Map<string, string[]>();
  for (const n of names) {
    const r = find(n);
    members.set(r, [...(members.get(r) ?? []), n]);
  }
  const canon = new Map<string, string>();
  for (const [, ms] of members) {
    const best = [...ms].sort(
      (a, b) =>
        b.length - a.length
        || (recordedTimes.get(b) ?? 0) - (recordedTimes.get(a) ?? 0)
        || a.localeCompare(b),
    )[0]!;
    for (const m of ms) canon.set(m, properSurname(best));
  }

  // ---- scoring standings attach to the resolved player ------------------
  //
  // A leaderboard names a man in the platform's own spelling; the same
  // `namesMatch` that resolves identity everywhere else maps it to the
  // canonical person, so "Bryan Karchensky" on a 2024 leaderboard lands on the
  // same page as every other spelling of him. A standing that matches nobody is
  // REPORTED, never silently dropped — it means a scorer the leaderboards knew
  // never reached a roster page, which is a hole worth seeing.
  const resolveCanon = (name: string): string | null => {
    if (canon.has(name)) return canon.get(name)!;
    for (const x of names) if (namesMatch(name, x).match) return canon.get(x) ?? null;
    return null;
  };
  const ranksByPlayer = new Map<string, ScoringRank[]>();
  const unplacedFinishes = new Set<string>();
  for (const { name, rank } of standings.values()) {
    const key = resolveCanon(name);
    if (!key) {
      unplacedFinishes.add(name);
      continue;
    }
    ranksByPlayer.set(key, [...(ranksByPlayer.get(key) ?? []), rank]);
  }
  if (unplacedFinishes.size > 0) {
    console.warn(
      `scoring ranks: ${unplacedFinishes.size} leaderboard name(s) matched no roster player: ${[...unplacedFinishes].join(", ")}`,
    );
  }
  // Oldest first — a career of standings reads as a timeline.
  for (const [, list] of ranksByPlayer) list.sort((a, b) => a.sessionSort - b.sessionSort);

  // ---- games played, where the league never counted them -----------------
  //
  // THE COLUMN DOES NOT EXIST. This is not a capture gap and no fetch can
  // close it. HAHL's SportsEngine era printed skaters as
  //
  //     # | Name | G | A | PTS | PEN | PIM
  //
  // and goaltenders as `# | Name | GP | W | L | GA`. Measured across every
  // such page in the corpus rather than reasoned about: 24 team statistics
  // pages, 7 division tables, both league tables, and Bryan Karchensky's own
  // player page for 2018-19 — every one of them, for every team in the
  // league, has no games column over a skater. Four lines in this archive
  // therefore carry points with no denominator, and always will.
  //
  // The captain was told what filling them asserts and ruled anyway: "Put in
  // the GP numbers even though we don't have them exactly." So they are
  // filled — and flagged, because a filled figure is the number of games the
  // TEAM played, not the number this man did.
  //
  // THE FIGURE IS THE GOALTENDER'S. One rule, both sessions, and it is the
  // largest number of games either session is evidenced to have played:
  //
  //   2018 - Summer  Corey Muff 13 GP. The standings row says 12, and the
  //                  difference is not a disagreement — removing exactly one
  //                  game from the archive's own 13-game log, 2018-08-23 at
  //                  Eat Rite Foods, reproduces that row on all four of its
  //                  figures at once (13-1 GP, 4-1 losses, 78-4 GF, 66-7 GA).
  //                  12 is the regular season; 13 is the season. The points
  //                  being divided come off the league table, whose own
  //                  linescore total for the club is 78 — the 13-game figure —
  //                  so 13 is the denominator that matches its numerator.
  //   2018 - Winter  Corey Muff 23 GP, and the standings row says 23 too.
  //
  // Keyed on session AND phase: a playoff line must never be divided by a
  // regular season's games. Never overwrites a recorded GP, and never lands on
  // a line that has no statistics on it at all — a roster-sidebar teammate is
  // a name and a number, and giving him a games total would put a season on
  // the site that nobody recorded him playing (§2.4, absence is not zero).
  const gpFilled: string[] = [];
  {
    const teamGames = new Map<string, { gp: number; who: string }>();
    for (const r of raw) {
      if (r.kind !== "goalie" || r.gp === null) continue;
      const key = `${r.session}|${r.phase}`;
      const best = teamGames.get(key);
      if (!best || r.gp > best.gp) teamGames.set(key, { gp: r.gp, who: r.name });
    }
    for (const r of raw) {
      if (r.kind !== "skater" || r.gp !== null) continue;
      if (r.g === null && r.a === null && r.pts === null && r.pim === null) continue;
      const t = teamGames.get(`${r.session}|${r.phase}`);
      if (!t) continue;
      r.gp = t.gp;
      r.gpInferred = true;
      r.gpBasis = `team games — ${t.who} tended ${t.gp} this session; the league recorded no skater games`;
      gpFilled.push(`${r.name} · ${r.session} · ${r.phase}: gp ${t.gp}`);
    }
  }
  if (gpFilled.length > 0) {
    console.warn(
      `games played inferred on ${gpFilled.length} line(s) — flagged gpInferred in site.json:\n  ` +
        gpFilled.join("\n  "),
    );
  }

  // ---- players --------------------------------------------------------
  const acc = new Map<string, {
    name: string; aliases: Set<string>; jerseys: Map<string, number>;
    positions: Set<string>; seasons: PlayerSession[];
  }>();
  for (const r of raw) {
    const key = canon.get(r.name)!;
    const p = acc.get(key) ?? {
      name: key, aliases: new Set<string>(), jerseys: new Map<string, number>(),
      positions: new Set<string>(), seasons: [],
    };
    p.aliases.add(r.name);
    if (r.jersey) p.jerseys.set(r.jersey, (p.jerseys.get(r.jersey) ?? 0) + 1);
    if (r.position) p.positions.add(r.position);
    p.seasons.push({
      session: r.session, phase: r.phase, team: r.team, recordedAs: r.name, jersey: r.jersey,
      kind: r.kind,
      // Verbatim, and only the columns the source actually printed. GAA is
      // 4.95 against 45-minute games and svPct arrives as "0.875%" — a percent
      // sign on a ratio. Both stay as written: parsing them would be the
      // archive deciding what a scorekeeper meant.
      goalie: r.goalie
        ? {
            w: r.goalie.W ?? null, l: r.goalie.L ?? null, t: r.goalie.T ?? null,
            so: r.goalie.SO ?? null, ga: r.goalie.GA ?? null, gaa: r.goalie.GAA ?? null,
            sv: r.goalie.SV ?? r.goalie.Sv ?? null,
            svPct: r.goalie["SV %"] ?? r.goalie["SV%"] ?? r.goalie["Sv%"] ?? null,
          }
        : null,
      position: r.position, gp: r.gp, g: r.g, a: r.a, pts: r.pts, pim: r.pim,
      // Null unless a source said. One ever has — see PlayerSession.status.
      status: r.status ?? null,
      gpInferred: r.gpInferred ?? false, gpBasis: r.gpBasis ?? null,
      provenance: SOURCES[r.source] ?? { source: r.source, label: r.source, archiveOnly: false },
    });
    acc.set(key, p);
  }

  const players: Player[] = [...acc.values()].map((p) => {
    const sum = (k: keyof PlayerSession) =>
      p.seasons.reduce((s, x) => s + ((x[k] as number | null) ?? 0), 0);
    const gp = sum("gp"), pts = sum("pts");

    // A RATE NEEDS BOTH ITS TERMS OUT OF THE SAME GAMES.
    //
    // The 2018 league tables record points and no games played — the column
    // does not exist those sessions, for anyone, on any page. Divide a whole
    // career's points by only the games that happen to be known and the 109
    // points Bryan Karchensky scored across Summer 2018 and 2018-19 are
    // credited against no games at all: 3.09 a game, for a man who averaged
    // 2.61. Neither total above is wrong. PAIRING them is.
    //
    // So the rate is taken over the seasons that record both terms, and a
    // season that cannot answer sits the question out instead of quietly
    // answering nought (§2.4).
    //
    // Those four lines now DO carry games, filled from the goaltender's — see
    // the fill above — so they are back in the rate, and the rate is honest
    // again in its arithmetic and inferred in one of its terms. `gpInferred`
    // travels with the career so the page can say which, and it is the only
    // reason this figure is safe to print.
    const rated = p.seasons.filter((s) => s.gp !== null && s.pts !== null);
    const ratedGp = rated.reduce((n, s) => n + (s.gp ?? 0), 0);
    const ratedPts = rated.reduce((n, s) => n + (s.pts ?? 0), 0);
    const gpInferred = rated.some((s) => s.gpInferred);

    return {
      slug: slugify(p.name),
      name: p.name,
      aliases: [...p.aliases].filter((a) => a !== p.name).sort(),
      // THE ROSTER BOOK WINS ON NUMBERS.
      //
      // Every other jersey here is a tally: the number a man was recorded
      // wearing most often, across whatever platforms bothered to write one
      // down. HarborCenter has run this league for eleven sessions and does
      // not collect numbers at all, so fourteen men had none from any source.
      //
      // The captain's own spreadsheet has them, and he set the rule: "The most
      // recent number for a player should be what we typically use to
      // represent them officially." So the book's latest goes first and the
      // tally follows it. This is the only figure on the site that comes from
      // a person rather than a page, and the site says which is which.
      jerseys: (() => {
        // Sorted by how often the number was worn, and TIES BROKEN BY THE
        // NUMBER so the output is byte-stable. Sorting on the tally alone left
        // equal counts in Map insertion order, which is corpus-read order — so
        // two runs over the same bytes could emit ["7","8","89"] and
        // ["8","7","89"], and every scheduled regeneration produced a diff for
        // no reason. A jersey is a string here and one of them is "0", so the
        // tie-break is numeric with a string fallback.
        const found = bookJersey(
          p.name,
          [...p.jerseys]
            .sort((a, b) => b[1] - a[1] || (Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0])))
            .map(([j]) => j),
        );
        return found.length > 0 ? found : ["99"];
      })(),
      positions: [...p.positions].sort(),
      career: {
        sessions: new Set(p.seasons.map((s) => s.session)).size,
        gp, g: sum("g"), a: sum("a"), pts, pim: sum("pim"),
        ppg: ratedGp ? Number((ratedPts / ratedGp).toFixed(2)) : 0,
        gpInferred,
      },
      seasons: p.seasons
        .map((s) => {
          const parsed = parseSessionLabel(s.session);
          return parsed ? { ...s, session: sessionLabel(parsed) } : s;
        })
        .sort((a, b) =>
          (parseSessionLabel(a.session)?.sort ?? 0) - (parseSessionLabel(b.session)?.sort ?? 0)),
      scoringRanks: ranksByPlayer.get(p.name) ?? [],
    };
  }).sort((a, b) => b.career.pts - a.career.pts);

  // ---- assist network (canonical names) --------------------------------
  const edgeMap = new Map<string, number>();
  for (const x of goals)
    for (const a of x.assists) {
      const from = canon.get(a) ?? a, to = canon.get(x.scorer) ?? x.scorer;
      const k = `${from} ${to}`;
      edgeMap.set(k, (edgeMap.get(k) ?? 0) + 1);
    }
  const assists: AssistEdge[] = [...edgeMap].map(([k, n]) => {
    const [from, to] = k.split(" ");
    return { from: from!, to: to!, n };
  }).sort((a, b) => b.n - a.n);

  const pairMap = new Map<string, number>();
  for (const e of assists) {
    const k = [e.from, e.to].sort().join(" ");
    pairMap.set(k, (pairMap.get(k) ?? 0) + e.n);
  }
  const partnerships = [...pairMap].map(([k, n]) => {
    const [a, b] = k.split(" ");
    return { a: a!, b: b!, n };
  }).sort((x, y) => y.n - x.n);

  // ---- the game record --------------------------------------------------
  //
  // WHICH LEAGUE A RECAP GAME WAS PLAYED IN, from the captain's workbook.
  //
  // The club's own site prints both its leagues in a masthead on every page —
  // "Erie Metro Hockey League / Labatt Senior Hockey League" — and never says
  // which one a given game belonged to. The workbook does, one league per
  // session block ("Winter 2012 / 13" is EMHL, "Summer 2013" is LSHL), and
  // both files are the same source to a reader (see SOURCES). Joined on the
  // parsed session, never on the label, for the reason the sessions pass
  // records at length.
  const leagueBySort = new Map<number, string>();
  for (const row of STATS_BOOK) {
    if (!row.league) continue;
    const p = parseSessionLabel(row.season);
    if (p) leagueBySort.set(p.sort, row.league);
  }

  const { games, totals: gameTotals } = buildGames(
    {
      sheets: gameSheets, teamSchedules, daySchedules, hsSchedules, boxscores: hsBoxscores,
      recentGames: recentGamePages, recaps: recapCaptures, schedules: schedulePages,
      leagueBySort,
    },
    (source) => SOURCES[source] ?? { source, label: source, archiveOnly: false },
  );

  // ---- the league's own word on each season ------------------------------
  //
  // Standings rows and club stat lines, read AFTER the player passes because
  // they describe SESSIONS, not people. Everything here follows rules the
  // file already enforces elsewhere:
  //
  //   - THE TEAM COMES FROM THE ROW. A standings page lists a whole league,
  //     and four other leagues' standings arrived in the same crawl.
  //   - THE LATEST SNAPSHOT WINS, whole-page. The 2019-20 table was captured
  //     both mid-season (9 GP, eighth place) and settled (19 GP, second);
  //     they are one season at two moments and only the last word counts.
  //     Club stat lines are taken off ONE page for the same reason — a
  //     goalie cell from December must never sit beside a scoring cell from
  //     March as if the league had printed them together.
  //   - A SESSION sessions.ts CANNOT PLACE IS NOT PLACED.
  //
  // The Wayback timestamp doubles as the row's provenance-in-time: for the
  // 2020-21 season the one capture predates the season's end, and `final:
  // false` is how the data says "this is what was recorded by 20 April 2021"
  // — the site renders the fact, never an apology.
  const snapDay = (snap: number) => {
    const s = String(snap);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  };
  /** True when the snapshot postdates the session's playing window (summer
   *  runs into September here — HAHL plays May to September; the fall/winter
   *  half is done by the end of the following May). */
  const settledBy = (p: { year: number; half: "summer" | "fall-winter" }, snap: number) =>
    Math.floor(snap / 1_000_000) >
    (p.half === "summer" ? p.year * 10_000 + 9_30 : (p.year + 1) * 10_000 + 5_31);

  type StandingsHit = {
    division: string; stats: Record<string, string>;
    place: number; of: number; snap: number;
    year: number; half: "summer" | "fall-winter";
    /** WHICH PLATFORM PUBLISHED THE TABLE. Two do now, and a season's record
     *  must not report itself as HarborCenter's because that is where the
     *  first of these rows happened to come from. */
    source: string;
  };
  const standingsBySort = new Map<number, StandingsHit>();
  for (const { html, source, snap } of standingsPages) {
    const st = parseStandings(html);
    if (!st) continue;
    const p = parseSessionLabel(st.session);
    if (!p || !snap) continue;
    for (const row of st.rows) {
      if (!IS_GR(row.team)) continue;
      const prev = standingsBySort.get(p.sort);
      if (prev && prev.snap >= snap) continue;
      standingsBySort.set(p.sort, {
        division: row.division, stats: row.stats, place: row.place, of: row.of,
        snap, year: p.year, half: p.half, source,
      });
    }
  }

  // ---- the club's own honours, and the league's word on which is which ----
  //
  // Erie Metro publishes no trophy-case field, so the only honours record for
  // that era is what somebody typed into the team page's text box. It carries
  // two claims for one season and they name two different divisions:
  //
  //     2016-17 EMHL Norris Division President's Trophy Champions
  //     2016-17 Adams Division Champions
  //
  // Publishing both would put a contradiction on a season page. Picking one on
  // the archive's own judgement would be worse. THE LEAGUE'S OWN STANDINGS ROW
  // DECIDES, and it is unambiguous: the row for this session sits under "Erie
  // Metro Hockey Adams Division", first of five, and the platform's breadcrumb
  // nav puts team 2952925 in Adams beside the four clubs the row ranks it
  // against. The captain has ruled on it in the same words — go with Adams if
  // that is what the standings row says.
  //
  // So a claim is admitted when the division it names is the division the
  // league filed this team under, and refused otherwise. The Norris line is
  // refused BY THE DATA rather than by being named here, which is the only way
  // this can stay right when the next page is read. It is not deleted: it is
  // recorded verbatim in docs/research/session-audit-2026-07-28/FINDINGS.md,
  // with the part of it that is still open — a President's Trophy is usually a
  // best-record award, so it may be a real second honour with the division
  // mistyped, and nobody should have to re-derive that.
  //
  // A claim naming NO division is admitted on the standings row alone: the row
  // is what proves the archive holds this season at all, and a claim about a
  // season with no row has nothing to be checked against.
  for (const { source, claims } of teamPageClaims) {
    for (const c of claims) {
      const p = parseSessionLabel(c.season);
      if (!p) continue;
      const hit = standingsBySort.get(p.sort);
      if (!hit) continue;
      if (c.division && !new RegExp(`\\b${c.division}\\b`, "i").test(hit.division)) continue;

      // "2016/17" — the spelling `Trophy.year` has always used for a league
      // half, and the one the site's own sort reads as a WINTER rather than as
      // the summer beside it. A bare year here would land this on 2016 -
      // Summer, a season it has nothing to do with.
      const year = p.half === "summer"
        ? String(p.year)
        : `${p.year}/${String(p.year + 1).slice(-2)}`;
      if (trophies.some((t) => t.year === year && t.title === c.title)) continue;

      trophies.push({
        year,
        // The claim's own league where it names one; otherwise the platform
        // the honour was read off, exactly as a schedule-established honour is
        // filed. Never a league name inferred from a neighbouring claim.
        league: c.league ?? SOURCES[source]?.label ?? "",
        title: c.title,
        isChampion: /Champion/i.test(c.title),
      });
    }
  }

  const teamStatsBySort = new Map<
    number,
    { scoring?: Record<string, string>; goalie?: Record<string, string>; snap: number }
  >();
  for (const { url, html } of hahlStatsPages) {
    const ts = parseTeamStats(html);
    if (!ts) continue;
    const p = parseSessionLabel(ts.session);
    const snap = snapOf(url);
    if (!p || !snap) continue;
    const ours = ts.teams.filter((t) => IS_GR(t.team));
    if (ours.length === 0) continue;
    const prev = teamStatsBySort.get(p.sort);
    if (prev && prev.snap >= snap) continue;
    teamStatsBySort.set(p.sort, {
      snap,
      scoring: ours.find((t) => t.kind === "scoring")?.stats,
      goalie: ours.find((t) => t.kind === "goalie")?.stats,
    });
  }

  // ---- sessions --------------------------------------------------------
  //
  // `players` counts PEOPLE, not rows.
  //
  // It used to increment once per raw row, which was right until the keystone
  // parser arrived: the team's own site records a regular season and a playoff
  // separately, both real, both counted, so Winter 2012-13 reported 28 players
  // for a roster of 14 men who each appear twice. Nothing failed — the number
  // simply doubled and rendered, on a site whose one claim is that every figure
  // traces to a stored page.
  //
  // Counted on the CANONICAL name, so a man recorded twice under two spellings
  // in one session is also one man. Found by the statistics work, not by a test.
  //
  // WHICH KIND OF PAGE NAMED THESE MEN DECIDES WHAT THE SITE MAY SAY ABOUT
  // THEM. A session whose only witness is a league leaderboard has not had its
  // roster recovered — it has had its top scorers recovered, which is a
  // different and much smaller claim. Both flags below are derived from that
  // and nothing else, so neither can drift from the evidence.
  //
  // A FRAGMENT IS A LIST WITH NOTHING BEHIND IT — NOT A LIST A RANKING ALSO
  // TOUCHED, and the difference was costing four sessions their rosters.
  //
  // `rosterPartial` used to be "SOME row here came off a leaderboard", which
  // was the right test while a leaderboard was the only thing that had ever
  // spoken for these seasons. It stopped being right the moment the captain
  // opened his own email: 2018 - Summer, 2018 - Winter, 2019 - Winter and 2020
  // - Winter all hold a full team roster now — fifteen, fourteen, sixteen and
  // nineteen men, every name in the email on file and 2019 - Winter holding one
  // MORE than the email did — and every one of the four was still being drawn
  // as a fragment, because the league had also ranked two or three of those
  // men in a top-thirty table. A ranking that names a man on a roster the
  // archive already holds ADDS to it. It cannot subtract.
  //
  // So the two flags nest, which is what their own documentation always said:
  // `rosterLost` is "no source that lists this TEAM'S MEMBERSHIP survives", and
  // `rosterPartial` is that same state with somebody nonetheless named — a
  // handful of leading scorers standing in for a squad. A session with a
  // membership source is neither, however that source reached us: a league
  // roster page, a team sidebar, the captain's roster book, or his own
  // correspondence. `authority` already encodes exactly that distinction and
  // is the only thing either flag reads.
  const rostered = new Set<string>();
  for (const r of raw) if (r.authority > LEADERBOARD) rostered.add(r.session);

  const sessPeople = new Map<string, Set<string>>();
  const sessMap = new Map<string, Session>();
  for (const r of raw) {
    const who = canon.get(r.name) ?? r.name;
    if (!sessPeople.has(r.session)) sessPeople.set(r.session, new Set());
    sessPeople.get(r.session)!.add(who);

    if (sessMap.has(r.session)) continue;
    const p = parseSessionLabel(r.session);
    sessMap.set(r.session, {
      id: p ? sessionLabel(p) : r.session,
      sort: p?.sort ?? 0,
      half: p?.half ?? "fall-winter",
      tournament: p?.tournament ?? null,
      division: null,
      provenance: SOURCES[r.source] ?? { source: r.source, label: r.source, archiveOnly: false },
      record: null,
      teamStats: null,
      players: 0,
      // Filled below, off the lines, for the one session whose roster says.
      rosterStatus: null,
      // No roster page survives for this season — whoever is named here was
      // named by something else. True for Summer 2018 and 2018-19, whose only
      // witness is a leaderboard, and it stays true: recovering one man's line
      // out of a top-thirty table does not recover the roster he was on.
      rosterLost: !rostered.has(r.session),
      // Set below, once `players` is counted: a fragment is a list with
      // nothing behind it, and "nothing behind it AND nobody on it" is a
      // different hole that `rosterLost` alone already states.
      rosterPartial: false,
    });
  }
  for (const [id, people] of sessPeople) sessMap.get(id)!.players = people.size;
  for (const s of sessMap.values()) s.rosterPartial = s.rosterLost && s.players > 0;

  // `players` ALONE IS NOT HONEST ABOUT THE COVID SEASON.
  //
  // Nineteen names were attached to that team and they were not attached the
  // same way: fifteen rostered, three taxi squad, one on injured reserve. The
  // headline number cannot say that and must not be read as though it does, so
  // the breakdown travels beside it — counted off the lines, per PERSON rather
  // than per line so a man with a regular-season and a playoff row is one man,
  // and left null for every session where nothing states a standing, which is
  // all of them but one. In the roster's own order: rostered, taxi, hurt.
  //
  // MATCHED ON THE PARSED SORT, NEVER ON THE LABEL — the same trap the session
  // pass above records. The email heads this session "2020 - Winter" and the
  // capture the goaltender came off heads it "2021 Spring HAHL", so a string
  // comparison here would count the email's eighteen and silently lose him.
  const RANK = ["Rostered", "Taxi Squad", "IR"];
  const statusBySort = new Map<number, Map<string, Set<string>>>();
  for (const r of raw) {
    if (!r.status) continue;
    const sort = parseSessionLabel(r.session)?.sort;
    if (sort === undefined) continue;
    const who = canon.get(r.name) ?? r.name;
    if (!statusBySort.has(sort)) statusBySort.set(sort, new Map());
    const m = statusBySort.get(sort)!;
    if (!m.has(r.status)) m.set(r.status, new Set());
    m.get(r.status)!.add(who);
  }
  for (const s of sessMap.values()) {
    const m = statusBySort.get(s.sort);
    if (!m) continue;
    s.rosterStatus = [...m]
      .map(([status, people]) => ({ status, n: people.size }))
      .sort((a, b) => {
        const ra = RANK.indexOf(a.status), rb = RANK.indexOf(b.status);
        return (ra < 0 ? RANK.length : ra) - (rb < 0 ? RANK.length : rb);
      });
  }

  // A SEASON CAN SURVIVE AS NOTHING BUT ITS RESULTS.
  //
  // Sessions were derived only from player rows, so a session with no roster
  // simply did not exist — and Summer 2018 is exactly that: thirteen real,
  // dated games (9-4, 78 goals) recovered from HarborCenter's day schedules,
  // with no roster page, no statistics, and until now no session. The team
  // played a summer and the site said they did not.
  //
  // `rosterLost` has been declared on this type since the beginning and never
  // once set. This is what it is for: the season happened, we can prove it
  // happened, and the list of who played it is gone. `players: 0` here means
  // the roster did not survive — NOT that nobody played.
  //
  // Summer 2018 no longer arrives here with nothing: the league tables name
  // two men of it — a scorer and the goaltender. It is still `rosterLost`,
  // because two names off league-wide tables are not a roster — that is
  // decided above, by what kind of page spoke, not by whether `players`
  // happens to be zero.
  //
  // Matched on the PARSED session, never on the label. The two sources spell
  // the same season differently — a roster row says "2016-17 Regular Season"
  // and a scoresheet says "2016-17" — so a string comparison here silently
  // forged duplicate 2016-17, 2017-18 and 2019-20 sessions, each claiming its
  // roster was lost while the real one sat next to it. Caught by the session
  // count going 16 -> 20 for one recovered season.
  const bySort = new Map([...sessMap.values()].map((x) => [x.sort, x]));
  for (const g of games) {
    if (!g.session) continue;
    const p = parseSessionLabel(g.session);
    if (p && bySort.has(p.sort)) continue;
    sessMap.set(g.session, {
      id: p ? sessionLabel(p) : g.session,
      sort: p?.sort ?? 0,
      half: p?.half ?? "summer",
      tournament: p?.tournament ?? null,
      division: null,
      provenance: g.provenance,
      record: null,
      teamStats: null,
      players: 0,
      rosterStatus: null,
      rosterLost: true,
      // Nobody is named at all, so there is no fragment to caveat. The hole is
      // the whole story and `rosterLost` already tells it.
      rosterPartial: false,
    });
  }

  // A SEASON CAN ALSO SURVIVE AS NOTHING BUT ITS STANDINGS ROW.
  //
  // Summer 2019 is that season: no roster, no games, no player line anywhere
  // — twelve games of standings arithmetic in the Silver table is the entire
  // surviving record. This block used to be a hand-written entry that said
  // the corpus held nothing for it; the corpus held this row the whole time,
  // captured three times. Now the row itself creates the session, so if a
  // standings capture ever surfaces for another lost half, that session
  // appears here without anyone writing it in.
  const standingsSorts = new Map(
    [...standingsBySort].filter(([sort]) => ![...sessMap.values()].some((s) => s.sort === sort)),
  );
  for (const [sort, hit] of standingsSorts) {
    const label = sessionLabel({ year: hit.year, half: hit.half, sort });
    sessMap.set(label, {
      id: label,
      sort,
      half: hit.half,
      // A standings row is a LEAGUE half by construction: no tournament
      // publishes one, and none of these has ever parsed to a tournament.
      tournament: null,
      division: null, // the attach pass below fills it, same as every session
      provenance: SOURCES[hit.source] ?? { source: hit.source, label: hit.source, archiveOnly: false },
      record: null,
      teamStats: null,
      players: 0,
      rosterStatus: null,
      rosterLost: true,
      rosterPartial: false,
    });
  }

  // The league's word attaches to every session it exists for — the two
  // recovered seasons and every neighbour whose standings the same crawl
  // caught. `division` comes from the heading the row sat under; `place` is
  // the row's index in the league's own ordering, never recomputed.
  for (const s of sessMap.values()) {
    const hit = standingsBySort.get(s.sort);
    if (hit) {
      s.division = hit.division;
      s.record = {
        gp: num(hit.stats.GP), w: num(hit.stats.W), l: num(hit.stats.L),
        otw: num(hit.stats.OTW), otl: num(hit.stats.OTL),
        pts: num(hit.stats.PTS),
        // TWO LEAGUES, TWO COLUMN NAMES FOR THE SAME TWO FACTS. HAHL heads
        // them GF and GA; Erie Metro heads them "For" and "Against". Read
        // under both, because the parser deliberately maps neither — it
        // carries every cell under the header the league printed, so this is
        // the layer that knows what the columns mean.
        gf: num(hit.stats.GF ?? hit.stats.For),
        ga: num(hit.stats.GA ?? hit.stats.Against),
        // "Division" is the platform's header for the composite record cell.
        record: hit.stats.Division ?? null,
        place: hit.place, of: hit.of,
        asOf: snapDay(hit.snap),
        final: settledBy(hit, hit.snap),
        provenance: SOURCES[hit.source] ?? { source: hit.source, label: hit.source, archiveOnly: false },
      } satisfies SessionRecord;

      // A SEASON'S PROVENANCE IS THE PAGE THAT RECORDED THE SEASON, not the
      // roster that happens to name its men.
      //
      // A session takes its provenance from the first player row filed against
      // it, which is right everywhere except here. Summer 2019 is named by ONE
      // source — the captain's email — and by that rule the season began
      // reporting itself as his correspondence and, worse, as no longer
      // archive-only, because his files are not the Internet Archive. But the
      // page that proves this season happened, and the row that gives its
      // 5-7-0, IS gone from the live web and survives only there. The gold rule
      // on the season record reads THIS flag, and it was about to come off a
      // season nothing had un-lost.
      //
      // So where the league's own standings row exists, it speaks for the
      // season. Every player line keeps its own provenance and still says the
      // captain named him.
      if (s.provenance.source === "captain-roster-email") s.provenance = s.record.provenance;
    }
    const ts = teamStatsBySort.get(s.sort);
    if (ts && (ts.scoring || ts.goalie)) {
      s.teamStats = {
        gp: num(ts.scoring?.GP), g: num(ts.scoring?.G), a: num(ts.scoring?.A),
        pts: num(ts.scoring?.PTS), pen: num(ts.scoring?.PEN), pim: num(ts.scoring?.PIM),
        goalieGp: num(ts.goalie?.GP), goalieGa: num(ts.goalie?.GA), goalieSo: num(ts.goalie?.SO),
        asOf: snapDay(ts.snap),
        provenance: SOURCES["harborcenter-sportngin"]!,
      } satisfies SessionTeamStats;
    }
  }

  const sessions = [...sessMap.values()].sort((a, b) => a.sort - b.sort);

  // ---- the Department's cases ------------------------------------------
  // GENERATED from real reconciliation, never authored. If the archive stops
  // disagreeing with itself, these disappear — which is the point.
  const cases: Case[] = [];
  const multi = players.filter((p) => p.aliases.length > 0);
  for (const p of multi.slice(0, 3)) {
    cases.push({
      id: `alias-${p.slug}`,
      title: `Matter of the name — ${p.name}`,
      body: [
        `Recorded across the archive as ${[p.name, ...p.aliases].join(", ")}. ` +
        `${p.jerseys.length === 1 ? `All wore number ${p.jerseys[0]}.` : `Numbers worn: ${p.jerseys.join(", ")}.`}`,
        // WHAT THE BUILD ACTUALLY DOES, not an appeal to an authority the site
        // no longer names. This read "The Golden Retriever Archive is held to be
        // the more reliable authority on the spelling of its own players' names"
        // — a source label that has since merged into `The team archive`, and a
        // rule the identity pass has never followed. It follows this one.
        `Where the sources disagree the site publishes the fullest form recorded, and where two are the same length, the spelling the record uses most often. Every other form is kept as it was written.`,
      ],
      ruling: p.jerseys.length === 1 ? "Resolved. One player." : "Sources disagree.",
      status: "closed",
    });
  }
  // THE WORKBOOK AGAINST THE ARCHIVED PAGE.
  //
  // The captain's statistics workbook overlaps six sessions the corpus already
  // held, and on four of them it agrees exactly — Winter 2012-13 matches the
  // team's own archived roster page cell for cell across thirty lines. On two
  // phases it does not, and those are these.
  //
  // The build keeps whichever of the two states MORE of the season, on the
  // captain's ruling. The losing figures do not simply vanish: a disagreement
  // is evidence in its own right and belongs on the site rather than in a build
  // log, so both sides are raised here, from the reconciliation itself, and the
  // case records which one the archive publishes. Every sentence below is
  // counted off the rows; if the two sources ever stop disagreeing, these
  // disappear.
  const clashPhases = new Map<string, typeof bookClashes>();
  for (const c of bookClashes) {
    const k = `${c.session}|${c.phase}`;
    clashPhases.set(k, [...(clashPhases.get(k) ?? []), c]);
  }
  for (const [k, rows] of clashPhases) {
    const [rawLabel, phase] = k.split("|") as [string, string];
    // The DISPLAY label, never the source page's own spelling. `raw` carries
    // "2014-15" because that is what the archived page called it; every other
    // session name on this site is the canonical form.
    const parsedLabel = parseSessionLabel(rawLabel);
    const session = parsedLabel ? sessionLabel(parsedLabel) : rawLabel;
    // Is the workbook uniformly the LARGER count? That is the shape of one
    // table caught at two moments, not of two sources contradicting each other,
    // and it is the whole reason this is an open matter rather than a defect.
    const numeric = rows.flatMap((r) => r.fields).filter(
      (f) => Number.isFinite(Number(f.book)) && Number.isFinite(Number(f.page)),
    );
    const allGreater = numeric.length > 0 && numeric.every((f) => Number(f.book) > Number(f.page));
    const widest = [...rows].sort(
      (a, b) => Math.max(...b.fields.map((f) => Number(f.book) - Number(f.page)))
              - Math.max(...a.fields.map((f) => Number(f.book) - Number(f.page))),
    )[0]!;
    const w = widest.fields.reduce((m, f) =>
      Number(f.book) - Number(f.page) > Number(m.book) - Number(m.page) ? f : m);
    const keys = new Set(rows.flatMap((r) => r.fields.map((f) => f.key))).size;
    // WHICH SIDE THE ARCHIVE PUBLISHES, read back off the reconciliation rather
    // than assumed. A phase where the two sources trade the fuller line row by
    // row would say so here instead of claiming a winner it does not have.
    const wonN = rows.filter((r) => r.bookWon).length;
    const verdict = wonN === rows.length
      ? `The workbook is the fuller record of the two and its lines are what this archive publishes for this phase. The page's figures are kept above, and every one of them is still what that page said on the day it was stored.`
      : wonN === 0
        ? `The page is the fuller record of the two and its figures stand. The workbook's lines for this phase are kept above but not published.`
        : `${wonN} of these lines are fuller in the workbook and are published from it; the other ${rows.length - wonN} are fuller on the page and stand as the page states them.`;
    cases.push({
      id: `book-${slugify(session)}-${slugify(phase)}`,
      title: `Matter of the unfinished table — ${session}, ${phase.toLowerCase()}`,
      body: [
        `The captain's statistics workbook and the archived page state ${rows.length} of these lines differently, ` +
        `across ${keys === 1 ? `one figure` : `${keys} figures`}. ` +
        `The widest is ${widest.name}: ${w.key} ${w.page} on the page, ${w.book} in the workbook.`,
        allGreater
          ? `Every one of the ${numeric.length} disagreements runs the same way — the workbook is the larger count. That is one table read at two moments, not two sources at odds.`
          : `The disagreements run in both directions.`,
        verdict,
      ],
      ruling: wonN === rows.length
        ? "Resolved. The fuller record stands."
        : wonN === 0
          ? "Resolved. The fuller record stands — here it is the page."
          : "Resolved line by line. The fuller record stands in each.",
      status: "closed",
    });
  }

  // THE GAME #2 CASE IS GONE, on the captain's instruction:
  //
  //   "just drop it. This was likely a note that eventually was overridden
  //    when the data did come in."
  //
  // He is right, and the archive can see it: the 2012-13 page was captured
  // four times while the season was being written up. The earliest is
  // captioned "Still missing game # 2 stats"; a later one is captioned
  // "Missing Game 25" and no longer mentions game 2. The scorekeeper found it.
  // We kept his oldest complaint on the site as an open case for years after
  // he had resolved it — an archive citing a note that its own later evidence
  // supersedes. The dedup already keeps the latest snapshot, so the DATA was
  // always right; only this hand-written case was stale.

  const totals = {
    sessions: sessions.length,
    playerSeasons: raw.length,
    recordedNames: names.length,
    people: players.length,
    goals: goals.length,
    assistEdges: assists.reduce((s, e) => s + e.n, 0),
    gameSheets: sheets,
    // EVERY CAPTURE RECORD, not every distinct page. `recs` is now collapsed
    // to the newest record per URL, and counting that instead would have made
    // this figure FALL from 2,889 to 2,427 the day the dedupe landed — a
    // number the site renders, going backwards, because the archive learned
    // something. "How many times we have asked a source" is the monotone
    // quantity and the one this has always meant.
    captures: allRecs.length,
    archiveOnlySessions: sessions.filter((s) => s.provenance.archiveOnly).length,
  };

  /* ---- the captain's rulings on the trophy case --------------------------
   *
   * Everything above derives honours from what a platform published. These are
   * the three places he has overruled that, on 2026-07-31, and they are applied
   * last so the derivation stays honest and the override stays visible.
   *
   * TWO REMOVED. "President's Trophy" (2012/13) and "Adams Division Champions"
   * (2016/17) are both regular-season placings rather than things the club won,
   * and both sat on a season page beside a Runner-Up, which reads as a
   * contradiction to anybody who does not already know the difference. He asked
   * for both gone. The parsing that found them is untouched — if the claim ever
   * matters again it is still being read, just not published.
   *
   * ONE RENAMED. The 2016 Greater Buffalo win is published as "Tier 1
   * Champions" and the 2014 and 2015 wins as "Tournament Champions". The club
   * played Tier 1 in all three years, so the distinction is an artefact of
   * which page each was read off, not a difference in what was won. One name
   * for the three-peat.
   */
  const RULED_OUT = ["President's Trophy", "Adams Division Champions"];
  const ruled = trophies
    .filter((trophy) => !RULED_OUT.includes(trophy.title))
    .map((trophy) =>
      trophy.title === "Tier 1 Champions"
        ? { ...trophy, title: "Tournament Champions" }
        : trophy,
    );

  return {
    generatedAt: new Date().toISOString(),
    totals, sessions, players, assists, partnerships, cases, games, gameTotals,
    trophies: ruled, recaps,
  };
}

if (import.meta.filename === process.argv[1]) {
  const data = await generate();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "site.json"), JSON.stringify(data, null, 2));
  const t = data.totals;
  console.log("--- site data generated ---");
  for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log(`  -> ${join(OUT, "site.json")}`);
}
