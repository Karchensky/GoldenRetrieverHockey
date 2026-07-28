/**
 * THE CLUB'S OWN HONOURS, FREE-TYPED ONTO ITS SPORTSENGINE TEAM PAGE.
 *
 * Erie Metro publishes no trophy-case field. What it publishes is a rich-text
 * box, and somebody put two championship claims into this club's:
 *
 *     <h3>2016-17 EMHL Norris Division President's Trophy Champions</h3>
 *     <h3>Golden Retreivers</h3> … <strong>2016-17 Adams Division Champions</strong>
 *
 * THEY NAME TWO DIFFERENT DIVISIONS FOR ONE SEASON, which is why nothing read
 * them for a year. This parser does not resolve that and must not: it reports
 * what is typed on the page, with the division each claim names carried as its
 * own field, and the build decides which claims it can stand behind by
 * checking them against the league's own standings row. See the honours block
 * in `generate.ts`.
 *
 * The refusal test is the same one `parseTrophyCase` uses on the club's dead
 * site — a claim needs a year and one of Champion / Trophy / Runner / Finalist
 * — so the page's other headings ("2017-18 Erie Metro Hockey League Schedule",
 * "Recent 23 Golden Retrievers News") are not honours and never arrive here.
 */

import { text } from "../html.ts";

export type TeamPageClaim = {
  /** "2016-17" — the season as the club typed it. */
  season: string;
  /**
   * The division this claim names — "Adams", "Norris" — or null where it names
   * none.
   *
   * THE FIELD THE WHOLE ROUTE EXISTS FOR. Two claims on one page name two
   * different divisions for the same season, and a reader that flattened them
   * to their text would have to pick between them with nothing to pick on.
   */
  division: string | null;
  /** "EMHL", where the claim names a league. Null where it does not. */
  league: string | null;
  /** The claim with the season stripped: "Adams Division Champions". */
  title: string;
  /** The whole line, verbatim, exactly as it is typed on the page. */
  recorded: string;
};

/** A claim is a claim only if it says one of these. Same set as the trophy case. */
const HONOUR = /Champion|Trophy|Runner|Finalist/i;

/** A season, spelled any of the ways this club spells one. */
const SEASON = /^(\d{4}(?:\s*[/-]\s*(?:\d{4}|\d{2}))?)\s+(.*)$/;

const DIVISION = /\b([A-Z][A-Za-z']+)\s+Division\b/;

const LEAGUE = /\b(EMHL|LSHL|PxHL|HAHL|LAHL|Performax)\b/i;

/**
 * Every honour claim typed into this page's text blocks.
 *
 * Read out of `<h1>`–`<h6>`, `<strong>` and `<em>` — the four things a person
 * reaches for in a rich-text box to say "we won something". A whole `<p>` is
 * deliberately NOT one: the claim here sits inside a `<p>` that also carries
 * the emphasis markup, and reading both levels would report the same honour
 * twice under two spellings.
 */
export function parseTeamPageClaims(html: string): TeamPageClaim[] {
  const blocks = html.match(/<div class="pageElement textBlockElement[^"]*"[\s\S]*?<span class="clearAll">/gi)
    ?? [html];

  const out: TeamPageClaim[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    for (const m of block.matchAll(/<(h[1-6]|strong|em)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const recorded = text(m[2]!);
      if (!recorded || !HONOUR.test(recorded)) continue;

      const s = recorded.match(SEASON);
      if (!s) continue;

      // "2016 - 17" and "2016/17" are the same season written two ways. The
      // spacing is the typist's; the season is not.
      const season = s[1]!.replace(/\s*([/-])\s*/, "$1");
      const rest = s[2]!.trim();
      if (seen.has(`${season}|${rest}`)) continue;
      seen.add(`${season}|${rest}`);

      const leagueM = rest.match(LEAGUE);
      out.push({
        season,
        division: rest.match(DIVISION)?.[1] ?? null,
        league: leagueM ? leagueM[1]!.toUpperCase() : null,
        // The league prefix comes off the title the same way the trophy case
        // takes it off: it is carried in its own field, not said twice.
        title: leagueM && rest.startsWith(leagueM[0]!)
          ? rest.slice(leagueM[0]!.length).trim()
          : rest,
        recorded,
      });
    }
  }

  return out;
}
