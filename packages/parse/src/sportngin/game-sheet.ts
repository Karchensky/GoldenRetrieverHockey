import { text, cellsOf, rowsOf } from "../html.ts";

/**
 * Parse a SportsEngine `game/game_sheet/<id>` page.
 *
 * The richest source in the archive. A sheet carries goal times, the scorer,
 * PRIMARY AND SECONDARY ASSISTS IN ORDER, strength state, penalties, shots by
 * period, and per-team box scores.
 *
 * The ordered assists are what make teammate chemistry and line combinations
 * computable rather than invented: an assist is a directed edge from a
 * passer to a scorer, and 167 sheets is a decade of them.
 */

/** A goal, with its ordered assists. */
export type GoalEvent = {
  /** "1st", "2nd", "3rd", "OT" — from the section heading. */
  period: string;
  /** Clock time as recorded, e.g. "4:01". Raw: never converted here. */
  time: string;
  /** Team AS RECORDED on the row. */
  team: string;
  scorer: string;
  /**
   * Assists IN SOURCE ORDER: primary first, then secondary.
   *
   * Order is meaningful and must never be sorted — a primary assist is a
   * different act from a secondary one.
   */
  assists: string[];
  /** "even strength", "power play", "short handed", ... as recorded. */
  strength: string | null;
};

export type PenaltyEvent = {
  period: string;
  time: string;
  team: string;
  /** The whole detail cell, verbatim: player, infraction and duration. */
  detail: string;
};

export type GoalieLine = {
  team: string;
  jersey: string;
  name: string;
  /** Verbatim, e.g. "45:00". */
  minutes: string;
  /**
   * The column LABELLED "Sh".
   *
   * Verified against the corpus: this holds GOALS AGAINST, not shots — its
   * value equals the opposing team's final score. The label is wrong at the
   * source. Named honestly here rather than propagating the lie.
   */
  shotsLabelled: string;
  /**
   * The column labelled "Sv".
   *
   * Observed to be "0" universally. Owner-confirmed: saves are not recorded
   * in these leagues. Per §2.4 this is UNTRACKED, not zero — a distinction
   * this layer preserves and must not resolve.
   */
  savesLabelled: string;
  /** "WIN" / "LOSS" / "" as recorded. */
  decision: string;
};

/**
 * One team's row of the box score: goals by period, then the final.
 *
 * A value is `null` where the sheet printed "-". That is not nought (§2.4):
 * every playoff sheet in the corpus prints a dash in all four cells, and a
 * 13-0 win rendered as four zeroes would be a fabrication.
 */
export type LinescoreRow = {
  team: string;
  /** Goals per period, aligned to `periodLabels`. */
  periods: (string | null)[];
  final: string | null;
};

export type GameSheet = {
  /** Title verbatim: "Golden Retrievers 11 at Dark Knights 4 (Final)". */
  title: string;
  awayTeam: string;
  awayScore: string;
  homeTeam: string;
  homeScore: string;
  /** True when the title says "(Final)". */
  final: boolean;
  /**
   * The sheet's own Date field, VERBATIM: "Sep 19, 2016".
   *
   * Note the abbreviation — `sessions.parseGameDate` wants a full month name
   * and returns null for eleven months out of twelve against these strings.
   */
  date: string | null;
  /** Verbatim: "10:50 PM EST". */
  time: string | null;
  /** Verbatim. Recorded on only a handful of sheets; blank on the rest. */
  location: string | null;
  /**
   * Verbatim: "Final" or "Final/OT".
   *
   * The TITLE says "(Final)" on every sheet including the overtime ones, so
   * `final` cannot tell you a game went past regulation. Only this can.
   */
  status: string | null;
  /** Box-score column headings, less the total: ["1","2","3"] or ["1","2","3","OT1"]. */
  periodLabels: string[];
  linescore: LinescoreRow[];
  /**
   * The team credited with a shootout win.
   *
   * These leagues settle a tie with a shootout, and the sheet records it as a
   * scoring row with NO TIME and NO SCORER reading "Shootout Won" — worth one
   * goal on the scoreboard and attributable to nobody. It is deliberately not
   * a `GoalEvent`: no player did it, and inventing a scorer to make the goals
   * add up to the score would be exactly the wrong repair.
   */
  shootoutWinner: string | null;
  /**
   * False when the sheet carries NO period summaries at all.
   *
   * Not a parse failure — a real and total absence. Every such sheet in the
   * corpus is a playoff game, and on those the score survives only in the
   * page title; even the box score is dashes.
   */
  hasScoringDetail: boolean;
  goals: GoalEvent[];
  penalties: PenaltyEvent[];
  goalies: GoalieLine[];
};

