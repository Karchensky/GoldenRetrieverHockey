import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobStore } from "../src/store/blobs.ts";
import { CaptureLog } from "../src/store/log.ts";
import { ManifestIndex, rebuildFromLog } from "../src/store/index.ts";
import { RateLimiter } from "../src/fetcher/politeness.ts";
import { RobotsCache } from "../src/fetcher/robots.ts";
import { Fetcher, BROWSER_UA, isLoginRedirect } from "../src/fetcher/fetcher.ts";

const allowAll = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;

async function harness(fetchFn: typeof fetch, maxAttempts = 3) {
  const dir = await mkdtemp(join(tmpdir(), "gr-fetch-"));
  const store = new BlobStore(join(dir, "blobs"));
  const log = new CaptureLog(join(dir, "captures.jsonl"));
  const index = new ManifestIndex(join(dir, "m.sqlite"));
  const fetcher = new Fetcher({
    store,
    log,
    index,
    fetchFn,
    limiter: new RateLimiter({ minIntervalMs: 0, jitterMs: 0, sleep: async () => {} }),
    robots: new RobotsCache(allowAll),
    sleep: async () => {},
    maxAttempts,
  });
  return { fetcher, store, log, index, dir };
}

test("isLoginRedirect detects the SportsEngine login wall", () => {
  assert.equal(isLoginRedirect("https://login.sportngin.com?next_url=x"), true);
  assert.equal(isLoginRedirect("https://user.sportngin.com/users/sign_in?x=1"), true);
  assert.equal(isLoginRedirect("https://www.eriemetrosports.com/stats/x"), false);
});

