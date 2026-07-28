import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRosterBook, type BookEntry } from "../../parse/src/ownsite/roster-book.ts";
import { parseStatsBook, STATS_BOOK_NAMES, type BookStatLine } from "../../parse/src/ownsite/stats-book.ts";
import { parseRosterEmails, type EmailRosterEntry } from "../../parse/src/ownsite/roster-email.ts";

/**
 * THE THREE SOURCES THAT WERE NEVER PAGES, STORED AS RECORDS.
 *
 * Every figure on this site traces to a stored capture in `data/` — except
 * three, which traced to files on one man's disk:
 *
 *   `Golden Retriever Hockey (1).xlsx`   the statistics workbook
 *   `docs/research/captain-roster-emails/*.txt`   the captain's roster emails
 *   `TGR.xlsx`                           the roster book
 *
 * They are gitignored, and rightly: the workbook holds the club's finances, its
 * members' dues and thirty-two USA Hockey registration numbers, and one of the
 * emails holds six more. None of that may ever be published. But `build:data`
 * READ THEM DIRECTLY, so the pipeline could only run on the machine that held
 * them — a clone could not regenerate `site.json` and neither could a build
 * server. An archive whose whole argument is that a record on one disk is a
 * record about to be lost had its own generator in exactly that position.
 *
 * THE PARSED OUTPUT WAS ALWAYS SAFE. Both parsers refuse the private material
 * at the parse boundary — see the header notes in `stats-book.ts`,
 * `roster-book.ts` and `roster-email.ts`, and the closed-set assertion in
 * `packages/build/test/derived-records.test.ts`, which reads the stored
 * artefact itself rather than the parser. Only the RAW DOCUMENTS are sensitive.
 *
 * So the documents are parsed ONCE, by `npm run derive:private`, and their
 * records are stored in `data/derived/` beside the corpus they now belong to.
 * `generate.ts` reads the records and never the documents. A clone — and a CI
 * runner — regenerates `site.json` byte-identically without ever seeing them.
 *
 * TWO CONSEQUENCES, both deliberate:
 *
 *   1. THESE THREE PARSERS NOW RUN AT DERIVE TIME, NOT AT BUILD TIME. Improve
 *      one and nothing moves until `derive:private` is run again on the machine
 *      that holds the documents. That is the price of the corpus being the
 *      input, and it is the same price every other source here already pays:
 *      a better HTML parser changes nothing until the blobs are re-read.
 *   2. THE DOCUMENTS ARE STILL CHECKED WHEN THEY ARE THERE. Where a private
 *      document IS on disk, the reads below re-parse it and compare. A stored
 *      record that has drifted from the document it claims to be derived from
 *      fails the build loudly, naming the command that fixes it — because the
 *      alternative is the captain building one `site.json` and the runner
 *      building another, and neither of them noticing.
 */

/** Where the records live, under the data directory. */
export const DERIVED = "derived";

/** The command that writes them. Named in every error this file can throw. */
export const DERIVE_COMMAND = "npm run derive:private";

export const DERIVED_FILES = {
  statsBook: "statistics-workbook.json",
  rosterEmails: "roster-emails.json",
  rosterBook: "roster-book.json",
} as const;

/** One roster email, as the parser read it, plus the hash of the bytes it read. */
export type RosterEmailFile = {
  file: string;
  /** SHA-256 of the stored email. Identifies the input without repeating it. */
  sha256: string;
  session: string;
  team: string;
  entries: EmailRosterEntry[];
  /** Lines the parser did not read as roster rows — reported, never swallowed.
   *  Registration identifiers are already stripped from these by the parser. */
  unread: string[];
  /** How many registration identifiers were refused. The COUNT, never a value. */
  refused: number;
};

export type StatsBookRecord = {
  derivedFrom: string;
  /** SHA-256 of the workbook these lines were read out of, or null if it was
   *  not on disk when the record was written. */
  sha256: string | null;
  derivedBy: string;
  count: number;
  lines: BookStatLine[];
};

