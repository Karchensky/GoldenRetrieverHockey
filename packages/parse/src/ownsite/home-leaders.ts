import { text } from "../html.ts";

/**
 * Parse the point leaders from goldenretrieverhockey.com's home page.
 *
 * The 2014-era site was a Web.com Site Builder export — absolutely-positioned
 * wsb-element divs, and the previous session said "nothing else." But the
 * point leaders ARE in real `<ol><li>` markup inside a wsb-element-text div:
 *
 *   <div class="wsb-element-text"><div class="txt">
 *     <h3>2014&nbsp; / 15 EMHL Point Leaders</h3>
 *   </div></div>
 *   ...
 *   <div class="wsb-element-text"><div class="txt">
 *     <ol>
 *       <li>Adam Kaplewicz&nbsp;30</li>
 *       <li>Justin Wheeler&nbsp;24</li>
 *     </ol>
 *   </div></div>
 *
 * Points only — no GP, G, A. For four of the competitions below this table is
 * the ONLY surviving statistical record anywhere.
 *
 * THE HOME PAGE IS NOT ONE SEASON. It was re-edited in place for four years,
 * and the Internet Archive caught it holding a different competition each time.
 * Reading only `home.html`, and only a `YYYY / YY <League> Point Leaders`
 * heading, saw exactly one of them:
 *
 *   2014 / 15 EMHL Point Leaders                    regular season   (was read)
 *   2014 / 15 EMHL Playoff Point Leaders            playoffs         (was not)
 *   2015 Summer PxHL Playoff Point Leaders          playoffs         (was not)
 *   2015 / 2016 EMHL  +  Point Leaders              regular season   (was not)
 *   2015 gREATER bUFFALO iNVITATIONAL pOINT lEADERS tournament       (see below)
 *
 * Three things defeated the old reader, and all three are page facts rather
 * than guesses:
 *
 *  1. THE HEADING SPLITS. By 2016 the season and the words "Point Leaders" sit
 *     in two SEPARATE `<h3>` elements — the site builder positions each block
 *     absolutely, so a visual line is not a markup line. They are always
 *     adjacent in document order, so candidates are formed by joining each
 *     heading with the one after it as well as reading it alone.
 *  2. THE SECOND YEAR IS NOT ALWAYS TWO DIGITS. "2014 / 15" became
 *     "2015 / 2016", and `\d{2}` matched the "20" of 2016 and then failed.
 *  3. A SUMMER SEASON HAS NO SPAN AT ALL. "2015 Summer PxHL" — a different
 *     league (Performax) in a different half of the year.
 *
 * "Playoff" between the league and "Point Leaders" is the page stating its own
 * phase, and it is kept: a regular season and its playoffs are two real,
 * separately-countable parts of one season.
 *
 * THE GREATER BUFFALO INVITATIONAL IS A TOURNAMENT, AND TOURNAMENTS ARE
 * SESSIONS — the captain's ruling: "Tournaments can be their own little
 * mini-seasons." Its heading is the odd one out because it names no league and
 * no half of the year, only an event: "2015 gREATER bUFFALO iNVITATIONAL
 * pOINT lEADERS". So it is read by a second, looser pattern that takes a year
 * and whatever the page calls the competition, VERBATIM and un-normalised.
 *
 * Placing it is not this parser's job. `sessions.ts` owns which competitions
 * are tournaments and when each is played, and it is the only place that knows
 * the Invitational runs in late April. A parser that decided that here would be
 * a parser asserting a date no page in front of it states.
 */
export type PointLeader = {
  name: string;
  pts: number;
};

export type HomeLeaders = {
  /** Raw season phrase for `sessions.ts` to place: "2014-15", "2015-2016",
   *  "2015 Summer". Never a display label — placement is the builder's job. */
  session: string;
  /** "EMHL", "PxHL" — the competition the page names. */
  league: string;
  /** "Regular Season" | "Playoffs", from the heading's own wording. */
  phase: string;
  leaders: PointLeader[];
};

/**
 * A season phrase followed by a league and "Point Leaders".
 *
 * Either a year span ("2014 / 15", "2015 / 2016") or a year and a half-of-year
 * word ("2015 Summer"). Anything else — an invitational, a tournament — is not
 * a session and is not matched.
 */
const HEADING =
  /(\d{4})\s*(?:\/\s*(\d{2,4})|\s+(summer|winter|spring|fall))\s+([A-Za-z][A-Za-z0-9]*)\s*(playoffs?)?\s*point\s*leaders/i;

/**
 * A year and an EVENT NAME: "2015 Greater Buffalo Invitational Point Leaders".
 *
 * Tried only after HEADING fails, so a league heading — which also begins with
 * a year — can never be captured by it. The name is taken as written; the page
 * shouts it in alternating case and normalising that is the builder's problem,
 * not this one's.
 */
const EVENT_HEADING = /(\d{4})\s+([A-Za-z][A-Za-z' ]*?)\s*(playoffs?)?\s*point\s*leaders/i;

export function parseHomeLeaders(html: string): HomeLeaders | null {
  // Headings in document order, tags and entities gone.
  const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((m) => text(m[1]!));

  // Each heading alone, then each joined with its successor — see (1) above.
  // Every candidate is tried against the LEAGUE pattern before any is tried
  // against the looser event one, so a league heading can never be taken for a
  // tournament.
  const candidates: string[] = [];
  for (let i = 0; i < headings.length; i++) {
    candidates.push(headings[i]!);
    if (i + 1 < headings.length) candidates.push(`${headings[i]} ${headings[i + 1]}`);
  }

  let session: string;
  let league: string;
  let phase: string;

  const leagueM = candidates.map((c) => c.match(HEADING)).find(Boolean);
  if (leagueM) {
    const [, year1, year2, half, name, playoff] = leagueM;
    session = year2 ? `${year1}-${year2}` : `${year1} ${half}`;
    league = name!;
    phase = playoff ? "Playoffs" : "Regular Season";
  } else {
    const eventM = candidates.map((c) => c.match(EVENT_HEADING)).find(Boolean);
    if (!eventM) return null;
    const [, year, name, playoff] = eventM;
    // The whole phrase, so `sessions.ts` can recognise the competition AND read
    // the year out of one string: "2015 Greater Buffalo Invitational".
    session = `${year} ${name!.trim()}`;
    league = name!.trim();
    phase = playoff ? "Playoffs" : "Regular Season";
  }

  const olM = html.match(/<ol[\s\S]*?<\/ol>/i);
  if (!olM) return null;

  const items = [...olM[0].matchAll(/<li>([\s\S]*?)<\/li>/gi)];
  if (items.length === 0) return null;

  const leaders: PointLeader[] = [];
  for (const item of items) {
    const raw = text(item[1]!).replace(/\s+/g, " ").trim();
    const m = raw.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    leaders.push({ name: m[1]!.trim(), pts: Number(m[2]) });
  }

  return leaders.length > 0 ? { session, league: league!, phase, leaders } : null;
}