test("a successful capture stores the body and logs provenance", async () => {
  const fake = (async () =>
    new Response("<html>hi</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;
  const { fetcher, store, log, index, dir } = await harness(fake);

  const rec = await fetcher.capture("https://a.com/p", { source: "test", via: "live" });

  assert.equal(rec.status, 200);
  assert.equal(rec.error, null);
  assert.ok(rec.contentHash);
  assert.equal(rec.source, "test");
  assert.equal(rec.authenticated, false);
  assert.deepEqual(await store.get(rec.contentHash!), Buffer.from("<html>hi</html>"));
  assert.equal((await log.all()).length, 1, "every capture must be logged");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("the browser User-Agent is always sent", async () => {
  let seenUA: string | null = null;
  const fake = (async (_i: unknown, init?: RequestInit) => {
    seenUA = new Headers(init?.headers).get("user-agent");
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  const { fetcher, index, dir } = await harness(fake);
  await fetcher.capture("https://a.com/p", { source: "test", via: "live" });
  assert.equal(seenUA, BROWSER_UA, "sources 403 without a browser UA");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("re-capturing unchanged content yields 2 captures and 1 blob", async () => {
  const fake = (async () => new Response("same bytes", { status: 200 })) as unknown as typeof fetch;
  const { fetcher, store, index, dir } = await harness(fake);
  await fetcher.capture("https://a.com/p", { source: "test", via: "live", freshnessMs: 0 });
  await fetcher.capture("https://a.com/p", { source: "test", via: "live", freshnessMs: 0 });
  assert.equal(index.countCaptures(), 2, "when we looked is per-fetch");
  assert.equal(await store.count(), 1, "what was there is per-content");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("the freshness window prevents re-fetching", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;
  const { fetcher, index, dir } = await harness(fake);
  await fetcher.capture("https://a.com/p", { source: "test", via: "live" });
  await fetcher.capture("https://a.com/p", {
    source: "test",
    via: "live",
    freshnessMs: 60_000,
  });
  assert.equal(calls, 1, "the store exists so we never have to ask twice");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

// --- Finding 1 (final review): the freshness gate reads ONLY the index,
// never the log, so a deleted-and-not-yet-reindexed manifest.sqlite defeats
// it silently. store/index.ts calls the file "DERIVED, NOT AUTHORITATIVE —
// deleting this file loses nothing," which is only true once something
// actually rebuilds it. cli.ts's captureKeystone() now calls
// rebuildFromLog(log, index) unconditionally before any fetch (see
// packages/capture/src/cli.ts); these two tests pin down the mechanism that
// fix depends on, independent of the CLI entry point (which cannot be
// exercised end-to-end without either hitting real archive.org network or
// restructuring cli.ts's top-level dispatch — out of scope here).
test("without a reindex, a deleted index silently re-fetches a URL that was already captured (the Finding 1 hole)", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response("unchanged content", { status: 200 });
  }) as unknown as typeof fetch;

  const dir = await mkdtemp(join(tmpdir(), "gr-fetch-"));
  const dbPath = join(dir, "m.sqlite");
  const store = new BlobStore(join(dir, "blobs"));
  const log = new CaptureLog(join(dir, "captures.jsonl"));
  const limiter = () =>
    new RateLimiter({ minIntervalMs: 0, jitterMs: 0, sleep: async () => {} });

  let index = new ManifestIndex(dbPath);
  let fetcher = new Fetcher({
    store,
    log,
    index,
    fetchFn: fake,
    limiter: limiter(),
    robots: new RobotsCache(allowAll),
    sleep: async () => {},
  });
  await fetcher.capture("https://a.com/p", { source: "test", via: "wayback", freshnessMs: 60_000 });
  assert.equal(calls, 1, "first capture always fetches");
  index.close();

  // Simulate an operator deleting manifest.sqlite on the strength of
  // store/index.ts's own "loses nothing" claim — WITHOUT running reindex
  // first. WAL mode (see ManifestIndex constructor) can leave sidecar files.
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });

  index = new ManifestIndex(dbPath); // fresh, empty — nothing reindexed
  fetcher = new Fetcher({
    store,
    log,
    index,
    fetchFn: fake,
    limiter: limiter(),
    robots: new RobotsCache(allowAll),
    sleep: async () => {},
  });
  await fetcher.capture("https://a.com/p", { source: "test", via: "wayback", freshnessMs: 60_000 });
  assert.equal(
    calls,
    2,
    "with the index gone and no reindex, the freshness gate cannot see the prior capture and silently re-fetches",
  );
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("rebuildFromLog before capture restores the freshness gate after the index is deleted (the Finding 1 fix)", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response("unchanged content", { status: 200 });
  }) as unknown as typeof fetch;

  const dir = await mkdtemp(join(tmpdir(), "gr-fetch-"));
  const dbPath = join(dir, "m.sqlite");
  const store = new BlobStore(join(dir, "blobs"));
  const log = new CaptureLog(join(dir, "captures.jsonl"));
  const limiter = () =>
    new RateLimiter({ minIntervalMs: 0, jitterMs: 0, sleep: async () => {} });

  let index = new ManifestIndex(dbPath);
  let fetcher = new Fetcher({
    store,
    log,
    index,
    fetchFn: fake,
    limiter: limiter(),
    robots: new RobotsCache(allowAll),
    sleep: async () => {},
  });
  await fetcher.capture("https://a.com/p", { source: "test", via: "wayback", freshnessMs: 60_000 });
  assert.equal(calls, 1, "first capture always fetches");
  index.close();

  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });

  index = new ManifestIndex(dbPath);
  // The fix: reindex unconditionally, before any fetch — mirroring the
  // ordering captureKeystone() now uses.
  const reindexed = await rebuildFromLog(log, index);
  assert.equal(reindexed, 1, "the one prior capture must be replayed from the log");

  fetcher = new Fetcher({
    store,
    log,
    index,
    fetchFn: fake,
    limiter: limiter(),
    robots: new RobotsCache(allowAll),
    sleep: async () => {},
  });
  await fetcher.capture("https://a.com/p", { source: "test", via: "wayback", freshnessMs: 60_000 });
  assert.equal(
    calls,
    1,
    "reindexing from the log before capture must restore the freshness gate — zero new fetches",
  );
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a login redirect is recorded as a gap and stores no body", async () => {
  // Models what real fetch returns with redirect:"follow" — it has ALREADY
  // followed the 302, so we get a 200 whose .url is the login page.
  // (Response.redirect() would be wrong here: its .url is "", so the fetcher
  // would fall back to the requested URL and never detect the wall.)
  const fake = (async () => {
    const res = new Response("<html>Sign In</html>", { status: 200 });
    Object.defineProperty(res, "url", {
      value: "https://user.sportngin.com/users/sign_in?user_return_to=x",
    });
    return res;
  }) as unknown as typeof fetch;
  const { fetcher, index, dir } = await harness(fake);

  const rec = await fetcher.capture("https://a.com/locked", { source: "test", via: "live" });

  assert.equal(rec.error, "auth_required");
  assert.equal(rec.contentHash, null, "never store a login page as if it were data");
  const gaps = index.gaps();
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.reason, "auth_required");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a robots-disallowed URL is skipped and never fetched", async () => {
  let calls = 0;
  const pageFetch = (async () => {
    calls++;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;
  const robotsFetch = (async () =>
    new Response("User-agent: *\nDisallow: /no", { status: 200 })) as unknown as typeof fetch;

  const dir = await mkdtemp(join(tmpdir(), "gr-fetch-"));
  const index = new ManifestIndex(join(dir, "m.sqlite"));
  const fetcher = new Fetcher({
    store: new BlobStore(join(dir, "blobs")),
    log: new CaptureLog(join(dir, "captures.jsonl")),
    index,
    fetchFn: pageFetch,
    limiter: new RateLimiter({ minIntervalMs: 0, jitterMs: 0, sleep: async () => {} }),
    robots: new RobotsCache(robotsFetch),
    sleep: async () => {},
  });

  const rec = await fetcher.capture("https://a.com/no/x", { source: "test", via: "live" });
  assert.equal(rec.error, "skipped_robots");
  assert.equal(calls, 0, "a disallowed URL must never be requested");
  assert.equal(index.gaps()[0]?.reason, "skipped_robots");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a 500 is retried with backoff then recorded as an error", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response("boom", { status: 500 });
  }) as unknown as typeof fetch;
  const { fetcher, index, dir } = await harness(fake, 3);
  const rec = await fetcher.capture("https://a.com/p", { source: "test", via: "live" });
  assert.equal(calls, 3, "5xx must be retried up to maxAttempts");
  assert.equal(rec.status, 500);
  assert.equal(rec.error, "http_500");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a 500 followed by a 200 succeeds", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return calls === 1
      ? new Response("boom", { status: 500 })
      : new Response("good", { status: 200 });
  }) as unknown as typeof fetch;
  const { fetcher, store, index, dir } = await harness(fake, 3);
  const rec = await fetcher.capture("https://a.com/p", { source: "test", via: "live" });
  assert.equal(rec.status, 200);
  assert.equal(rec.error, null);
  assert.deepEqual(await store.get(rec.contentHash!), Buffer.from("good"));
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a transport error is logged, not thrown", async () => {
  const fake = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const { fetcher, log, index, dir } = await harness(fake, 1);
  const rec = await fetcher.capture("https://a.com/p", { source: "test", via: "live" });
  assert.equal(rec.status, null);
  assert.match(rec.error ?? "", /ECONNRESET/);
  assert.equal((await log.all()).length, 1, "failures are history too");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a session cookie is sent and marks the capture authenticated", async () => {
  let seenCookie: string | null = null;
  const fake = (async (_i: unknown, init?: RequestInit) => {
    seenCookie = new Headers(init?.headers).get("cookie");
    return new Response("private", { status: 200 });
  }) as unknown as typeof fetch;
  const { fetcher, index, dir } = await harness(fake);
  const rec = await fetcher.capture("https://a.com/p", {
    source: "test",
    via: "live",
    sessionCookie: "_se_session=abc",
  });
  assert.equal(seenCookie, "_se_session=abc");
  assert.equal(rec.authenticated, true, "provenance must record HOW a fact was obtained");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("an invalid URL never reaches fetchFn and is recorded, not thrown", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;
  const { fetcher, store, index, dir } = await harness(fake);

  const rec = await fetcher.capture("not-a-valid-url", { source: "test", via: "live" });

  assert.equal(rec.error, "invalid_url");
  assert.equal(rec.contentHash, null);
  assert.equal(calls, 0, "a malformed URL must never reach fetchFn");
  assert.equal(await store.count(), 0, "no blob is stored for an invalid URL");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("an invalid-URL capture is still written to the log", async () => {
  const fake = (async () => new Response("body", { status: 200 })) as unknown as typeof fetch;
  const { fetcher, log, index, dir } = await harness(fake);

  await fetcher.capture("not-a-valid-url", { source: "test", via: "live" });

  assert.equal((await log.all()).length, 1, "failures are history too");
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("constructing a Fetcher with maxAttempts: 0 throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gr-fetch-"));
  const store = new BlobStore(join(dir, "blobs"));
  const log = new CaptureLog(join(dir, "captures.jsonl"));
  const index = new ManifestIndex(join(dir, "m.sqlite"));

  assert.throws(() => {
    new Fetcher({ store, log, index, fetchFn: allowAll, maxAttempts: 0 });
  }, /maxAttempts/);

  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a valid URL still captures successfully (URL validation does not break the happy path)", async () => {
  const fake = (async () =>
    new Response("hello", { status: 200 })) as unknown as typeof fetch;
  const { fetcher, store, index, dir } = await harness(fake);

  const rec = await fetcher.capture("https://a.com/still-works", { source: "test", via: "live" });

  assert.equal(rec.status, 200);
  assert.equal(rec.error, null);
  assert.ok(rec.contentHash);
  assert.deepEqual(await store.get(rec.contentHash!), Buffer.from("hello"));
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("an authorization header is sent but does NOT mark the capture authenticated", async () => {
  // An anonymous API ticket is not the owner's credentials. Marking such a
  // capture `authenticated` would make provenance claim we used privileged
  // access to read a page any visitor can see.
  let seenAuth: string | null = null;
  let seenCookie: string | null = null;
  const fake = (async (_i: unknown, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seenAuth = h.get("authorization");
    seenCookie = h.get("cookie");
    return new Response("public data", { status: 200 });
  }) as unknown as typeof fetch;

  const { fetcher, index, dir } = await harness(fake);
  const rec = await fetcher.capture("https://a.com/p", {
    source: "test",
    via: "live",
    authorization: 'ticket="anon-guest-token"',
  });

  assert.equal(seenAuth, 'ticket="anon-guest-token"');
  assert.equal(seenCookie, null, "no cookie should be sent");
  assert.equal(rec.authenticated, false, "an anonymous ticket is NOT owner credentials");
  assert.equal(rec.error, null);
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("a session cookie and an authorization header can be sent together", async () => {
  let h: Headers | null = null;
  const fake = (async (_i: unknown, init?: RequestInit) => {
    h = new Headers(init?.headers);
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  const { fetcher, index, dir } = await harness(fake);
  const rec = await fetcher.capture("https://a.com/p", {
    source: "test",
    via: "live",
    sessionCookie: "_ngin_session=abc",
    authorization: 'ticket="xyz"',
  });

  assert.equal(h!.get("cookie"), "_ngin_session=abc");
  assert.equal(h!.get("authorization"), 'ticket="xyz"');
  assert.equal(rec.authenticated, true, "the session cookie IS owner credentials");
  index.close();
  await rm(dir, { recursive: true, force: true });
});
