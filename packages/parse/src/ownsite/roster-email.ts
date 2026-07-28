import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * THE CAPTAIN'S ROSTER EMAILS — `docs/research/captain-roster-emails/*.txt`.
 *
 * A third kind of source, and the first one that was never on the internet at
 * all. `TGR.xlsx` and the statistics workbook are the captain's spreadsheets;
 * these are his correspondence — a roster he sent to, or received from, a
 * league at the time, pasted back into the archive years later.
 *
 * WHY IT IS A FILE AND NOT A CONSTANT. A roster that exists only in a chat
 * message is a roster nobody can check. The email is written into the repo
 * VERBATIM, below a marker line, and this reader parses that stored text. The
 * next session can read exactly what was supplied and re-derive every row of
 * it; nothing here is retyped from memory into code.
 *
 * WHAT IT IS AND IS NOT.
 *
 *   IT IS: name, jersey number, position, for one team in one session.
 *   IT IS NOT: a statistic. Not one figure of games, goals, assists or minutes
 *   appears in these files, and none is invented from them. Every line this
 *   produces publishes with its stats null — the archive's standing rule that
 *   absence is not nought.
 *
 * `TBD` IS A REAL ANSWER. Two men in the 2018 Spring/Summer roster have "TBD"
 * where a number would be: at the moment the email was written nobody knew what
 * they would wear. That is recorded as an UNKNOWN number — jersey null — and
 * never filled from a neighbouring season, because numbers are reused in this
 * club: Justin Wheeler wore 2 in 2011 and this same email gives 2 to Anthony
 * Gugino. Greg Suffoletto proves it again inside these files alone — 28 in the
 * 2018-19 email, 26 in the Summer 2019 one — and Mark Lucatra wears that 26 the
 * winter after. Whatever the site does with an unevidenced number, it does here.
 *
 * REGISTRATION IDENTIFIERS ARE REFUSED AT THIS BOUNDARY. Six rows of the
 * 2018-19 email end in a USA Hockey registration number. They are personal
 * identifiers, they are nothing to do with hockey history, and they are
 * stripped off every row BEFORE anything else reads it — so one cannot reach an
 * entry, cannot be swallowed into a name, and cannot appear in `unread` either,
 * which is printed to the build log. `refused` counts them so the refusal is
 * provable without ever repeating the value, and no real one is written down
 * anywhere in this file. The stored email keeps them, exactly as the captain's
 * statistics workbook does: this directory is the evidence, and a redacted
 * source cannot be re-derived.
 *
 * PROVENANCE. This is the captain's word, not a league's page, and the site
 * must say which. See SOURCES["captain-roster-email"] in generate.ts.
 */

/** One line of one roster email. */
export type EmailRosterEntry = {
  /** The session label, verbatim from the file header: "2018 - Summer". */
  session: string;
  /** The team, verbatim from the file header. */
  team: string;
  name: string;
  /** The number as written, or null where the email says TBD or leaves it out. */
  jersey: string | null;
  /** "F" / "D" / "G", as written. Null when the column is blank — the Summer
   *  2019 email has no position column at all. */
  position: string | null;
  /**
   * "Rostered" / "Taxi Squad" / "IR", where the email says. Null everywhere
   * else, which is every other roster in this archive.
   *
   * ONE EMAIL HAS THIS COLUMN: the COVID season, headed "Rostered", with Yes
   * for fifteen men, "Taxi Squad" for three and "IR" for one. A taxi-squad
   * player and a rostered player were not in the same position and IR is a
   * statement that somebody was hurt, so flattening the three into "nineteen
   * players" would lose the only thing that roster says which no other roster
   * does. "Yes" is that column's affirmative and reads as "Rostered"; the word
   * alone means nothing away from its heading.
   */
  status: string | null;
};

/** The line that separates the metadata header from the untouched email. */
const MARKER = "--- the email, verbatim below this line ---";

/**
 * A position cell. Deliberately a closed set: a roster table is whitespace
 * aligned, so "is the last token a position?" is what tells a data row from
 * the prose around it. "L" appears in the roster book for a left wing.
 */
const POSITION = /^(?:G|F|D|L|C|LW|RW)$/i;

/** A number cell: digits, or the email's own way of saying it did not know. */
const NUMBER = /^(?:\d{1,3}|TBD|N\/A|-{1,2})$/i;

