"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { num, plural } from "../../lib/format";
import type { BoardCell, Half } from "../../lib/stats";

/**
 * The record, sorted however you want it.
 *
 * Two rules the sorting obeys and the source does not:
 *
 * - A blank is not a zero. `null` sorts to the bottom in both directions and
 *   prints as an em dash. The goaltender is not the worst scorer in franchise
 *   history; he is the only man in the file whose columns were never filled in.
 *   AND HE DOES NOT GET AN ORDINAL EITHER, which is the same rule one column
 *   over and this board was breaking it in the widest cell it has. A rank is a
 *   claim about the column it is sorted by, so a row with nothing in that column
 *   cannot carry one: `#78` beside an em dash says seventy-seventh-best scorer
 *   about a man nobody recorded a point for. It is worst under the session
 *   filter, which now offers all thirty-one — pick 2019 - Summer and the board
 *   was seventeen men with GP, G, A, Pts, Pts/G and PIM all blank, numbered 1 to
 *   17 in alphabetical order, on the board the page trusts most. Unnumbered,
 *   the same rows read as what they are: a roster, not a ranking.
 * - Points per game is recomputed from the rows in view — AS THE TWO COLUMNS
 *   BESIDE IT DIVIDE. It used to be summed over only the lines carrying both
 *   halves of it, which is a defensible rate and an indefensible row: two of
 *   Karchensky's seasons record points with no games-played beside them, so the
 *   board printed GP 422, Pts 1239 and Pts/G 2.68 in adjacent cells, and 1239
 *   ÷ 422 is 2.94. Nothing on screen said the rate covered fewer games than the
 *   games column, and every player divides his own row. site.json's own `ppg`
 *   is no better — it divides a null-summed-to-zero by a real games total and
 *   reports 0.00 for the goaltender, which is a statement nobody made — so the
 *   blank rule still comes first: no points, no rate.
 */

type Person = { slug: string; name: string; aliases: string[]; jersey: string | null };
type SessionOpt = { id: string; label: string; sort: number; archiveOnly: boolean };

type Props = {
  cells: BoardCell[];
  people: Person[];
  sessions: SessionOpt[];
  sources: { source: string; label: string; archiveOnly: boolean }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
};

type Key = "sessions" | "gp" | "g" | "a" | "pts" | "ppg" | "pim";

const COLS: { key: Key; label: string; title: string }[] = [
  { key: "sessions", label: "Sess", title: "Seasons played" },
  { key: "gp", label: "GP", title: "Games played" },
  { key: "g", label: "G", title: "Goals" },
  { key: "a", label: "A", title: "Assists" },
  { key: "pts", label: "Pts", title: "Points" },
  { key: "ppg", label: "Pts/G", title: "Points per game" },
  { key: "pim", label: "PIM", title: "Penalty minutes" },
];

/** null only when NOTHING was recorded. Otherwise the sum of what was. */
const nsum = (xs: (number | null)[]): number | null =>
  xs.reduce<number | null>((t, v) => (v === null ? t : (t ?? 0) + v), null);

/**
 * A SCORING FIGURE OFF A GOALTENDER'S LINE, WHICH IS THE PLATFORM'S NOUGHT.
 *
 * Two career goaltenders sat on this board with two different verdicts, and the
 * difference was which platform typed the zero. Erie Metro left a goalie's
 * scoring columns blank, so Brent Seymour read "163 GP · — · — · — · — · —".
 * DigitalShift fills them with noughts, so Corey Muff read 258 GP, 2 points and
 * 0.01 a game — a rate whose numerator covers fourteen of his twenty-two lines
 * and whose denominator covers all of them, printed as a career.
 *
 * Same rule as `savesOf` in lib/data.ts: a nought in a column the platform
 * never filled is not a statistic. The two points DigitalShift did record — a
 * goal in 2022-23, an assist in Summer 2026 — survive, because a figure it
 * actually published is not a blank.
 */