/**
 * Title shape: "<Away> <n> at <Home> <m> (Final) | Ice Hockey Game Sheet".
 *
 * Team names contain digits ("913 Whalers", "716 Realty Group"), so a lazy
 * number match binds to the wrong token. Anchor on " at " and take the LAST
 * number of each side.
 */
export function parseGameTitle(title: string): {
  awayTeam: string;
  awayScore: string;
  homeTeam: string;
  homeScore: string;
  final: boolean;
} | null {
  // Decode first. The <title> is transport-encoded while the team name on
  // every goal row below it is not, so "M&amp;M Forwarding" here and
  // "M&M Forwarding" there are the same club — and grouping a box score by
  // team silently drops one side of that game unless they are made to agree.
  const head = text(title.split("|")[0] ?? "");
  const final = /\(Final\)/i.test(head);
  const body = head.replace(/\s*\(.*?\)\s*$/, "").trim();

  const at = body.lastIndexOf(" at ");
  if (at === -1) return null;

  const split = (side: string) => {
    const m = side.trim().match(/^(.*?)\s+(\d+)$/);
    return m ? { team: m[1]!.trim(), score: m[2]! } : null;
  };
  const away = split(body.slice(0, at));
  const home = split(body.slice(at + 4));
  if (!away || !home) return null;

  return {
    awayTeam: away.team,
    awayScore: away.score,
    homeTeam: home.team,
    homeScore: home.score,
    final,
  };
}

/**
 * Split an event detail cell into scorer, strength and ordered assists.
 *
 * Shape: "Dave Demizio Goal (even strength) <em>Assists: A, B</em>"
 */
export function parseScoringDetail(detailHtml: string): {
  scorer: string;
  strength: string | null;
  assists: string[];
} {
  const assistsRaw = detailHtml.match(/Assists?:([^<]*)/i)?.[1] ?? "";
  const assists = assistsRaw
    .split(",")
    .map((s) => text(s))
    .filter((s) => s.length > 0);

  // Everything before the <em>Assists...</em> block is the goal line.
  const goalLine = text(detailHtml.replace(/<em>[\s\S]*?<\/em>/gi, ""));
  const strength = goalLine.match(/\(([^)]*)\)/)?.[1]?.trim() ?? null;
  const scorer = goalLine
    .replace(/\(.*?\)/g, "")
    .replace(/\bGoal\b.*$/i, "")
    .trim();

  return { scorer, strength, assists };
}

/** Section headings mark periods: "<h3>1st Period Summary</h3>". */
function periodOf(heading: string): string {
  return text(heading).replace(/period summary/i, "").trim();
}

/** A field of the `<ul id="game_details">` block: Date, Time, Location, Status. */
function detail(html: string, id: string): string | null {
  const v = html.match(new RegExp(`<span id="${id}">([^<]*)</span>`))?.[1];
  const s = v === undefined ? "" : text(v);
  // The Location span is PRESENT and EMPTY on most sheets. An empty field is
  // not a recorded blank; it is nothing, and it must not become "".
  return s === "" ? null : s;
}

