import { text, rowsOf, cellsOf } from "../html.ts";
import type { PlayerSeason, Phase } from "../types.ts";

/**
 * Parse a SportsEngine `stats/league_instance/<id>?subseason=<n>` page —
 * HarborCenter's LEAGUE-WIDE player statistics table.
 *
 * This is the only surviving reach into 2018-19 Fall/Winter, and the only
 * source that names anyone at all for Summer 2018. Both sessions were filed as
 * MISSING for the life of the project while these pages sat in the corpus
 * unread: nothing parsed them, so the seasons did not exist.
 *
 * These tables are NOT a team's roster. They are every player in the league,
 * ranked, and they carry three hazards that have each already cost this repo:
 *
 * 1. **The page is not evidence of the team.** Every row names its OWN team in
 *    its own cell, and a page that lists 1,220 players from 40-odd clubs will
 *    of course contain the string "Golden Retrievers" somewhere. Substring
 *    matching the whole page (`/Golden Retrievers/.test(html)`) once labelled
 *    Classic Cue's, Burners and 716 Realty as Retrievers — the exact three
 *    teams that are out of scope. The team belongs to the ROW. That is why
 *    this parser returns EVERY row and filters nothing: deciding whose row it
 *    is belongs to the build layer, which has `IS_GR` and the corpus context.
 *
 * 2. **The same man appears twice, on two teams, in one table.** Bryan
 *    Karchensky is #21 for The Golden Retrievers AND #12 for Classic Cue's
 *    Billiards on all three HAHL pages — 47-25-72 and 43-23-66 in 2018-19
 *    alone. Taking both silently doubles a career, and nothing downstream can
 *    tell that it happened.
 *
 * 3. **The team totals live in the same page, in the same stat vocabulary.**
 *    Alongside the player tables sit `team-sm-*` tables headed
 *    `Team | G | A | PTS | PEN | PIM` — "The Golden Retrievers | 42 | ...".
 *    A reader keyed on "has a PTS column" ingests the club as a PLAYER with a
 *    season's worth of team goals. The player tables are told apart
 *    STRUCTURALLY, by their `# | Name | Team` lead-in, not by their stats.
 *
 * SHAPE (verified against all 72 captured pages, 2,333 player rows):
 *
 *   <table id="player-sm-ice_hockey_skater-table" class="dataTable statTable">
 *     <tr><th>#</th><th>Name</th><th>Team</th><th>G</th>...</tr>
 *     <tr class="odd">
 *       <td class="jersey-number ">21</td>
 *       <td class="statPlayer " sorttable_customkey="Karchensky Bryan">
 *         <a ...>Bryan Karchensky</a><div style="display: inline-block"></div></td>
 *       <td class="statTeam " sorttable_customkey="The Golden Retrievers">
 *         <a class="teamName" ...>The Golden Retrievers</a></td>
 *       <td class="highlight">47</td><td class="">25</td>...
 *
 * THE COLUMNS ARE NOT FIXED. Twelve distinct header sets are in the corpus and
 * they differ by league AND by session:
 *
 *   2018-19 Fall/Winter  skater: # Name Team    G A PTS PEN PIM   <- NO GP
 *   2019-20              skater: # Name Team GP G A PTS PEN PIM
 *   2018-19 Fall/Winter  goalie: # Name Team GP W L GA
 *   2021 Spring          goalie: # Name Team GP W L T SOL GA SO
 *
 * So every stat is carried through verbatim under its own header rather than
 * mapped to a fixed schema. 2018-19 records no games played FOR ANYONE, and
 * per §2.4 that column is absent, not nought — a GP invented here would be a
 * fabricated statistic in a career total.
 *
 * ONLY PAGE 1 OF EACH TABLE WAS EVER ARCHIVED. The 2018-19 skater table says
 * "Page 1 of 41 — Displaying Results 1-30 of 1220", it is sorted by GOALS
 * descending, and the CDX index holds zero snapshots carrying a `page=`
 * parameter. What this source can return is therefore the league's top thirty
 * goalscorers and nobody else. Any roster built from it is a FRAGMENT, and the
 * build layer must say so rather than present it as a roster.
 */

