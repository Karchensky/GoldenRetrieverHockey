import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CaptureRecord } from "./types.ts";
import type { CaptureLog } from "./log.ts";

/**
 * `CaptureRecord.error` values that constitute a genuine, permanent gap in
 * the archive — as opposed to a transient failure worth retrying later.
 *
 * A gap is a restatement of a failed capture, not independent data: it is
 * derived from these exact reasons inside `insert()` (see below), so there is
 * exactly one source for it and nothing new to define here if the set of
 * reasons changes — everything else (transport errors, http_5xx, etc.) stays
 * transient by default.
 */
const GAP_WORTHY_REASONS: ReadonlySet<string> = new Set([
  "auth_required",
  "skipped_robots",
]);

/**
 * SQLite query index over the capture log.
 *
 * DERIVED, NOT AUTHORITATIVE. Deleting this file loses nothing: rebuildFromLog
 * reconstructs it from captures.jsonl. node:sqlite is experimental, which is
 * acceptable precisely because nothing irreplaceable lives here.
 *
 * That includes gaps. A gap row is itself derived — insert() upserts one
 * whenever a record's `error` is gap-worthy (GAP_WORTHY_REASONS) — so the
 * log's CaptureRecord.error remains the single source of truth. Because
 * rebuildFromLog already calls insert() for every record, gaps come back for
 * free on rebuild; there is deliberately no second, separate derivation path.
 */
