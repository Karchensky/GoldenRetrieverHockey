import { join } from "node:path";
import { BlobStore } from "./store/blobs.ts";
import { CaptureLog } from "./store/log.ts";
import { ManifestIndex, rebuildFromLog } from "./store/index.ts";
import { Fetcher } from "./fetcher/fetcher.ts";
import { RateLimiter } from "./fetcher/politeness.ts";
import {
  cdxQuery,
  originalUrl,
  selectHtmlSnapshots,
  filterByPathSegment,
} from "./sources/wayback.ts";
import type { CdxRow } from "./sources/wayback.ts";
import {
  guestTicket,
  authHeader,
  endpoints,
  playerIdsIn,
  teamIdsIn,
  isRetrievers,
  teamIdentity,
  teamsByDivision,
  scheduleRows,
  HAHL_LEAGUE_ID,
} from "./sources/digitalshift.ts";
import {
  urls,
  rosterPlayerIds,
  gameShowIds,
} from "./sources/sportngin.ts";
import type { TeamSeason } from "./sources/sportngin.ts";

const DATA = process.env.GR_DATA_DIR ?? "data";

/**
 * How recently a URL must have been captured for a re-run to skip it.
 *
 * A week by default, because that is the right answer for the ARCHIVE: a
 * decade-old Wayback snapshot does not change, and re-asking a donated public
 * archive for bytes we already hold is rude.
 *
 * It is the WRONG answer for the live season, which is why this is now
 * overridable. The freshness gate is what makes a second run in the same week
 * a no-op — every URL short-circuits and the sync reports success having
 * fetched nothing. A refresh that runs the morning after a Monday-night game
 * must be able to say "anything older than twelve hours is stale":
 *
 *   GR_FRESHNESS_HOURS=12 npm run capture:harborcenter-games
 *
 * Zero disables the gate entirely and re-fetches everything asked for. Only
 * the value is configurable — nothing here can make a run fetch a URL the
 * command did not already choose to ask for.
 */
const FRESHNESS_MS = (() => {
  const raw = process.env.GR_FRESHNESS_HOURS;
  if (raw === undefined || raw.trim() === "") return 7 * 24 * 60 * 60 * 1000;
  const hours = Number(raw);
  // Fail loud. A typo silently becoming NaN would disable the gate and put a
  // thousand extra requests on a public archive without anyone asking for it.
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`GR_FRESHNESS_HOURS must be a non-negative number of hours, got ${JSON.stringify(raw)}`);
  }
  return hours * 60 * 60 * 1000;
})();

/**
 * The freshness window for data that CANNOT change any more.
 *
 * A game that is already Final is final; a season that has ended has ended,
 * and so has its scoring leaderboard. Refreshing the live season is supposed
 * to be cheap and frequent, and with one window for everything it is neither:
 * at twelve hours a single run re-fetched 195 boxscores and ~330 leaderboard
 * pages — over five hundred requests to a public API — to learn about two new
 * games.
 *
 * Thirty days, not never, deliberately. Beer-league scoresheets do get
 * corrected weeks later, and a settled figure being re-verified monthly is
 * worth one request. This is a politeness measure with a correctness margin,
 * not a cache.
 *
 * Only ever LONGER than FRESHNESS_MS, never shorter: if an operator asks for a
 * longer window than this, theirs wins.
 */
const SETTLED_FRESHNESS_MS = Math.max(FRESHNESS_MS, 30 * 24 * 60 * 60 * 1000);

/**
 * Seed for the HarborCenter walk: one known Golden Retriever.
 * Discovery follows PEOPLE, not names — the only reliable anchor when the
 * team's name changes and the roster does not (§2.5).
 *
 * This is the COLD-START seed. `captureHarborcenterLive` now also seeds from
 * every Retrievers player already on disk (see `knownRetrieversPlayerIds`),
 * because a walk that begins at exactly one man ends at nobody the day that
 * man's page 500s — and the corpus's whole reason for existing is that we
 * already know who else to ask about.
 */
const SEED_PLAYER_ID = 2350393; // Bryan Karchensky

/**
 * The Retrievers' complete Erie Metro history.
 *
 * Not a guess and not a starting point: eriemetrosports.com's own sitemap
 * contains exactly two `golden-retrievers` pages, and league-wide stats for
 * every other season contain no Retrievers rows. Two seasons is the whole of
 * it — the team was at HarborCenter before and after.
 */
const ERIE_METRO_SEASONS: readonly TeamSeason[] = [
  {
    host: "www.eriemetrosports.com",
    label: "2016-17",
    pageId: 2952925,
    teamInstance: 2395123,
  },
  {
    host: "www.eriemetrosports.com",
    label: "2017-18",
    pageId: 3667197,
    teamInstance: 3080368,
  },
];

/**
 * The Erie Metro LEAGUE-WIDE skater tables — one per Retrievers season — for
 * where each player stood against the whole league in every stat.
 *
 * `(league_instance, subseason)` read from the corpus's own team-stats pages:
 * `stats/team_instance/2395123` links `league_instance/50115?subseason=356342`.
 * The team stats page names the season; the league page ranks it.
 */
const ERIE_METRO_LEAGUES: readonly { label: string; leagueInstance: number; subseason: number }[] = [
  { label: "2016-17", leagueInstance: 50115, subseason: 356342 },
  { label: "2017-18", leagueInstance: 62160, subseason: 447160 },
];

type WaybackRescue = {
  /** Domain to enumerate via CDX. */
  domain: string;
  /** Recorded as CaptureRecord.source — provenance, so keep it stable. */
  source: string;
  /** Human label for the summary. */
  label: string;
  /** Why this source exists only in the archive. Printed, so a future
   *  operator understands what they are rescuing and why it matters. */
  rationale: string;
  /** Optional allow-list of first path segments. Omit to take every HTML
   *  snapshot. Whatever this drops is REPORTED, never silently truncated. */
  dataPaths?: readonly string[];
  /**
   * Optional narrowing WITHIN an allowed path, for a segment that is mostly
   * noise but holds something we need.
   *
   * /page holds 785 snapshots of registration forms and privacy policies and
   * exactly a handful of team pages. Taking the segment wholesale would triple
   * the load on a donated public archive to fetch waivers; excluding it lost
   * two seasons. Whatever this drops is reported, same rule as dataPaths.
   */
  urlFilter?: (url: string) => boolean;
};

const KEYSTONE: WaybackRescue = {
  domain: "goldenretrieverhockey.com",
  source: "goldenretrieverhockey",
  label: "Keystone",
  rationale:
    "The team's own defunct website: the only surviving reach into the 2012-16 era, " +
    "the authoritative spelling of every player's name, and the origin of the site's voice.",
  // No filter: the site is small and every page is editorial or roster data.
};

