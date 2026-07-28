import { text, rowsOf } from "../html.ts";

/**
 * Parse SportsEngine schedule pages.
 *
 * The game sheets are richer, but they cannot answer two questions on their
 * own, and both matter:
 *
 * 1. **Is this list complete?** A sheet knows about itself and nothing else.
 *    The team's own season schedule (`schedule/team_instance/<id>`) lists
 *    every game the team played, so it is the only thing in the archive that
 *    can prove no game is missing — and for 2016-17 and 2017-18 it does.
 *
 * 2. **Which games were playoffs?** Nine sheets in the corpus carry a final
 *    score and no goals whatsoever. That looked like rot until the schedule
 *    named them: every one is labelled "Semi 1", "Final 2", and so on. The
 *    absence is not damage. Erie Metro simply stopped writing goals down in
 *    March, twice, and the label is the only surviving evidence of why.
 *
 * The day pages (`schedule/day/league_instance/<id>`) are the other half:
 * they are the ONLY record of the team's Summer 2018 season, which has no
 * sheets, no roster, and no session anywhere else in the archive.
 */

/** One row of a team's own season schedule. */
export type TeamScheduleRow = {
  /** SportsEngine game id — joins to `game/game_sheet/<id>`. */
  gameId: string;
  /**
   * The round label, verbatim: "Semi 1", "Semi2 Final", "Final1", "Final 2".
   *
   * Read from the column headed **"Game ID"**, which does not contain one.
   * Erie Metro typed the round into a free-text field meant for something
   * else, which is why the labels are spelled four different ways and why
   * this is the only evidence in the archive that nine games were playoffs.
   *
   * Empty on a regular-season game. Not normalised: the inconsistency is the
   * source's, and tidying it would hide that a human typed it.
   */
  round: string;
  /** "Mon Sep 19" — verbatim, and note it carries NO YEAR. */
  date: string;
  /** "W 13-2" / "L 5-8" — the team's own score first. */
  result: string;
  /** "@ Financial Forester" for an away game; "Hammers" for a home one. */
  opponent: string;
};

export type TeamSchedule = {
  /** "Golden Retrievers", from the page title. */
  team: string | null;
  /** "2016-17 Regular Season", from the page title. */
  session: string | null;
  rows: TeamScheduleRow[];
};

/** One row of a league's day schedule. */
export type DayScheduleRow = {
  gameId: string;
  awayTeam: string;
  /** Null when unplayed: the sheet prints an en-dash, which is not nought. */
  awayScore: string | null;
  homeTeam: string;
  homeScore: string | null;
  /** "New Wave Energy Rink 2". */
  rink: string;
  /** "Postponed", or "" for a completed game. Verbatim. */
  status: string;
};

export type DaySchedule = {
  /** "8/14/2018" — from the title, and the only place the date appears. */
  date: string | null;
  /** "HAHL 2018 Spring/Summer Regular Season" — from the title. */
  league: string | null;
  rows: DayScheduleRow[];
};

