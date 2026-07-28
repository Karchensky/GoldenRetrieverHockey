/** How a capture was obtained. */
export type Via = "live" | "wayback";

/**
 * One HTTP fetch attempt. Append-only: never mutated after being logged.
 *
 * Capture identity (when we looked) is deliberately separate from content
 * identity (what was there). Re-fetching an unchanged page produces a second
 * CaptureRecord referencing the same contentHash. That is what powers
 * "last verified appearance" and change detection.
 */
export type CaptureRecord = {
  /**
   * Unique id for this fetch attempt (crypto.randomUUID at capture time).
   *
   * The primary key. Deliberately NOT (url, fetchedAt): two captures of one
   * URL inside the same millisecond would collide on that key and silently
   * collapse into a single row, making store correctness depend on the rate
   * limiter being enabled. The id lives in the log, so reindexing stays
   * idempotent.
   */
  id: string;
  /** URL as requested. */
  url: string;
  /** URL after redirects; null on transport error. */
  finalUrl: string | null;
  /** HTTP status; null on transport error. */
  status: number | null;
  /** sha256 hex of the response body; null when there is no body. */
  contentHash: string | null;
  contentType: string | null;
  /** ISO8601 UTC. */
  fetchedAt: string;
  /** eriemetro | performax | harborcenter | goldenretrieverhockey | wayback */
  source: string;
  via: Via;
  /** Wayback capture timestamp when via === "wayback". */
  waybackTs: string | null;
  /** True when an owner-supplied session cookie was used. Provenance must
   *  always record HOW a fact was obtained. */
  authenticated: boolean;
  /** URL of the capture that yielded this URL. A URL rather than a row id,
   *  so the reference survives an index rebuild. */
  discoveredFrom: string | null;
  error: string | null;
};
