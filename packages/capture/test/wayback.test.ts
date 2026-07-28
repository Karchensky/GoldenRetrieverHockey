import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cdxQuery,
  originalUrl,
  selectHtmlSnapshots,
  firstPathSegment,
  filterByPathSegment,
} from "../src/sources/wayback.ts";
import type { CdxRow } from "../src/sources/wayback.ts";

function row(p: Partial<CdxRow>): CdxRow {
  return {
    timestamp: "20130221000000",
    original: "http://goldenretrieverhockey.com/",
    statuscode: "200",
    mimetype: "text/html",
    digest: "AAA",
    ...p,
  };
}

test("originalUrl inserts the id_ modifier to get pristine archived bytes", () => {
  const u = originalUrl("20130221000000", "http://goldenretrieverhockey.com/Game_Recaps.html");
  assert.equal(
    u,
    "https://web.archive.org/web/20130221000000id_/http://goldenretrieverhockey.com/Game_Recaps.html",
  );
  assert.ok(u.includes("id_/"), "without id_ Wayback injects ~2KB of toolbar into the body");
});

test("selectHtmlSnapshots keeps only successful HTML captures", () => {
  const rows = [
    row({ digest: "A" }),
    row({ statuscode: "404", digest: "B" }),
    row({ statuscode: "301", digest: "C" }),
    row({ mimetype: "image/png", digest: "D" }),
    row({ mimetype: "text/css", digest: "E" }),
  ];
  const kept = selectHtmlSnapshots(rows);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.digest, "A");
});

test("selectHtmlSnapshots keeps every distinct timestamp, not just the latest", () => {
  const rows = [
    row({ timestamp: "20130221000000", digest: "A" }),
    row({ timestamp: "20150226000000", digest: "B" }),
  ];
  assert.equal(
    selectHtmlSnapshots(rows).length,
    2,
    "each capture is a distinct historical state of the site",
  );
});

test("selectHtmlSnapshots keeps same-digest rows at different timestamps", () => {
  const rows = [
    row({ timestamp: "20130221000000", digest: "SAME" }),
    row({ timestamp: "20130324000000", digest: "SAME" }),
  ];
  assert.equal(
    selectHtmlSnapshots(rows).length,
    2,
    "dedup is the blob store's job; 'we looked and it was unchanged' is a fact worth keeping",
  );
});

test("cdxQuery parses the JSON header/row format", async () => {
  const payload = [
    ["timestamp", "original", "statuscode", "mimetype", "digest"],
    ["20130703022433", "http://goldenretrieverhockey.com", "200", "text/html", "CTNW"],
    ["20150226000000", "http://www.goldenretrieverhockey.com:80/statistics.html", "200", "text/html", "XYZ"],
  ];
  const fake = (async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.includes("goldenretrieverhockey.com"), "queries the requested domain");
    assert.ok(url.includes("matchType=domain"), "must sweep the whole domain, not one URL");
    assert.ok(url.includes("output=json"));
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof fetch;

  const rows = await cdxQuery("goldenretrieverhockey.com", fake);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.timestamp, "20130703022433");
  assert.equal(rows[1]?.original, "http://www.goldenretrieverhockey.com:80/statistics.html");
});

test("cdxQuery returns empty for an empty archive rather than throwing", async () => {
  const fake = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await cdxQuery("nothing.example", fake), []);
});

// A no-op sleep so retry tests below run instantly, with no real timers.
const noSleep = async () => {};

test("cdxQuery throws on a 503 rather than silently returning [] (a transient outage must not look like an empty archive)", async () => {
  const fake = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;

  await assert.rejects(
    cdxQuery("outage.example", fake, noSleep),
    /503/,
    "a failed lookup must never be indistinguishable from 'this domain has no archive'",
  );
});

test("cdxQuery retries a 429 (archive.org's real rate-limit body), then throws a descriptive error naming the status", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    // archive.org's actual plain-text 429 body — not JSON.
    return new Response("Too Many Requests", { status: 429 });
  }) as unknown as typeof fetch;

  await assert.rejects(cdxQuery("busy.example", fake, noSleep), /429/);
  assert.equal(calls, 3, "429 must be retried up to the default max attempts before giving up");
});