export function parseGameSheet(html: string): GameSheet | null {
  const rawTitle = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
  if (!rawTitle || !/game sheet/i.test(rawTitle)) return null;
  const t = parseGameTitle(rawTitle);
  if (!t) return null;
  const title = text(rawTitle.split("|")[0] ?? "");

  const goals: GoalEvent[] = [];
  const penalties: PenaltyEvent[] = [];
  let shootoutWinner: string | null = null;

  // Each period is an <h3>Nth Period Summary</h3> followed by a scoring table
  // and a penalty table. Walk headings so events keep their period.
  const sections = html.split(/<h3[^>]*>/).slice(1);
  for (const section of sections) {
    const heading = section.slice(0, section.indexOf("</h3>"));
    if (!/period summary/i.test(heading)) continue;
    const period = periodOf(heading);

    for (const table of section.match(/<table[\s\S]*?<\/table>/g) ?? []) {
      // A period is ONE table holding scoring rows AND penalty rows, separated
      // by an interior <th> header row ("Penalty Detail") rather than by a
      // table boundary. So mode must be tracked per ROW, not per table.
      // Reading only the first header and applying it to the whole table makes
      // penalty durations ("0:0", "10:00") parse as goal strength states.
      let mode: "scoring" | "penalty" | null = null;

      for (const tr of rowsOf(table)) {
        const isHeaderRow = /<th[\s>]/.test(tr);
        if (isHeaderRow) {
          const h = cellsOf(tr);
          if (h.some((x) => /scoring detail/i.test(x))) mode = "scoring";
          else if (h.some((x) => /penalty detail/i.test(x))) mode = "penalty";
          else mode = null;
          continue;
        }
        if (!mode) continue;

        const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
        if (tds.length < 3) continue;
        const time = text(tds[0]!);
        const team = text(tds[1]!);
        if (!team) continue;

        if (mode === "scoring") {
          // The shootout row comes BEFORE the empty-time guard, and must.
          // It is the one scoring row the sheets file with no clock, so a
          // guard that reads "no time, not an event" throws away the only
          // record of how four games in this corpus were actually decided.
          if (/^shootout\b/i.test(text(tds[2]!))) {
            shootoutWinner = team;
            continue;
          }
          if (!time) continue;
          const d = parseScoringDetail(tds[2]!);
          if (!d.scorer) continue;
          goals.push({ period, time, team, ...d });
        } else {
          if (!time) continue;
          penalties.push({ period, time, team, detail: text(tds[2]!) });
        }
      }
    }
  }

  // Box score: "<h3>Team</h3> ... <h4>Goalies</h4><table>...".
  const goalies: GoalieLine[] = [];
  for (const m of html.matchAll(/<h3[^>]*>([^<]*)<\/h3>([\s\S]*?)(?=<h3|$)/g)) {
    const team = text(m[1]!);
    if (!team || /period summary|shots on goal|power plays/i.test(team)) continue;
    const gm = m[2]!.match(/<h4[^>]*>\s*Goalies\s*<\/h4>\s*(<table[\s\S]*?<\/table>)/i);
    if (!gm) continue;
    for (const tr of rowsOf(gm[1]!).slice(1)) {
      const v = cellsOf(tr);
      // "Totals:" rows are aggregates and have a different arity (§2.8.1).
      if (v.length < 6 || /totals?:/i.test(v[0] ?? "")) continue;
      goalies.push({
        team,
        jersey: v[0] ?? "",
        name: v[1] ?? "",
        minutes: v[2] ?? "",
        shotsLabelled: v[3] ?? "",
        savesLabelled: v[4] ?? "",
        decision: v[5] ?? "",
      });
    }
  }

  // ---- box score --------------------------------------------------------
  //
  // Scoped to the table holding `<tbody id="test">` (SportsEngine's name, not
  // ours). The page carries three more <thead>s below it — Shots on Goal and
  // Power Plays among them — and the first heading row that matches loosely
  // is not always this one.
  const linescore: LinescoreRow[] = [];
  let periodLabels: string[] = [];
  const boxAt = html.indexOf('<tbody id="test">');
  if (boxAt !== -1) {
    const headAt = html.slice(0, boxAt).lastIndexOf("<thead>");
    if (headAt !== -1) {
      periodLabels = (html.slice(headAt, boxAt).match(/<th[^>]*class="[^"]*scores?[^"]*"[^>]*>[\s\S]*?<\/th>/g) ?? [])
        .map(text)
        // The last column is the total ("T"), not a period.
        .slice(0, -1);
    }
    const body = html.slice(boxAt, html.indexOf("</tbody>", boxAt));
    for (const tr of rowsOf(body)) {
      const m = tr.match(/<td class="teamName"[^>]*>([\s\S]*?)<\/td>([\s\S]*)$/);
      if (!m) continue;
      const team = text(m[1]!);
      const cells = (m[2]!.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(text);
      if (!team || cells.length < 2) continue;
      const dash = (v: string | undefined) => (v === undefined || v === "" || v === "-" ? null : v);
      linescore.push({
        team,
        periods: cells.slice(0, -1).map(dash),
        final: dash(cells.at(-1)),
      });
    }
  }

  return {
    title,
    ...t,
    date: detail(html, "game_date"),
    time: detail(html, "game_time"),
    location: detail(html, "game_location"),
    status: detail(html, "game_status"),
    periodLabels,
    linescore,
    shootoutWinner,
    hasScoringDetail: /scoring detail/i.test(html),
    goals,
    penalties,
    goalies,
  };
}
