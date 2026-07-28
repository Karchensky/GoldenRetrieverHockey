import type { PlayerSeason, Phase } from "../types.ts";

/**
 * Parse a SportsEngine `roster_players/<id>` page.
 *
 * 357 of these are in the corpus across two sources (Erie Metro and
 * HarborCenter's pre-2021 era), in one format. They carry name, jersey,
 * position, date of birth, per-phase stats — the richest per-player source
 * available.
 */

/** Strip tags to text. Entities decoded; whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cells of one row, IN ORDER, INCLUDING EMPTY ONES.
 *
 * Dropping empty cells shifts every subsequent value into the wrong column —
 * a hazard this project has hit repeatedly (§2.9). An empty cell is
 * positional information and, per §2.4, is NOT zero.
 */
function cells(row: string): string[] {
  return (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(text);
}

const rows = (table: string): string[] => table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];

/** Aggregate rows: "2017-18 Totals", "Summer League 2019 Totals" (§2.8.1). */
export function isAggregateLabel(label: string): boolean {
  return /\btotals?\b/i.test(label);
}

/** Goalie tables carry MIN/GAA; skater tables carry G/A/PTS. */
export function tableKind(headers: string[]): "skater" | "goalie" {
  // GAA/MIN alone missed a real shape and cost the last 4 nulls in the corpus.
  //
  // Measured across every roster_players page: there are EIGHT distinct goalie
  // header shapes, and one of them is `Date | GP | W | L | GA` — no GAA, no
  // MIN. Corey Muff's 2019-20 page is that shape, so a goalie table classified
  // as "skater", defeated generate.ts's `ph.kind !== "skater"` filter, and
  // contributed a phantom gp:9. The parser contradicted itself while doing it:
  // its own title parse read the position as "G".
  //
  // W+L is safe and complete, both verified against the whole corpus rather
  // than reasoned about: ZERO skater-titled tables carry W and L, and ZERO
  // goalie-titled tables are missed by (GAA|MIN|W+L). Same family as the
  // DigitalShift goaltender shift — decide by COLUMNS, never by a position
  // cell, because the position cell is what breaks.
  const h = new Set(headers);
  return h.has("GAA") || h.has("MIN") || (h.has("W") && h.has("L")) ? "goalie" : "skater";
}

/**
 * Title shape:
 *   "Golden Retrievers - 2016-17 Regular Season - Roster - #1 - Brent Seymour - G"
 *    team                session                          jersey  name           pos
 *
 * Split on " - ": the session contains hyphens ("2019-20"), so any
 * hyphen-excluding pattern silently drops it. Position may be absent, and the
 * title often has a trailing " - " leaving an empty final part.
 */
export function parseTitle(title: string): {
  team: string;
  session: string;
  jersey: string;
  name: string;
  position: string | null;
} | null {
  const parts = title.split(" - ").map((s) => s.trim());
  const rosterAt = parts.findIndex((p) => /^roster$/i.test(p));
  if (rosterAt < 1) return null;

  const jerseyPart = parts[rosterAt + 1];
  if (!jerseyPart?.startsWith("#")) return null;

  const name = parts[rosterAt + 2];
  if (!name) return null;

  const posRaw = parts[rosterAt + 3];
  return {
    team: parts.slice(0, rosterAt - 1).join(" - "),
    session: parts[rosterAt - 1] ?? "",
    jersey: jerseyPart.slice(1),
    name,
    // A trailing " - " yields an empty part; that means "no position", not "".
    position: posRaw && posRaw.length > 0 ? posRaw : null,
  };
}

/** A labelled bio field ("Date of Birth", "Weight") from the page. */
export function bioField(html: string, label: string): string | null {
  const re = new RegExp(
    `>\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*<\\/[a-z]+>\\s*<[^>]+>([^<]*)<`,
    "i",
  );
  const v = html.match(re)?.[1]?.trim();
  return v ? v : null;
}