const HARBORCENTER_ARCHIVE: WaybackRescue = {
  domain: "rinksatharborcenter.com",
  source: "harborcenter-sportngin",
  label: "HarborCenter (pre-2021 SportsEngine era)",
  rationale:
    "HarborCenter migrated stats platforms ~2021. Its current HockeyShift API holds " +
    "NOTHING before Summer 2021, so the 2018-2021 Golden Retrievers seasons — " +
    "confirmed present, e.g. 'Standings - 2018 Spring/Summer - HAHL: The Golden " +
    "Retrievers, 25 PTS' — survive only in the Wayback Machine.",
  // The domain has ~3,925 archived HTML snapshots but only ~1,171 are data.
  // Fetching registration forms and privacy policies would triple the load on
  // a donated public archive for nothing.
  dataPaths: [
    "roster_players",
    "roster",
    "stats",
    "standings",
    "game",
    "schedule",
    "team",
    "posts",
    "player",
  ],
};

/**
 * THE SECOND HOST — SportsEngine's own domain for the same rink.
 *
 * `harborcenter.sportngin.com` and `www.rinksatharborcenter.com` served the
 * SAME SportsEngine site under two names, and the Wayback Machine crawled them
 * separately. Every sweep this project ever ran was aimed at the second name.
 *
 * That mattered: the ONE archived division scoring table in the whole corpus
 * that names four Golden Retrievers by name came from this host, and it was
 * captured by hand. The CDX index holds 10,748 rows here, 5,298 of them
 * successful HTML, and the corpus held THREE of them.
 *
 * Why `roster_players` is the point of it: every one of those pages renders
 * the WHOLE TEAM in a sidebar beside the man it is about (see
 * `parseRosterSidebar`). 734 distinct player pages are archived on this host
 * against 260 in the corpus, and one page from a season is one whole roster.
 *
 * The host is dead live — `https://harborcenter.sportngin.com/` and every path
 * under it 302 to `discover.sportsengineplay.com/lost-and-found`, HTTP 404.
 * Wayback is the only way in.
 */
const HARBORCENTER_SPORTNGIN: WaybackRescue = {
  domain: "harborcenter.sportngin.com",
  source: "harborcenter-sportngin",
  label: "HarborCenter — the SECOND host (harborcenter.sportngin.com)",
  rationale:
    "The same SportsEngine site under its platform hostname, crawled by the " +
    "Internet Archive as a separate domain and never swept from here. Its " +
    "roster_players pages each carry a whole team in the sidebar, which is how " +
    "2018-19 and 2019-20 went from four players to fourteen and sixteen.",
  // Same politeness rule as the sister host: 5,298 HTML snapshots, of which
  // ~2,000 are data. /page alone is 1,912 rows of registration forms, camp
  // listings and tournament marketing — and this host, unlike the other,
  // files no team under a `-the-golden-retrievers` slug (checked: five
  // `/page/show/*golden*` rows exist and all five are the Golden Seals or the
  // West Hill Golden Hawks). There is nothing there to aim a urlFilter at.
  dataPaths: [
    "roster_players",
    "roster_player",
    "roster",
    "stats",
    "standings",
    "game",
    "team",
    "player",
  ],
};

/**
 * THE TEAM'S OWN PAGES — the two seasons the sweep above could not see.
 *
 * HARBORCENTER_ARCHIVE allow-lists first path segments and "page" is not one
 * of them, for a good reason: /page carries 785 archived snapshots and almost
 * all of them are registration forms. But SportsEngine files a TEAM under
 * /page/show/<id>-<slug>, so that exclusion silently dropped every Golden
 * Retrievers team page in the 2018-2021 era — which is exactly why 2018-19 and
 * Summer 2019 have been sitting in docs/BACKLOG.md as "missing" while their
 * pages sat in the Internet Archive, 200 OK, the whole time.
 *
 * The sweep was not incomplete. It was aimed slightly to the left.
 *
 * Found by mining the nav JSON every SportsEngine page carries, which names
 * every team in the league with its own URL:
 *   {"name":"The Golden Retrievers","id":"page_node_4157345",
 *    "url":"/page/show/4157345-the-golden-retrievers?subseason=493397"}
 *
 * Narrowed to this team by name. 11 of the 785 mention a golden anything, and
 * some of THOSE are the Golden Seals — a different team, and a reminder that
 * substring-matching a team name is how this repo once labelled Classic Cue's
 * as the Retrievers.
 */
const RETRIEVERS_SPORTNGIN_PAGES: WaybackRescue = {
  domain: "rinksatharborcenter.com",
  source: "harborcenter-sportngin",
  label: "HarborCenter — the Retrievers' own team pages (2018-2021)",
  rationale:
    "SportsEngine files a team at /page/show/<id>-<slug>, a path the main " +
    "archive sweep excludes to avoid fetching 785 registration forms. That " +
    "exclusion is why 2018-19 and Summer 2019 read as lost: their pages were " +
    "archived and never asked for.",
  dataPaths: ["page"],
  urlFilter: (url) => /\/page\/show\/\d+-the-golden-retrievers/i.test(url),
};

function openStore() {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));
  const index = new ManifestIndex(join(DATA, "manifest.sqlite"));
  return { store, log, index };
}

/**
 * Rescue a domain that survives only in the Wayback Machine.
 *
 * Every snapshot is captured, not just the latest: each is a distinct
 * historical state of the source.
 */