export class ManifestIndex {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      -- WAIT FOR A BUSY DATABASE, do not die on it.
      --
      -- This is the WRITER. Without a busy timeout, a write that arrives while
      -- anything else holds the lock fails at once with "database is locked" —
      -- and a capture run opens with rebuildFromLog(), so the failure lands on
      -- the first statement and takes the whole command down before a single
      -- page is fetched. That happened twice here: once when a second capture
      -- was started while one was already running, and once when a test process
      -- reading the corpus overlapped a scheduled refresh.
      --
      -- Thirty seconds is chosen against the real contender: a full
      -- rebuildFromLog of ~2,900 records, which is the longest write this
      -- database ever takes and is far under it. The readers in
      -- parse/test/helpers/corpus.ts set the same pragma from their side.
      PRAGMA busy_timeout = 30000;
      CREATE TABLE IF NOT EXISTS captures (
        id              TEXT    PRIMARY KEY,
        url             TEXT    NOT NULL,
        final_url       TEXT,
        status          INTEGER,
        content_hash    TEXT,
        content_type    TEXT,
        fetched_at      TEXT    NOT NULL,
        source          TEXT    NOT NULL,
        via             TEXT    NOT NULL,
        wayback_ts      TEXT,
        authenticated   INTEGER NOT NULL DEFAULT 0,
        discovered_from TEXT,
        error           TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_captures_url  ON captures(url);
      CREATE INDEX IF NOT EXISTS idx_captures_hash ON captures(content_hash);

      CREATE TABLE IF NOT EXISTS gaps (
        url      TEXT PRIMARY KEY,
        kind     TEXT NOT NULL,
        reason   TEXT NOT NULL,
        noted_at TEXT NOT NULL,
        detail   TEXT
      );
    `);
  }

  /**
   * Insert many records as ONE transaction. Returns how many were written.
   *
   * Same rows and the same idempotence as calling `insert` in a loop — it IS
   * that loop — but in a single transaction, so SQLite syncs to disk once
   * instead of once per record. That is the whole of the difference between a
   * two-minute reindex and a one-second one.
   *
   * Rolls back as a unit. A half-applied replay would leave the index claiming
   * a corpus that does not match the log, and the index's whole contract is
   * that it is derivable from the log — better to fail and be rebuilt than to
   * be quietly wrong about what the archive holds.
   */
  replay(records: readonly CaptureRecord[]): number {
    this.db.exec("BEGIN");
    try {
      for (const rec of records) this.insert(rec);
      this.db.exec("COMMIT");
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The transaction was already resolved; the original error is the one
        // worth reporting.
      }
      throw e;
    }
    return records.length;
  }

  /** Idempotent: id is the key and lives in the log, so replay is safe. */
  insert(rec: CaptureRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO captures
         (id, url, final_url, status, content_hash, content_type, fetched_at,
          source, via, wayback_ts, authenticated, discovered_from, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        rec.id,
        rec.url,
        rec.finalUrl,
        rec.status,
        rec.contentHash,
        rec.contentType,
        rec.fetchedAt,
        rec.source,
        rec.via,
        rec.waybackTs,
        rec.authenticated ? 1 : 0,
        rec.discoveredFrom,
        rec.error,
      );

    // Derive the gap, if any, from this same record — see GAP_WORTHY_REASONS.
    // Routed through recordGap() itself rather than duplicating its SQL.
    if (rec.error !== null && GAP_WORTHY_REASONS.has(rec.error)) {
      this.recordGap(rec.url, "unknown", rec.error, rec.finalUrl ?? undefined);
    }
  }

  lastCapture(url: string): CaptureRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM captures WHERE url = ? ORDER BY fetched_at DESC, id DESC LIMIT 1`,
      )
      .get(url) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      url: row.url as string,
      finalUrl: (row.final_url as string) ?? null,
      status: (row.status as number) ?? null,
      contentHash: (row.content_hash as string) ?? null,
      contentType: (row.content_type as string) ?? null,
      fetchedAt: row.fetched_at as string,
      source: row.source as string,
      via: row.via as CaptureRecord["via"],
      waybackTs: (row.wayback_ts as string) ?? null,
      authenticated: Boolean(row.authenticated),
      discoveredFrom: (row.discovered_from as string) ?? null,
      error: (row.error as string) ?? null,
    };
  }

  countCaptures(): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM captures`).get() as {
      n: number;
    };
    return r.n;
  }

  distinctHashes(): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(DISTINCT content_hash) AS n FROM captures WHERE content_hash IS NOT NULL`,
      )
      .get() as { n: number };
    return r.n;
  }

  /** Record something we could not capture, and why. This is real history. */
  recordGap(url: string, kind: string, reason: string, detail?: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gaps (url, kind, reason, noted_at, detail)
         VALUES (?,?,?,?,?)`,
      )
      .run(url, kind, reason, new Date().toISOString(), detail ?? null);
  }

  gaps(): Array<{ url: string; kind: string; reason: string }> {
    return this.db
      .prepare(`SELECT url, kind, reason FROM gaps ORDER BY noted_at`)
      .all() as Array<{ url: string; kind: string; reason: string }>;
  }

  /**
   * Fold the write-ahead log back into the database file, then close.
   *
   * WAL mode makes writes fast and it leaves a `-wal` and a `-shm` beside the
   * database. A READ-ONLY opener of a WAL database is not actually read-only
   * at the filesystem level — it needs the shared-memory file, and if the WAL
   * holds unmerged frames it needs a write lock to recover them. `npm test`
   * opens this database read-only from a dozen test processes at once, and
   * when that happens moments after a capture run has written to it, one of
   * them can lose the race and get back nothing.
   *
   * That is not a hypothetical: a scheduled `sync:current` failed its test
   * step once here with a single assertion error, and the same suite passed
   * immediately afterwards, twice. A corpus reader that intermittently sees an
   * empty archive is the worst possible flake in this repo — the fixtures ARE
   * the corpus, so "the database was busy" and "the archive is missing" look
   * identical from inside a test, and an unattended job would report failure
   * for neither reason.
   *
   * TRUNCATE rather than PASSIVE: passive is what SQLite already does on the
   * last connection closing, and it leaves the file in place. Truncating takes
   * the WAL to zero bytes so a later reader has nothing to recover and cannot
   * need a lock to start.
   *
   * Wrapped, because a failed checkpoint must never fail a capture run: the
   * data is already committed by the time we get here, and an unmerged WAL is
   * a performance state, not a loss.
   */
  close(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Another connection held the lock. The WAL stays; nothing is lost.
    }
    this.db.close();
  }
}

/** Rebuild the index from the log. Returns the number of records indexed. */
export async function rebuildFromLog(
  log: CaptureLog,
  idx: ManifestIndex,
): Promise<number> {
  // READ FIRST, THEN WRITE ONCE.
  //
  // This used to call insert() per record straight out of the async iterator,
  // which is one implicit transaction — and therefore one fsync — for each of
  // the 2,889 records. Measured on this machine: 1m59s for a full replay, and
  // every capture command runs this at startup to keep the index self-healing.
  // A three-command refresh spent about six minutes re-indexing data it had
  // already indexed, before it made a single request.
  //
  // The records are small and there are a few thousand of them, so collecting
  // them costs nothing worth naming. Doing it this way also means no
  // transaction is held open across an `await`, which would keep the writer
  // lock for the length of a file read.
  const records: CaptureRecord[] = [];
  for await (const rec of log.read()) records.push(rec);
  return idx.replay(records);
}
