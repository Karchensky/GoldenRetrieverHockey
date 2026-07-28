/**
 * THE CLUB'S OWN `schedule.html` — a hand-typed season fixture list.
 *
 * One capture survives, of the 2014/15 EMHL season, and it is the ONLY
 * game-by-game record that exists for that year. It is a GoDaddy Website
 * Builder text block: fifteen lines somebody typed into a rich-text box, with
 * no table, no markup per field and no year anywhere on the page.
 *
 *     Game 1: Wednesday, September 17th - 9:20 pm - vs. Catholic Health (9 - 3 W)
 *     Game 8: Friday, November 14th - 10:50 pm - vs. Barrets (W)
 *     Game 15: Monday, December 29th - 9:20 pm - vs. Catholic Health
 *
 * THE SCORES ARE WRITTEN WINNER FIRST, and this is the fact the whole route
 * turns on. It reads as ours-first until you check it against the club's own
 * W/L labels, at which point both of the obvious readings die on the same ten
 * rows:
 *
 *   - "us - them" makes `12 - 11 L` a win, and four other L rows with it.
 *   - "them - us" makes `9 - 3 W` a loss, and four other W rows with it.
 *   - Winner first is consistent with all ten, and the larger number is written
 *     first in all ten.
 *
 * An earlier pass read the two orderings against each other, found neither
 * worked, and rejected the page as inconsistent. It is not inconsistent; the
 * W/L label is the third piece of information and it resolves it. So this
 * parser takes the score BY POSITION — winner's goals first — rather than by
 * taking the larger number for a win. The two agree on every row here, and
 * they disagree loudly the day a row is typed the other way round, which is
 * the behaviour worth having: see `gf` below.
 *
 * THE PAGE NEVER WRITES A VENUE. It says `vs.` on all fifteen fixtures, home
 * and away alike, exactly as `Game_Recaps.html` does for a different season on
 * the same site. The word is this club's house style, not a claim, and nothing
 * here reports one. `Game.venueUnknown` is what the build carries instead.
 *
 * THE PAGE NEVER WRITES A YEAR EITHER — but unlike the recap page it names its
 * own season in a heading ("2014 / 2015 EMHL Season"), and it writes the
 * WEEKDAY of every fixture. Those two are enough between them: the heading
 * places the season and the fifteen weekdays check it, independently, fifteen
 * times. The dating is done in `packages/build/src/games.ts`, where the
 * session vocabulary lives; this file reports the weekday, month and day it
 * read and derives no year of its own.
 */

/** One line of the fixture list, exactly as the page states it. */
export type ScheduleFixture = {
  /** "1" — the club numbers each season's games from one. */
  number: string;
  /**
   * The heading standing over this fixture — "Regular Season" — or null where
   * the page prints none above it.
   *
   * Same job as `RecapFixture.section`: this club numbers its playoffs from
   * one as well, so a playoff opener is written identically to a season opener
   * and only the heading above it knows the difference.
   */
  section: string | null;
  /** "Wednesday". The page's own, and a free check on the derived year. */
  weekday: string;
  /** "September 17th" — verbatim. There is no year on the page. */
  recorded: string;
  month: number;
  day: number;
  /** "9:20 pm", or null where the line omits it. */
  time: string | null;
  opponent: string;
  /**
   * The two numbers AS WRITTEN, in the page's own left-to-right order. Null
   * where the line prints no score at all.
   *
   * Kept beside `gf`/`ga` deliberately: it is the evidence the winner-first
   * reading is derived from, and a later session must be able to re-derive
   * that reading rather than take this one's word for it.
   */
  written: readonly [number, number] | null;
  /** The club's own label. Null where the line prints none. */
  result: "W" | "L" | "T" | null;
  /**
   * Ours and theirs, resolved WINNER FIRST — `written[0]` is the winner's, and
   * the club's own W/L says which side that was.
   *
   * NULL WHERE THE PAGE CONTRADICTS ITSELF, which is the point of doing it by
   * position. A row reading `3 - 9 W` would be a page that does not follow its
   * own convention, and the honest answer to it is that this archive cannot
   * orient that score — not a quietly larger number picked out to make the
   * label come true. Also null where either half is missing: game 8 states a
   * result and no score, and absence is not nought.
   */
  gf: number | null;
  ga: number | null;
};