async function rescueWayback(cfg: WaybackRescue): Promise<void> {
  const { store, log, index } = openStore();

  // store/index.ts documents manifest.sqlite as DERIVED, NOT AUTHORITATIVE —
  // "deleting this file loses nothing." That is only true if something
  // actually rebuilds it before it is relied on: Fetcher.capture()'s
  // freshness gate reads ONLY the index, never the log, so a deleted-and-
  // not-yet-reindexed manifest makes every URL look never-captured and
  // silently re-fetches the whole corpus from archive.org — quietly
  // disabling "never re-fetch" via an action the docs call safe. Rebuilding
  // unconditionally here, before any fetch, makes the index self-healing so
  // freshness always reflects the true log. rebuildFromLog is idempotent
  // (see reindex() and its tests), so this is a no-op cost-wise when the
  // index was already current.
  const reindexed = await rebuildFromLog(log, index);
  console.log(
    `Reindexed ${reindexed} record(s) from ${join(DATA, "captures.jsonl")} before capture (index self-heals every run).`,
  );

  const fetcher = new Fetcher({
    store,
    log,
    index,
    // Wayback is a donated public good. One request/sec, no exceptions.
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 250 }),
  });

  console.log(`\n${cfg.label}`);
  console.log(`  ${cfg.rationale}\n`);
  console.log(`Enumerating ${cfg.domain} via Wayback CDX...`);
  // cdxQuery throws a descriptive Error on a failed request (non-2xx after
  // retries, or malformed JSON) rather than returning []; it reserves []
  // for a genuinely empty archive. That failure must be reported plainly
  // instead of crashing out as a raw stack trace — and never swallowed
  // into a false "0 failed" summary below.
  let rows: CdxRow[];
  try {
    rows = await cdxQuery(cfg.domain);
  } catch (err) {
    console.error(
      `CDX enumeration failed for ${cfg.domain}: ${err instanceof Error ? err.message : String(err)}`,
    );
    index.close();
    process.exitCode = 1;
    return;
  }
  const html = selectHtmlSnapshots(rows);
  const byPath = cfg.dataPaths ? filterByPathSegment(html, cfg.dataPaths) : html;
  const snaps = cfg.urlFilter ? byPath.filter((r) => cfg.urlFilter!(r.original)) : byPath;
  if (cfg.urlFilter) {
    // Same no-silent-caps rule as dataPaths: say what was dropped.
    console.log(
      `  urlFilter kept ${snaps.length} of ${byPath.length} snapshots in the allowed paths`,
    );
  }
  console.log(`  ${rows.length} CDX rows -> ${html.length} successful HTML snapshots`);
  if (cfg.dataPaths) {
    // No silent caps: state exactly what the filter dropped and why, so this
    // run is never mistaken for full coverage of the domain.
    console.log(
      `  path filter [${cfg.dataPaths.join(", ")}] -> ${snaps.length} data snapshots ` +
        `(${html.length - snaps.length} non-data pages skipped: marketing, registration, policies)`,
    );
  }
  const mins = Math.round(snaps.length / 60);
  console.log(`  ~${mins} min at 1 req/sec (archive.org is a donated public good)\n`);

  let ok = 0;
  let failed = 0;
  let fresh = 0;
  for (const [i, s] of snaps.entries()) {
    const url = originalUrl(s.timestamp, s.original);
    // Fetcher's public API deliberately returns the PRIOR record, indistinguishable
    // by shape, when the freshness window short-circuits (see Fetcher.capture()
    // step 1) — and we must not change that signature. Detect the short-circuit
    // from the outside instead: it is the ONLY path through capture() that does
    // not commit() a new row, so an unchanged capture count means nothing new
    // was logged.
    const before = index.countCaptures();
    const rec = await fetcher.capture(url, {
      source: cfg.source,
      via: "wayback",
      waybackTs: s.timestamp,
      freshnessMs: FRESHNESS_MS,
    });
    const after = index.countCaptures();
    // Long sweeps: log every failure, but only every 25th success, so a real
    // problem is not buried under a thousand "ok" lines.
    const noisy = (i + 1) % 25 === 0 || i === snaps.length - 1;
    if (after === before) {
      fresh++;
      if (noisy) console.log(`  [${i + 1}/${snaps.length}] fresh ${s.timestamp}`);
    } else if (rec.error) {
      failed++;
      console.log(`  [${i + 1}/${snaps.length}] FAIL ${s.timestamp} ${rec.error} ${s.original}`);
    } else {
      ok++;
      if (noisy) console.log(`  [${i + 1}/${snaps.length}] ok ${s.timestamp} ${s.original}`);
    }
  }

  // Integrity cross-check: distinct content hashes recorded in the index
  // (derived from the log) versus actual blob files on disk. These must
  // always agree — a mismatch means the index and the blob store have
  // diverged, which for an archive is worth shouting about.
  const hashes = index.distinctHashes();
  const blobs = await store.count();

  console.log(`\n--- ${cfg.label} rescue summary ---`);
  console.log("  this run:");
  console.log(`    snapshots attempted : ${snaps.length}`);
  console.log(`    captured            : ${ok}`);
  console.log(`    skipped (fresh)     : ${fresh}`);
  console.log(`    failed              : ${failed}`);
  console.log("  corpus totals:");
  console.log(`    captures logged     : ${index.countCaptures()}`);
  console.log(`    distinct hashes     : ${hashes}`);
  console.log(`    blob files on disk  : ${blobs}`);
  console.log(`    gaps recorded       : ${index.gaps().length}`);
  console.log(`    corpus              : ${join(DATA, "blobs")}`);
  if (hashes !== blobs) {
    console.warn(
      `    WARNING: index/blob-store divergence — ${hashes} distinct content hash(es) recorded in the index but ${blobs} blob file(s) on disk. Investigate before trusting this corpus.`,
    );
  }
  index.close();
}

/**
 * Capture the LIVE HarborCenter era (HockeyShift / DigitalShift API).
 *
 * Discovery follows PEOPLE, not team names — which works here only because
 * HarborCenter has persistent player identity (§6.5.1), unlike SportsEngine.
 * Seeded from one known player, it walks:
 *
 *   player -> every team that player appeared on
 *          -> for each team: is it a Golden Retrievers team?
 *          -> if so: its full roster -> every player on it -> repeat
 *
 * until no new players or teams appear. The team-name test must accept BOTH
 * "Golden Retrievers" and "The Golden Retrievers": both are in live,
 * alternating use across consecutive sessions (§6.5.2).
 */
