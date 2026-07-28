/**
 * Capture HAHL Silver division stats and player pages from the Wayback Machine.
 *
 * Research agents found these pages contain inline stat tables for 2018-19
 * that are NOT in the corpus. The division leaderboard has Karchensky leading
 * the entire Silver division at 47G/25A/72Pts.
 *
 * Usage:  node packages/capture/src/capture-wayback-hahl-silver.ts
 */

import { join } from "node:path";
import { BlobStore } from "./store/blobs.ts";
import { CaptureLog } from "./store/log.ts";
import { ManifestIndex, rebuildFromLog } from "./store/index.ts";
import { Fetcher } from "./fetcher/fetcher.ts";
import { RateLimiter } from "./fetcher/politeness.ts";

const DATA = process.env.GR_DATA_DIR ?? "data";

function waybackTsFrom(url: string): string {
  const m = url.match(/\/web\/(\d+)id_\//);
  if (!m) throw new Error(`No wayback timestamp in URL: ${url}`);
  return m[1]!;
}

const TARGETS = [
  {
    label: "2018-19 Silver division player stats (Aug 2020 capture)",
    url: "https://web.archive.org/web/20200806011947id_/https://harborcenter.sportngin.com/stats/division_instance/308666?subseason=531786&tab=division_instance_player_stats&tool=3233049",
    source: "harborcenter-sportngin",
  },
  {
    label: "Karchensky player page (Nov 2019)",
    url: "https://web.archive.org/web/20191112120042id_/https://harborcenter.sportngin.com/roster_players/27736750",
    source: "harborcenter-sportngin",
  },
  {
    label: "Kaplewicz player page (Nov 2019)",
    url: "https://web.archive.org/web/20191112112032id_/https://harborcenter.sportngin.com/roster_players/27736747",
    source: "harborcenter-sportngin",
  },
];

async function main(): Promise<void> {
  const store = new BlobStore(join(DATA, "blobs"));
  const log = new CaptureLog(join(DATA, "captures.jsonl"));
  const index = new ManifestIndex(join(DATA, "manifest.sqlite"));

  await rebuildFromLog(log, index);

  const fetcher = new Fetcher({
    store,
    log,
    index,
    limiter: new RateLimiter({ minIntervalMs: 1000, jitterMs: 250 }),
  });

  console.log("HAHL Silver division captures (harborcenter-sportngin)\n");

  let ok = 0;
  let failed = 0;

  for (const target of TARGETS) {
    const waybackTs = waybackTsFrom(target.url);
    const before = index.countCaptures();
    const rec = await fetcher.capture(target.url, {
      source: target.source,
      via: "wayback",
      waybackTs,
      freshnessMs: 7 * 24 * 60 * 60 * 1000,
    });
    const after = index.countCaptures();

    if (after === before) {
      console.log(`  FRESH  ${target.label}`);
    } else if (rec.error) {
      failed++;
      console.log(`  FAIL   ${target.label}  ${rec.error}`);
    } else {
      ok++;
      console.log(`  OK     ${target.label}  -> ${rec.contentHash?.slice(0, 12)}...`);
    }
  }

  console.log(`\n--- ${ok} captured, ${failed} failed ---`);
  console.log(`  corpus: ${index.countCaptures()} captures, ${index.distinctHashes()} distinct hashes`);
  index.close();

  if (failed > 0) process.exitCode = 1;
}

await main();
