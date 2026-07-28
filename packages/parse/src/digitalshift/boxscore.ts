import { text, cellsOf, rowsOf } from "../html.ts";

/**
 * Parse a DigitalShift `partials/stats/game/boxscore?game_id=<id>` response.
 *
 * THE HARBORCENTER ERA'S SCORESHEET. Eleven of the archive's eighteen sessions
 * are HarborCenter's HockeyShift era, and until this parser existed not one
 * goal of them was on file: the assist network — the thing the site is for —
 * covered the two Erie Metro seasons and nothing else. These pages were public
 * on the league's own site the whole time. What was missing was a way to list
 * the game ids; see `endpoints.teamSchedule` in the capture source for how that
 * was answered.
 *
 * Richer than the SportsEngine sheets in three ways, all of them free:
 * every scorer and assister carries a PERSISTENT PLAYER ID and a jersey
 * number, and the team on each row carries its team id. Identity here is a
 * link, not a spelling.
 *
 * The response is a JSON envelope — `JSON.parse(raw).content` — whose HTML
 * has its attribute values `&quot;`-encoded. This parser takes the decoded
 * `content`, not the envelope.
 */

/** A person on a scoring row, as the row itself records them. */
export type BoxPlayer = {
  /** Verbatim, from the row's own link text. */
  name: string;
  /**
   * DigitalShift's persistent player id, from `#/player/<id>`.
   *
   * The strongest identity key in the whole archive: HarborCenter keeps one id
   * per person across every season, so this survives a man being written down
   * three different ways. Null when the source did not link the name.
   */
  playerId: number | null;
  /** "72", from the "#72" that precedes the name. Null when absent. */
  jersey: string | null;
};

/** A goal, with its ordered assists. */
export type BoxGoal = {
  /** "1st", "2nd", "3rd", "OT" — verbatim from the row's own cell. */
  period: string;
  /** Clock as recorded, e.g. "08:43". Raw: never converted here. */
  time: string;
  /** Team AS RECORDED ON THIS ROW. Never the page. */
  team: string;
  /** This row's own team id, from its team link. Stronger than the name. */
  teamId: number | null;
  scorer: BoxPlayer;
  /**
   * Assists IN SOURCE ORDER: primary first, then secondary.
   *
   * Order is meaningful and must never be sorted — a primary assist is a
   * different act from a secondary one.
   */
  assists: BoxPlayer[];
  /**
   * Strength state, EXPANDED: "Even Strength", "Power Play", "Short Handed".
   *
   * The cell shows an abbreviation ("Ev") and carries the full form in a
   * `tooltip` attribute. The tooltip is the source's own expansion of its own
   * abbreviation, so it is preferred; the abbreviation is the fallback.
   */
  strength: string | null;
  /** The running score, verbatim: "2 - 1 Tall Boys", "3 - 3 Tie". */
  total: string | null;
};

export type BoxPenalty = {
  period: string;
  time: string;
  /** Team AS RECORDED ON THIS ROW. */
  team: string;
  teamId: number | null;
  player: BoxPlayer;
  /** "Hooking (Minor)", verbatim. */
  infraction: string;
  /** "02:00", verbatim. */
  length: string;
};

/** One team's goals by period. Aligned to `periodLabels`. */
export type BoxLine = {
  team: string;
  teamId: number | null;
  /**
   * Goals per period, verbatim — EXCEPT on a game with no scoring summary,
   * where every cell is null. See `parseBoxscore`: those cells are the
   * platform counting a table that is not there, and a zero-fill is not a
   * record (§2.4).
   */
  periods: (string | null)[];
  /** The final score. REAL even when the period breakdown is not. */
  final: string | null;
};

export type Boxscore = {
  /** Box-score column headings, less the total: ["1st","2nd","3rd"]. */
  periodLabels: string[];
  linescore: BoxLine[];
  /**
   * False when the page carries no Scoring Summary table at all.
   *
   * Not a parse failure — a real absence, and the same distinction the
   * SportsEngine sheets need for the nine playoff games nobody wrote up.
   */
  hasScoringDetail: boolean;
  goals: BoxGoal[];
  penalties: BoxPenalty[];
};