/** Every `<tr id="game_list_row_N">` with its id and class list. */
function gameRows(html: string): { id: string; cls: string; html: string }[] {
  const out: { id: string; cls: string; html: string }[] = [];
  for (const m of html.matchAll(/<tr id="game_list_row_(\d+)"([^>]*)>([\s\S]*?)<\/tr>/g)) {
    out.push({ id: m[1]!, cls: m[2]!.match(/class="([^"]*)"/)?.[1] ?? "", html: m[0]! });
  }
  return out;
}

const cells = (row: string) => (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(text);

/**
 * Column headings of the table that holds the game rows.
 *
 * Columns MUST be located by heading, never by position. The corpus carries
 * two different team-schedule shapes — one with a leading "Game ID" column
 * and one without — and reading by index parses "Fri Jun 8" as a round label
 * and "L 3-8" as a date on the second of them, without failing.
 */
function headersOf(html: string): string[] {
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    if (!/game_list_row/.test(table)) continue;
    const header = rowsOf(table).find((r) => /<th[\s>]/.test(r));
    if (!header) continue;
    return (header.match(/<th[^>]*>[\s\S]*?<\/th>/g) ?? []).map(text);
  }
  return [];
}

/**
 * Parse `schedule/team_instance/<id>` — one team's whole season.
 *
 * Title: "Game Schedule - 2016-17 Regular Season - Golden Retrievers".
 */
export function parseTeamSchedule(html: string): TeamSchedule | null {
  const title = text(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  if (!/^Game Schedule/i.test(title)) return null;

  // "Game Schedule - <session> - <team>". The team is last: a session label
  // can itself contain " - ", and splitting from the front loses the team.
  const parts = title.replace(/^Game Schedule\s*-\s*/i, "").split(" - ");
  const team = parts.length > 1 ? parts.at(-1)!.trim() : null;
  const session = parts.length > 1 ? parts.slice(0, -1).join(" - ").trim() : null;

  const h = headersOf(html);
  const iDate = h.indexOf("Date");
  const iResult = h.indexOf("Result");
  const iOpp = h.indexOf("Opponent");
  // "Game ID" is where the round label lives. Absent on the other shape.
  const iRound = h.indexOf("Game ID");
  if (iDate === -1 || iResult === -1) return { team, session, rows: [] };

  const rows: TeamScheduleRow[] = [];
  for (const r of gameRows(html)) {
    const v = cells(r.html);
    const date = v[iDate];
    const result = v[iResult];
    if (!date || !result) continue;
    rows.push({
      gameId: r.id,
      round: (iRound === -1 ? "" : v[iRound]) ?? "",
      date,
      result,
      opponent: (iOpp === -1 ? "" : v[iOpp]) ?? "",
    });
  }
  return { team, session, rows };
}

/**
 * Parse `schedule/day/league_instance/<id>` — every game on one date.
 *
 * Title: "Game Schedule - 8/14/2018 - HAHL 2018 Spring/Summer Regular Season".
 */
export function parseDaySchedule(html: string): DaySchedule | null {
  const title = text(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  if (!/^Game Schedule/i.test(title)) return null;

  const m = title.match(/^Game Schedule\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(.*)$/i);
  if (!m) return null;

  // "Visitor" / "V" / "Home" / "H" — the score columns are headed with a
  // single letter, which is why they are found by name and not by counting.
  const h = headersOf(html);
  const iAway = h.indexOf("Visitor");
  const iAwayScore = h.indexOf("V");
  const iHome = h.indexOf("Home");
  const iHomeScore = h.indexOf("H");
  const iRink = h.indexOf("Location");
  const iStatus = h.indexOf("Status");
  if (iAway === -1 || iHome === -1) return { date: m[1]!, league: m[2]!.trim(), rows: [] };

  const rows: DayScheduleRow[] = [];
  for (const r of gameRows(html)) {
    const v = cells(r.html);
    const awayTeam = v[iAway];
    const homeTeam = v[iHome];
    if (!awayTeam || !homeTeam) continue;
    // A score cell reads "-" on anything unplayed. Nought is a real result
    // here — 716 Realty Group actually lost 13-0 — so the two must not merge.
    const score = (x: string | undefined) => (x === undefined || x === "" || x === "-" ? null : x);
    const status = iStatus === -1 ? "" : v[iStatus] ?? "";
    rows.push({
      gameId: r.id,
      awayTeam,
      awayScore: score(v[iAwayScore]),
      homeTeam,
      homeScore: score(v[iHomeScore]),
      rink: (iRink === -1 ? "" : v[iRink]) ?? "",
      // The visible cell is blank on a completed game; the row's CLASS is
      // where the state actually lives.
      status: status || (/\bpostponed\b/.test(r.cls) ? "Postponed" : ""),
    });
  }
  return { date: m[1]!, league: m[2]!.trim(), rows };
}