/**
 * The page's own title: "Statistics - 2018-19 Fall/Winter - HAHL".
 *
 * Split on " - " and take the ends: the session sits between the word
 * "Statistics" and the league, and it contains hyphens of its own ("2018-19",
 * "2020-21"), so any hyphen-splitting pattern loses it. The league name is the
 * last part — "HAHL", but also "HarborCenter Mite League" and "Buffalo
 * Catholic Hockey League", which is how the four other leagues swept in by the
 * same crawl are told apart from ours.
 */
export function parseStatsTitle(title: string): { session: string; league: string } | null {
  const parts = title.split(" - ").map((s) => s.replace(/\s+/g, " ").trim());
  // "Statistics - <session> - <league>": fewer than three parts is some other
  // page that happens to have a title.
  if (parts.length < 3) return null;
  if (!/^statistics$/i.test(parts[0] ?? "")) return null;
  const league = parts[parts.length - 1] ?? "";
  const session = parts.slice(1, -1).join(" - ");
  if (!session || !league) return null;
  return { session, league };
}

/**
 * Which stat vocabulary a table speaks, from its COLUMNS ALONE.
 *
 * There is no position cell on these pages to ask, and the table `id`
 * (`player-sm-ice_hockey_goalie-table`) would answer — but the columns are the
 * thing that actually decides how the row must be read, and a header that
 * stops matching is a header this parser should refuse rather than guess at.
 *
 * PTS is the only positive skater signal that holds across all twelve header
 * sets. Wins identify a goalie: two of the captured goalie tables carry
 * neither GAA nor MIN (`# Name Team GP W L GA`) and two carry nothing but
 * wins (`# Name Team GP W` and `# Name Team W`), so the existing house tests —
 * `headers.includes("GAA") || headers.includes("MIN")` in `roster-player.ts`,
 * and `W && L` in `ownsite/roster-stats.ts` — both read those as SKATERS. That
 * is not a hypothetical: it is why HarborCenter's own goaltenders arrive in
 * the build as skaters with a games-played and no goals.
 *
 * `G` is deliberately not consulted. A goalie table has `GA` — goals against —
 * and any test looser than an exact column match reads a goaltender's worst
 * night as a scoring record.
 */
export function tableKind(headers: string[]): "skater" | "goalie" | null {
  if (headers.includes("PTS")) return "skater";
  if (headers.includes("W")) return "goalie";
  return null;
}

/**
 * The phase a league table covers.
 *
 * One `league_instance` + `subseason` is one phase, and the page's own season
 * selector names them: "Regular Season", "Fall/Winter", "2014-15 Playoffs".
 * Every HAHL page in the corpus is a regular-season subseason, which is also
 * the label `roster_players` pages use for the same seasons — so a league row
 * and a roster row for one man's season carry the same phase and can be told
 * to be the same thing.
 */
export function phaseOf(session: string): string {
  if (/playoff/i.test(session)) return "Playoffs";
  if (/Fall\/Winter/i.test(session)) return "Fall/Winter";
  return "Regular Season";
}

/**
 * One club's line from the league's TEAM statistics tables — the `team-sm-*`
 * tables hazard #3 above exists to keep OUT of the player read. This is the
 * reader that takes them in on purpose.
 *
 * Two of the four table vocabularies are carried; the other two are refused
 * by shape:
 *
 *   Team | GP? | G | A | PTS | ... PEN | PIM     -> "scoring"  (has PTS)
 *   Team | GP | [MIN] | GA | [GAA] | [SO]        -> "goalie"   (GA, no PTS)
 *   Team | 1 | 2 | 3 | Overtime | Total          -> skipped: period splits
 *   Team | GP | GPG | GAPG | PP | PK ...         -> skipped: derived rates
 *
 * Verbatim under their own headers, same as the player tables: Summer 2018's
 * scoring table has NO GP column, and a games-played invented for it would be
 * a fabricated statistic (§2.4). The page renders each table more than once
 * (viewport variants), so one line per (team, kind) is kept — the repeats are
 * the same table, not more evidence.
 */
export type TeamStatLine = {
  team: string;
  kind: "scoring" | "goalie";
  stats: Record<string, string>;
};

