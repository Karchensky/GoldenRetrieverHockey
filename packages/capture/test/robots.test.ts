import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, RobotsCache } from "../src/fetcher/robots.ts";

test("an empty robots.txt allows everything", () => {
  const r = parseRobots("", "*");
  assert.equal(r.isAllowed("/anything"), true);
});

test("Disallow blocks matching path prefixes", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private", "*");
  assert.equal(r.isAllowed("/private/x"), false);
  assert.equal(r.isAllowed("/public/x"), true);
});

test("Disallow: / blocks the whole site", () => {
  const r = parseRobots("User-agent: *\nDisallow: /", "*");
  assert.equal(r.isAllowed("/"), false);
  assert.equal(r.isAllowed("/anything"), false);
});

test("an empty Disallow value allows everything", () => {
  const r = parseRobots("User-agent: *\nDisallow:", "*");
  assert.equal(r.isAllowed("/anything"), true);
});

test("Allow overrides a broader Disallow via longest-match", () => {
  const r = parseRobots("User-agent: *\nDisallow: /stats\nAllow: /stats/public", "*");
  assert.equal(r.isAllowed("/stats/secret"), false);
  assert.equal(r.isAllowed("/stats/public/x"), true);
});

test("rules for other user-agents are ignored", () => {
  const r = parseRobots("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin", "*");
  assert.equal(r.isAllowed("/anything"), true);
  assert.equal(r.isAllowed("/admin/x"), false);
});

test("comments and blank lines are ignored", () => {
  const r = parseRobots("# a comment\n\nUser-agent: *\nDisallow: /x # trailing\n", "*");
  assert.equal(r.isAllowed("/x"), false);
  assert.equal(r.isAllowed("/y"), true);
});

test("RobotsCache fetches robots.txt once per host", async () => {
  let calls = 0;
  const fake = (async (input: string | URL | Request) => {
    calls++;
    assert.equal(String(input), "https://a.com/robots.txt");
    return new Response("User-agent: *\nDisallow: /no", { status: 200 });
  }) as unknown as typeof fetch;

  const cache = new RobotsCache(fake);
  assert.equal(await cache.isAllowed("https://a.com/yes"), true);
  assert.equal(await cache.isAllowed("https://a.com/no/x"), false);
  assert.equal(calls, 1, "robots.txt must be fetched once per host and cached");
});

test("a missing robots.txt (404) allows everything", async () => {
  const fake = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  const cache = new RobotsCache(fake);
  assert.equal(await cache.isAllowed("https://a.com/anything"), true);
});

test("an unreachable robots.txt fails closed", async () => {
  const fake = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const cache = new RobotsCache(fake);
  assert.equal(
    await cache.isAllowed("https://a.com/anything"),
    false,
    "if we cannot confirm permission, we do not fetch",
  );
});

// --- Finding 1: non-200 status handling (RFC 9309 §2.3.1) ---------------

test("a 503 response fails closed (unreachable, not merely absent)", async () => {
  const fake = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  const cache = new RobotsCache(fake);
  assert.equal(
    await cache.isAllowed("https://a.com/anything"),
    false,
    "5xx means robots.txt is unreachable; RFC 9309 requires assuming complete disallow",
  );
});

test("a 500 response fails closed, and so does a 429", async () => {
  const cache500 = new RobotsCache(
    (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
  );
  assert.equal(await cache500.isAllowed("https://a.com/anything"), false);

  const cache429 = new RobotsCache(
    (async () => new Response("", { status: 429 })) as unknown as typeof fetch,
  );
  assert.equal(
    await cache429.isAllowed("https://b.com/anything"),
    false,
    "429 is an overload signal, not 'there is no robots.txt here' — treat as unreachable",
  );
});

test("a 403 response allows everything (4xx means robots.txt is unavailable)", async () => {
  const fake = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
  const cache = new RobotsCache(fake);
  assert.equal(await cache.isAllowed("https://a.com/anything"), true);
});

// --- Finding 2: consecutive User-agent lines form one group -------------

test("consecutive User-agent lines form one group; rules apply if any named agent matches", () => {
  const r = parseRobots("User-agent: *\nUser-agent: NamedBot\nDisallow: /secret", "*");
  assert.equal(r.isAllowed("/secret/x"), false);
});

test("consecutive User-agent lines form one group regardless of listed order", () => {
  const r = parseRobots("User-agent: NamedBot\nUser-agent: *\nDisallow: /secret", "*");
  assert.equal(r.isAllowed("/secret/x"), false);
});

test("a group naming only another agent does not apply to us", () => {
  const r = parseRobots("User-agent: NamedBot\nDisallow: /secret", "*");
  assert.equal(r.isAllowed("/secret/x"), true);
});

// --- Finding 3: a fail-closed fetch failure must not be cached forever --

test("a transient fetch failure is not cached; the next call retries", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    if (calls === 1) throw new Error("network blip");
    return new Response("User-agent: *\nDisallow: /no", { status: 200 });
  }) as unknown as typeof fetch;

  const cache = new RobotsCache(fake);
  assert.equal(
    await cache.isAllowed("https://a.com/anything"),
    false,
    "first call: the fetch throws, so we fail closed",
  );
  assert.equal(
    await cache.isAllowed("https://a.com/yes"),
    true,
    "second call: the failure was not cached, so this retries and gets the real verdict",
  );
  assert.equal(await cache.isAllowed("https://a.com/no/x"), false, "the real rules are respected");
  assert.equal(calls, 2, "exactly one failed attempt plus one successful attempt — no caching of the failure");
});

test("a persistent 5xx IS cached — fetched once, disallowed on every call", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response("", { status: 503 });
  }) as unknown as typeof fetch;

  const cache = new RobotsCache(fake);
  assert.equal(await cache.isAllowed("https://a.com/one"), false);
  assert.equal(await cache.isAllowed("https://a.com/two"), false);
  assert.equal(
    calls,
    1,
    "unlike a thrown error, a resolved 5xx is a definitive outcome and should be cached once per host",
  );
});