test("cdxQuery: a 429 followed by a success returns the parsed rows (retry recovers)", async () => {
  let calls = 0;
  const payload = [
    ["timestamp", "original", "statuscode", "mimetype", "digest"],
    ["20130703022433", "http://goldenretrieverhockey.com", "200", "text/html", "CTNW"],
  ];
  const fake = (async () => {
    calls++;
    if (calls === 1) return new Response("Too Many Requests", { status: 429 });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof fetch;

  const rows = await cdxQuery("recovers.example", fake, noSleep);
  assert.equal(calls, 2, "one retry after the 429, then success");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.timestamp, "20130703022433");
});

test("cdxQuery throws a descriptive error (not a raw SyntaxError) when an HTML error page is served at status 200", async () => {
  const html =
    "<html><body><h1>503 Service Unavailable</h1><p>The server is temporarily unable to service your request.</p></body></html>";
  const fake = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;

  try {
    await cdxQuery("html-error.example", fake, noSleep);
    assert.fail("expected cdxQuery to throw on malformed JSON");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof SyntaxError), "must not leak a raw SyntaxError to the caller");
    assert.match((err as Error).message, /200/, "message must name the status");
    assert.ok(
      (err as Error).message.includes(html.slice(0, 50)),
      "message must include a body excerpt so an operator can see it was an HTML page, not data",
    );
  }
});

test("cdxQuery: a successful empty response still returns [] and never retries (empty archive is not a failure)", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;

  const rows = await cdxQuery("empty-archive.example", fake, noSleep);
  assert.deepEqual(rows, []);
  assert.equal(calls, 1, "a clean empty 2xx must not trigger any retry");
});

// --- path filtering (aims a sweep at data pages, skips marketing surface) ---

test("firstPathSegment extracts the SportsEngine page type", () => {
  assert.equal(
    firstPathSegment("https://www.rinksatharborcenter.com/roster_players/12345"),
    "roster_players",
  );
  assert.equal(
    firstPathSegment("https://www.rinksatharborcenter.com/standings/show/4025607?subseason=493397"),
    "standings",
  );
  assert.equal(firstPathSegment("https://www.rinksatharborcenter.com/"), "");
  assert.equal(firstPathSegment("https://www.rinksatharborcenter.com"), "");
});

test("firstPathSegment returns '' for an unparseable url rather than throwing", () => {
  // Archived urls come from a third party and are not guaranteed well-formed.
  // A malformed one must be filtered out, never crash a multi-hour sweep.
  assert.equal(firstPathSegment("not-a-url"), "");
  assert.equal(firstPathSegment(""), "");
});

test("filterByPathSegment keeps only allowed page types", () => {
  const rows = [
    row({ original: "https://x.com/roster_players/1", digest: "A" }),
    row({ original: "https://x.com/privacy-policy", digest: "B" }),
    row({ original: "https://x.com/standings/show/2", digest: "C" }),
    row({ original: "https://x.com/register/99", digest: "D" }),
  ];
  const kept = filterByPathSegment(rows, ["roster_players", "standings"]);
  assert.deepEqual(kept.map((r) => r.digest), ["A", "C"]);
});

test("filterByPathSegment keeps every timestamp of an allowed page", () => {
  // Same guarantee as selectHtmlSnapshots: dedup is the blob store's job.
  const rows = [
    row({ timestamp: "20190101000000", original: "https://x.com/stats/1", digest: "SAME" }),
    row({ timestamp: "20200101000000", original: "https://x.com/stats/1", digest: "SAME" }),
  ];
  assert.equal(filterByPathSegment(rows, ["stats"]).length, 2);
});

test("filterByPathSegment with an empty allow-list keeps nothing", () => {
  const rows = [row({ original: "https://x.com/stats/1" })];
  assert.equal(filterByPathSegment(rows, []).length, 0);
});
