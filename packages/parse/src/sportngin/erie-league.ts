import { text, rowsOf, cellsOf } from "../html.ts";

/**
 * Parse an Erie Metro LEAGUE-WIDE skater table — every player in the EMHL, one
 * season, ranked. The source of a Retriever's standing against the whole league
 * in the 2016-18 era, the way `digitalshift/leaders.ts` is for the modern one.
 *
 * These pages are SortsEngine's, and they carry two traps this platform is
 * known for (see `sportngin.ts`):
 *
 * 1. THE TEAM IS AN ABBREVIATION IN THE VISIBLE CELL. The Golden Retrievers
 *    render as "83". The real name lives in the team cell's own
 *    `sorttable_customkey` / `title` attribute, so the team is read from THERE —
 *    the same "the team belongs to the row, never the page" rule the league
 *    tables everywhere in this repo are held to. Reading the visible text would
 *    make every Retriever's team "83" and match nothing.
 *
 * 2. THE COLUMNS ARE NOT FIXED. `# Name Team GP G A PTS PIM GW` is the 2016-18
 *    skater shape, but a goalie table on the same id speaks `GP MIN W L ...`, so
 *    stats are read by HEADER and a table without PTS is refused rather than
 *    misread. (The capture requests `stat_module=ice_hockey_skater`, so in
 *    practice only the skater table is present, but the guard is cheap.)
 *
 * Rank is NOT read off these rows: the page is points-sorted, and a standing in
 * goals, assists or penalty minutes is computed off the whole field by the
 * build. Every row already carries all four, which is why one sort suffices.
 */

export type ErieSkater = {
  name: string;
  /** The team's real name, from the row's own attribute — "Golden Retrievers",
   *  never the "83" abbreviation the cell shows. */
  team: string;
  gp: number | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pim: number | null;
};

const num = (s: string | undefined): number | null => {
  // "" is NOT 0 — an untracked column must never become a zero (§2.4).
  if (s === undefined || s.trim() === "") return null;
  const v = Number(s.trim());
  return Number.isFinite(v) ? v : null;
};

export function parseErieLeagueSkaters(html: string): ErieSkater[] {
  const out: ErieSkater[] = [];
  // The SPA renders the scrollable table twice (a responsive clone); a player
  // therefore appears more than once. Dedup on name AND team — two different
  // people can share a name across teams, and both are real.
  const seen = new Set<string>();

  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const trs = rowsOf(table);
    const headers = cellsOf(trs[0] ?? "");
    // A player table leads "# | Name | Team"; anything else is a team-totals or
    // some other table and is skipped.
    if (headers[0] !== "#" || headers[1] !== "Name" || headers[2] !== "Team") continue;
    // PTS is the skater signal that holds across the shapes; a goalie table has
    // GA/GAA and no PTS, and reading it here would put saves in a goals column.
    if (!headers.includes("PTS")) continue;

    const iGp = headers.indexOf("GP");
    const iG = headers.indexOf("G");
    const iA = headers.indexOf("A");
    const iP = headers.indexOf("PTS");
    const iPim = headers.indexOf("PIM");

    for (const tr of trs.slice(1)) {
      const raw = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
      // A row that does not match its header is not a stat row. Skipping beats
      // misaligning every column after the short one (§2.9).
      if (raw.length !== headers.length) continue;

      // Name from the player anchor, not the whole cell (which may also carry a
      // position note).
      const name = text(raw[1]!.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? raw[1]!);
      if (!name) continue;

      // Team from the row's OWN attribute — customkey first, then the anchor
      // title, and only then the visible cell (the abbreviation) as a last resort.
      const team =
        raw[2]!.match(/sorttable_customkey="([^"]*)"/)?.[1] ??
        raw[2]!.match(/title="([^"]*)"/)?.[1] ??
        text(raw[2]!);

      const key = `${name}|${team}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const at = (i: number) => (i >= 0 ? num(text(raw[i] ?? "")) : null);
      out.push({ name, team, gp: at(iGp), g: at(iG), a: at(iA), pts: at(iP), pim: at(iPim) });
    }
  }
  return out;
}
