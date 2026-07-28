import { readFileSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/**
 * THE CAPTAIN'S ROSTER BOOK — `TGR.xlsx`.
 *
 * The first source in this archive that is not a website. It is the team's own
 * spreadsheet, one tab per session, and it holds the thing no league ever
 * bothered to record: JERSEY NUMBERS AND POSITIONS.
 *
 * That matters more than it sounds. HarborCenter has run this league for eleven
 * sessions and does not collect numbers, so fourteen men on this site have
 * never had one written down by anybody. The roster page says so in a caveat.
 * This book answers it.
 *
 * WHAT IS DELIBERATELY NOT READ, AND WILL NOT BE.
 *
 * The sheet is a working document and carries things a website has no business
 * with: dues (`Cost`, `Collected`, `Owed`), the beer ledger, and — in Winter
 * 21-22 — a `USA Hockey #` column holding real registration identifiers like
 * "111111111NAMEX". Those are personal data and team finances. This reader
 * takes three columns: name, number, position. Everything else is skipped at
 * the parse boundary rather than filtered later, so it cannot leak by accident
 * into site.json, and site.json is what the world sees.
 *
 * PROVENANCE. Every other figure on this site traces to a page that was served
 * on the internet and is stored in the corpus. These do not. They trace to a
 * man's spreadsheet, and the site must say so — a number somebody typed and a
 * number a league published are not the same kind of fact, and the distinction
 * is the entire project. See SOURCES["roster-book"] in generate.ts.
 */

export type BookEntry = {
  /** The tab's own label, verbatim: "Winter 19-20", "Summer2 - 21". */
  tab: string;
  name: string;
  /** As written. "1", "89", "" when the cell is blank. */
  jersey: string;
  /** F / D / G / L, as written. Null when blank. */
  position: string | null;
};

/* ---------- a minimal xlsx reader ------------------------------------------
   An xlsx is a ZIP of XML. There is no zip reader in Node's standard library
   and this repo takes no runtime dependencies, so this walks the central
   directory itself and inflates the members it needs. It is about sixty lines
   and it only has to read one file that a human maintains by hand.

   EXPORTED, because there is now a second workbook. `stats-book.ts` reads the
   captain's statistics workbook and needs exactly these five functions and
   nothing else from this file. A second hand-rolled zip reader in the same
   repo is a second place for the self-closing-cell bug below to be rediscovered
   the hard way. */

export type Zip = Map<string, Buffer>;

export function unzip(path: string): Zip {
  const buf = readFileSync(path);
  const out: Zip = new Map();

  // End of Central Directory: scan back for the signature. The comment field
  // is almost always empty, but bound the scan rather than assume it.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x0605_4b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x0201_4b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // The local header repeats the name/extra lengths and they can DIFFER from
    // the central directory's; the data starts after the local ones.
    const lNameLen = buf.readUInt16LE(localAt + 26);
    const lExtraLen = buf.readUInt16LE(localAt + 28);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);

    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Text of every <t> under a node, joined. Rich text splits a cell across runs. */
export function textOf(xml: string): string {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
    .map((m) => m[1] ?? "")
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function sharedStrings(zip: Zip): string[] {
  const b = zip.get("xl/sharedStrings.xml");
  if (!b) return [];
  return [...b.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1] ?? ""));
}

/**
 * Cells of one sheet as "A1" -> value.
 *
 * THE SELF-CLOSING CELL IS THE WHOLE PROBLEM. An empty cell is emitted as
 * `<c r="C3" s="19"/>` with no closing tag, and a pattern that requires
 * `<c …>…</c>` matches its OPENING tag and then scans to the first `</c>` it
 * finds — which belongs to the NEXT cell. So one blank cell silently eats its
 * neighbour and the scanner resumes past both:
 *
 *   <c r="C3" s="19"/><c r="D3" s="19"><v>21</v></c>
 *    ^ blank "Confirmed"   ^ the jersey number, swallowed
 *
 * That is exactly the shape of these tabs: most have a `Confirmed` column that
 * is usually blank, sitting between the name and the number. The first version
 * of this read jersey numbers from only 55 of 180 entries and I nearly
 * concluded the captain had left them out. He had not. I was eating them.
 */
export function sheetCells(xml: string, ss: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, body] = m;
    const type = /t="(\w+)"/.exec(attrs ?? "")?.[1];
    let val: string | null = null;
    if (type === "inlineStr") val = textOf(body ?? "");
    else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body ?? "")?.[1];
      if (v == null) continue;
      val = type === "s" ? (ss[Number(v)] ?? "") : v;
    }
    if (val !== null && val !== "") out.set(ref!, val);
  }
  return out;
}