async function captureHarborcenterLive(): Promise<void> {
  const { store, log, index } = openStore();
  const reindexed = await rebuildFromLog(log, index);
  console.log(`Reindexed ${reindexed} record(s) before capture (index self-heals every run).`);

  console.log("\nHarborCenter (live HockeyShift era, Seneca HAHL)");
  console.log(
    "  Minting an anonymous guest ticket — the same token any visitor's browser mints.\n",
  );

  let ticket: string;
  try {
    ticket = await guestTicket();
  } catch (err) {
    console.error(`  ticket failed: ${err instanceof Error ? err.message : String(err)}`);
    index.close();
    process.exitCode = 1;
    return;
  }
  const auth = authHeader(ticket);

  const fetcher = new Fetcher({
    store,
    log,
    index,
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 250 }),
  });

  const opts = { source: "harborcenter-hockeyshift", via: "live" as const, authorization: auth, freshnessMs: FRESHNESS_MS };

  /** Capture a URL and return its body text, or null if it failed. */
  const grab = async (url: string): Promise<string | null> => {
    const rec = await fetcher.capture(url, opts);
    if (rec.error || !rec.contentHash) {
      console.log(`    FAIL ${rec.error ?? "no body"} ${url}`);
      return null;
    }
    const buf = await store.get(rec.contentHash);
    if (!buf) return null;
    try {
      return (JSON.parse(buf.toString("utf8")) as { content?: string }).content ?? null;
    } catch {
      return null;
    }
  };

  // SEED FROM EVERYONE WE ALREADY KNOW, not from one man.
  //
  // The walk's shape is player -> teams -> is it ours -> roster -> more
  // players, so a single seed is enough WHEN IT WORKS. When it does not — one
  // 500, one timeout, one id retired by the platform — `grab` returns null,
  // `continue` runs, the queue empties, and the command exits reporting
  // "0 teams inspected, 0 RETRIEVERS sessions" with a zero exit code. That is
  // indistinguishable from "the team did not play", and on a scheduled refresh
  // nobody is watching the log to tell the difference.
  //
  // Every Retriever the corpus can already name is a valid entry point to the
  // same graph, and they cost nothing to add: they are all walked anyway.
  // Ordering the known ids first also means a NEW session is normally found on
  // the first page fetched, by whichever teammate is rostered on it.
  const known = await knownRetrieversPlayerIds();
  const seedPlayers = [...new Set([...known, SEED_PLAYER_ID])];
  console.log(
    `  Seeding the walk with ${seedPlayers.length} player id(s): ${known.length} already in the corpus, ` +
      `plus the cold-start seed. A new session is found via whichever of them is rostered on it.\n`,
  );
  const playerQueue = [...seedPlayers];
  const seenPlayers = new Set<number>();
  const seenTeams = new Set<number>();
  const grTeams = new Map<number, string>();
  let calls = 0;

  while (playerQueue.length > 0) {
    const pid = playerQueue.shift()!;
    if (seenPlayers.has(pid)) continue;
    seenPlayers.add(pid);

    const content = await grab(endpoints.player(pid));
    calls++;
    if (!content) continue;

    // Every team this person ever appeared on — Retrievers and otherwise.
    for (const tid of teamIdsIn(content)) {
      if (seenTeams.has(tid)) continue;
      seenTeams.add(tid);

      const t = await grab(endpoints.team(tid));
      calls++;
      if (!t) continue;

      // isRetrievers tests the team's OWN name. Testing the raw content
      // instead matches any team sharing a division with the Retrievers,
      // because a team partial embeds its whole division's team list.
      if (!isRetrievers(t)) continue;
      const id = teamIdentity(t);
      const label = id ? `${id.name}, ${id.session}, ${id.division}` : `team ${tid}`;
      grTeams.set(tid, label);
      console.log(`  RETRIEVERS  ${label}`);

      const stats = await grab(endpoints.teamStats(tid));
      calls++;
      if (!stats) continue;
      for (const p of playerIdsIn(stats)) {
        if (!seenPlayers.has(p)) playerQueue.push(p);
      }
    }
  }

  const hashes = index.distinctHashes();
  const blobs = await store.count();
  console.log("\n--- HarborCenter (live) capture summary ---");
  console.log("  this run:");
  console.log(`    api calls           : ${calls}`);
  console.log(`    players walked      : ${seenPlayers.size}`);
  console.log(`    teams inspected     : ${seenTeams.size}`);
  console.log(`    RETRIEVERS sessions : ${grTeams.size}`);
  console.log("  corpus totals:");
  console.log(`    captures logged     : ${index.countCaptures()}`);
  console.log(`    distinct hashes     : ${hashes}`);
  console.log(`    blob files on disk  : ${blobs}`);
  if (hashes !== blobs) {
    console.warn(
      `    WARNING: index/blob-store divergence — ${hashes} hash(es) vs ${blobs} blob(s).`,
    );
  }
  index.close();
}

/**
 * Every Golden Retrievers team the corpus can already name, from the team
 * partials `capture:harborcenter-live` stored.
 *
 * Read out of the archive rather than re-derived by walking 265 player and
 * team pages a second time. The walk's whole job is deciding which team ids
 * are ours; it already did it, and its answers are on disk.
 *
 * `isRetrievers` tests the partial's OWN `<h1 class="sr-only">`, never the
 * document — a team partial embeds every sibling team in its division, so a
 * content test returns the Retrievers' whole division.
 */
async function retrieversTeamsInCorpus(): Promise<{ teamId: number; label: string }[]> {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));
  const out = new Map<number, string>();
  for (const r of await log.all()) {
    if (!r.contentHash) continue;
    const teamId = Number(r.url.match(/partials\/stats\/team\?team_id=(\d+)/)?.[1]);
    if (!Number.isFinite(teamId) || teamId === 0) continue;
    const buf = await store.get(r.contentHash);
    if (!buf) continue;
    let content: string;
    try {
      content = (JSON.parse(buf.toString("utf8")) as { content: string }).content;
    } catch {
      continue;
    }
    if (!isRetrievers(content)) continue;
    const id = teamIdentity(content);
    out.set(teamId, id ? `${id.session}, ${id.division}` : `team ${teamId}`);
  }
  return [...out].map(([teamId, label]) => ({ teamId, label })).sort((a, b) => a.teamId - b.teamId);
}

/**
 * Every player id that has appeared on a Golden Retrievers roster, read out of
 * the corpus.
 *
 * The seed list for the live walk. Taken from the `team/stats` partials of
 * teams `isRetrievers` has already vouched for — NEVER from the `team`
 * partials themselves, which embed every sibling team in the division and
 * would seed the walk with several hundred strangers' ids.
 *
 * Returns [] on an empty or unreadable corpus, which is the honest answer for
 * a cold start; the caller adds the hardcoded seed regardless, so an empty
 * result degrades to exactly the old single-seed behaviour rather than to a
 * walk that cannot start.
 */
async function knownRetrieversPlayerIds(): Promise<number[]> {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));

  const records = await log.all();
  const bodyOf = async (hash: string): Promise<string | null> => {
    const buf = await store.get(hash);
    if (!buf) return null;
    try {
      return (JSON.parse(buf.toString("utf8")) as { content?: string }).content ?? null;
    } catch {
      return null;
    }
  };

  // Pass 1: which team ids are ours, by the team partial's own name.
  const ours = new Set<number>();
  for (const r of records) {
    if (!r.contentHash) continue;
    const teamId = Number(r.url.match(/partials\/stats\/team\?team_id=(\d+)/)?.[1]);
    if (!Number.isFinite(teamId) || teamId === 0) continue;
    if (ours.has(teamId)) continue;
    const content = await bodyOf(r.contentHash);
    if (content && isRetrievers(content)) ours.add(teamId);
  }

  // Pass 2: the rosters of exactly those teams.
  const ids = new Set<number>();
  for (const r of records) {
    if (!r.contentHash) continue;
    const teamId = Number(r.url.match(/partials\/stats\/team\/stats\?team_id=(\d+)/)?.[1]);
    if (!Number.isFinite(teamId) || !ours.has(teamId)) continue;
    const content = await bodyOf(r.contentHash);
    if (!content) continue;
    for (const p of playerIdsIn(content)) ids.add(p);
  }
  return [...ids].sort((a, b) => a - b);
}

