"use client";

import Link from "next/link";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { RIDGE_W, Ridge, RidgeLegend, fmtMetric, marksOf } from "../CareerArc";
import { plural } from "../../lib/format";
import type { Slot, Trace, TraceMetric } from "../../lib/stats";
import { GAP_WORDS, TRACE_METRICS, slotLabel } from "../../lib/stats";

/**
 * Every career the archive can draw a line through, on one grid, each drawn
 * against its own best season — opening on the men who are still playing.
 *
 * The cut for what is DRAWN is more than one session on file, and it is the
 * only honest one: one session is a dot and there is no trajectory through a
 * dot. The cut for what is drawn FIRST is a different question and the answer
 * is time. Every career the archive holds is a career, but a reader arriving
 * at a page called "career timelines" is looking for the side that took the
 * ice this summer, and it was scattered down a list running back to the first
 * season on file, between men who stopped playing a decade ago. `Trace.recent`
 * — the last league halves, derived in lib/stats.ts off the newest session and
 * never off a year — leads; the rest are one disclosure below, in the same
 * order, drawn on the same grid, against the same peak.
 *
 * Nothing here says which set is on screen. The list is the answer.
 *
 * The old row was a 340 × 34 viewBox with three units of padding, so
 * twenty-seven units carried the whole range — about 46 px of picture per
 * player — and the tallest cell in the file set the top of every row. Five of
 * sixteen careers came out under 5 px, and the component's own copy apologised
 * for it: *"The smaller careers look flat. They are flat, next to Karchensky."*
 *
 * THE ROW ANSWERS "WHEN", AND THE FIGURES ANSWER "HOW MUCH". Every ridge is
 * scaled to its own man's best session, so a nine-point career has a shape and a
 * peak that can be dated — which is what a timeline is for. How big that career
 * was is on the same row twice, in figures: the session count and the career
 * total under his name, and the total again at the end of the row. A second grey
 * ridge drawn against the whole file's peak used to carry it as a picture and
 * lost its key three rounds running; see CareerArc.tsx.
 *
 * Nothing here knows how long the spine is, how the halves alternate, or that
 * the slots are evenly spaced in time. Columns lay out by index off `slots`,
 * and every figure comes from `site.json` by way of lib/stats.
 */

type Props = { traces: Trace[]; slots: Slot[] };

/** "2012 - Winter" is too wide for 28 table columns; the grid is not. */
const shortLabel = (label: string) => label.replace(" - Summer", " S").replace(" - Winter", " W");

/**
 * The session log's columns.
 *
 * Six figures, one per column, aligned down the page. This replaced a strip of
 * 94 px cells each carrying a nowrapped label, a display figure and the run-on
 * line `32 GP · 67G 49A · 18 PIM`. A cell's label set its own min-content
 * width, so "Greater Buffalo Invitational" widened every span in that cell to
 * 173 px inside a 94 px track and painted straight over the two columns to its
 * right — a measured 68 px of collision at every viewport tested. There is no
 * width at which twenty-four columns of that fit. Rows have as much width as
 * they need and cannot overlap.
 */
const LOG_COLS: { key: "gp" | "g" | "a" | "pts" | "ppg" | "pim"; head: string }[] = [
  { key: "gp", head: "GP" },
  { key: "g", head: "G" },
  { key: "a", head: "A" },
  { key: "pts", head: "Pts" },
  { key: "ppg", head: "Pts/G" },
  { key: "pim", head: "PIM" },
];

/**
 * A figure, or nothing at all.
 *
 * NOT an em-dash. A session with no statistics on file used to print
 * `— GP · —G —A · — PIM`, four placeholders standing in for four absences, and
 * most sessions are absent for most players. Absence is still not zero — the
 * cell is empty, and an empty cell is not a nought — it is simply no longer
 * spelled out four times.
 */
const logFigure = (v: number | null, key: string) =>
  v === null ? "" : key === "ppg" ? v.toFixed(2) : String(v);

/**
 * WHEN, ON THE GRID ITSELF.
 *
 * Forty sparklines were drawn against the session spine with no x-axis at any
 * width — a peak whose position cannot be dated is decoration. `First and last`
 * is the section directly below, drawn on the same spine, and it has carried
 * five anchor ticks since it was built; a reader learned to read years off that
 * chart, scrolled back up and could not date a single career.
 *
 * Same five anchors, same construction, and a tick is a POSITION IN TIME, so it
 * prints the half-year and never the slot's own name — one of the five lands on
 * a tournament, whose name is three times the width of every other tick.
 */
function Axis({ slots }: { slots: Slot[] }) {
  const n = slots.length || 1;
  const step = RIDGE_W / n;
  const ticks = [...new Set([0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1])]
    .filter((i) => i >= 0 && i < n);

  return (
    <div className="st-axis" aria-hidden="true">
      <span />
      <svg viewBox={`0 0 ${RIDGE_W} 12`}>
        {ticks.map((i) => (
          <text
            key={i}
            x={step * i + step / 2}
            y="9"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {slots[i] ? slotLabel(slots[i]!.sort).replace(" - ", " ") : ""}
          </text>
        ))}
      </svg>
      <span />
      <span />
    </div>
  );
}