export type SchedulePage = {
  /** "2014 / 2015 EMHL Season" — the page's own heading, verbatim. */
  heading: string;
  /** "EMHL", where the heading names a league. Null where it does not. */
  league: string | null;
  fixtures: ScheduleFixture[];
  /**
   * Non-empty lines inside the fixture block that were not read as fixtures.
   *
   * Reported rather than dropped, the same rule the roster emails follow: a
   * hand-typed page whose format shifts mid-list must not be able to lose a
   * game silently.
   */
  unread: string[];
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** A line that is a section heading and nothing else. */
const SECTION = /^(Playoffs|Regular Season|Championship|Semi[- ]?finals?)\s*:?\s*$/i;

/**
 * The season heading: a year, or a span of two, then the rest of the line.
 *
 * "2014 / 2015 EMHL Season". Matched on the whole line so a fixture's own
 * date can never be mistaken for it.
 */
const HEADING = /^(\d{4})(?:\s*\/\s*(\d{4}|\d{2}))?\s+(.*?)\s*Season\s*$/i;

/** The league abbreviations this club's pages actually print. */
const LEAGUE = /\b(EMHL|LSHL|PxHL|HAHL|LAHL|Performax)\b/i;

/**
 * One fixture line.
 *
 * `Game <n>: <Weekday>, <Month> <day><ordinal> - <time> - vs. <opponent>`
 * with an optional trailing `(<score> <result>)`.
 *
 * The time is optional because nothing about a fixture depends on it and a
 * line that omits one is still a game. The opponent is taken lazily up to the
 * end of the line and the parenthesised tail is peeled off it afterwards —
 * doing it in one expression makes an opponent whose name contains a bracket
 * unreadable, and this is a hand-typed page.
 */
const FIXTURE =
  /^Game\s*(?:#\s*)?(\d+|[A-Z]):\s*([A-Za-z]+),\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:-\s*([\d:]+\s*[ap]\.?m\.?)\s*)?-\s*vs\.?\s*(.+)$/i;

/** The tail: `(9 - 3 W)`, `(W)`, or `(9 - 3)`. */
const TAIL = /\(\s*(?:(\d+)\s*-\s*(\d+))?\s*([WLT])?\s*\)\s*$/i;

export function parseSchedulePage(html: string): SchedulePage | null {
  const clean = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(clean)
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let heading: string | null = null;
  let league: string | null = null;
  const fixtures: ScheduleFixture[] = [];
  const unread: string[] = [];
  let section: string | null = null;

  for (const line of lines) {
    if (heading === null) {
      const h = line.match(HEADING);
      if (h) {
        heading = line;
        league = h[3]!.match(LEAGUE)?.[1]?.toUpperCase() ?? null;
      }
      // Everything above the heading is chrome — the nav, the masthead, the
      // stylesheet's leavings. Not reported: it is not part of the list.
      continue;
    }

    const s = line.match(SECTION);
    if (s) {
      const word = s[1]!.replace(/\s+/g, " ");
      section = word[0]!.toUpperCase() + word.slice(1);
      continue;
    }

    const m = line.match(FIXTURE);
    if (!m) {
      // A bare navigation word or a stray footer line after the list. Only
      // things that look like they were meant to be read are worth reporting,
      // and a line with no letters in it is not.
      if (/[A-Za-z]{3}/.test(line)) unread.push(line);
      continue;
    }

    const monthName = m[3]!.toLowerCase();
    const monthIndex = MONTHS.findIndex((x) => x === monthName || x.slice(0, 3) === monthName);
    if (monthIndex === -1) {
      unread.push(line);
      continue;
    }

    let opponent = m[6]!.trim();
    let written: readonly [number, number] | null = null;
    let result: "W" | "L" | "T" | null = null;

    const tail = opponent.match(TAIL);
    if (tail) {
      opponent = opponent.slice(0, tail.index).trim();
      if (tail[1] !== undefined && tail[2] !== undefined) {
        written = [Number(tail[1]), Number(tail[2])];
      }
      if (tail[3] !== undefined) result = tail[3]!.toUpperCase() as "W" | "L" | "T";
    }
    // Trailing punctuation the typist left behind, never a letter of a name.
    opponent = opponent.replace(/[\s.,;:-]+$/, "").trim();
    if (!opponent) {
      unread.push(line);
      continue;
    }

    // WINNER FIRST, BY POSITION. `written[0]` is the winner's goals; the W/L
    // says whether that was us. A row whose numbers disagree with its own
    // label is refused rather than reoriented — see `gf`.
    let gf: number | null = null;
    let ga: number | null = null;
    if (written && result) {
      const mine = result === "L" ? written[1]! : written[0]!;
      const theirs = result === "L" ? written[0]! : written[1]!;
      const agrees =
        result === "W" ? mine > theirs : result === "L" ? mine < theirs : mine === theirs;
      if (agrees) {
        gf = mine;
        ga = theirs;
      }
    }

    fixtures.push({
      number: m[1]!,
      section,
      weekday: m[2]!,
      recorded: `${m[3]!} ${m[4]!}`,
      month: monthIndex + 1,
      day: Number(m[4]),
      time: m[5] ? m[5]!.replace(/\s+/g, " ").trim() : null,
      opponent,
      written,
      result,
      gf,
      ga,
    });
  }

  if (heading === null) return null;
  return { heading, league, fixtures, unread };
}
