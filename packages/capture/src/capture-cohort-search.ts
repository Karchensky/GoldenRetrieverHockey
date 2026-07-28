/**
 * Capture the two still-plausible 2012–17 archive surfaces and search their
 * bodies by player cohort. Every distinct 2016 Performax body and every
 * distinct Holiday adult/schedule body is retained; reruns are freshness-gated.
 *
 * Usage: npm run capture:cohort-search
 */
import { join } from "node:path";
import { BlobStore } from "./store/blobs.ts";
import { CaptureLog } from "./store/log.ts";
import { ManifestIndex, rebuildFromLog } from "./store/index.ts";
import { Fetcher } from "./fetcher/fetcher.ts";
import { RateLimiter } from "./fetcher/politeness.ts";
import { originalUrl } from "./sources/wayback.ts";

const DATA = process.env.GR_DATA_DIR ?? "data";
const CDX = "https://web.archive.org/cdx/search/cdx";
const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

type Target = {
  label: string;
  source: string;
  pattern: string;
  from: number;
  to: number;
  bodyPath?: RegExp;
  /**
   * Full-URL filter, for narrowing on the QUERY STRING.
   *
   * `bodyPath` only sees `new URL(...).pathname`, which is blind to
   * `?leagueid=718` — and on Pointstreak the path is one shared endpoint and
   * the league is entirely in the query. Without this, the season-page pattern
   * below matches 1,940 archived pages of other people's leagues to reach the
   * four that are ours. Whatever this drops is reported, same rule as
   * `bodyPath`.
   */
  urlMatch?: RegExp;
};

const TARGETS: readonly Target[] = [
  {
    label: "Holiday/Leisure content pages",
    source: "holiday-wayback",
    pattern: "holidayrinks.com/content/pages/*",
    from: 2012,
    to: 2017,
    bodyPath: /\/content\/pages\/.*(?:senior|schedule|adult|labatt|league|standings|suspension|game[_-]info)/i,
  },
  {
    /**
     * THE LSHL SEASON INDEX — the page the pattern above cannot see.
     *
     * The Labatt Senior Hockey League is the team's 2012-13 league (trophy
     * case: "2012 LSHL Summer Champions", "2013 LSHL Runner-Up") and Holiday
     * Twin Rinks ran it. Its season-by-season links live at
     * `/senior-game-schedules-ii` — a TOP-LEVEL path, not under
     * `/content/pages/`, so the sweep above missed all 41 archived snapshots
     * of it while capturing 27 of the sibling `senior-hockey-home`.
     *
     * This page is what names the league's Pointstreak ids: every snapshot
     * links `pointstreak.com/players/players-leagues.html?leagueid=718&
     * seasonid=<id>` under a human season label, and walking the snapshots in
     * date order is how LSHL Summer 2012 was identified as seasonid 8977.
     */
    label: "Holiday senior game-schedule index (LSHL season links)",
    source: "holiday-wayback",
    pattern: "holidayrinks.com/senior-game-schedules-ii*",
    from: 2010,
    to: 2017,
  },
  {
    /**
     * LSHL ON POINTSTREAK — leagueid 718, the league's own stats platform.
     *
     * Pointstreak is DEAD as a live source: every `pointstreak.com` URL now
     * 301s to `stacksports.com`, which answers 403 behind Cloudflare (checked
     * 2026-07-26). The Wayback Machine holds exactly four league-home
     * snapshots for leagueid 718, and one of them — 20141015013257,
     * seasonid 10894 — carries the complete season dropdown, which is the only
     * surviving map from a season NAME to its Pointstreak id:
     *
     *   MSHL Fall 2008 3399 · MSHL Summer 2009 4190 · MSHL Fall 2009 4652
     *   MSHL Summer 2010 5623 · MSHL Fall 2010 6201 · LSHL Summer 2011 7194
     *   LSHL Fall 2011 7703 · LSHL Summer 2012 8977 · LSHL Fall 2012 9578
     *   LSHL Summer 2013 10894 · LSHL Fall 2013 11504 · LSHL Summer 2014 12614
     *   OTHL Fall 2014 12928
     *
     * MSHL/LSHL/OTHL are the same league under three beer sponsors (Molson,
     * Labatt, Molson Old Tyme). That dropdown is the reason this target exists:
     * it is small, it is the index to everything else, and it is one CDN
     * outage from being gone.
     */
    label: "LSHL on Pointstreak (leagueid 718 season index)",
    source: "lshl-pointstreak",
    pattern: "pointstreak.com/players/players-leagues.html*",
    from: 2010,
    to: 2017,
    urlMatch: /[?&]leagueid=718(?:&|$)/,
  },
  {
    label: "Performax 2016",
    source: "performax-wayback",
    pattern: "performaxsports.com/*",
    from: 2016,
    to: 2016,
  },
];