export const colOf = (ref: string) => /^[A-Z]+/.exec(ref)![0];
export const rowOf = (ref: string) => Number(/\d+$/.exec(ref)![0]);

/**
 * Read every season tab.
 *
 * The header row is FOUND, not assumed: the tabs disagree about which column
 * the roster starts in (B in the later ones, C in the earlier), some carry a
 * `Confirmed` column between name and number and some do not, and one is
 * indented differently again. Locating "Player Name"/"Name" and reading the
 * headers to its right is the only thing that survives all thirteen.
 */
export function parseRosterBook(path: string): BookEntry[] {
  if (!existsSync(path)) return [];
  const zip = unzip(path);
  const ss = sharedStrings(zip);

  // Tab name -> sheet part, via the workbook's relationships.
  const wb = zip.get("xl/workbook.xml")!.toString("utf8");
  const rels = new Map(
    [...zip.get("xl/_rels/workbook.xml.rels")!.toString("utf8")
      .matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  const tabs = [...wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({
    name: m[1]!,
    part: `xl/${(rels.get(m[2]!) ?? "").replace(/^\/?xl\//, "")}`,
  }));

  const out: BookEntry[] = [];
  for (const tab of tabs) {
    // Sheet1/Sheet2 are scratch, not rosters.
    if (/^Sheet\d+$/.test(tab.name)) continue;
    const part = zip.get(tab.part);
    if (!part) continue;
    const cells = sheetCells(part.toString("utf8"), ss);

    // Find the header cell that opens the roster table.
    let head: { col: string; row: number } | null = null;
    for (const [ref, v] of cells) {
      if (/^(player name|name)$/i.test(v.trim())) {
        const r = rowOf(ref);
        if (!head || r < head.row) head = { col: colOf(ref), row: r };
      }
    }
    if (!head) continue;

    // BIND THE COLUMNS TO THIS TABLE ONLY.
    //
    // The tabs put several tables SIDE BY SIDE on the same rows — Winter 19-20
    // has the skaters at column C and a goalie table at N, and later tabs park
    // a per-game beer ledger to the right of the roster. Searching the whole
    // header row for "Number" therefore finds the wrong table's column: the
    // first version of this read Vinny Terrana as #1, off the goalie table's
    // numbering, when the sheet plainly says 89 two cells from his name. It
    // also collected "Status", "Full time", "43" and "144" as positions.
    //
    // So: walk RIGHT from the name column and stop at the next table's header.
    const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    const here = colNum(head.col);
    let edge = Infinity;
    for (const [ref, v] of cells) {
      if (rowOf(ref) !== head.row) continue;
      const c = colNum(colOf(ref));
      if (c > here && /^(player name|name)$/i.test(v.trim())) edge = Math.min(edge, c);
    }

    const wanted: Record<string, string> = {};
    for (const [ref, v] of cells) {
      if (rowOf(ref) !== head.row) continue;
      const c = colNum(colOf(ref));
      if (c <= here || c >= edge) continue;
      const k = v.trim().toLowerCase();
      if (k === "number") wanted.jersey = colOf(ref);
      else if (k === "position") wanted.position = colOf(ref);
    }
    if (!wanted.jersey) continue;

    for (let r = head.row + 1; r < head.row + 60; r++) {
      const name = cells.get(`${head.col}${r}`)?.trim();
      if (!name) continue;
      // The tabs repeat their own header, and carry totals rows.
      if (/^(player name|name|total|totals)$/i.test(name)) continue;
      if (!/[a-z]/i.test(name)) continue;
      const jersey = (cells.get(`${wanted.jersey}${r}`) ?? "").trim();
      const rawPos = (wanted.position ? cells.get(`${wanted.position}${r}`) : null)?.trim() ?? "";

      // A number is a number. A position is one of four letters. Anything else
      // in those cells is a neighbouring table bleeding in — "Status", "Full
      // time" and "USA Number" all arrived this way — and the honest answer to
      // a cell that does not hold what its header promises is nothing, not a
      // guess. This is a hand-kept sheet; it is allowed to be untidy.
      if (jersey && !/^\d{1,2}$/.test(jersey)) continue;
      out.push({
        tab: tab.name,
        name,
        jersey,
        position: /^[FDGL]$/i.test(rawPos) ? rawPos.toUpperCase() : null,
      });
    }
  }
  return out;
}