export type RosterEmailsRecord = {
  derivedFrom: string;
  derivedBy: string;
  count: number;
  files: RosterEmailFile[];
};

export type RosterBookRecord = {
  derivedFrom: string;
  sha256: string | null;
  derivedBy: string;
  count: number;
  entries: BookEntry[];
};

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

/** The statistics workbook on disk, under either name it arrives with. */
export const statsBookPath = (cwd: string): string | undefined =>
  STATS_BOOK_NAMES.map((n) => join(cwd, n)).find(existsSync);

export const rosterBookPath = (cwd: string): string | undefined =>
  [join(cwd, "TGR.xlsx")].find(existsSync);

export const rosterEmailDir = (cwd: string): string =>
  join(cwd, "docs", "research", "captain-roster-emails");

/* ---------- deriving: the only code that opens a private document --------- */

export function deriveStatsBook(cwd: string): StatsBookRecord {
  const path = statsBookPath(cwd);
  const lines = path ? parseStatsBook(path) : [];
  return {
    derivedFrom: STATS_BOOK_NAMES[0]!,
    sha256: path ? sha256(path) : null,
    derivedBy: DERIVE_COMMAND,
    count: lines.length,
    lines,
  };
}

export function deriveRosterEmails(cwd: string): RosterEmailsRecord {
  const dir = rosterEmailDir(cwd);
  const files: RosterEmailFile[] = parseRosterEmails(dir).map((f) => ({
    file: f.file,
    sha256: sha256(join(dir, f.file)),
    session: f.session,
    team: f.team,
    entries: f.entries,
    unread: f.unread,
    refused: f.refused,
  }));
  return {
    derivedFrom: "docs/research/captain-roster-emails/*.txt",
    derivedBy: DERIVE_COMMAND,
    count: files.length,
    files,
  };
}

export function deriveRosterBook(cwd: string): RosterBookRecord {
  const path = rosterBookPath(cwd);
  const entries = path ? parseRosterBook(path) : [];
  return {
    derivedFrom: "TGR.xlsx",
    sha256: path ? sha256(path) : null,
    derivedBy: DERIVE_COMMAND,
    count: entries.length,
    entries,
  };
}

/* ---------- reading: what the build does, and all it does ---------------- */

/**
 * THE MISSING-RECORD ERROR, and it is the same shape the workbook guard had.
 *
 * The old guard told the reader the workbook was required. It is not, and has
 * not been since the records were stored: what is required is the RECORD, which
 * is tracked, so a clean checkout always has it. This fires when somebody has
 * deleted it, or is building against a `GR_DATA_DIR` that does not hold one.
 *
 * IT NEVER RETURNS AN EMPTY ARRAY, and it names what an empty one would cost —
 * measured for each source, not guessed. Every caller passes its own figure,
 * because "the build would be a bit smaller" is not a thing anybody stops for
 * and "63 people instead of 80" is.
 */
function missing(path: string, what: string, sourceOnDisk: boolean, costs: string): never {
  throw new Error(
    `The stored ${what} record is missing: ${path}\n\n` +
      `  It is TRACKED, so a clean checkout has it and this build should not be here.\n` +
      (sourceOnDisk
        ? `  The private source IS on this disk, so the record can be rebuilt: run\n` +
          `    ${DERIVE_COMMAND}\n`
        : `  The private source is NOT on this disk either, so nothing here can rebuild it.\n` +
          `  Restore the record from git:\n` +
          `    git checkout -- ${path}\n`) +
      `\n  Its absence is not zero, and this is what carrying on without it would cost:\n` +
      `  ${costs}`,
  );
}

function read<T extends { count: number }>(
  dataDir: string,
  file: string,
  what: string,
  sourceOnDisk: boolean,
  costs: string,
  size: (r: T) => number,
): T {
  const path = join(dataDir, DERIVED, file);
  if (!existsSync(path)) missing(path, what, sourceOnDisk, costs);
  const record = JSON.parse(readFileSync(path, "utf8")) as T;
  // A truncated or half-written record is not an empty one either.
  if (size(record) !== record.count) {
    throw new Error(
      `The stored ${what} record is inconsistent: ${path}\n` +
        `  It states count ${record.count} and holds ${size(record)}. Re-derive it with\n` +
        `    ${DERIVE_COMMAND}`,
    );
  }
  return record;
}

