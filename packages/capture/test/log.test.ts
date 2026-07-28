import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureLog } from "../src/store/log.ts";
import type { CaptureRecord } from "../src/store/types.ts";

let n = 0;
function rec(url: string, hash: string): CaptureRecord {
  return {
    id: `id-${++n}`,
    url,
    finalUrl: url,
    status: 200,
    contentHash: hash,
    contentType: "text/html",
    fetchedAt: "2026-07-14T12:00:00.000Z",
    source: "goldenretrieverhockey",
    via: "wayback",
    waybackTs: "20130221000000",
    authenticated: false,
    discoveredFrom: null,
    error: null,
  };
}

async function tempLog(): Promise<{ log: CaptureLog; dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "gr-log-"));
  const file = join(dir, "captures.jsonl");
  return { log: new CaptureLog(file), dir, file };
}

test("append then read round-trips records in order", async () => {
  const { log, dir } = await tempLog();
  await log.append(rec("http://a/", "aa"));
  await log.append(rec("http://b/", "bb"));
  const all = await log.all();
  assert.equal(all.length, 2);
  assert.equal(all[0]?.url, "http://a/");
  assert.equal(all[1]?.url, "http://b/");
  await rm(dir, { recursive: true, force: true });
});

test("log is newline-delimited JSON, one record per line", async () => {
  const { log, dir, file } = await tempLog();
  await log.append(rec("http://a/", "aa"));
  await log.append(rec("http://b/", "bb"));
  const text = await readFile(file, "utf8");
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).url, "http://a/");
  await rm(dir, { recursive: true, force: true });
});

test("append is additive and never rewrites earlier records", async () => {
  const { log, dir, file } = await tempLog();
  await log.append(rec("http://a/", "aa"));
  const afterFirst = await readFile(file, "utf8");
  await log.append(rec("http://b/", "bb"));
  const afterSecond = await readFile(file, "utf8");
  assert.ok(
    afterSecond.startsWith(afterFirst),
    "existing bytes must be a prefix of the log after appending",
  );
  await rm(dir, { recursive: true, force: true });
});

test("the same URL captured twice yields two records sharing one hash", async () => {
  const { log, dir } = await tempLog();
  await log.append(rec("http://a/", "same"));
  await log.append(rec("http://a/", "same"));
  const all = await log.all();
  assert.equal(all.length, 2, "capture identity is per-fetch, not per-content");
  assert.equal(all[0]?.contentHash, all[1]?.contentHash);
  await rm(dir, { recursive: true, force: true });
});

test("a truncated trailing line is skipped rather than throwing", async () => {
  const { log, dir, file } = await tempLog();
  await log.append(rec("http://a/", "aa"));
  await appendFile(file, '{"url":"http://partial/","stat');
  const all = await log.all();
  assert.equal(all.length, 1, "a crash mid-write must not corrupt the readable log");
  assert.equal(all[0]?.url, "http://a/");
  await rm(dir, { recursive: true, force: true });
});

test("all() on a missing log returns empty rather than throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gr-log-"));
  const log = new CaptureLog(join(dir, "nope.jsonl"));
  assert.deepEqual(await log.all(), []);
  await rm(dir, { recursive: true, force: true });
});

test("a non-ENOENT open failure propagates rather than being reported as an empty log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gr-log-"));
  // A NUL byte makes fs.open() itself throw synchronously with
  // ERR_INVALID_ARG_VALUE — deterministically and on every platform Node
  // supports, unlike e.g. permission errors or opening a directory (which,
  // on Windows, does NOT fail at open() time; the failure only surfaces on
  // the first read). It stands in for "the log exists but could not be
  // opened" (EACCES in production): CaptureLog must propagate that, not
  // report it as an empty log.
  const file = join(dir, `bad${String.fromCharCode(0)}name.jsonl`);
  const log = new CaptureLog(file);
  await assert.rejects(
    () => log.all(),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.notEqual((err as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    },
  );
  await rm(dir, { recursive: true, force: true });
});

test("a corrupt line in the middle of the file is skipped, warned about, and does not take its neighbors with it", async () => {
  const { log, dir, file } = await tempLog();
  await log.append(rec("http://a/", "aa"));
  await appendFile(file, "not json at all\n");
  await log.append(rec("http://b/", "bb"));

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  let all: CaptureRecord[];
  try {
    all = await log.all();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(all.length, 2, "the good records surrounding the corrupt line must survive");
  assert.equal(all[0]?.url, "http://a/");
  assert.equal(all[1]?.url, "http://b/");
  assert.equal(warnings.length, 1, "exactly one diagnostic for the one corrupt line");
  const message = String(warnings[0]?.[0] ?? "");
  assert.match(message, /line 2/, "diagnostic should name the 1-based line number");
  assert.ok(message.includes(file), "diagnostic should include the log file path");
  await rm(dir, { recursive: true, force: true });
});