/** One Golden Retrievers season at HarborCenter, with the ids the leaders
 *  route needs to rank its players two ways. */
type RetrieversSeason = {
  teamId: number;
  session: string;
  division: string;
  /** The league's own season id, for the leaders route. */
  seasonId: number;
  /** The id of the DIVISION this team played in that season, for the
   *  division-only ranking. Null when the team partial did not carry the
   *  division structure — the league-wide table is still captured. */
  divisionId: number | null;
};

/**
 * Every Golden Retrievers season the corpus can already place, resolved down to
 * the (season_id, division_id) the leaders route ranks on.
 *
 * Read entirely out of the archive the two live captures already stored, never
 * re-walked: the team partials name each season's division structure in their
 * own `teams_by_division`, and the schedule tables carry the league's season
 * id on every row. This just joins them.
 *
 *   team partial     -> is it ours? which session/division? which division id?
 *   schedule/table   -> which season_id those games belong to
 *
 * A team whose division id cannot be resolved is kept, not dropped: its
 * league-wide leaderboard is still worth capturing, and only the divisional
 * one is lost — reported, never silent.
 */
async function retrieversSeasonsInCorpus(): Promise<RetrieversSeason[]> {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));

  const teams = new Map<number, { session: string; division: string; divisionId: number | null }>();
  const seasonByTeam = new Map<number, number>();

  const bodyOf = async (hash: string): Promise<string | null> => {
    const buf = await store.get(hash);
    if (!buf) return null;
    try {
      return (JSON.parse(buf.toString("utf8")) as { content?: string }).content ?? null;
    } catch {
      return null;
    }
  };

  for (const r of await log.all()) {
    if (!r.contentHash) continue;

    const tMatch = r.url.match(/partials\/stats\/team\?team_id=(\d+)/);
    if (tMatch) {
      const content = await bodyOf(r.contentHash);
      if (!content || !isRetrievers(content)) continue;
      const teamId = Number(tMatch[1]);
      const id = teamIdentity(content);
      // The Retrievers' own division id: the division in this season's
      // structure whose team list contains this very team.
      const division = teamsByDivision(content).find((d) =>
        d.teams.some((t) => t.id === teamId),
      );
      teams.set(teamId, {
        session: id?.session ?? "",
        division: id?.division ?? "",
        divisionId: division?.id ?? null,
      });
      continue;
    }

    const sMatch = r.url.match(/partials\/stats\/schedule\/table\?team_id=(\d+)/);
    if (sMatch) {
      const teamId = Number(sMatch[1]);
      const content = await bodyOf(r.contentHash);
      if (!content) continue;
      // A schedule carries both teams' games but one season; take the season
      // id the rows agree on rather than any single row's.
      const counts = new Map<number, number>();
      for (const row of scheduleRows(content)) {
        if (Number.isFinite(row.seasonId)) counts.set(row.seasonId, (counts.get(row.seasonId) ?? 0) + 1);
      }
      let best: number | null = null;
      let bestN = 0;
      for (const [sid, n] of counts) if (n > bestN) (best = sid), (bestN = n);
      if (best !== null) seasonByTeam.set(teamId, best);
    }
  }

  const out: RetrieversSeason[] = [];
  for (const [teamId, t] of teams) {
    const seasonId = seasonByTeam.get(teamId);
    // No season id, no leaders URL: the route is keyed on it. This never
    // happens for a team whose schedule was captured, which is all of them.
    if (seasonId === undefined) continue;
    out.push({ teamId, session: t.session, division: t.division, seasonId, divisionId: t.divisionId });
  }
  return out.sort((a, b) => a.seasonId - b.seasonId);
}

/**
 * Capture the LEAGUE-WIDE SCORING LEADERBOARD for every Golden Retrievers
 * season — the standing of each player relative to the league, and to the
 * division they actually played in.
 *
 * Two tables per season, both regular-season skaters:
 *
 *   leaders/table?...&game_type=Regular Season&player_type=players
 *     -> the whole league, ranked. A Retriever near the top of THIS is rare
 *        and is the bigger honour.
 *   ...&division_id=<the Retrievers' division>
 *     -> the same players re-ranked within their own tier. This is where a
 *        Silver or Bronze team's scoring finishes live.
 *
 * The team filter is the REQUEST, not a string test: the season and division
 * ids come from team partials `isRetrievers` has already vouched for, so no
 * division-mate can be mistaken for us. Deciding WHOSE rows on the returned
 * table are the Retrievers' belongs to the build layer, which has the team id.
 */