export function parseTeamStats(
  html: string,
): { session: string; league: string; teams: TeamStatLine[] } | null {
  const raw = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const t = raw ? parseStatsTitle(text(raw)) : null;
  if (!t) return null;

  const seen = new Map<string, TeamStatLine>();
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const trs = rowsOf(table);
    const headers = cellsOf(trs[0] ?? "");
    // A TEAM table leads "Team". The player tables lead "# | Name | Team" and
    // are the other parser's business — the same positional contract, read
    // from the other side.
    if (headers[0] !== "Team" || headers.length < 2) continue;
    if (headers.includes("1") || headers.includes("GPG")) continue;
    const kind = headers.includes("PTS")
      ? ("scoring" as const)
      : headers.includes("GA")
        ? ("goalie" as const)
        : null;
    if (!kind) continue;

    for (const tr of trs.slice(1)) {
      const c = cellsOf(tr);
      if (c.length !== headers.length) continue;
      const team = c[0] ?? "";
      if (!team) continue;
      const key = `${team}|${kind}`;
      if (seen.has(key)) continue;
      const stats: Record<string, string> = {};
      for (let i = 1; i < headers.length; i++) {
        const k = headers[i];
        if (k) stats[k] = c[i] ?? "";
      }
      seen.set(key, { team, kind, stats });
    }
  }
  return { session: t.session, league: t.league, teams: [...seen.values()] };
}

/**
 * Parse one captured league statistics page into PlayerSeason rows.
 *
 * Returns EVERY player row on the page, every team, unfiltered — including
 * both of Bryan Karchensky's. Identity and ownership are not this layer's
 * business (§2.5) and the evidence must survive the read.
 */
export function parseLeagueStats(
  html: string,
  fallback?: { session: string; league: string },
): PlayerSeason[] {
  const raw = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const t = (raw ? parseStatsTitle(text(raw)) : null) ?? fallback ?? null;
  if (!t) return [];
  const label = phaseOf(t.session);

  const out: PlayerSeason[] = [];

  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const trs = rowsOf(table);
    const headers = cellsOf(trs[0] ?? "");

    // A PLAYER table leads "# | Name | Team". The team-totals tables on this
    // same page lead "Team | ..." and otherwise speak the identical stat
    // vocabulary, down to PTS and PIM. This positional contract is the ONLY
    // thing separating "Bryan Karchensky, 47 goals" from "The Golden
    // Retrievers, 42 goals" — a club, ingested as a man.
    if (headers[0] !== "#" || headers[1] !== "Name" || headers[2] !== "Team") continue;

    const kind = tableKind(headers);
    if (!kind) continue;

    for (const tr of trs.slice(1)) {
      const c = cellsOf(tr);
      // A row that does not match its header is not a stat row. Skipping beats
      // misaligning every column after the short one (§2.9).
      if (c.length !== headers.length) continue;

      const name = c[1] ?? "";
      const team = c[2] ?? "";
      // A row with no name or no team cannot be attributed to anybody, and an
      // unattributable stat line is worse than no stat line.
      if (!name || !team) continue;

      const stats: Record<string, string> = {};
      // Columns 0-2 are jersey, name and team — identity, not statistics.
      for (let i = 3; i < headers.length; i++) {
        const key = headers[i];
        if (key) stats[key] = c[i] ?? "";
      }

      const phase: Phase = {
        label,
        // A leaderboard row is one player's line in one subseason. There are no
        // "Totals" rows to guard against here — the aggregates on this page are
        // the team tables, which are excluded above by their shape.
        isAggregate: false,
        kind,
        stats,
      };

      out.push({
        team,
        session: t.session,
        jersey: c[0] ?? "",
        // The name as the league printed it. The cell also carries
        // sorttable_customkey="Karchensky Bryan" — a canonical "Last First"
        // that is tempting and wrong: every other source in the archive, and
        // the name matcher that has to reconcile them, speaks "First Last".
        name,
        // No position column exists on these pages. Absent is absent (§2.4);
        // "" would be a claim that the league recorded one and left it blank.
        position: null,
        dob: null,
        weight: null,
        phases: [phase],
      });
    }
  }

  return out;
}
