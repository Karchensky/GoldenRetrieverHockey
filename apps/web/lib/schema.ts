import type { Game, Player } from "../../../packages/build/src/types";
import { FOUNDED, ourSide } from "./data";
import { SITE_URL } from "./meta";

/**
 * The archive, as structured data.
 *
 * **What this is honestly worth, stated once so nobody expects otherwise.**
 * `BreadcrumbList` is the only type here Google renders in a result — it
 * replaces the raw URL under the title. `SportsEvent` on a past amateur fixture
 * produces no rich result; Google's event results are for upcoming ticketed
 * events. `Person` produces none either. Those two are entity hygiene: they let
 * a crawler know that this page is one game between two named clubs on a date,
 * or one man who played for one club, rather than an anonymous table. Cheap,
 * correct, and not traffic.
 *
 * The reach levers on this half of the site are the per-page social cards in
 * `meta.ts`, the canonicals, and the 385 pages that entered the sitemap on
 * 2026-08-03.
 *
 * The shop's markup is not here — it is in `packages/store/src/schema.ts`, so
 * that the prices in it are checked by `npm test` against the same function the
 * checkout charges from.
 */

const SCHEMA = "https://schema.org";

/** The club's own node, referenced by @id from every page that mentions it. */
export const TEAM_ID = `${SITE_URL}/#team`;

/**
 * ONE CLUB NODE, DEFINED ONCE.
 *
 * Every other page points at this `@id` rather than restating the club, so a
 * crawler reading a game page and a player page understands them to be about
 * the same team instead of two clubs that share a name.
 *
 * The founding year is `FOUNDED` — counted from the earliest session on file,
 * never typed. A season recovered from before 2011 moves it here as it moves it
 * in the masthead.
 */
export const teamSchema = (): Record<string, unknown> => ({
  "@context": SCHEMA,
  "@type": "SportsTeam",
  "@id": TEAM_ID,
  name: "Golden Retrievers",
  sport: "Ice hockey",
  foundingDate: String(FOUNDED),
  url: SITE_URL,
  logo: `${SITE_URL}/brand/golden-retrievers-crest.png`,
  location: {
    "@type": "Place",
    name: "Buffalo, New York",
  },
});

/** Just the reference. Used wherever the club is named but not described. */
const teamRef = { "@id": TEAM_ID };

const club = (name: string): Record<string, unknown> =>
  // Our own side resolves to the club node; an opponent is named and nothing
  // more, because nothing here knows anything else about them.
  /retriever/i.test(name)
    ? { "@type": "SportsTeam", ...teamRef, name }
    : { "@type": "SportsTeam", name };

/**
 * `status` is the source's own word, and there are five of them across the 328
 * sheets: Final, Final/OT, Score not recorded, Postponed, Not Started.
 *
 * schema.org has no "finished" state — `EventStatusType` offers cancelled,
 * moved online, postponed, rescheduled and scheduled, and a played game is
 * simply a scheduled one that happened. So only the two that map get mapped.
 */
const eventStatus = (status: string): string =>
  status === "Postponed" ? `${SCHEMA}/EventPostponed` : `${SCHEMA}/EventScheduled`;

export function gameSchema(g: Game): Record<string, unknown> {
  const url = `${SITE_URL}/games/${g.id}`;
  const played = g.homeScore !== null && g.awayScore !== null;

  return {
    "@context": SCHEMA,
    "@type": "SportsEvent",
    "@id": `${url}#event`,
    // The same string the page's own <title> carries. A crawler reading a
    // different name from the reader would be describing a different fixture.
    name: played
      ? `${g.away} ${g.awayScore} at ${g.home} ${g.homeScore}`
      : `${g.away} at ${g.home}`,
    url,
    sport: "Ice hockey",
    // `date` is the ISO field. `dateRecorded` is a DISPLAY string that reads
    // "September 24" on the older sheets — no year — and Date.parse silently
    // resolves that to this morning. It dated a 2012 fixture to today once.
    startDate: g.date,
    eventStatus: eventStatus(g.status),
    eventAttendanceMode: `${SCHEMA}/OfflineEventAttendanceMode`,
    organizer: { "@type": "Organization", name: g.league },
    /**
     * **`homeTeam` AND `awayTeam` ONLY WHERE A SOURCE ACTUALLY SAID SO.**
     *
     * 119 of the 328 sheets carry `venueUnknown` — the club's own dead site
     * wrote every fixture as "vs.", so which side was home is not recorded and
     * the fields hold an arbitrary assignment. Naming a home side there would
     * be inventing a fact about somebody else's rink. `competitor` is the
     * unordered pair and is the honest shape for those.
     */
    ...(g.venueUnknown
      ? { competitor: [club(g.home), club(g.away)] }
      : { homeTeam: club(g.home), awayTeam: club(g.away) }),
    // 209 of 328 name a rink. No street address is invented for any of them.
    ...(g.rink ? { location: { "@type": "Place", name: g.rink } } : {}),
  };
}

/**
 * A man's page.
 *
 * Name, his page, and the club — nothing else. No statistics, no contact
 * details, nothing the page does not already render in plain sight. The
 * archive's whole argument is that these eighty men should be findable under
 * their own names; this is the machine-readable half of saying so.
 */
export const playerSchema = (p: Player): Record<string, unknown> => ({
  "@context": SCHEMA,
  "@type": "Person",
  "@id": `${SITE_URL}/players/${p.slug}#person`,
  name: p.name,
  url: `${SITE_URL}/players/${p.slug}`,
  memberOf: { "@type": "SportsTeam", ...teamRef, name: "Golden Retrievers" },
});

export type Crumb = { name: string; path: string };

/**
 * The trail Google prints under the title in place of the raw URL.
 *
 * Positions are 1-based and the last item is the page itself. The home page has
 * no breadcrumb — a single-item trail is the page saying it is where it is.
 */
export const breadcrumbSchema = (crumbs: Crumb[]): Record<string, unknown> => ({
  "@context": SCHEMA,
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name,
    item: `${SITE_URL}${c.path}`,
  })),
});

/** The two trails the archive uses, so the wording is not retyped per page. */
export const ARCHIVE_CRUMB: Crumb = { name: "Team Archive", path: "/seasons" };
export const STORE_CRUMB: Crumb = { name: "Store", path: "/store" };

/** Used by the game page, which is reached through its season. */
export const gameCrumbs = (g: Game): Crumb[] => [
  ARCHIVE_CRUMB,
  {
    name: g.session,
    // The game page links back to the archive index rather than to a season
    // route it cannot always resolve; the trail says the same thing.
    path: "/seasons",
  },
  { name: `${ourSide(g)} v ${g.opponent}`, path: `/games/${g.id}` },
];