async function captureHarborcenterLeaders(): Promise<void> {
  const { store, log, index } = openStore();
  const reindexed = await rebuildFromLog(log, index);
  console.log(`Reindexed ${reindexed} record(s) before capture (index self-heals every run).`);

  console.log("\nHarborCenter scoring leaderboards (live HockeyShift era, Seneca HAHL)");
  console.log("  Leaders route: league-wide and division-only, per season.\n");

  const seasons = await retrieversSeasonsInCorpus();
  if (seasons.length === 0) {
    console.error(
      "  No Golden Retrievers seasons in the corpus. This command reads the team " +
        "ids and season ids the earlier captures stored — run capture:harborcenter-live " +
        "and capture:harborcenter-games first.",
    );
    index.close();
    process.exitCode = 1;
    return;
  }
  console.log(`  ${seasons.length} Retrievers season(s) in the corpus.\n`);

  let ticket: string;
  try {
    ticket = await guestTicket();
  } catch (err) {
    console.error(`  ticket failed: ${err instanceof Error ? err.message : String(err)}`);
    index.close();
    process.exitCode = 1;
    return;
  }

  const fetcher = new Fetcher({
    store,
    log,
    index,
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 250 }),
  });
  const opts = {
    source: "harborcenter-hockeyshift",
    via: "live" as const,
    authorization: authHeader(ticket),
    freshnessMs: FRESHNESS_MS,
  };

  let leaguePages = 0;
  let divisionPages = 0;
  let noDivision = 0;
  let failed = 0;
  let fresh = 0;

  /**
   * The one season whose leaderboard can still move.
   *
   * `seasons` is sorted by season id ascending, so the last is the newest.
   * Every earlier season has ended and its scoring table with it, which is
   * what makes the long window below safe.
   */
  const liveSeasonId = seasons.at(-1)?.seasonId ?? null;

  /** Capture one URL, returning its unwrapped partial body (or null). */
  const grab = async (url: string, settled = false): Promise<string | null> => {
    const before = index.countCaptures();
    const rec = await fetcher.capture(
      url,
      settled ? { ...opts, freshnessMs: SETTLED_FRESHNESS_MS } : opts,
    );
    if (index.countCaptures() === before) fresh++;
    if (rec.error || !rec.contentHash) {
      console.log(`    FAIL ${rec.error ?? "no body"} ${url}`);
      return null;
    }
    const buf = await store.get(rec.contentHash);
    if (!buf) return null;
    try {
      return (JSON.parse(buf.toString("utf8")) as { content?: string }).content ?? null;
    } catch {
      return null;
    }
  };

  /**
   * Capture EVERY page of one leaderboard, stopping when a page introduces no
   * new player.
   *
   * Standings in goals, assists and penalty minutes are computed off the whole
   * field (the API only ever sorts by points), so the whole field has to be on
   * disk. The API wraps past the last real page — an out-of-range page repeats
   * page one — so the end is "a page that adds nobody", not an empty page.
   * Capped at 15 pages (1,500 players); the largest field in the league is
   * under a thousand.
   */
  const grabField = async (base: { seasonId: number; divisionId?: number }): Promise<number> => {
    const seen = new Set<number>();
    // A season that has ended cannot gain a point. Only the live season's
    // field is worth re-reading on a twice-weekly refresh; the other ten cost
    // ~300 requests to confirm figures that stopped moving years ago.
    const settled = base.seasonId !== liveSeasonId;
    let pages = 0;
    for (let page = 1; page <= 15; page++) {
      const content = await grab(
        endpoints.leaders({
          leagueId: HAHL_LEAGUE_ID,
          seasonId: base.seasonId,
          gameType: "Regular Season",
          playerType: "players",
          ...(base.divisionId ? { divisionId: base.divisionId } : {}),
          page,
        }),
        settled,
      );
      if (content === null) {
        if (page === 1) failed++;
        break;
      }
      pages++;
      const ids = [...content.matchAll(/#\/player\/(\d+)/g)].map((m) => Number(m[1]));
      const newIds = ids.filter((id) => !seen.has(id));
      for (const id of ids) seen.add(id);
      if (newIds.length === 0) break; // the wrap-around: the field ended already
    }
    return pages;
  };

  for (const s of seasons) {
    console.log(`  ${s.session.padEnd(20)} ${s.division.padEnd(18)} season ${s.seasonId}`);
    leaguePages += await grabField({ seasonId: s.seasonId });
    if (s.divisionId === null) {
      // Not a failure — the league-wide field was still captured. But say so:
      // this season will have no divisional finishes on the site.
      console.log(`    no division id — league-wide only`);
      noDivision++;
      continue;
    }
    divisionPages += await grabField({ seasonId: s.seasonId, divisionId: s.divisionId });
  }

  const hashes = index.distinctHashes();
  const blobs = await store.count();
  console.log("\n--- HarborCenter scoring leaderboard capture summary ---");
  console.log("  this run:");
  console.log(`    seasons             : ${seasons.length}`);
  console.log(`    league pages        : ${leaguePages}`);
  console.log(`    division pages      : ${divisionPages}`);
  console.log(`    seasons w/o division: ${noDivision}`);
  console.log(`    requests skipped    : ${fresh} (already fresh — no network)`);
  console.log(`    failed              : ${failed}`);
  console.log("  corpus totals:");
  console.log(`    captures logged     : ${index.countCaptures()}`);
  console.log(`    distinct hashes     : ${hashes}`);
  console.log(`    blob files on disk  : ${blobs}`);
  if (hashes !== blobs) {
    console.warn(`    WARNING: index/blob divergence — ${hashes} vs ${blobs}.`);
  }
  index.close();
}

/**
 * Capture the HarborCenter game record — every game, goal by goal.
 *
 * THE ASSIST NETWORK'S SECOND SOURCE. Until this existed, "who set up whom"
 * covered two sessions of eighteen (Erie Metro 2016-17 and 2017-18) because
 * those were the only scoresheets anyone had found. The HarborCenter era's
 * game sheets were public on the same site the whole time; what was missing
 * was a way to LIST them. See `endpoints.teamSchedule` for how that was
 * finally answered and why every obvious guess 404s.
 *
 * Two requests per team, then one per played game:
 *
 *   schedule/table?team_id=N&all=true  -> every game_id this team played
 *   game/boxscore?game_id=M            -> its goals, assists, strengths
 *
 * THE TEAM FILTER IS THE REQUEST, NOT A STRING TEST. We ask the API for one
 * team's schedule and it answers with that team's games, so there is no page
 * to substring-match and no way for a division-mate to be mistaken for us —
 * the failure that once made Classic Cue's, Burners and 716 Realty into
 * Retrievers teams. The team ids come from `isRetrievers`, which reads a
 * partial's own header.
 *
 * Unplayed games are enumerated and NOT fetched: a game that has not been
 * skated has no scoring summary to capture, and the schedule row already
 * records that it is coming. Four such games are on the Summer 2026 schedule.
 */
async function captureHarborcenterGames(): Promise<void> {
  const { store, log, index } = openStore();
  const reindexed = await rebuildFromLog(log, index);
  console.log(`Reindexed ${reindexed} record(s) before capture (index self-heals every run).`);

  console.log("\nHarborCenter game record (live HockeyShift era, Seneca HAHL)");
  console.log("  Enumerating via schedule/table — the route the SPA's own toolbar names.\n");

  const teams = await retrieversTeamsInCorpus();
  if (teams.length === 0) {
    // A silent zero here would read as "the Retrievers played no games at
    // HarborCenter", which is the opposite of true.
    console.error(
      "  No Golden Retrievers team partials in the corpus. This command reads the " +
        "team ids that `capture:harborcenter-live` discovers — run that first.",
    );
    index.close();
    process.exitCode = 1;
    return;
  }
  console.log(`  ${teams.length} Retrievers team(s) in the corpus.\n`);

  let ticket: string;
  try {
    ticket = await guestTicket();
  } catch (err) {
    console.error(`  ticket failed: ${err instanceof Error ? err.message : String(err)}`);
    index.close();
    process.exitCode = 1;
    return;
  }

  const fetcher = new Fetcher({
    store,
    log,
    index,
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 250 }),
  });
  const opts = {
    source: "harborcenter-hockeyshift",
    via: "live" as const,
    authorization: authHeader(ticket),
    freshnessMs: FRESHNESS_MS,
  };

  let fresh = 0;

  const grab = async (url: string, settled = false): Promise<string | null> => {
    // Fetcher.capture() deliberately returns the PRIOR record, indistinguishable
    // by shape, when the freshness window short-circuits. Detect it from the
    // outside as rescueWayback does: the short-circuit is the only path through
    // capture() that does not commit() a new row, so an unchanged capture count
    // means nothing was fetched. Without this the summary reports 189 boxscores
    // "captured" on a re-run that touched the network zero times.
    const before = index.countCaptures();
    const rec = await fetcher.capture(
      url,
      settled ? { ...opts, freshnessMs: SETTLED_FRESHNESS_MS } : opts,
    );
    if (index.countCaptures() === before) fresh++;
    if (rec.error || !rec.contentHash) {
      console.log(`    FAIL ${rec.error ?? "no body"} ${url}`);
      return null;
    }
    const buf = await store.get(rec.contentHash);
    if (!buf) return null;
    try {
      return (JSON.parse(buf.toString("utf8")) as { content?: string }).content ?? null;
    } catch {
      return null;
    }
  };

  let scheduled = 0;
  let played = 0;
  let boxscores = 0;
  let failed = 0;

  for (const t of teams) {
    const content = await grab(endpoints.teamSchedule(t.teamId));
    if (!content) {
      failed++;
      continue;
    }
    const rows = scheduleRows(content);
    if (rows.length === 0) {
      // Not "no games": an empty schedule means the response shape moved.
      console.log(`  ${t.label.padEnd(34)} NO SCHEDULE ROWS — response shape changed?`);
      failed++;
      continue;
    }
    const final = rows.filter((r) => r.status === "Final");
    scheduled += rows.length;
    played += final.length;
    const upcoming = rows.length - final.length;
    console.log(
      `  ${t.label.padEnd(34)} ${String(rows.length).padStart(2)} games` +
        `${upcoming > 0 ? ` (${final.length} played, ${upcoming} not yet)` : ""}`,
    );

    for (const r of final) {
      // A GAME THAT IS FINAL IS FINAL. The schedule above was fetched under
      // the live window and is what reveals a NEW result; the boxscore of a
      // game already played is not going to change, and re-reading all 195 of
      // them twice a week is 195 requests to learn nothing.
      //
      // Note this does not delay a new game by one minute: a boxscore never
      // captured has no prior record, so the freshness gate does not apply to
      // it at all and it is fetched on the first run after the game ends. The
      // long window only governs re-reading, and it is a window rather than
      // "never" because a scoresheet does occasionally get corrected.
      const box = await grab(endpoints.gameBoxscore(r.gameId), true);
      if (box) boxscores++;
      else failed++;
    }
  }

  const hashes = index.distinctHashes();
  const blobs = await store.count();
  console.log("\n--- HarborCenter game record capture summary ---");
  console.log("  this run:");
  console.log(`    sessions            : ${teams.length}`);
  console.log(`    games scheduled     : ${scheduled}`);
  console.log(`    games played        : ${played}`);
  console.log(`    boxscores on file   : ${boxscores}`);
  console.log(`    requests skipped    : ${fresh} (already fresh — no network)`);
  console.log(`    failed              : ${failed}`);
  console.log("  corpus totals:");
  console.log(`    captures logged     : ${index.countCaptures()}`);
  console.log(`    distinct hashes     : ${hashes}`);
  console.log(`    blob files on disk  : ${blobs}`);
  if (hashes !== blobs) {
    console.warn(`    WARNING: index/blob divergence — ${hashes} vs ${blobs}.`);
  }
  index.close();
}