const scoringOf = (cell: BoardCell, key: "g" | "a" | "pts" | "pim"): number | null =>
  cell.goalie && cell[key] === 0 ? null : cell[key];

const cmp = (a: number | null, b: number | null, dir: 1 | -1) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // blanks last, always
  if (b === null) return -1;
  return (b - a) * dir;
};

export default function Leaderboard({ cells, people, sessions, sources, selected, onSelect }: Props) {
  const [half, setHalf] = useState<Half | "all">("all");
  const [source, setSource] = useState<string>("all");
  const [minGp, setMinGp] = useState(0);
  const [sort, setSort] = useState<Key>("pts");
  const [dir, setDir] = useState<1 | -1>(1);

  const byName = useMemo(() => new Map(people.map((p) => [p.slug, p])), [people]);

  const rows = useMemo(() => {
    const keep = cells.filter(
      (c) =>
        (selected === null || c.session === selected) &&
        (half === "all" || c.half === half) &&
        (source === "all" || c.source === source),
    );

    const by = new Map<string, BoardCell[]>();
    for (const c of keep) by.set(c.slug, [...(by.get(c.slug) ?? []), c]);

    return [...by]
      .map(([slug, cs]) => {
        const p = byName.get(slug)!;
        const named = [...new Set(cs.map((c) => c.recordedAs))].filter((n) => n !== p.name);
        const gp = nsum(cs.map((c) => c.gp));
        const pts = nsum(cs.map((c) => scoringOf(c, "pts")));
        /* No rate for a goaltender. The two figures a rate divides have to be
           two readings of the same career, and a goaltender's games are his
           while his points column is the platform's. */
        const tended = cs.every((c) => c.goalie);
        return {
          slug,
          name: p.name,
          jersey: p.jersey,
          recordedAs: named,
          archiveOnly: cs.some((c) => c.archiveOnly),
          sessions: new Set(cs.map((c) => c.session)).size,
          gp,
          g: nsum(cs.map((c) => scoringOf(c, "g"))),
          a: nsum(cs.map((c) => scoringOf(c, "a"))),
          pts,
          pim: nsum(cs.map((c) => scoringOf(c, "pim"))),
          ppg: !tended && pts !== null && gp !== null && gp > 0 ? pts / gp : null,
        };
      })
      // A blank games column cannot be shown to clear a games threshold, so it
      // does not get the benefit of the doubt. At zero, nobody is filtered out.
      .filter((r) => minGp === 0 || (r.gp !== null && r.gp >= minGp))
      .sort((x, y) => cmp(x[sort], y[sort], dir) || x.name.localeCompare(y.name));
  }, [cells, byName, selected, half, source, minGp, sort, dir]);

  const top = rows.reduce((m, r) => Math.max(m, r.pts ?? 0), 0) || 1;
  const scope = sessions.find((s) => s.id === selected);
  const totalPts = nsum(rows.map((r) => r.pts));
  const filtered = selected !== null || half !== "all" || source !== "all" || minGp !== 0;

  const click = (k: Key) => {
    if (k === sort) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(k);
      setDir(1);
    }
  };

  return (
    <>
      <div className="st-controls">
        <label className="st-field">
          <span>Session</span>
          <select value={selected ?? "all"} onChange={(e) => onSelect(e.target.value === "all" ? null : e.target.value)}>
            <option value="all">All {sessions.length} sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </label>

        <span className="st-field" role="group" aria-label="Half">
          <span>Half</span>
          {(["all", "summer", "fall-winter"] as const).map((h) => (
            <button
              key={h}
              type="button"
              className="st-chip"
              aria-pressed={half === h}
              onClick={() => setHalf(h)}
            >
              {h === "all" ? "Both" : h === "summer" ? "Summer" : "Fall/Winter"}
            </button>
          ))}
        </span>

        <label className="st-field">
          <span>Platform</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All {sources.length}</option>
            {sources.map((s) => (
              <option key={s.source} value={s.source}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="st-field">
          <span>Min games</span>
          <input
            type="range"
            min={0}
            max={40}
            step={5}
            value={minGp}
            onChange={(e) => setMinGp(Number(e.target.value))}
            aria-label={`Minimum games played: ${minGp}`}
          />
          <span style={{ letterSpacing: 0, textTransform: "none", fontSize: 11, color: minGp ? "var(--ink)" : "var(--dim)" }}>
            {minGp === 0 ? "everyone" : `${minGp}+`}
          </span>
        </label>

        {(selected || half !== "all" || source !== "all" || minGp !== 0) && (
          <button
            type="button"
            className="st-chip"
            onClick={() => {
              onSelect(null);
              setHalf("all");
              setSource("all");
              setMinGp(0);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ONLY WHEN A FILTER IS ON. Unfiltered it read "79 people across all
          seasons. 6240 points between them." — the hero's own player count in
          a third noun for the same set, and a total nobody asked for. It is a
          readout, so it reads out what the controls above it did. "Players" is
          the word; "people" and "individual records" were two more for the
          same 79. */}
      {filtered && (
        <p className="lede" style={{ margin: "0 0 12px" }} aria-live="polite">
          {plural(rows.length, "player")}
          {scope && (
            <>
              {" "}in <b>{scope.id}</b>
            </>
          )}
          {half !== "all" && `, ${half === "summer" ? "summer" : "fall/winter"} only`}
          {source !== "all" && `, ${sources.find((s) => s.source === source)?.label} only`}
          {minGp > 0 && `, ${minGp} games or more`}
          {totalPts !== null && `. ${num(totalPts)} points between them.`}
        </p>
      )}

      {/* TEN ROWS, not the seven every other table on the page shows. This is
          the board a reader trusts most and the only one whose rows are a
          ranking: seven of seventy-nine cut it off inside the top ten, which is
          the one boundary a leaderboard has. `st-board` is the extra room; see
          styles.tsx for the arithmetic. */}
      <div className="scroll st-tall st-board">
        <table>
          <thead>
            <tr>
              <th className="l" style={{ width: "2ch" }} scope="col">
                <span className="st-miss">#</span>
              </th>
              <th className="l" scope="col">Player</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort === c.key ? (dir === 1 ? "descending" : "ascending") : "none"}
                >
                  <button type="button" onClick={() => click(c.key)} title={c.title}>
                    {c.label}
                    {sort === c.key ? (dir === 1 ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.slug}>
                <td className="l st-miss">{r[sort] === null ? "" : i + 1}</td>
                <td className="l">
                  <Link href={`/players/${r.slug}`}>{r.name}</Link>
                  {r.jersey && <span className="st-miss" style={{ fontSize: 10 }}> #{r.jersey}</span>}
                </td>
                {/* THROUGH `num`, like everything else. This board is the first
                    table on the page and holds the largest figures on the site,
                    and it was the only place that printed 1239 — the same
                    career reads 1,239 in the timelines row, its sub-line, its
                    aria-label and its player-index tile. */}
                <td>{num(r.sessions)}</td>
                {(["gp", "g", "a"] as const).map((k) => (
                  <td key={k}>{r[k] === null ? <span className="st-miss">—</span> : num(r[k]!)}</td>
                ))}
                <td>
                  {r.pts === null ? (
                    <span className="st-miss">—</span>
                  ) : (
                    <>
                      {num(r.pts)}
                      <span aria-hidden="true" className="bar" style={{ width: `${Math.round((r.pts / top) * 100)}%` }} />
                    </>
                  )}
                </td>
                <td className="st-miss">{r.ppg === null ? "—" : r.ppg.toFixed(2)}</td>
                <td>{r.pim === null ? <span className="st-miss">—</span> : num(r.pim)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="l" colSpan={9} style={{ color: "var(--dim)", padding: "18px 0" }}>
                  No results for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