/** `#/player/<id>` on a person link. */
const playerIdOf = (html: string): number | null => {
  const m = html.match(/#\/player\/(\d+)/);
  return m ? Number(m[1]) : null;
};

/** `#/<league>/team/<id>` on a team link. */
const teamIdOf = (html: string): number | null => {
  const m = html.match(/\/team\/(\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * The people in a fragment, in order, with their ids and jersey numbers.
 *
 * Shape: `#72 <a class="person-inline" href="/stats#/player/905719">Anthony
 * Venditti</a>`. The jersey sits OUTSIDE the link, immediately before it, so it
 * is read from the text that precedes each anchor rather than from the anchor.
 */
function peopleIn(html: string): BoxPlayer[] {
  const out: BoxPlayer[] = [];
  const re = /<a[^>]*class="person-inline"[^>]*>([\s\S]*?)<\/a>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const before = html.slice(last, m.index);
    out.push({
      name: text(m[1]!),
      playerId: playerIdOf(m[0]),
      // The LAST "#nn" before this link is this player's. Anchored to the end
      // of the preceding text so a jersey never binds across a comma to the
      // player after it.
      jersey: before.match(/#(\d+)\s*$/)?.[1] ?? null,
    });
    last = re.lastIndex;
  }
  return out;
}

/**
 * Split a "Scorer (Assists)" cell into its scorer and its ordered assists.
 *
 * THE ASSISTS ARE THE ONES INSIDE THE PARENTHESES, and that is the whole rule.
 * Taking "first person is the scorer, the rest are assists" instead would be
 * correct on every row in the corpus and still wrong: it infers from position
 * what the source states with punctuation, and it silently promotes a
 * malformed row's second name to an assist that was never recorded.
 *
 *   #96 <a>Adam Kaplewicz</a>                                  -> unassisted
 *   #72 <a>Anthony Venditti</a> (#13 <a>Caidon Evancho</a>, #9 <a>Brady Eich</a>)
 */
export function parseScorerCell(cellHtml: string): {
  scorer: BoxPlayer | null;
  assists: BoxPlayer[];
} {
  // The assists group is the LAST parenthesised run in the cell. Matched on the
  // raw HTML so the anchors inside survive to carry their player ids.
  const open = cellHtml.lastIndexOf("(");
  const close = cellHtml.lastIndexOf(")");
  const hasGroup = open !== -1 && close > open;

  const scorerPart = hasGroup ? cellHtml.slice(0, open) : cellHtml;
  const assistPart = hasGroup ? cellHtml.slice(open + 1, close) : "";

  const scorers = peopleIn(scorerPart);
  return {
    scorer: scorers[0] ?? null,
    assists: peopleIn(assistPart),
  };
}

/** The strength cell: `<span tooltip="Even Strength"> Ev </span>`. */
export function parseStrength(cellHtml: string): string | null {
  const tip = cellHtml.match(/tooltip="([^"]*)"/)?.[1];
  if (tip && tip.trim()) return text(tip);
  const t = text(cellHtml);
  return t === "" ? null : t;
}

/**
 * Section heading -> its FIRST table.
 *
 * THE SPA RENDERS EVERY SCROLLABLE TABLE TWICE and the second copy is a
 * pixel-for-pixel clone with a frozen header:
 *
 *   <div class="table-scroll"><table>  ...the real one...  </table></div>
 *   <div class="table-fixed" aria-hidden="true"><table> ...the same rows... </table></div>
 *
 * Reading every table in the section therefore returns every goal TWICE, and
 * because the assist network is built by counting goal events, that would not
 * fail anything — it would double every edge on the site and look like a
 * decade of chemistry. `aria-hidden="true"` is the source's own statement that
 * the clone is presentation and not content; taking the first table honours it
 * and does not depend on how the clone is marked. The same trap is already
 * documented on `parseHsPlayer`, which meets it in the career tables.
 */
function firstTableUnder(content: string, heading: string): string | null {
  for (const section of content.split(/<h3[^>]*>/).slice(1)) {
    const end = section.indexOf("</h3>");
    if (end === -1) continue;
    // Exact, not a substring test: this page has BOTH "Scoring" and "Scoring
    // Summary", and they are different tables — one is the linescore, the
    // other is every goal in the game.
    if (text(section.slice(0, end)) !== heading) continue;
    return section.match(/<table[\s\S]*?<\/table>/)?.[0] ?? null;
  }
  return null;
}

/** A linescore table: Team | 1st | 2nd | 3rd | T. */
function parseLine(table: string | null): { labels: string[]; rows: BoxLine[] } {
  if (!table) return { labels: [], rows: [] };
  const trs = rowsOf(table);
  const header = trs.find((r) => /<th[\s>]/.test(r));
  // Drop "Team" from the front and the total ("T") from the end.
  const labels = header ? cellsOf(header).slice(1, -1) : [];

  const rows: BoxLine[] = [];
  for (const tr of trs) {
    if (/<th[\s>]/.test(tr)) continue;
    const v = cellsOf(tr);
    if (v.length < 2) continue;
    const team = v[0] ?? "";
    if (!team) continue;
    const blank = (x: string | undefined) => (x === undefined || x === "" ? null : x);
    rows.push({
      team,
      teamId: teamIdOf(tr),
      periods: v.slice(1, -1).map(blank),
      final: blank(v.at(-1)),
    });
  }
  return { labels, rows };
}

export function parseBoxscore(content: string): Boxscore {
  const { labels, rows: linescore } = parseLine(firstTableUnder(content, "Scoring"));

  const goals: BoxGoal[] = [];
  const scoring = firstTableUnder(content, "Scoring Summary");
  if (scoring) {
    for (const tr of rowsOf(scoring)) {
      if (/<th[\s>]/.test(tr)) continue;
      const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
      // Period | Time | Strength | Team | Scorer (Assists) | Total | More
      if (tds.length < 6) continue;
      const period = text(tds[0]!);
      const time = text(tds[1]!);
      const team = text(tds[3]!);
      if (!period || !time || !team) continue;
      const { scorer, assists } = parseScorerCell(tds[4]!);
      // A scoring row with nobody on it is not a goal we can attribute. Kept
      // out rather than invented into one.
      if (!scorer || !scorer.name) continue;
      goals.push({
        period,
        time,
        team,
        teamId: teamIdOf(tds[3]!),
        scorer,
        assists,
        strength: parseStrength(tds[2]!),
        total: text(tds[5]!) || null,
      });
    }
  }

  const penalties: BoxPenalty[] = [];
  const pen = firstTableUnder(content, "Penalty Summary");
  if (pen) {
    for (const tr of rowsOf(pen)) {
      if (/<th[\s>]/.test(tr)) continue;
      const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
      // Period | Time | Player | Team | Infraction | Length
      //
      // A clean game still renders the table, with one row reading
      // `<td colspan="6">No penalties recorded.</td>` — the source saying so
      // in words. Seventeen games say it. The arity test drops that row for
      // the same reason it drops any other non-data row: six columns of
      // penalty are not there. Read positionally it would file the sentence
      // itself as a period and "" as a team.
      if (tds.length < 6) continue;
      const period = text(tds[0]!);
      const team = text(tds[3]!);
      if (!period || !team) continue;
      penalties.push({
        period,
        time: text(tds[1]!),
        team,
        teamId: teamIdOf(tds[3]!),
        player: peopleIn(tds[2]!)[0] ?? {
          name: text(tds[2]!),
          playerId: null,
          jersey: null,
        },
        infraction: text(tds[4]!),
        length: text(tds[5]!),
      });
    }
  }

  // ---- a zero-fill is not a score ---------------------------------------
  //
  // The per-period cells are DERIVED by the platform from the scoring summary,
  // not stored beside the final: on the 172 games that have a summary they sum
  // to the final exactly, all 344 team-lines of them. On the 17 that do not,
  // every cell is "0" while the final says 8, or 11, or 5 — the platform
  // counting a table that is not there and rendering the absence as a number.
  //
  // Recorded verbatim that is a linescore reading 0-0-0 = 8: eight goals in no
  // periods, printed as fact, on a site whose one claim is that every figure
  // traces to a page. The SportsEngine sheets meet the same hole and print a
  // DASH, which `game-sheet.ts` already maps to null for exactly this reason —
  // "a 13-0 win rendered as four zeroes would be a fabrication". Same hole,
  // same answer, or the archive draws one fact two ways depending on which
  // platform happened to host the season.
  //
  // This is NOT the repair of a wrong value, which this parser never does (see
  // the goalie columns in `player.ts`, passed through untouched though they
  // are plainly false). It is the refusal to promote an absence into a zero.
  // The FINAL is kept: that one is real, and it is the only thing these
  // seventeen games have left.
  const detail = scoring !== null;
  return {
    periodLabels: labels,
    linescore: detail
      ? linescore
      : linescore.map((l) => ({ ...l, periods: l.periods.map(() => null) })),
    hasScoringDetail: detail,
    goals,
    penalties,
  };
}
