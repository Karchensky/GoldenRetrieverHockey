import type { MetadataRoute } from "next";
import { players } from "../lib/data";
import { SITE_URL } from "../lib/meta";
import { AVAILABLE_SEASONS, seasonGames } from "../lib/seasons";
import { products } from "../lib/store";
import { games } from "../components/games/games";

/**
 * The sitemap is DERIVED from the record, not maintained by hand.
 *
 * Player pages exist because people are on file; the day a sweep recovers a
 * lost session, this grows on its own. A hand-kept list
 * would be one more number in this repo that drifts away from the data — there
 * have already been three of those today.
 *
 * This project's whole subject is what happens when a team's history becomes
 * unfindable. Making the recovered version findable is not housekeeping.
 *
 * **It stopped one list short, twice.** Until 2026-08-03 this named players and
 * seasons and nothing else: 114 URLs against 505 exported pages. Missing were
 * the 56 product pages — the only ones that take money — and all 328 game
 * pages, which are the largest thing here by some distance and name 90
 * opposing clubs between them. A man looking for the night his own club played
 * is the most likely stranger this site will ever get, and the page he wants
 * was written, built and then left out of the index.
 *
 * The four redirect stubs (`/roster`, `/games`, `/stats`, `/history`) are
 * deliberately still absent. They hold no content of their own.
 *
 * **`lastModified` IS NOT THE BUILD TIME.** It was, on every URL, and a daily
 * Action rebuilds and commits this repository — so all of them announced they
 * had changed, every day, forever. A sitemap that always says "today" is a
 * sitemap whose dates a crawler learns to ignore, and it got four times worse
 * the moment the games went in. Three of the five groups can answer the
 * question honestly and now do; the other two genuinely can change on any day a
 * sync runs, so for those the build time is the true answer rather than a
 * placeholder.
 */
export const dynamic = "force-static";

/**
 * The origin, shared with `layout.tsx`'s `metadataBase` and every canonical.
 * It was written out a third time here; a sitemap that names a different origin
 * from the canonicals is a sitemap that indexes duplicates.
 */
const SITE = SITE_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  /**
   * Never claim a page changed in the future.
   *
   * Three fixtures on file have not been played yet — the schedule runs to
   * 2026-08-17 — and a `lastmod` ahead of the crawl is invalid, so the whole
   * entry gets discarded rather than merely disbelieved.
   */
  const notAfterNow = (d: Date): Date => (d > now ? now : d);

  /**
   * `game.date` is the ISO one. `dateRecorded` is a DISPLAY string and reads
   * "September 24" on the older sheets — no year — which `Date.parse` silently
   * resolves to the current one. It was the obvious field to reach for and it
   * would have dated a 2012 fixture to this morning.
   */
  const playedOn = (iso: string): Date | null => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : notAfterNow(new Date(t));
  };

  /** The latest fixture in a session, by that session's own label. */
  const lastGameInSession = new Map<string, Date>();
  for (const game of games) {
    const on = playedOn(game.date);
    if (!on) continue;
    const seen = lastGameInSession.get(game.session);
    if (!seen || on > seen) lastGameInSession.set(game.session, on);
  }

  const latestOf = (sessions: readonly string[]): Date | undefined => {
    let best: Date | undefined;
    for (const session of sessions) {
      const on = lastGameInSession.get(session);
      if (on && (!best || on > best)) best = on;
    }
    return best;
  };

  const fixed = ["", "/store", "/seasons", "/store/help"].map((path) => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    // The store is the front door by instruction; the record is the reason.
    priority: path === "" ? 1 : path === "/store" ? 0.9 : path === "/seasons" ? 0.8 : 0.4,
  }));

  return [
    ...fixed,
    // A season's page settles when its last fixture is played. An archive-only
    // session with no game log on file has no honest date, and gets no claim.
    ...AVAILABLE_SEASONS.map((season) => {
      const settled = latestOf(seasonGames(season.sort).map((g) => g.session));
      return {
        url: `${SITE}${season.href}`,
        ...(settled ? { lastModified: settled } : {}),
        changeFrequency: "monthly" as const,
        priority: 0.8,
      };
    }),
    // The shop is the one part of this that really can move on any given day:
    // a price, a colourway or a line of copy changes whenever a sync runs.
    ...products.map((p) => ({
      url: `${SITE}/store/${p.id}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    // A player's page changes when he plays again, so it is as old as the last
    // session he appeared in.
    ...players.map((p) => {
      const lastSeen = latestOf(p.seasons.map((s) => s.session));
      return {
        url: `${SITE}/players/${p.slug}`,
        ...(lastSeen ? { lastModified: lastSeen } : {}),
        changeFrequency: "yearly" as const,
        priority: 0.6,
      };
    }),
    // A played game is the one thing on this site that can never change again.
    ...games.map((g) => {
      const on = playedOn(g.date);
      return {
        url: `${SITE}/games/${g.id}`,
        ...(on ? { lastModified: on } : {}),
        changeFrequency: "yearly" as const,
        priority: 0.5,
      };
    }),
  ];
}
