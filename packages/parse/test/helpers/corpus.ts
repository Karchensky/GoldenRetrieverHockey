import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Read real captured pages out of the corpus, for tests.
 *
 * The capture store doubles as the fixture library — that was the point of
 * building it. Parse tests run fully offline against bytes that were actually
 * served, so a test can never pass against a page shape that does not exist.
 * That is not hypothetical: a parser here once passed 13/13 against a
 * hand-written fixture and produced 1,064 phantom goals against the real thing.
 *
 * Read-only, and it never writes: a test must not be able to corrupt the
 * archive it is reading.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "data");

/**
 * Open the manifest read-only, and WAIT rather than fail if it is busy.
 *
 * `npm test` runs a dozen test files as parallel processes and several of them
 * open this database. In WAL mode a "read-only" opener still takes locks, so
 * one arriving while a capture run is finishing its write can be refused — and
 * every reader here returns [] on failure, which inside a test is
 * indistinguishable from "the archive is missing". A `sync:current` run failed
 * its test step exactly once this way, then passed twice in a row unchanged.
 *
 * Five seconds of patience costs nothing when the database is free and removes
 * the race when it is not. `ManifestIndex.close()` truncates the WAL for the
 * same reason, from the other side.
 */
function openCorpus(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch {
    // Older runtimes may refuse a pragma on a read-only handle. Not fatal:
    // without it we are exactly as racy as before, never worse.
  }
  return db;
}

/**
 * Every distinct captured body whose URL matches a SQL LIKE pattern.
 *
 * DISTINCT ON CONTENT. Deliberately left exactly as it was: every existing
 * test's counts are calibrated to it, and `corpusPages` below is a different
 * question, not a better version of this one.
 */
export function corpusHtml(urlLike: string): string[] {
  const dbPath = join(ROOT, "manifest.sqlite");
  if (!existsSync(dbPath)) return [];

  const db = openCorpus(dbPath);
  try {
    const rows = db
      .prepare(
        "select distinct content_hash from captures " +
          "where url like ? and content_hash is not null",
      )
      .all(urlLike) as { content_hash: string }[];

    const out: string[] = [];
    for (const r of rows) {
      const p = join(ROOT, "blobs", r.content_hash.slice(0, 2), `${r.content_hash}.gz`);
      if (!existsSync(p)) continue;
      out.push(gunzipSync(readFileSync(p)).toString("utf8"));
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * EVERY capture of a URL, OLDEST FIRST — the archive's successive words, not
 * just its last one.
 *
 * The other two readers here deliberately collapse repeats: `corpusHtml` to
 * distinct content and `corpusPages` to the newest per URL. Neither can answer
 * "what did this page look like before, and does the parser handle both?" —
 * and that question only became answerable once the live season was refreshed
 * and the corpus started holding two genuinely different bodies for the same
 * player.
 *
 * ORDER IS THE POINT. `corpusHtml` returns rows in whatever order SQLite hands
 * back, so a test that assumed oldest-first from it asserted "GP went 7 -> 5"
 * and failed against a corpus that was entirely correct. Ordering by
 * `fetched_at` here is what makes "the live session only ever grows" a
 * statement about the data rather than about SQLite's row order.
 */
export function corpusSnapshots(urlLike: string): { fetchedAt: string; html: string }[] {
  const dbPath = join(ROOT, "manifest.sqlite");
  if (!existsSync(dbPath)) return [];

  const db = openCorpus(dbPath);
  try {
    const rows = db
      .prepare(
        "select fetched_at, content_hash from captures " +
          "where url like ? and content_hash is not null order by fetched_at asc",
      )
      .all(urlLike) as { fetched_at: string; content_hash: string }[];

    const out: { fetchedAt: string; html: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      // A re-capture that found the page unchanged logs a new row against the
      // same blob. That is one state of the page, not two.
      if (seen.has(r.content_hash)) continue;
      seen.add(r.content_hash);
      const p = join(ROOT, "blobs", r.content_hash.slice(0, 2), `${r.content_hash}.gz`);
      if (!existsSync(p)) continue;
      out.push({ fetchedAt: r.fetched_at, html: gunzipSync(readFileSync(p)).toString("utf8") });
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * Every distinct captured page whose URL matches a SQL LIKE pattern, WITH the
 * URL it was served from.
 *
 * The URL is not decoration for the DigitalShift era: a boxscore body does not
 * contain its own game id and a schedule body does not contain the team id it
 * was requested for. Both live only in the URL, and both are the join keys the
 * game record is assembled on. `corpusHtml` cannot express that, which is why
 * this exists alongside it rather than replacing it.
 *
 * DISTINCT ON URL, not on content: two different games can score identically
 * and, more to the point, an unplayed fixture's boxscore is byte-identical to
 * every other unplayed fixture's. Deduping those by content hash would silently
 * drop real games. `corpusHtml` keeps its distinct-content behaviour.
 */
export function corpusPages(urlLike: string): { url: string; html: string }[] {
  const dbPath = join(ROOT, "manifest.sqlite");
  if (!existsSync(dbPath)) return [];

  const db = openCorpus(dbPath);
  try {
    // The newest capture of each URL: a re-run past the freshness window logs a
    // second record for the same URL, and the archive's last word is the one
    // meant. Without this a re-captured page is returned twice and anything
    // counting rows out of it silently doubles.
    const rows = db
      .prepare(
        "select url, content_hash from captures c " +
          "where url like ? and content_hash is not null " +
          "and fetched_at = (select max(fetched_at) from captures x where x.url = c.url " +
          "and x.content_hash is not null) " +
          "group by url",
      )
      .all(urlLike) as { url: string; content_hash: string }[];

    const out: { url: string; html: string }[] = [];
    for (const r of rows) {
      const p = join(ROOT, "blobs", r.content_hash.slice(0, 2), `${r.content_hash}.gz`);
      if (!existsSync(p)) continue;
      out.push({ url: r.url, html: gunzipSync(readFileSync(p)).toString("utf8") });
    }
    return out;
  } finally {
    db.close();
  }
}