/**
 * A USA Hockey registration identifier: a long run of digits with the head of a
 * surname stuck on the end, e.g. `111111111NAMEX`.
 *
 * The same shape the statistics workbook's parse boundary refuses, and refused
 * here for the same reason: it is a personal identifier and this is a hockey
 * archive. Matched on the SHAPE rather than a list, because the next email will
 * carry six more of them belonging to men not on this one — and the example
 * above is deliberately invented, because a real one written into a comment has
 * escaped the boundary just as surely as one written into the data.
 */
const REGISTRATION = /^\d{6,}[A-Za-z]{4,}$/;

/**
 * A name word: a letter, then letters and the punctuation names actually carry.
 *
 * The guard against a sentence being read as a player, and it needs three parts
 * because two are not enough. What is left after the number, position and status
 * cells come off must be TWO OR MORE of these words, and the FIRST and LAST of
 * them must be capitalised.
 *
 * A roster names a man by given name and surname. One bare word in front of a
 * number is prose ("Thanks, 21"), and so is a whole clause ending in one — "we
 * finished the year 15" is four perfectly name-shaped words, and only the
 * capitals tell it from a player. Requiring the first AND the last leaves the
 * lowercase particles in the middle of a real name alone: "Vincent van Gogh"
 * still reads.
 *
 * Anything refused by this is REPORTED in `unread` and printed by the build,
 * never dropped quietly.
 */
