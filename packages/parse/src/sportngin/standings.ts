import { text, rowsOf, cellsOf } from "../html.ts";

/**
 * Parse a SportsEngine `standings/show/<id>?subseason=<n>` page — the league's
 * own standings tables, one table per division under an `<h4>` heading.
 *
 * This family is what a season looks like when everything else is gone. Two
 * of them are the ONLY surviving record of entire halves of this team's
 * history:
 *
 * - Summer 2019: no roster, no games, no player line anywhere — the team's
 *   twelve games survive as ONE ROW of the Silver table, captured three times
 *   as the league updated it. The archive listed the season as "played,
 *   nothing survives" for the life of the project while these bytes sat in
 *   the corpus.
 * - 2020-21 ("2021 Spring HAHL", the pandemic half): captured mid-season on
 *   20 April 2021 and never migrated to the league's next platform, so the
 *   snapshot is the ceiling — there is no final table anywhere to prefer.
 *
 * SHAPE (verified against all 69 captured standings pages):
 *
 *   <h4>Silver  - 2019 Spring/Summer Regular Season</h4>
 *   <table class="statTable ...">
 *     <thead><tr><th>Team</th><th>Team</th><th>GP</th><th>W</th>...</tr></thead>
 *     <tr id='standing_4626809_603556' class='odd'>
 *       <td class="name expandedView">...The Golden Retrievers...</td>
 *       <td class="name condensedView">...The Golden Retrievers...</td>
 *       <td class="expandedView">12</td><td>5</td>...
 *
 * The rules this parser inherits from the rest of the family:
 *
 * - **The page is not evidence of the team.** A standings page lists a whole
 *   league; the same Wayback crawl swept in the Mite league, the BEHL, a
 *   Catholic league and four club sites serving the identical tables. Every
 *   row names its own team in its own cell and EVERY row is returned; whose
 *   row it is belongs to the build layer (§2.5).
 * - **The columns are not fixed.** Summer 2018's table carries an SO column
 *   the later seasons drop, and Erie Metro's standings speak a different
 *   vocabulary again (`OTL PTS For Against +/- L10`). Every stat is carried
 *   verbatim under its own header rather than mapped to a schema.
 * - **Two leading Team cells, not one.** The platform renders the club twice
 *   (expanded and condensed view); both are identity, neither is a stat, and
 *   a reader that takes headers[1] as a column shifts every number one place.
 *
 * The division comes from the heading the league itself printed. Rows keep
 * their table ORDER — the platform sorts by points, so position in the table
 * IS the standing, and the build derives "4th of 7" from nothing but the row
 * index the league published.
 */

export type StandingRow = {
  /** The club, from the row's own first Team cell. */
  team: string;
  /** The division heading this table sits under: "Silver", "Bronze B". */
  division: string;
  /** 1-based position in the division table, in the league's own order. */
  place: number;
  /** How many rows the division table holds. */
  of: number;
  /** Every stat cell verbatim under its own header: GP W L OTW OTL PTS GF GA
   *  DIFF, the occasional SO, and "Division" — the platform's name for the
   *  composite record column ("5-7-0-0-0"). */
  stats: Record<string, string>;
};

export type Standings = {
  /** "2019 Spring/Summer Regular Season" — from the page's own title. */
  session: string;
  /** The SITE serving the page — "HAHL" on the league site, but also "District
   *  5" and "Golden Retrievers": every club site serves the same tables. NOT
   *  reliable as a league name, which is why it is called what it is. */
  site: string;
  rows: StandingRow[];
};

/**
 * The page's own title: "Standings - 2019 Spring/Summer Regular Season - HAHL".
 *
 * Same contract as `parseStatsTitle` next door: split on " - " and take the
 * ends, because the session between them contains hyphens of its own
 * ("2018-19 Fall/Winter"). The last part is the serving site.
 */
export function parseStandingsTitle(title: string): { session: string; site: string } | null {
  const parts = title.split(" - ").map((s) => s.replace(/\s+/g, " ").trim());
  if (parts.length < 3) return null;
  if (!/^standings$/i.test(parts[0] ?? "")) return null;
  const site = parts[parts.length - 1] ?? "";
  const session = parts.slice(1, -1).join(" - ");
  if (!session || !site) return null;
  return { session, site };
}

/** The division out of its heading: "Silver  - 2019 Spring/Summer ..." ->
 *  "Silver". The session suffix is dropped by name where it matches, and by
 *  the first " - " otherwise — no captured division contains one. */
function divisionOf(heading: string, session: string): string {
  const h = text(heading);
  if (session && h.endsWith(session)) {
    return h.slice(0, h.length - session.length).replace(/\s*-\s*$/, "").trim();
  }
  return h.split(" - ")[0]!.trim();
}

export function parseStandings(html: string): Standings | null {
  const raw = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const t = raw ? parseStandingsTitle(text(raw)) : null;
  if (!t) return null;

  const rows: StandingRow[] = [];

  // Walk the page one division at a time: each <h4> heading owns the tables
  // that follow it, up to the next heading. Anchoring rows to their OWN
  // heading is what stops a Silver row from being read as Bronze — the exact
  // class of shift this family's parsers exist to refuse.
  const sections = html.split(/<h4[^>]*>/).slice(1);
  for (const section of sections) {
    const headEnd = section.indexOf("</h4>");
    if (headEnd === -1) continue;
    const division = divisionOf(section.slice(0, headEnd), t.session);
    if (!division) continue;

    // One division's rows across its tables, in the order the league printed.
    const divRows: { team: string; stats: Record<string, string> }[] = [];

    for (const table of section.slice(headEnd).match(/<table[\s\S]*?<\/table>/g) ?? []) {
      const trs = rowsOf(table);
      const headers = cellsOf(trs[0] ?? "");
      // A standings table leads "Team | Team": the club rendered twice, for
      // two viewport widths. Anything else here — a schedule, a nav strip —
      // is not standings and is refused rather than guessed at.
      if (headers[0] !== "Team" || headers[1] !== "Team") continue;

      for (const tr of trs.slice(1)) {
        // Only the platform's own standing rows: each carries its id in the
        // markup ("standing_4626809_603556"). Header repeats and spacer rows
        // do not, and are not rows of the table in any sense that counts.
        if (!/id=['"]standing_/.test(tr)) continue;
        const c = cellsOf(tr);
        // A row that does not match its header is not a stat row. Skipping
        // beats misaligning every column after the short one (§2.9).
        if (c.length !== headers.length) continue;

        // The club, from whichever of its two identity cells has the name —
        // the expanded cell is empty on some club-site renderings.
        const team = c[0] || c[1] || "";
        if (!team) continue;

        const stats: Record<string, string> = {};
        for (let i = 2; i < headers.length; i++) {
          const key = headers[i];
          if (key) stats[key] = c[i] ?? "";
        }
        divRows.push({ team, stats });
      }
    }

    for (let i = 0; i < divRows.length; i++) {
      rows.push({
        team: divRows[i]!.team,
        division,
        place: i + 1,
        of: divRows.length,
        stats: divRows[i]!.stats,
      });
    }
  }

  return { session: t.session, site: t.site, rows };
}