export default function Trajectories({ traces, slots }: Props) {
  const [metric, setMetric] = useState<TraceMetric>("pts");
  const [col, setCol] = useState(-1);
  const [open, setOpen] = useState<string | null>(null);

  const meta = TRACE_METRICS.find((m) => m.key === metric) ?? TRACE_METRICS[0]!;
  const n = slots.length;
  const here = col >= 0 && col < n ? slots[col] : null;

  const sessionSlots = slots.filter((s) => s.kind === "session");

  /**
   * Who leads, and who is behind the disclosure.
   *
   * The fallback is not decoration. A session lands here the day it is
   * captured, and a half whose roster arrives before its statistics — or one
   * played by men with no second session yet — would leave `recent` empty and
   * this grid blank, with the whole archive sitting one click away behind a
   * control nobody would think to press. An empty lead means everyone leads.
   */
  const anyRecent = traces.some((t) => t.recent);
  const lead = anyRecent ? traces.filter((t) => t.recent) : traces;
  const rest = anyRecent ? traces.filter((t) => !t.recent) : [];

  /** -1 is "all on file", and the stepper wraps through it rather than past it. */
  const step = (d: number) =>
    setCol((c) => {
      const next = c + d;
      if (next < -1) return n - 1;
      if (next > n - 1) return -1;
      return next;
    });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      step(-1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      step(1);
      e.preventDefault();
    }
  };

  /**
   * One man's row. Lifted out of the map so the two groups are the same row
   * and not two that have to be kept the same.
   */
  const row = (t: Trace) => {
    const isOpen = open === t.slug;
    const v = col >= 0 ? t.cells[col]?.[metric] : undefined;
    const shownValue =
      col >= 0
        ? v === null || v === undefined
          ? "—"
          : fmtMetric(v, metric)
        : fmtMetric(t.totals[metric], metric);

    return (
      <div key={t.slug} className={`st-row${isOpen ? " open" : ""}${col >= 0 ? " lit" : ""}`}>
        <button
          type="button"
          className="st-rhead"
          aria-expanded={isOpen}
          // named explicitly, or the row's name is the jersey, the
          // sub-line, the drawing's own description and the total, in
          // that order, read out as one sentence
          aria-label={`${t.name}, ${t.sessions} sessions, ${fmtMetric(
            t.totals[metric],
            metric,
          )} ${meta.label.toLowerCase()}`}
          onClick={() => setOpen(isOpen ? null : t.slug)}
        >
          <span className="st-who">
            {/* A jersey is a STRING and one of them is "0". Tested for
                null, never for truth. */}
            <span className="st-jer">{t.jersey === null ? "—" : t.jersey}</span>
            <span className="st-nm">{t.name}</span>
            {/* THROUGH THE SAME FORMATTER AS THE TOTAL AT THE OTHER END OF THE
                ROW. This read `t.pts` — the raw career sum, which adds nulls
                to nought — so Brent Seymour's row printed "9 sessions · 0 pts"
                beside an em dash, and Matt Gentner's and Corey Lloyd's did the
                same. Absence is not zero, including here. */}
            <span className="st-sub">
              {plural(t.sessions, "session")}
              {t.totals.pts !== null && ` · ${plural(t.totals.pts, "pt")}`}
            </span>
          </span>

          <Ridge trace={t} slots={slots} metric={metric} col={col} onColumn={setCol} />

          {/* Through the same formatter as the sub-line eight columns left of
              it, which printed 1,239 while this printed 1239 on the same row. */}
          <span className="st-tot">{shownValue}</span>
          <span className="st-caret" aria-hidden="true">
            &#9656;
          </span>
        </button>

        {isOpen && (
          <div className="st-panel">
            <div className="st-ptop">
              <div className="st-pt">
                {t.name} · <b>{fmtMetric(t.totals[metric], metric)}</b> {meta.label.toLowerCase()}
                {t.gp ? ` in ${plural(t.gp, "game")}` : ""}
              </div>
              <Link href={`/players/${t.slug}`} className="st-plink">
                Full record &rarr;
              </Link>
            </div>

            <Ridge
              trace={t}
              slots={slots}
              metric={metric}
              col={col}
              onColumn={setCol}
              detailed
            />

            {/* The keys this drawing has marks for — no key for a dot, a tick
                or a break the career does not have. */}
            <RidgeLegend {...marksOf(t, metric, slots, true)} />

            <div className="scroll">
              <table className="st-log">
                <thead>
                  <tr>
                    <th className="l" scope="col">
                      Session
                    </th>
                    {LOG_COLS.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={c.key === metric ? "on" : undefined}
                      >
                        {c.head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s, i) => {
                    const c = t.cells[i];
                    if (!c) return null;
                    return (
                      <tr key={s.sort}>
                        <td className={c.archiveOnly ? "l gold" : "l"}>{s.label}</td>
                        {LOG_COLS.map((k) => (
                          <td key={k.key} className={k.key === metric ? "on" : undefined}>
                            {logFigure(c[k.key], k.key)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="st-controls">
        <span className="st-field" role="group" aria-label="Metric">
          <span>Show</span>
          {TRACE_METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className="st-chip"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </span>

        <span className="st-field" role="group" aria-label="Session">
          <span>Session</span>
          <button type="button" className="st-step" onClick={() => step(-1)} aria-label="Previous session">
            &#9666;
          </button>
          <span className={here ? "st-colname lit" : "st-colname"}>{here ? here.label : "all on file"}</span>
          <button type="button" className="st-step" onClick={() => step(1)} aria-label="Next session">
            &#9656;
          </button>
        </span>
      </div>

      {/* Counted over every drawable career, not over the ones on screen. The
          readout's second figure is a fact about the archive, and its "no
          scoring on file" branch is only true of the whole set — no man still
          playing has a line in the earliest sessions, and those sessions are
          full of scoring. Narrowed to the leading rows it would report an
          empty season that is not empty. */}
      <Readout
        slot={here}
        traces={traces}
        metric={metric}
        col={col}
        span={
          sessionSlots.length > 0
            ? `${sessionSlots[0]!.label} to ${sessionSlots.at(-1)!.label}`
            : ""
        }
        sessions={sessionSlots.length}
      />

      <div onMouseLeave={() => setCol(-1)}>
        <Axis slots={slots} />
        <div className="st-rows">{lead.map(row)}</div>

        {/* A native disclosure and no state of its own, so the rest of the
            archive is one press away with JavaScript off as well as on. */}
        {rest.length > 0 && (
          <details className="st-more">
            <summary>
              {rest.length} more {rest.length === 1 ? "career" : "careers"}
            </summary>
            <div className="st-rows">{rest.map(row)}</div>
          </details>
        )}
      </div>

      <RidgeLegend />

      <details className="st-close">
        <summary>All {traces.length} careers, session by session, as a table</summary>
        <div className="scroll st-tall">
          <table>
            <thead>
              <tr>
                <th className="l" scope="col">
                  Player
                </th>
                {slots.map((s) => (
                  <th key={s.sort} scope="col" style={{ fontSize: 8.5 }}>
                    {shortLabel(s.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr key={t.slug}>
                  <td className="l">{t.name}</td>
                  {slots.map((s, i) => {
                    const val = t.cells[i]?.[metric];
                    const missing = val === null || val === undefined;
                    return (
                      <td key={s.sort} className={missing ? "st-miss" : undefined}>
                        {missing ? "—" : fmtMetric(val, metric)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------
// the readout
// ------------------------------------------------------------------

/**
 * What the highlighted session is, in figures.
 *
 * IT DOES NOT NARRATE. It used to close with a line under every state — "Every
 * half-year from 2012 - Winter to 2026 - Summer, whether or not anything
 * survived it, plus one tournament. 11 of the 24 survive in the Internet
 * Archive alone." — which is the grid describing the grid to a reader already
 * looking at it. The gold rule down the left edge still says archive-only, the
 * shaded columns still say not on file, and the four kinds of nothing are
 * named in three words rather than a sentence. Nothing below is prose, and
 * nothing below should become prose again.
 */
function Readout({
  slot,
  traces,
  metric,
  col,
  span,
  sessions,
}: {
  slot: Slot | null;
  traces: Trace[];
  metric: TraceMetric;
  col: number;
  /** First session on the spine to last. */
  span: string;
  /** How many of the columns carry a session. */
  sessions: number;
}) {
  if (!slot) {
    /**
     * NO COVERAGE CLAIM AT REST — in either direction.
     *
     * It read "31 sessions on file — 2017 - Summer · 2020 - Summer are not",
     * which is 31 of 31 followed by two exclusions that were never in the 31.
     * Then it named the two half-years instead, which is the scope box's own
     * "No record" row restated 2,300px below it, in a box whose rule is that
     * nothing beneath it repeats it.
     *
     * What is left is what the grid actually is: two ends and a count. The two
     * absent half-years are shaded columns and stepping onto one names it and
     * says which kind of nothing it is — one keypress, one arrow, or one hover.
     */
    return (
      <div className="st-readout" role="status" aria-live="polite">
        <span className="k">The grid</span>
        <div className="v">
          {span}
          <small>{plural(sessions, "session")}</small>
        </div>
      </div>
    );
  }

  if (slot.kind === "gap") {
    return (
      <div className="st-readout" role="status" aria-live="polite">
        <span className="k">{slot.label}</span>
        <div className="v">
          Not on file <small>{GAP_WORDS[slot.gap.status]}</small>
        </div>
      </div>
    );
  }

  const roll = slot.roll;
  const drawn = traces.filter((t) => {
    const v = t.cells[col]?.[metric];
    return v !== null && v !== undefined;
  }).length;

  return (
    <div
      className="st-readout"
      role="status"
      aria-live="polite"
      data-gold={roll.archiveOnly ? "1" : undefined}
    >
      <span className="k">
        {slot.label} · {roll.sourceLabel}
      </span>
      <div className="v">
        {plural(roll.people, "player")} on file{" "}
        <small>{drawn ? `${drawn} of ${traces.length} drawn` : "no scoring on file"}</small>
      </div>
    </div>
  );
}