/** One teammate, as the roster sidebar states him. Name, number, position. */
export type Teammate = { pageId: string; name: string; jersey: string | null; position: string | null };

/**
 * THE WHOLE TEAM, off a page about one man.
 *
 * Every `roster_players/<id>` page renders its ENTIRE ROSTER beside the player
 * it is about, as a column of hover cards:
 *
 *   <div id="player-36434335" class="tooltip-outer rosterTooltip">
 *     <h3>Andy Murphy</h3>
 *     ... <span class="position"> 12 &middot; D </span>
 *
 * This archive read the subject of each page and threw the other fifteen names
 * away, which is why five HarborCenter seasons sat on the site holding two to
 * four men out of a roster of sixteen while their full rosters were on disk the
 * whole time. Nothing was missing. Nothing was fetched to fix it.
 *
 * A CARD IS NAME, NUMBER AND POSITION — NEVER A STAT. The sidebar carries no
 * games, goals or assists, and a teammate recovered here must be published as a
 * roster line with null figures. Inventing zeroes for him would put a man on
 * the site with a scoreless season he may well not have had.
 *
 * Cards are delimited by the NEXT card, not by a closing tag: they nest four
 * levels of `<div>` and every non-greedy close-tag boundary ends early, which
 * drops the jersey and position off every row while still looking like it
 * parsed. Measured on real captured bytes, not reasoned about.
 */
export function parseRosterSidebar(html: string): Teammate[] {
  const opener = /<div id="player-(\d+)"[^>]*class="[^"]*rosterTooltip[^"]*"[^>]*>\s*<h3>([^<]+)<\/h3>/g;
  const hits = [...html.matchAll(opener)];
  return hits.map((m, i) => {
    const body = html.slice(
      m.index,
      hits[i + 1]?.index ?? Math.min(html.length, m.index + 2000),
    );
    // "12 &middot; D", or "1 &middot; G", or sometimes just "D" with no number.
    const raw = text(body.match(/<span class="position">([\s\S]*?)<\/span>/)?.[1] ?? "")
      .replace(/&middot;/g, "·");
    const parts = raw.split("·").map((s) => s.trim()).filter(Boolean);
    // A lone part is the POSITION where it is not numeric, and the NUMBER where
    // it is — a card may state either alone.
    const jersey = parts.length > 1 ? parts[0]! : (/^\d+$/.test(parts[0] ?? "") ? parts[0]! : null);
    const position = parts.length > 1 ? parts[1]! : (/^\d+$/.test(parts[0] ?? "") ? null : (parts[0] ?? null));
    return { pageId: m[1]!, name: text(m[2]!), jersey: jersey || null, position: position || null };
  });
}

/** Parse one captured roster_players page. Returns null if it is not one. */
export function parseRosterPlayer(html: string): PlayerSeason | null {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) return null;
  const t = parseTitle(title);
  if (!t) return null;

  const phases: Phase[] = [];
  for (const table of html.match(/<table[^>]*statTable[\s\S]*?<\/table>/g) ?? []) {
    const trs = rows(table);
    const headers = cells(trs[0] ?? "");
    if (headers.length === 0) continue;
    const kind = tableKind(headers);

    for (const tr of trs.slice(1)) {
      const v = cells(tr);
      // A row whose cell count differs from the header is not a stat row
      // (spanning rows, footers). Skipping beats silently misaligning columns.
      if (v.length !== headers.length) continue;
      const label = v[0] ?? "";
      if (!label) continue;

      const stats: Record<string, string> = {};
      // Column 0 is the row label, not a stat.
      for (let i = 1; i < headers.length; i++) {
        const key = headers[i];
        if (key) stats[key] = v[i] ?? "";
      }
      phases.push({ label, isAggregate: isAggregateLabel(label), kind, stats });
    }
  }

  return {
    team: t.team,
    session: t.session,
    jersey: t.jersey,
    name: t.name,
    position: t.position,
    dob: bioField(html, "Date of Birth"),
    weight: bioField(html, "Weight"),
    phases,
  };
}
