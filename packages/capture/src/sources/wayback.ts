import { backoffDelay } from "../fetcher/politeness.ts";

export type CdxRow = {
  timestamp: string;
  original: string;
  statuscode: string;
  mimetype: string;
  digest: string;
};

const CDX = "http://web.archive.org/cdx/search/cdx";

// archive.org is documented to 429 under load. Retried attempts, not just
// the initial request — one rate-limit blip must not fail the whole sweep.
const MAX_ATTEMPTS = 3;

/**
 * Fetch `url`, retrying 429/5xx with the shared backoff policy up to
 * MAX_ATTEMPTS. Any other non-2xx — or a retryable status once attempts are
 * exhausted — throws immediately, naming the status and the URL.
 *
 * cdxQuery is step ONE of the rescue pipeline: everything downstream
 * depends on its answer. A failed request must never be silently treated
 * as "this domain has no archive" — that is the one legitimate meaning of
 * an empty result, and cdxQuery reserves it for a genuine 2xx empty body.
 * The same fail-loud-not-silent principle is already applied to
 * CaptureLog.read() and RobotsCache elsewhere in this codebase.
 */
async function fetchWithRetry(
  url: string,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetchFn(url);
    if (res.ok) return res;
    lastStatus = res.status;

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      await sleep(backoffDelay(attempt));
      continue;
    }
    throw new Error(`cdxQuery: CDX request failed with status ${res.status} for ${url}`);
  }
  // Unreachable: every loop iteration above returns or throws. Kept only so
  // the compiler can see every path resolves.
  throw new Error(`cdxQuery: CDX request failed with status ${lastStatus} for ${url}`);
}

/**
 * Enumerate every archived URL for a domain via the CDX API.
 *
 * `sleep` is injectable (defaulting to a real timer), following the same
 * pattern as RateLimiter in politeness.ts, so retry tests run instantly.
 */
export async function cdxQuery(
  domain: string,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<CdxRow[]> {
  const url =
    `${CDX}?url=${encodeURIComponent(domain)}&matchType=domain&output=json` +
    `&fl=timestamp,original,statuscode,mimetype,digest`;
  const res = await fetchWithRetry(url, fetchFn, sleep);
  const text = await res.text();
  if (!text.trim()) return []; // a genuine 2xx empty body: no archive for this domain

  let data: string[][];
  try {
    data = JSON.parse(text) as string[][];
  } catch {
    // A raw SyntaxError ("Unexpected token '<'...") tells an operator
    // nothing useful. Surface the status plus a body excerpt so a
    // mis-served HTML error page (still status 200) is immediately
    // recognizable as such, rather than mistaken for real CDX data.
    throw new Error(
      `cdxQuery: malformed JSON (status ${res.status}) from ${url}: ${text.slice(0, 200)}`,
    );
  }
  if (data.length < 2) return [];

  // Row 0 is the header; the rest are values in header order.
  return data.slice(1).map((r) => ({
    timestamp: r[0] ?? "",
    original: r[1] ?? "",
    statuscode: r[2] ?? "",
    mimetype: r[3] ?? "",
    digest: r[4] ?? "",
  }));
}

/**
 * Build the URL for the ORIGINAL archived bytes.
 *
 * The `id_` modifier is mandatory. Verified: without it Wayback returns a
 * replay page with ~2KB of injected toolbar JavaScript and 11 rewritten
 * archive.org references in the body. Capturing that would corrupt the
 * primary source at the moment of rescue.
 */
export function originalUrl(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

/**
 * Successful HTML captures only.
 *
 * Kept: every row with an explicit statuscode of "200" and an HTML mime
 * type — including repeats of identical digests at different timestamps.
 * Dedup is the blob store's job; "we looked on this date and it was
 * unchanged" remains a fact worth recording on its own timestamp.
 *
 * Excluded: `warc/revisit` rows, whose statuscode is "-" rather than "200"
 * even though they are themselves Wayback's record of "we looked and it was
 * unchanged." That exclusion is current behavior, not a design goal — a
 * revisit is exactly the kind of unchanged-content row this function
 * otherwise means to keep. Changing the filter to include them is out of
 * scope here and needs its own review.
 */
export function selectHtmlSnapshots(rows: CdxRow[]): CdxRow[] {
  return rows.filter(
    (r) => r.statuscode === "200" && r.mimetype.toLowerCase().startsWith("text/html"),
  );
}

/**
 * The first path segment of a URL — the SportsEngine "page type"
 * (`roster_players`, `stats`, `standings`, `game`, ...).
 *
 * Returns "" for the site root and for anything unparseable, so a malformed
 * archived URL is simply filtered out rather than throwing mid-sweep.
 */
export function firstPathSegment(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    // Archived URLs come from a third party and are not guaranteed well-formed.
    return "";
  }
  return path.split("/").filter(Boolean)[0] ?? "";
}

/**
 * Keep only snapshots whose first path segment is one of `allowed`.
 *
 * Used to aim a sweep at data pages and skip a site's marketing surface. This
 * is a politeness measure, not a correctness one: `rinksatharborcenter.com`
 * has 3,925 archived HTML snapshots, of which ~1,171 are data. Fetching the
 * other ~2,750 would triple the load on a donated public archive to collect
 * registration forms and privacy policies.
 *
 * **Whatever this drops must be reported by the caller.** Silent truncation
 * reads as "we captured everything" when it did not (§9's no-silent-caps
 * rule).
 */
export function filterByPathSegment(
  rows: CdxRow[],
  allowed: readonly string[],
): CdxRow[] {
  const set = new Set(allowed);
  return rows.filter((r) => set.has(firstPathSegment(r.original)));
}