/**
 * Surnames to search each captured body for.
 *
 * `fedele` and `muff` were missing from this list while being two of the seven
 * men the handoff names as the search cohort. That omission was not free:
 * `holidayrinks.com/content/pages/goalie-pool` — already captured by the first
 * target, sitting in the corpus — lists "Corey Muff ... C 3 Advanced", which
 * independently corroborates the C3 division the team won in 2012, and this
 * scan reported zero hits on it.
 */
const COHORT = [
  "kaplewicz", "karchensky", "suffoletto", "suffaletto", "terrana", "terana",
  "terrara", "wheeler", "schmitt", "koeppel", "vanvoorhis", "kaczmerski",
  "morphis", "tomeny", "fedele", "muff",
] as const;

type Row = { timestamp: string; original: string; digest: string };

async function rowsFor(target: Target): Promise<Row[]> {
  const query = new URLSearchParams({
    url: target.pattern,
    output: "json",
    fl: "timestamp,original,statuscode,mimetype,digest",
    from: String(target.from),
    to: String(target.to),
    collapse: "digest",
  });
  query.append("filter", "statuscode:200");
  query.append("filter", "mimetype:text/html");
  const response = await fetch(`${CDX}?${query}`);
  if (!response.ok) throw new Error(`${target.label}: CDX returned ${response.status}`);
  const raw = await response.json() as string[][];
  const rows: Row[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const row of raw.slice(1)) {
    const item = { timestamp: row[0] ?? "", original: row[1] ?? "", digest: row[4] ?? "" };
    if (!item.timestamp || !item.original) continue;
    if (target.bodyPath && !target.bodyPath.test(new URL(item.original).pathname)) { dropped++; continue; }
    if (target.urlMatch && !target.urlMatch.test(item.original)) { dropped++; continue; }
    const key = `${item.timestamp}|${item.original}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(item);
  }
  // No silent caps: a narrowed sweep must say what it narrowed away, or a run
  // that touched four pages of a 1,940-page pattern reads as full coverage.
  if (dropped > 0) console.log(`  ${target.label}: filters dropped ${dropped} of ${raw.length - 1} CDX rows`);
  return rows.sort((a, b) => a.original.localeCompare(b.original) || a.timestamp.localeCompare(b.timestamp));
}

async function main() {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));
  const index = new ManifestIndex(join(DATA, "manifest.sqlite"));
  await rebuildFromLog(log, index);
  const fetcher = new Fetcher({
    store,
    log,
    index,
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 150 }),
  });

  const hits: { target: string; url: string; names: string[] }[] = [];
  for (const target of TARGETS) {
    const rows = await rowsFor(target);
    console.log(`\n${target.label}: ${rows.length} distinct URLs`);
    for (const [indexInTarget, row] of rows.entries()) {
      const archived = originalUrl(row.timestamp, row.original);
      const record = await fetcher.capture(archived, {
        source: target.source,
        via: "wayback",
        waybackTs: row.timestamp,
        freshnessMs: FRESHNESS_MS,
      });
      if (record.contentHash) {
        const body = (await store.get(record.contentHash))?.toString("utf8").toLowerCase() ?? "";
        const names = COHORT.filter((name) => body.includes(name));
        if (names.length > 0) {
          hits.push({ target: target.label, url: row.original, names: [...names] });
          console.log(`  HIT ${names.join(", ")}  ${row.original}`);
        }
      }
      if ((indexInTarget + 1) % 25 === 0 || indexInTarget === rows.length - 1) {
        console.log(`  ${indexInTarget + 1}/${rows.length}`);
      }
    }
  }

  console.log(`\nCohort matches: ${hits.length}`);
  for (const hit of hits) console.log(`  ${hit.names.join(", ")}  ${hit.url}`);
  index.close();
}

await main();
