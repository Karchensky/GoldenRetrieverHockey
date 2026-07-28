import { randomUUID } from "node:crypto";
import type { BlobStore } from "../store/blobs.ts";
import type { CaptureLog } from "../store/log.ts";
import type { ManifestIndex } from "../store/index.ts";
import type { CaptureRecord, Via } from "../store/types.ts";
import { RateLimiter, backoffDelay, hostOf } from "./politeness.ts";
import { RobotsCache } from "./robots.ts";

/**
 * Required. Sources return 403 Forbidden without a browser User-Agent —
 * a blanket CDN default rather than a considered policy. Requests remain
 * low-volume, rate-limited, robots-respecting, and read-only against public
 * pages, for the archival benefit of the team whose own records these are.
 */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const LOGIN_HOST_PATTERNS = [/login\.sportngin\.com/i, /user\.sportngin\.com/i];

/** True when a final URL indicates we were bounced to an auth wall. */
export function isLoginRedirect(finalUrl: string): boolean {
  return LOGIN_HOST_PATTERNS.some((re) => re.test(finalUrl));
}

export type FetcherDeps = {
  store: BlobStore;
  log: CaptureLog;
  index: ManifestIndex;
  fetchFn?: typeof fetch;
  limiter?: RateLimiter;
  robots?: RobotsCache;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
};

export type CaptureOpts = {
  source: string;
  via: Via;
  waybackTs?: string;
  discoveredFrom?: string;
  /** Skip the fetch if this URL was captured within this many ms. */
  freshnessMs?: number;
  /** Owner-supplied session cookie. Never a password. Marks the capture
   *  `authenticated`, because it was obtained with the owner's credentials. */
  sessionCookie?: string;
  /**
   * Value for an `Authorization` header — e.g. an ANONYMOUS API ticket that
   * a public SPA mints for every visitor (HarborCenter's DigitalShift API
   * works this way).
   *
   * Deliberately does NOT mark the capture `authenticated`. That flag means
   * "obtained using the owner's credentials", and a token any anonymous
   * visitor can mint is not that. Conflating the two would make provenance
   * claim we used privileged access to read a public page.
   */
  authorization?: string;
};

export class Fetcher {
  private readonly store: BlobStore;
  private readonly log: CaptureLog;
  private readonly index: ManifestIndex;
  private readonly fetchFn: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly robots: RobotsCache;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;

  constructor(deps: FetcherDeps) {
    this.store = deps.store;
    this.log = deps.log;
    this.index = deps.index;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.limiter = deps.limiter ?? new RateLimiter();
    this.robots = deps.robots ?? new RobotsCache(this.fetchFn);
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = deps.maxAttempts ?? 3;
    // A programmer/config error, not runtime data: maxAttempts: 0 makes the
    // retry loop body never run, so execution falls through to the trailing
    // commit() with status/contentHash/error all null — a clean-looking
    // record for a request that was never made. That is worse than a crash
    // for an archive's provenance, so fail loudly here instead of silently
    // clamping.
    if (this.maxAttempts < 1) {
      throw new Error(
        `Fetcher: maxAttempts must be at least 1, got ${this.maxAttempts}`,
      );
    }
  }

  private base(url: string, opts: CaptureOpts): CaptureRecord {
    return {
      id: randomUUID(),
      url,
      finalUrl: null,
      status: null,
      contentHash: null,
      contentType: null,
      fetchedAt: this.now().toISOString(),
      source: opts.source,
      via: opts.via,
      waybackTs: opts.waybackTs ?? null,
      authenticated: Boolean(opts.sessionCookie),
      discoveredFrom: opts.discoveredFrom ?? null,
      error: null,
    };
  }

  private async commit(rec: CaptureRecord): Promise<CaptureRecord> {
    await this.log.append(rec); // log first: it is the source of truth
    this.index.insert(rec);
    return rec;
  }

  async capture(url: string, opts: CaptureOpts): Promise<CaptureRecord> {
    // 0. Validate the URL up front. robots.isAllowed() and the rate limiter
    // below both need the host, and both resolve it via `new URL(url)`,
    // which throws on a malformed URL — and neither call site was guarded.
    // Nothing feeds bad URLs today, but the next phase discovers URLs by
    // parsing links out of decade-old archived HTML, where a single
    // malformed href must not crash a multi-hour sweep: capture() must
    // always resolve to a logged record, never throw. Computing the host
    // once here also lets the retry loop below reuse it instead of
    // re-parsing the URL on every attempt.
    let host: string;
    try {
      host = hostOf(url);
    } catch {
      const rec = this.base(url, opts);
      rec.error = "invalid_url";
      // Deliberately NOT gap-worthy (see GAP_WORTHY_REASONS in
      // store/index.ts): a malformed URL is a defect in the caller, not a
      // hole in the archive.
      return this.commit(rec);
    }

    // 1. Freshness: the store exists so we never have to ask twice.
    if (opts.freshnessMs && opts.freshnessMs > 0) {
      const last = this.index.lastCapture(url);
      if (last && !last.error) {
        const age = this.now().getTime() - new Date(last.fetchedAt).getTime();
        if (age < opts.freshnessMs) return last;
      }
    }

    // 2. robots.txt: a disallowed URL is never requested.
    if (!(await this.robots.isAllowed(url))) {
      const rec = this.base(url, opts);
      rec.error = "skipped_robots";
      // The gap row is DERIVED from rec.error by ManifestIndex.insert(), so it
      // survives a rebuild from the log. Do not record it separately here:
      // that redundancy is what made gaps unrecoverable in the first place.
      return this.commit(rec);
    }

    // 3. Fetch with politeness and backoff.
    const headers: Record<string, string> = { "user-agent": BROWSER_UA };
    if (opts.sessionCookie) headers["cookie"] = opts.sessionCookie;
    // Anonymous API ticket — see CaptureOpts.authorization on why this does
    // not set `authenticated`.
    if (opts.authorization) headers["authorization"] = opts.authorization;

    let lastErr: string | null = null;
    let lastStatus: number | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      await this.limiter.acquire(host);
      try {
        const res = await this.fetchFn(url, { headers, redirect: "follow" });
        const finalUrl = res.url || url;
        lastStatus = res.status;

        // Auth wall: a stop, not an obstacle. Never store a login page as data.
        if (isLoginRedirect(finalUrl)) {
          const rec = this.base(url, opts);
          rec.finalUrl = finalUrl;
          rec.status = res.status;
          rec.error = "auth_required";
          // Gap row is derived from rec.error by ManifestIndex.insert().
          return this.commit(rec);
        }

        if (res.status === 429 || res.status >= 500) {
          lastErr = `http_${res.status}`;
          if (attempt < this.maxAttempts - 1) {
            await this.sleep(backoffDelay(attempt));
            continue;
          }
          const rec = this.base(url, opts);
          rec.finalUrl = finalUrl;
          rec.status = res.status;
          rec.error = lastErr;
          return this.commit(rec);
        }

        const body = Buffer.from(await res.arrayBuffer());
        const { hash } = await this.store.put(body);
        const rec = this.base(url, opts);
        rec.finalUrl = finalUrl;
        rec.status = res.status;
        rec.contentHash = hash;
        rec.contentType = res.headers.get("content-type");
        return this.commit(rec);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (attempt < this.maxAttempts - 1) {
          await this.sleep(backoffDelay(attempt));
          continue;
        }
      }
    }

    const rec = this.base(url, opts);
    rec.status = lastStatus;
    rec.error = lastErr; // failures are history too
    return this.commit(rec);
  }
}
