import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestIndex, rebuildFromLog } from "../src/store/index.ts";
import { CaptureLog } from "../src/store/log.ts";
import type { CaptureRecord } from "../src/store/types.ts";

/** Deterministic ids so replaying the same log is genuinely idempotent. */
function rec(url: string, hash: string, fetchedAt: string): CaptureRecord {
  return {
    id: `${url}@${fetchedAt}#${hash}`,
    url,
    finalUrl: url,
    status: 200,
    contentHash: hash,
    contentType: "text/html",
    fetchedAt,
    source: "goldenretrieverhockey",
    via: "wayback",
    waybackTs: "20130221000000",
    authenticated: false,
    discoveredFrom: null,
    error: null,
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "gr-idx-"));
}

test("insert then lastCapture returns the most recent capture for a url", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  idx.insert(rec("http://a/", "h1", "2026-07-14T10:00:00.000Z"));
  idx.insert(rec("http://a/", "h2", "2026-07-14T12:00:00.000Z"));
  const last = idx.lastCapture("http://a/");
  assert.equal(last?.contentHash, "h2");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("lastCapture returns null for an unseen url", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  assert.equal(idx.lastCapture("http://never/"), null);
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("two captures of identical content count as 2 captures and 1 hash", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  idx.insert(rec("http://a/", "same", "2026-07-14T10:00:00.000Z"));
  idx.insert(rec("http://a/", "same", "2026-07-14T11:00:00.000Z"));
  assert.equal(idx.countCaptures(), 2, "capture identity is per-fetch");
  assert.equal(idx.distinctHashes(), 1, "content identity is per-bytes");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("two captures in the SAME millisecond are both kept", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  const t = "2026-07-14T10:00:00.000Z";
  // Same url, same timestamp, same content — distinguished only by id.
  // Keying on (url, fetched_at) would silently collapse these into one row
  // and make store correctness depend on the rate limiter being enabled.
  idx.insert({ ...rec("http://a/", "same", t), id: "capture-1" });
  idx.insert({ ...rec("http://a/", "same", t), id: "capture-2" });
  assert.equal(idx.countCaptures(), 2, "id is the primary key, not (url, fetched_at)");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("the index is fully rebuildable from the log alone", async () => {
  const dir = await tempDir();
  const log = new CaptureLog(join(dir, "captures.jsonl"));
  await log.append(rec("http://a/", "h1", "2026-07-14T10:00:00.000Z"));
  await log.append(rec("http://b/", "h2", "2026-07-14T11:00:00.000Z"));
  await log.append(rec("http://a/", "h3", "2026-07-14T12:00:00.000Z"));

  // Simulate total loss of the database.
  const fresh = new ManifestIndex(join(dir, "rebuilt.sqlite"));
  const n = await rebuildFromLog(log, fresh);

  assert.equal(n, 3, "every logged record must be reindexed");
  assert.equal(fresh.countCaptures(), 3);
  assert.equal(fresh.lastCapture("http://a/")?.contentHash, "h3");
  fresh.close();
  await rm(dir, { recursive: true, force: true });
});

test("rebuild is idempotent — replaying the log twice does not duplicate", async () => {
  const dir = await tempDir();
  const log = new CaptureLog(join(dir, "captures.jsonl"));
  await log.append(rec("http://a/", "h1", "2026-07-14T10:00:00.000Z"));
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  await rebuildFromLog(log, idx);
  await rebuildFromLog(log, idx);
  assert.equal(idx.countCaptures(), 1, "reindexing must be idempotent");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("gaps are recorded and listed", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  idx.recordGap("http://locked/", "league_instance", "auth_required", "302 to login");
  idx.recordGap("http://locked/", "league_instance", "auth_required", "seen again");
  const gaps = idx.gaps();
  assert.equal(gaps.length, 1, "a gap is keyed by url");
  assert.equal(gaps[0]?.reason, "auth_required");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("a gap-worthy capture error survives total database loss via rebuild", async () => {
  const dir = await tempDir();
  const log = new CaptureLog(join(dir, "captures.jsonl"));
  const t = "2026-07-14T10:00:00.000Z";
  const gapRec: CaptureRecord = {
    ...rec("http://locked/", "h1", t),
    id: "capture-gap-1",
    error: "auth_required",
    finalUrl: "http://locked/login",
  };
  await log.append(gapRec);

  // Insert directly and confirm the gap is derived immediately.
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  idx.insert(gapRec);
  const gapsAfterInsert = idx.gaps();
  assert.equal(gapsAfterInsert.length, 1, "insert() must derive a gap row from a gap-worthy error");
  assert.equal(gapsAfterInsert[0]?.reason, "auth_required");
  idx.close();

  // Simulate total loss of the database: rebuild against a FRESH index.
  const fresh = new ManifestIndex(join(dir, "rebuilt.sqlite"));
  const n = await rebuildFromLog(log, fresh);

  assert.equal(n, 1, "every logged record must be reindexed");
  assert.equal(fresh.countCaptures(), 1, "the capture row must be restored");
  const gapsAfterRebuild = fresh.gaps();
  assert.equal(gapsAfterRebuild.length, 1, "the gap row must be restored by rebuild alone");
  assert.equal(gapsAfterRebuild[0]?.url, "http://locked/");
  assert.equal(gapsAfterRebuild[0]?.reason, "auth_required");
  fresh.close();
  await rm(dir, { recursive: true, force: true });
});

test("a transient (non-gap-worthy) error does not create a gap row", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  const t = "2026-07-14T10:00:00.000Z";
  idx.insert({ ...rec("http://a/", "h1", t), id: "capture-transient-1", error: "http_500" });
  assert.equal(idx.gaps().length, 0, "a transient failure must not be recorded as a gap");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("a record with error: null does not create a gap row", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  const t = "2026-07-14T10:00:00.000Z";
  idx.insert({ ...rec("http://a/", "h1", t), id: "capture-ok-1", error: null });
  assert.equal(idx.gaps().length, 0, "a successful capture must not be recorded as a gap");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});

test("lastCapture is deterministic when two records share fetched_at", async () => {
  const dir = await tempDir();
  const idx = new ManifestIndex(join(dir, "m.sqlite"));
  const t = "2026-07-14T10:00:00.000Z";
  idx.insert({ ...rec("http://a/", "h1", t), id: "capture-aaa" });
  idx.insert({ ...rec("http://a/", "h2", t), id: "capture-bbb" });
  const first = idx.lastCapture("http://a/");
  const second = idx.lastCapture("http://a/");
  assert.equal(first?.id, second?.id, "lastCapture must be deterministic across repeated calls");
  assert.equal(first?.id, "capture-bbb", "ties break on id DESC");
  idx.close();
  await rm(dir, { recursive: true, force: true });
});
