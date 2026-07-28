import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, backoffDelay, hostOf } from "../src/fetcher/politeness.ts";

/** Deterministic fake clock: sleeping advances time, nothing actually waits. */
function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    slept,
  };
}

/**
 * Fake clock whose `sleep` yields control (via a microtask) BEFORE advancing
 * time, instead of after.
 *
 * `fakeClock` above mutates `t` synchronously, before its own `await` ever
 * yields. That accidentally serializes two concurrently-started calls: by
 * the time the second call reads `now()`, the first call's sleep has
 * already (synchronously) fast-forwarded the clock, so the second call
 * "sees" the first one as already having finished. That hides races.
 *
 * Here, `sleep` yields first and only advances `t` after resuming. That
 * lets two concurrently-started `acquire()` calls genuinely interleave
 * their reads before either one writes back to `lastAt` — which is exactly
 * the window `acquire()` must protect.
 */
function racyClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      await Promise.resolve();
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    slept,
  };
}

test("hostOf extracts the host", () => {
  assert.equal(hostOf("https://www.eriemetrosports.com/stats/x?y=1"), "www.eriemetrosports.com");
  assert.equal(hostOf("http://web.archive.org/web/2013/http://x.com/"), "web.archive.org");
});

test("the first request to a host does not wait", async () => {
  const c = fakeClock();
  const rl = new RateLimiter({ minIntervalMs: 1000, jitterMs: 0, now: c.now, sleep: c.sleep });
  await rl.acquire("a.com");
  assert.deepEqual(c.slept, [], "first request must be immediate");
});

test("a second immediate request to the same host waits the full interval", async () => {
  const c = fakeClock();
  const rl = new RateLimiter({ minIntervalMs: 1000, jitterMs: 0, now: c.now, sleep: c.sleep });
  await rl.acquire("a.com");
  await rl.acquire("a.com");
  assert.deepEqual(c.slept, [1000], "must wait >=1s between requests to one host");
});

test("two concurrent acquire() calls for the same host do not resume at the same instant", async () => {
  const c = racyClock();
  const rl = new RateLimiter({ minIntervalMs: 1000, jitterMs: 0, now: c.now, sleep: c.sleep });
  // Prime lastAt for the host so both concurrent calls below take the
  // "must wait" branch and race on the same stale read.
  await rl.acquire("a.com");

  let firstResumedAt = -1;
  let secondResumedAt = -1;
  await Promise.all([
    rl.acquire("a.com").then(() => {
      firstResumedAt = c.now();
    }),
    rl.acquire("a.com").then(() => {
      secondResumedAt = c.now();
    }),
  ]);

  assert.notEqual(firstResumedAt, -1, "first call must have resumed");
  assert.notEqual(secondResumedAt, -1, "second call must have resumed");
  const gap = Math.abs(secondResumedAt - firstResumedAt);
  assert.ok(
    gap >= 1000,
    `two concurrent acquire() calls for one host must not resume together; got ${firstResumedAt}ms and ${secondResumedAt}ms (gap ${gap}ms)`,
  );
});

test("no wait when enough time has already elapsed", async () => {
  const c = fakeClock();
  const rl = new RateLimiter({ minIntervalMs: 1000, jitterMs: 0, now: c.now, sleep: c.sleep });
  await rl.acquire("a.com");
  c.advance(1500);
  await rl.acquire("a.com");
  assert.deepEqual(c.slept, [], "already-elapsed time must not be re-waited");
});

test("rate limiting is per-host, not global", async () => {
  const c = fakeClock();
  const rl = new RateLimiter({ minIntervalMs: 1000, jitterMs: 0, now: c.now, sleep: c.sleep });
  await rl.acquire("a.com");
  await rl.acquire("b.com");
  assert.deepEqual(c.slept, [], "a different host must not be throttled");
});

test("concurrent acquire() calls for different hosts do not serialize against each other", async () => {
  const c = fakeClock();
  const rl = new RateLimiter({ minIntervalMs: 1000, jitterMs: 0, now: c.now, sleep: c.sleep });
  // Both started before either resolves: if per-host serialization ever
  // leaked across hosts, one of these would wait on the other.
  await Promise.all([rl.acquire("a.com"), rl.acquire("b.com")]);
  assert.deepEqual(c.slept, [], "different hosts must not wait on each other, even when acquired concurrently");
});

test("jitter is added on top of the minimum interval", async () => {
  const c = fakeClock();
  const rl = new RateLimiter({
    minIntervalMs: 1000,
    jitterMs: 500,
    now: c.now,
    sleep: c.sleep,
    random: () => 1,
  });
  await rl.acquire("a.com");
  await rl.acquire("a.com");
  assert.equal(c.slept[0], 1500, "jitter must extend, never shorten, the wait");
});

test("jitter never shortens the wait below minIntervalMs", async () => {
  const c = fakeClock();
  const rl = new RateLimiter({
    minIntervalMs: 1000,
    jitterMs: 500,
    now: c.now,
    sleep: c.sleep,
    random: () => 0,
  });
  await rl.acquire("a.com");
  await rl.acquire("a.com");
  assert.equal(c.slept[0], 1000, "with random()=0 the wait must be exactly minIntervalMs, never less");
});

test("backoffDelay grows exponentially and is capped", () => {
  assert.equal(backoffDelay(0, 1000), 1000);
  assert.equal(backoffDelay(1, 1000), 2000);
  assert.equal(backoffDelay(2, 1000), 4000);
  assert.equal(backoffDelay(3, 1000), 8000);
  assert.ok(backoffDelay(99, 1000) <= 60_000, "backoff must be capped at 60s");
});
