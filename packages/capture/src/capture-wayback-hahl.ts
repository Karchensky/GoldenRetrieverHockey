/**
 * Targeted capture of HAHL standings and stats pages from the Wayback Machine.
 *
 * These four pages were identified by research agents as archived but NOT in
 * our corpus. They are HarborCenter SportsEngine pages from eras the CDX
 * sweep did not reach (the sweep enumerates by domain; these URLs were found
 * by following specific subseason/league_instance links).
 *
 * Each URL uses the `id_/` modifier so Wayback returns the original bytes
 * without its toolbar or injected scripts.
 *
 * Usage:  node packages/capture/src/capture-wayback-hahl.ts
 */

import { join } from "node:path";
import { BlobStore } from "./store/blobs.ts";
import { CaptureLog } from "./store/log.ts";
import { ManifestIndex, rebuildFromLog } from "./store/index.ts";
import { Fetcher } from "./fetcher/fetcher.ts";
import { RateLimiter } from "./fetcher/politeness.ts";

const DATA = process.env.GR_DATA_DIR ?? "data";

/**
 * Extract the Wayback timestamp from a `…/web/<timestamp>id_/…` URL.
 * Returns the numeric timestamp string (e.g. "20190824003155").
 */
function waybackTsFrom(url: string): string {
  const m = url.match(/\/web\/(\d+)id_\//);
  if (!m) throw new Error(`No wayback timestamp in URL: ${url}`);
  return m[1]!;
}

type Target = {
  /** Human label for console output. */
  label: string;
  /** Full Wayback id_ URL. */
  url: string;
};

const TARGETS: readonly Target[] = [
  {
    label: "Summer 2018 standings",
    url: "https://web.archive.org/web/20190824003155id_/https://www.rinksatharborcenter.com/standings/show/4025607?subseason=493397",
  },
  {
    label: "2018-19 FW standings",
    url: "https://web.archive.org/web/20191214111835id_/https://www.rinksatharborcenter.com/standings/show/4498441?subseason=531786",
  },
  {
    label: "2019-20 league stats",
    url: "https://web.archive.org/web/20191119232054id_/https://www.rinksatharborcenter.com/stats/league_instance/100049?subseason=624780&tab=league_instance_team_stats&tool=3777298",
  },
  {
    label: "Spring 2021 league stats",
    url: "https://web.archive.org/web/20210420004208id_/https://www.rinksatharborcenter.com/stats/league_instance/118509?subseason=682079&tab=league_instance_team_stats&tool=4119744",
  },
];

async function main(): Promise<void> {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));
  const index = new ManifestIndex(join(DATA, "manifest.sqlite"));

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

  console.log("\nHAHL targeted Wayback captures (harborcenter-sportngin)");
  console.log(
    "  Standings and league stats pages identified by research but absent from the corpus.\n",
  );

  let ok = 0;
  let failed = 0;
  let fresh = 0;

  for (const target of TARGETS) {
    const waybackTs = waybackTsFrom(target.url);
    const before = index.countCaptures();
    const rec = await fetcher.capture(target.url, {
      source: "harborcenter-sportngin",
      via: "wayback",
      waybackTs,
      // No freshnessMs: these are specific historical snapshots that never
      // change. Once captured, a re-run should skip them via the index
      // (the Fetcher's freshness gate), not re-fetch them.
      freshnessMs: 7 * 24 * 60 * 60 * 1000,
    });
    const after = index.countCaptures();

    if (after === before) {
      fresh++;
      console.log(`  FRESH  ${target.label}  (${waybackTs})`);
    } else if (rec.error) {
      failed++;
      console.log(`  FAIL   ${target.label}  (${waybackTs})  ${rec.error}`);
    } else {
      ok++;
      console.log(`  OK     ${target.label}  (${waybackTs})  -> ${rec.contentHash?.slice(0, 12)}...`);
    }
  }

  const hashes = index.distinctHashes();
  const blobs = await store.count();

  console.log("\n--- HAHL targeted capture summary ---");
  console.log("  this run:");
  console.log(`    targets             : ${TARGETS.length}`);
  console.log(`    captured            : ${ok}`);
  console.log(`    skipped (fresh)     : ${fresh}`);
  console.log(`    failed              : ${failed}`);
  console.log("  corpus totals:");
  console.log(`    captures logged     : ${index.countCaptures()}`);
  console.log(`    distinct hashes     : ${hashes}`);
  console.log(`    blob files on disk  : ${blobs}`);
  if (hashes !== blobs) {
    console.warn(
      `    WARNING: index/blob-store divergence — ${hashes} distinct content hash(es) recorded in the index but ${blobs} blob file(s) on disk. Investigate before trusting this corpus.`,
    );
  }
  index.close();

  if (failed > 0) process.exitCode = 1;
}

await main();
