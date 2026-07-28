export function hostOf(url: string): string {
  return new URL(url).host;
}

const MAX_BACKOFF_MS = 60_000;

/** Exponential backoff with a hard 60s ceiling. */
export function backoffDelay(attempt: number, baseMs = 1000): number {
  return Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
}

type RateLimiterOpts = {
  minIntervalMs?: number;
  jitterMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

/**
 * Per-host rate limiter: at most one request per host per minIntervalMs,
 * plus jitter. These are volunteer-run community sites; being a good guest
 * is a constraint, not a preference.
 *
 * Clock and sleep are injectable so tests are deterministic and instant.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private readonly jitterMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly lastAt = new Map<string, number>();
  /**
   * Per-host tail of an acquisition chain. Each call to `acquire()` for a
   * host is appended after the previous call's chain entry, so one call's
   * read-check-write of `lastAt` fully completes before the next call for
   * the SAME host begins its own read. Without this, two concurrent
   * `acquire()` calls for one host can both read the same stale `lastAt`,
   * both compute the same wait, and both resume at the same instant —
   * issuing simultaneous requests to a host that expects at most one.
   *
   * Different hosts get different map entries, so they never wait on each
   * other.
   */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(opts: RateLimiterOpts = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.jitterMs = opts.jitterMs ?? 250;
    this.now = opts.now ?? Date.now;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  /** Block until it is polite to hit this host again. */
  async acquire(host: string): Promise<void> {
    const previous = this.chains.get(host) ?? Promise.resolve();
    const current = previous.then(() => this.acquireOne(host));
    // The stored chain must never itself become a rejected promise: if it
    // did, every later caller's `previous.then(...)` for this host would
    // skip straight to rejection without ever running `acquireOne`, so one
    // failed acquisition would permanently wedge the host. Swallow the
    // error on the stored link only; `current` (returned below) still
    // carries the real rejection back to this call's caller.
    this.chains.set(
      host,
      current.catch(() => undefined),
    );
    return current;
  }

  private async acquireOne(host: string): Promise<void> {
    const last = this.lastAt.get(host);
    if (last !== undefined) {
      const elapsed = this.now() - last;
      const target = this.minIntervalMs + this.random() * this.jitterMs;
      const wait = target - elapsed;
      if (wait > 0) await this.sleep(wait);
    }
    this.lastAt.set(host, this.now());
  }
}