const NAME_WORD = /^[A-Za-z][A-Za-z'’.-]*$/;
const CAPITALISED = /^[A-Z]/;

/**
 * The roster-status cell, as a CLOSED SET, longest phrase first.
 *
 * Closed for the same reason POSITION is: the table is whitespace-aligned, so
 * "is this the status cell?" is what tells the cell from the surname beside it.
 * And it has to be a set of PHRASES rather than tokens, because "Taxi Squad" is
 * one cell written as two words — taking the last token alone would leave
 * "Taxi" behind and read it as part of a name.
 *
 * "Rostered" is deliberately NOT a value here. It is the COLUMN HEADING, and
 * admitting it would make the heading itself parse as a man named "Player Name"
 * with a status and no number.
 */
const STATUSES: { words: string[]; status: string }[] = [
  { words: ["taxi", "squad"], status: "Taxi Squad" },
  { words: ["injured", "reserve"], status: "IR" },
  { words: ["ir"], status: "IR" },
  { words: ["yes"], status: "Rostered" },
  { words: ["no"], status: "Not rostered" },
];

/**
 * Parse one stored roster email.
 *
 * Header lines are `key: value` until MARKER; everything after MARKER is the
 * email as it arrived and is read for its table only.
 *
 * A ROW IS ITS CELLS, TAKEN OFF THE ENDS. The table is whitespace-aligned and
 * the alignment breaks down on the longest name — "Brendan Kaplewicz 9        D"
 * has a single space where every other row has several — so splitting on runs
 * of whitespace drops that man silently. The rule is positional instead, and it
 * has to be, because FIVE EMAILS HAVE FOUR DIFFERENT COLUMN ORDERS and none of
 * them announces which:
 *
 *   Corey Muff        1     G             name, number, position       (2018 S/S)
 *   1   Corey   Muff  G   <registration>  number FIRST, split name     (2018-19)
 *   Andy Murphy       12                  name and number, no position (2019 S/S)
 *   Adam Kaplewicz    96    Yes           name, number, STATUS         (2020-21)
 *
 * So the cells are taken off the ends in a fixed order and whatever is left in
 * the middle is the name, however many words it runs to:
 *
 *   0. A registration identifier goes first, off any position in the row, and
 *      is never seen again by anything below. See REGISTRATION.
 *   1. A status phrase off the RIGHT ("Taxi Squad", "IR", "Yes").
 *   2. A position off the right ("F", "D", "G").
 *   3. A number off the right — or, failing that, off the LEFT, which is where
 *      the 2018-19 email keeps it.
 *   4. What remains is the name, and must be two or more name-shaped words
 *      beginning and ending in a capital. See NAME_WORD.
 *
 * A ROW MUST STATE A NUMBER CELL. Every row of every email supplied so far
 * does, even when the number itself is unknown and the cell says TBD, and
 * requiring it is what keeps a column heading ("Player Name  Number  Position")
 * and a line of prose out of the roster. Anything without one is not a data row
 * and is skipped — and `unread` names every skipped non-empty line, so a
 * malformed table can never pass as an empty one.
 */
export function parseRosterEmail(text: string): {
  session: string;
  team: string;
  entries: EmailRosterEntry[];
  unread: string[];
  /** How many registration identifiers were refused. The COUNT, never the
   *  value: the refusal has to be provable without repeating what it refused. */
  refused: number;
} {
  const lines = text.split(/\r?\n/);
  const at = lines.indexOf(MARKER);
  if (at < 0) {
    throw new Error(
      `roster email: no verbatim marker. Expected a line reading exactly ${JSON.stringify(MARKER)}`,
    );
  }

  const header = new Map<string, string>();
  for (const line of lines.slice(0, at)) {
    const m = line.match(/^([a-z-]+):\s*(.*)$/i);
    if (m) header.set(m[1]!.toLowerCase(), m[2]!.trim());
  }
  const session = header.get("session") ?? "";
  const team = header.get("team") ?? "";
  if (!session || !team) {
    throw new Error("roster email: header must carry both `session:` and `team:`");
  }

  const entries: EmailRosterEntry[] = [];
  const unread: string[] = [];
  let refused = 0;
  for (const line of lines.slice(at + 1)) {
    const t = line.trim();
    if (!t) continue;
    const all = t.split(/\s+/);

    // THE REGISTRATION IDENTIFIERS COME OFF FIRST, before one line of this
    // function has looked at the row for anything else. Nothing downstream can
    // put one in an entry because nothing downstream can see one.
    const tokens = all.filter((x) => !REGISTRATION.test(x));
    refused += all.length - tokens.length;
    // A line that was NOTHING but an identifier leaves nothing to report, and
    // reporting the original would be the leak this whole passage prevents.
    if (tokens.length === 0) continue;
    // What `unread` may safely repeat. The stripped form only where something
    // was stripped, so the aligned column heading stays exactly as written.
    const safe = tokens.length === all.length ? t : tokens.join(" ");

    let tok = tokens;

    let status: string | null = null;
    for (const s of STATUSES) {
      const n = s.words.length;
      if (tok.length <= n) continue;
      const tail = tok.slice(tok.length - n).map((w) => w.toLowerCase());
      if (s.words.every((w, i) => tail[i] === w)) {
        status = s.status;
        tok = tok.slice(0, tok.length - n);
        break;
      }
    }

    let position: string | null = null;
    if (tok.length > 1 && POSITION.test(tok[tok.length - 1]!)) {
      position = tok[tok.length - 1]!.toUpperCase();
      tok = tok.slice(0, -1);
    }

    // Right first, then left. Right is where three of the four column orders
    // keep it; left is the 2018-19 email, whose name is split across two cells
    // so the number cannot be found by counting in from the end at all.
    let cell: string | null = null;
    if (tok.length > 1 && NUMBER.test(tok[tok.length - 1]!)) {
      cell = tok[tok.length - 1]!;
      tok = tok.slice(0, -1);
    } else if (tok.length > 1 && NUMBER.test(tok[0]!)) {
      cell = tok[0]!;
      tok = tok.slice(1);
    }

    const namely =
      tok.length >= 2
      && tok.every((w) => NAME_WORD.test(w))
      && CAPITALISED.test(tok[0]!)
      && CAPITALISED.test(tok[tok.length - 1]!);
    if (cell === null || !namely) {
      unread.push(safe);
      continue;
    }

    entries.push({
      session,
      team,
      name: tok.join(" "),
      // TBD is the email saying it did not know. Not a number, and not a zero.
      jersey: /^\d{1,3}$/.test(cell) ? cell : null,
      position,
      status,
    });
  }

  return { session, team, entries, unread, refused };
}

/**
 * Every stored roster email, in filename order.
 *
 * Returns [] when the directory does not exist, which is the honest answer for
 * a checkout that has not been given one — the same shape as the workbook
 * readers. A directory that exists and holds an unparseable file throws, which
 * is not the same thing.
 */
export function parseRosterEmails(dir: string): {
  file: string;
  session: string;
  team: string;
  entries: EmailRosterEntry[];
  unread: string[];
  refused: number;
}[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .sort()
    .map((f) => ({ file: f, ...parseRosterEmail(readFileSync(join(dir, f), "utf8")) }));
}