/**
 * Capture the Golden Retrievers' Erie Metro era (live SportsEngine).
 *
 * Bounded, not discovered: the site's own sitemap lists exactly TWO
 * `golden-retrievers` pages, so the team's Erie Metro history is 2016-17 and
 * 2017-18 and nothing else. Seeds are therefore hard-coded rather than
 * crawled for — enumerating the whole league to re-derive a two-item list
 * would be a pointless load on a volunteer-run site.
 *
 * Authorization basis: the owner is part of Erie Metro league management
 * (spec §8.1). We honor the `User-agent: *` group in full; every path below
 * is explicitly allowed there.
 */
async function captureErieMetro(): Promise<void> {
  const { store, log, index } = openStore();
  const reindexed = await rebuildFromLog(log, index);
  console.log(`Reindexed ${reindexed} record(s) before capture (index self-heals every run).`);

  console.log("\nErie Metro (live SportsEngine)");
  console.log(
    "  The sitemap lists exactly two golden-retrievers pages: 2016-17 and 2017-18.\n",
  );

  const fetcher = new Fetcher({
    store,
    log,
    index,
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 250 }),
  });
  const opts = { source: "eriemetro", via: "live" as const, freshnessMs: FRESHNESS_MS };

  const grab = async (url: string): Promise<string | null> => {
    const rec = await fetcher.capture(url, opts);
    if (rec.error || !rec.contentHash) {
      console.log(`    FAIL ${rec.error ?? "no body"} ${url}`);
      return null;
    }
    return (await store.get(rec.contentHash))?.toString("utf8") ?? null;
  };

  let players = 0;
  let sheets = 0;
  let calls = 0;

  for (const t of ERIE_METRO_SEASONS) {
    console.log(`  ${t.label}  (page ${t.pageId} / team_instance ${t.teamInstance})`);

    // Season context: team page, roster, standings.
    for (const u of [urls.page(t), urls.roster(t), urls.standings(t)]) {
      await grab(u);
      calls++;
    }

    // Roster + stats -> the per-season player records.
    const stats = await grab(urls.teamStats(t));
    calls++;
    const pids = stats ? rosterPlayerIds(stats) : [];
    console.log(`    roster_players: ${pids.length}`);
    for (const pid of pids) {
      // Bio pages carry DATE OF BIRTH — the only field that reliably separates
      // the Kaplewicz/Suffoletto siblings (spec §2.5). Capture priority 1.
      await grab(urls.rosterPlayer(t.host, pid));
      calls++;
      players++;
    }

    // Schedule -> game sheets: goal times, primary AND secondary assists,
    // strength state. The sole source of assist networks.
    const sched = await grab(urls.schedule(t));
    calls++;
    // A schedule links /game/show/<id>, never /game/game_sheet/<id> — but the
    // SAME id addresses both views, so show ids become sheet URLs directly.
    const gids = sched ? gameShowIds(sched) : [];
    console.log(`    game_sheets   : ${gids.length}`);
    for (const gid of gids) {
      await grab(urls.gameSheet(t.host, gid));
      calls++;
      sheets++;
    }
  }

  const hashes = index.distinctHashes();
  const blobs = await store.count();
  console.log("\n--- Erie Metro capture summary ---");
  console.log("  this run:");
  console.log(`    http calls          : ${calls}`);
  console.log(`    seasons             : ${ERIE_METRO_SEASONS.length}`);
  console.log(`    roster_players      : ${players}`);
  console.log(`    game_sheets         : ${sheets}`);
  console.log("  corpus totals:");
  console.log(`    captures logged     : ${index.countCaptures()}`);
  console.log(`    distinct hashes     : ${hashes}`);
  console.log(`    blob files on disk  : ${blobs}`);
  if (hashes !== blobs) {
    console.warn(`    WARNING: index/blob divergence — ${hashes} vs ${blobs}.`);
  }
  index.close();
}

