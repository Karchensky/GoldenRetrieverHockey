import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DERIVED, DERIVED_FILES, DERIVE_COMMAND,
  deriveStatsBook, deriveRosterEmails, deriveRosterBook,
  statsBookPath, rosterBookPath, rosterEmailDir,
} from "./derived.ts";

/**
 * PARSE THE PRIVATE DOCUMENTS, ONCE, INTO THE CORPUS.
 *
 *     npm run derive:private
 *
 * The only code in this repository that opens the captain's workbooks or his
 * roster emails. It reads them, keeps the three columns and the stat lines that
 * are a hockey record, and writes those to `data/derived/`. `build:data` reads
 * what this writes and never the documents themselves — see `derived.ts` for
 * why, and for what is deliberately left behind at the parse boundary.
 *
 * Run it when a document changes: another roster email surfaces, the captain
 * corrects a cell, or one of the three parsers is improved. Then commit the
 * record, which is a reviewable diff of exactly what moved.
 *
 * IT WILL NOT EMPTY A RECORD IT CANNOT REBUILD.
 *
 * Two of these documents are gitignored and one — `TGR.xlsx` — is deleted. Run
 * this on a machine that does not have them and the honest output is an empty
 * record, which is the 63-people-instead-of-80 failure written straight into
 * the corpus and committed as though it were a finding. So a record that holds
 * something is never overwritten by one that holds nothing: the source's
 * absence is reported and the stored record is left exactly as it was.
 * Genuinely emptying one — should a document ever really lose its last row —
 * means deleting the stored file first, deliberately.
 */

const DATA = process.env.GR_DATA_DIR ?? "data";
const cwd = process.cwd();

type Written = { file: string; count: number; note: string; refusedWrite: boolean };

function put(file: string, payload: { count: number }, sourceOnDisk: boolean, note: string): Written {
  const dir = join(DATA, DERIVED);
  const path = join(dir, file);
  if (!sourceOnDisk && existsSync(path)) {
    const held = (JSON.parse(readFileSync(path, "utf8")) as { count: number }).count;
    if (held > 0) {
      console.error(
        `\nREFUSED to rewrite ${path}\n` +
          `  Its source is not on this disk, so this run would replace ${held} record(s) with\n` +
          `  nothing — and nothing would look exactly like a finding. Left as it was.\n` +
          `  ${note}`,
      );
      return { file, count: held, note: `${note} — record left untouched`, refusedWrite: true };
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return { file, count: payload.count, note, refusedWrite: false };
}

const bookPath = statsBookPath(cwd);
const emailDir = rosterEmailDir(cwd);
const tgrPath = rosterBookPath(cwd);

const emails = deriveRosterEmails(cwd);
const refused = emails.files.reduce((n, f) => n + f.refused, 0);
const rows = emails.files.reduce((n, f) => n + f.entries.length, 0);

const written = [
  put(
    DERIVED_FILES.statsBook, deriveStatsBook(cwd), bookPath !== undefined,
    bookPath ? `read from ${bookPath}` : "the statistics workbook is not on this disk",
  ),
  put(
    DERIVED_FILES.rosterEmails, emails, existsSync(emailDir),
    existsSync(emailDir)
      ? `${emails.count} email(s), ${rows} roster line(s)`
      : "the roster emails are not on this disk",
  ),
  put(
    DERIVED_FILES.rosterBook, deriveRosterBook(cwd), tgrPath !== undefined,
    tgrPath ? `read from ${tgrPath}` : "TGR.xlsx is not on this disk",
  ),
];

console.log("--- private sources derived ---");
for (const w of written) {
  console.log(`  ${w.file.padEnd(28)} ${String(w.count).padStart(4)}  ${w.note}`);
}
// THE COUNT OF REFUSED REGISTRATION IDENTIFIERS, NEVER ONE OF THE VALUES.
// Printing a personal identifier to prove it was refused would be the leak the
// refusal exists to prevent.
console.log(
  `  ${refused} USA Hockey registration identifier(s) refused at the parse boundary`,
);
console.log(`  -> ${join(DATA, DERIVED)}`);

const refusals = written.filter((w) => w.refusedWrite);
if (refusals.length > 0) {
  // A run that could not open the documents it exists to read has not derived
  // anything, and must not report success. The records it left alone are still
  // correct — they are simply not this run's work.
  console.error(
    `\nNOTHING WAS DERIVED for ${refusals.map((r) => r.file).join(", ")}.\n` +
      `  This machine does not hold the private source(s). That is fine — the stored\n` +
      `  records are tracked and still correct — but this run did no work, and exiting 0\n` +
      `  would say otherwise.`,
  );
  process.exit(1);
}
console.log(
  `\nCommit these. ${DERIVE_COMMAND} is the only step that needs the private documents;\n` +
    `everything downstream reads the records instead.`,
);