/**
 * THE DRIFT CHECK. Only runs where the private document is on disk.
 *
 * Compares the stored record against a fresh parse of the document it names. A
 * changed document, or a changed parser, moves the fresh side; the stored side
 * cannot move on its own. Either way the two builds — the captain's and the
 * runner's — are about to disagree, and that is the failure this catches.
 *
 * NOTHING FROM EITHER SIDE IS PRINTED. The message says WHICH of hash, count
 * and content differs and stops there: a diff is not needed to know what to do,
 * and this is the one place in the pipeline where a private document has just
 * been read into memory.
 */
function assertNoDrift(stored: unknown, fresh: unknown, what: string, path: string): void {
  const a = JSON.stringify(stored);
  const b = JSON.stringify(fresh);
  if (a === b) return;
  const s = stored as { sha256?: string | null; count?: number };
  const f = fresh as { sha256?: string | null; count?: number };
  const differs = [
    s.sha256 !== f.sha256 ? "the source document's hash" : null,
    s.count !== f.count ? `the record count (${s.count} stored, ${f.count} fresh)` : null,
    "the parsed content",
  ].filter((x): x is string => x !== null);
  throw new Error(
    `The stored ${what} record disagrees with the private source it was derived from.\n` +
      `  Stored:  ${path}\n` +
      `  Differs: ${differs.join(", ")}\n\n` +
      `  Whatever moved — the document, or the parser that reads it — this build and a\n` +
      `  build without the document would now produce different site.json files, and\n` +
      `  neither would say so. Re-derive the record and commit it:\n` +
      `    ${DERIVE_COMMAND}`,
  );
}

/** The statistics workbook's lines, from the stored record. */
export function readStatsBook(dataDir: string, cwd: string): BookStatLine[] {
  const path = statsBookPath(cwd);
  const record = read<StatsBookRecord>(
    dataDir, DERIVED_FILES.statsBook, "statistics workbook", path !== undefined,
    "63 people instead of 80, and 478 player-seasons instead of 649 — silently, exit 0,\n" +
      "  writing a site.json that looks entirely plausible.",
    (r) => r.lines.length,
  );
  if (path) {
    assertNoDrift(record, deriveStatsBook(cwd), "statistics workbook",
      join(dataDir, DERIVED, DERIVED_FILES.statsBook));
  }
  return record.lines;
}

/** The captain's roster emails, from the stored record. */
export function readRosterEmails(dataDir: string, cwd: string): RosterEmailFile[] {
  const dir = rosterEmailDir(cwd);
  const record = read<RosterEmailsRecord>(
    dataDir, DERIVED_FILES.rosterEmails, "roster emails", existsSync(dir),
    "2019 - Summer falls from 17 players to none, 2020 - Winter from 19 to one and\n" +
      "  2018 - Summer from 15 to two — three squads the leagues never published, and\n" +
      "  nothing else in the corpus names them.",
    (r) => r.files.length,
  );
  if (existsSync(dir)) {
    assertNoDrift(record, deriveRosterEmails(cwd), "roster emails",
      join(dataDir, DERIVED, DERIVED_FILES.rosterEmails));
  }
  return record.files;
}

/** The roster book's entries, from the stored record. */
export function readRosterBook(dataDir: string, cwd: string): BookEntry[] {
  const path = rosterBookPath(cwd);
  const record = read<RosterBookRecord>(
    dataDir, DERIVED_FILES.rosterBook, "roster book", path !== undefined,
    "nothing today — the record is empty, because TGR.xlsx is gone. That empty array is a\n" +
      "  finding and it is stored as one; it is not a default this build may reach for.",
    (r) => r.entries.length,
  );
  if (path) {
    assertNoDrift(record, deriveRosterBook(cwd), "roster book",
      join(dataDir, DERIVED, DERIVED_FILES.rosterBook));
  }
  return record.entries;
}