/**
 * Capture the Erie Metro LEAGUE-WIDE skater tables — where the Retrievers stood
 * against the whole EMHL, every stat, 2016-17 and 2017-18.
 *
 * SportsEngine sorts and pages these server-side. The URL the site's own
 * pagination widget uses carries the whole contract:
 *
 *   stats/league_instance/<id>?subseason=<n>
 *     &order_by=hkspts&dir=desc&stat_module=ice_hockey_skater&page=<p>
 *
 * `order_by` is a real server sort (`hkspts` points, and the site exposes goals,
 * assists and penalty minutes the same way) — so unlike the archived HAHL
 * tables, which survive only as page one sorted by goals, this is the WHOLE
 * field and can be ranked on anything. One sort is enough: every row already
 * carries G, A, PTS and PIM, so points-sorted pages give the complete field and
 * the other three races are computed off it. The end is a page that adds no new
 * player (the pager clamps past the last page rather than erroring).
 *
 * Whose row is the Retrievers' is decided by the team's OWN `sorttable_customkey`
 * attribute on the row, never the visible cell — which on this platform is the
 * team's ABBREVIATION ("83"), not its name.
 */
async function captureErieMetroLeaders(): Promise<void> {
  const { store, log, index } = openStore();
  const reindexed = await rebuildFromLog(log, index);
  console.log(`Reindexed ${reindexed} record(s) before capture (index self-heals every run).`);

  console.log("\nErie Metro league-wide skater tables (live SportsEngine)");
  console.log("  Full field, points-sorted; goals/assists/PIM computed off it.\n");

  const fetcher = new Fetcher({
    store,
    log,
    index,
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 250 }),
  });
  const opts = { source: "eriemetro", via: "live" as const, freshnessMs: FRESHNESS_MS };

  let fresh = 0;
  let failed = 0;
  let pagesTotal = 0;

  const grab = async (url: string): Promise<string | null> => {
    const before = index.countCaptures();
    const rec = await fetcher.capture(url, opts);
    if (index.countCaptures() === before) fresh++;
    if (rec.error || !rec.contentHash) {
      console.log(`    FAIL ${rec.error ?? "no body"} ${url}`);
      return null;
    }
    return (await store.get(rec.contentHash))?.toString("utf8") ?? null;
  };

  for (const s of ERIE_METRO_LEAGUES) {
    const seen = new Set<string>();
    let pages = 0;
    for (let page = 1; page <= 25; page++) {
      const url =
        `https://www.eriemetrosports.com/stats/league_instance/${s.leagueInstance}` +
        `?subseason=${s.subseason}&order_by=hkspts&dir=desc&stat_module=ice_hockey_skater&page=${page}`;
      const html = await grab(url);
      if (html === null) {
        if (page === 1) failed++;
        break;
      }
      pages++;
      // Each league row links its own roster_players id; a page that introduces
      // none we have not seen is the pager clamping past the end.
      const ids = [...html.matchAll(/roster_players\/(\d+)/g)].map((m) => m[1]!);
      const newIds = ids.filter((id) => !seen.has(id));
      for (const id of ids) seen.add(id);
      if (newIds.length === 0) break;
    }
    pagesTotal += pages;
    console.log(`  ${s.label.padEnd(10)} league_instance ${s.leagueInstance}: ${pages} page(s), ${seen.size} skaters`);
  }

  const hashes = index.distinctHashes();
  const blobs = await store.count();
  console.log("\n--- Erie Metro league table capture summary ---");
  console.log(`  this run:`);
  console.log(`    seasons             : ${ERIE_METRO_LEAGUES.length}`);
  console.log(`    pages captured      : ${pagesTotal}`);
  console.log(`    requests skipped    : ${fresh} (already fresh — no network)`);
  console.log(`    failed              : ${failed}`);
  console.log("  corpus totals:");
  console.log(`    captures logged     : ${index.countCaptures()}`);
  console.log(`    distinct hashes     : ${hashes}`);
  console.log(`    blob files on disk  : ${blobs}`);
  if (hashes !== blobs) {
    console.warn(`    WARNING: index/blob divergence — ${hashes} vs ${blobs}.`);
  }
  index.close();
}

/** Rebuild the derived index from the log. Proves the log is authoritative. */
async function reindex(): Promise<void> {
  const { log, index } = openStore();
  const n = await rebuildFromLog(log, index);
  console.log(`Reindexed ${n} records from ${join(DATA, "captures.jsonl")}`);
  index.close();
}

const cmd = process.argv[2];
if (cmd === "capture:keystone") await rescueWayback(KEYSTONE);
else if (cmd === "capture:harborcenter-archive") await rescueWayback(HARBORCENTER_ARCHIVE);
else if (cmd === "capture:harborcenter-sportngin") await rescueWayback(HARBORCENTER_SPORTNGIN);
else if (cmd === "capture:retrievers-pages") await rescueWayback(RETRIEVERS_SPORTNGIN_PAGES);
else if (cmd === "capture:harborcenter-live") await captureHarborcenterLive();
else if (cmd === "capture:harborcenter-games") await captureHarborcenterGames();
else if (cmd === "capture:harborcenter-leaders") await captureHarborcenterLeaders();
else if (cmd === "capture:eriemetro") await captureErieMetro();
else if (cmd === "capture:eriemetro-leaders") await captureErieMetroLeaders();
else if (cmd === "reindex") await reindex();
else {
  console.error(
    "usage: node src/cli.ts <capture:keystone|capture:harborcenter-archive|capture:harborcenter-sportngin|capture:retrievers-pages|capture:harborcenter-live|capture:harborcenter-games|capture:harborcenter-leaders|capture:eriemetro|capture:eriemetro-leaders|reindex>",
  );
  process.exit(1);
}
