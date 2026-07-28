import { appendFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { CaptureRecord } from "./types.ts";

/**
 * Narrows an `unknown` catch value to a Node error carrying a `code`
 * (e.g. "ENOENT"), without resorting to `any`.
 */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Append-only JSONL log of every capture. THIS IS THE SOURCE OF TRUTH.
 *
 * The SQLite manifest is a derived index rebuilt from this file. Plain text,
 * one JSON object per line: greppable, diffable, and readable by anything,
 * with no dependency on this codebase or on SQLite. A rescue archive must not
 * rest on a foundation more fragile than the thing it is rescuing.
 */
export class CaptureLog {
  // NOTE: an explicit field + assignment, NOT a `constructor(private file: string)`
  // parameter property. Node's type stripping only ERASES types; parameter
  // properties emit a runtime assignment, so they fail with
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Same rule applies project-wide.
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async append(rec: CaptureRecord): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    // appendFile opens with O_APPEND, so the seek-to-end and the write are
    // atomic with respect to other appenders: concurrent writers cannot
    // clobber each other's offsets. That is NOT a guarantee that a single
    // write is indivisible, and it says nothing about a crash mid-write —
    // a torn trailing line is still possible, and read() below tolerates it.
    await appendFile(this.file, `${JSON.stringify(rec)}\n`, "utf8");
  }

  /** Stream records. A truncated trailing line (crash mid-write) is skipped. */
  async *read(): AsyncGenerator<CaptureRecord> {
    let handle;
    try {
      handle = await open(this.file, "r");
    } catch (err) {
      // Only "no log yet" is a legitimate empty state. Any other failure to
      // open (EACCES, EISDIR, ...) must propagate: reporting "empty" when we
      // actually just couldn't look would tell an operator the archive is
      // gone when it is merely unreadable.
      if (isErrnoException(err) && err.code === "ENOENT") return;
      throw err;
    }
    try {
      let lineNo = 0;
      for await (const line of handle.readLines({ encoding: "utf8" })) {
        lineNo++;
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as CaptureRecord;
        } catch {
          // Never throw on a bad record, but never smooth it over either:
          // this may be a torn final line from an interrupted write, or it
          // may be corruption in the middle of the log, and the two are
          // indistinguishable from here. Surface it either way — gaps and
          // discrepancies must never pass silently in an archive tool.
          console.warn(`CaptureLog: skipping unparseable line ${lineNo} in ${this.file}`);
          continue;
        }
      }
    } finally {
      await handle.close();
    }
  }

  async all(): Promise<CaptureRecord[]> {
    const out: CaptureRecord[] = [];
    for await (const r of this.read()) out.push(r);
    return out;
  }
}
