"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Player } from "../../../packages/build/src/types";
import { num } from "../lib/format";
import type { Slot, Trace, TraceMetric } from "../lib/stats";
import {
  SPINE,
  TRACE_METRICS,
  TRACE_PEAK,
  TRACE_MIN_SESSIONS,
  drawableSessions,
  gapBlocks,
  traceOf,
} from "../lib/stats";

/**
 * One career, drawn against the man's own best season.
 *
 * THE GREY GHOST IS GONE, AND SO IS THE LAST HALF OF THE TWO-SCALE APPARATUS.
 * It plotted the same career a second time against the largest session anyone on
 * file ever had, and its key — "the same career, scaled to the biggest session
 * on file", another man's season cited under every arc on the site — was raised
 * twice, reworded once, and cut. The mark was left behind. What that left was a
 * faint triangle at the foot of thirty-three of thirty-four default arcs whose
 * meaning is a second man's season: the one thing on the drawing a reader cannot
 * reach by looking, with nothing anywhere to reach it by. Restoring the words
 * was the fourth pass at a sentence three passes had already deleted, so the
 * mark followed the key instead.
 *
 * Nothing is lost that is not on the same screen in figures: the arc labels its
 * own peak, the grid prints each man's career total at the end of his row and
 * his session count under his name, and the log table under the arc holds every
 * reading. What the grid asks is WHEN a man peaked, and a timeline scaled to his
 * own best is the honest drawing of that.
 *
 * Three rules the drawing is not allowed to break:
 *
 * - **The line BREAKS where a man did not play a session that is on file.** A
 *   hole never closes quietly, so a run of one reading is a stem and a point
 *   rather than a bar — a bar reads as a quantity you may compare across the
 *   gap, and there is nothing on the other side of it.
 * - **The column is SHADED where the session is not on file for anyone**, and
 *   in the arc it says which of the four kinds of nothing it is.
 * - **The magnification is capped.** A man with one point in eleven sessions
 *   drawn to his own peak is a mountain: a lie told with a true figure.
 *
 * The same function draws the 78-unit row on /seasons and the 268-unit arc on
 * a player page, so a reader who clicks a name arrives somewhere he recognises.
 */

/** Every drawing here is 780 user units wide and stretched to its container. */
export const RIDGE_W = 780;

/** The /seasons row. 78 units, up from the 34 that left five careers under 5px. */
export const ROW_H = 78;
const ROW_PAD_T = 9;
const ROW_PAD_B = 7;

/** The career arc. The named axis eats the bottom 78. */
export const ARC_H = 268;
const ARC_PAD_T = 42;
const ARC_PAD_B = 78;

/**
 * THE ARC CARRIES A SECOND ANNOTATION FOR A PHONE, because at 375 the first one
 * is not annotation, it is texture.
 *
 * Every `<text>` in here lives in a 780-unit viewBox stretched to its
 * container, so all of it scales with the width. Measured on the record
 * holder's page: at 1440 the container is 1006px and the axis renders at
 * 10.3px; at 375 it is 297px — a scale of 0.381 — and the axis lands at 3.05px,
 * the peak's season at 2.86px and the shaded columns' own words at 2.59px. The
 * metric switcher above it is fully usable and the thing it controls cannot be
 * read, at the width most readers will use.
 *
 * So under 620px the annotation is CUT rather than shrunk: three anchor ticks
 * set flat instead of thirty-three at -54°, the peak's figure without its
 * season, and no words down the shaded columns. Both sets are drawn and the
 * stylesheet chooses — `.ca-wide` and `.ca-narrow`, a media query, four extra
 * elements. NOT a matchMedia hook: this drawing renders with JavaScript
 * switched off, which is the whole reason the layout is computed at build time,
 * and a hook would have left every reader without it looking at 3px of type.
 *
 * The user-unit sizes are the px targets divided by that 0.381: 24 units lands
 * near 9px and 34 near 13, which is what the wide arc sets in px.
 */
const NARROW_TEXT = 24;
const NARROW_PEAK = 34;

/**
 * A slot's name, cut to what the axis can hold at -54°.
 *
 * Most slots are half-years and fit. A session that is not a half-year names
 * itself — "2015 - Greater Buffalo Invitational" — and at full length it runs
 * off the bottom of the drawing and through the legend. The whole name stays
 * one hover away and is printed in full in the session strip.
 *
 * THE YEAR COMES OFF A HALF-YEAR AND STAYS ON EVERYTHING ELSE. Dropping it
 * first was right for "2018 Winter", whose neighbours on the axis carry the
 * year already, and it collapsed the club's three Greater Buffalo Invitationals
 * — 2014, 2015 and 2016, four years apart on the spine — into one tick reading
 * "Greater Buffalo…", three times, with a peak landing on one labelled with no
 * year at all. lib/stats.ts puts the year into a tournament's label expressly
 * to stop that: "three ticks on an axis and three entries in a session filter
 * with nothing to tell them apart".
 *
 * AND IT CUTS AT A WORD. "2014 Greater Bu…" reads as a rendering fault, which
 * is the reasoning that took mid-word ellipsis off the club names in the
 * opponents' ledger.
 */
const AXIS_CHARS = 16;
function axisLabel(slot: Slot | undefined) {
  const flat = (slot?.label ?? "").replace(" - ", " ");
  if (flat.length <= AXIS_CHARS) return flat;
  const dated = slot?.kind === "session" && slot.roll.tournament !== null;
  const cut = dated ? flat : flat.replace(/^\d{4}\s+/, "");
  if (cut.length <= AXIS_CHARS) return cut;
  const head = cut.slice(0, AXIS_CHARS - 1);
  const word = head.lastIndexOf(" ");
  return `${(word > 0 ? head.slice(0, word) : head).trimEnd()}…`;
}

/**
 * The most a man may be magnified beyond the file's own top.
 *
 * `top = max(ownPeak, sharedPeak / 12)`. Corey Muff's single career point
 * becomes a bump rather than a summit; nothing above a twelfth of the peak is
 * affected at all.
 */
const MAG_CAP = 12;

/** Labels for the aria text. Six, because a cell still carries six. */
const METRIC_LABEL: Record<TraceMetric, string> = {
  pts: "points",
  g: "goals",
  a: "assists",
  pim: "penalty minutes",
  ppg: "points per game",
  share: "share of the session rate",
};

/** useLayoutEffect warns during SSR; the effect it replaces never runs there. */
const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Reading = { i: number; v: number };

const cellVal = (t: Trace, i: number, m: TraceMetric): number | null => {
  const v = t.cells[i]?.[m];
  return v === null || v === undefined ? null : v;
};

export const isRate = (m: TraceMetric) => m === "ppg" || m === "share";
/** One formatter, thousands separated, so a career total does not print 1239
 *  at one end of a row and 1,239 at the other. */
export const fmtMetric = (v: number | null, m: TraceMetric) =>
  v === null ? "—" : isRate(m) ? v.toFixed(2) : num(v);

/** The tallest single session anyone on file has for this metric. Nothing is
 *  drawn against it any more; it is the floor under the magnification cap, so a
 *  man with one point in eleven sessions is a bump rather than a summit. */
export const sharedTop = (m: TraceMetric) => TRACE_PEAK[m]?.value ?? 1;

/** His own top, floored so the cap holds. */
export function ownTop(t: Trace, m: TraceMetric, shared: number) {
  let top = 0;
  for (let i = 0; i < t.cells.length; i++) top = Math.max(top, cellVal(t, i, m) ?? 0);
  return Math.max(top || 1, shared / MAG_CAP);
}

/**
 * His best session in this metric — and NOTHING WHERE EVERY SESSION IS EQUAL.
 *
 * The comparison is strictly greater, so among identical readings it crowned
 * whichever came first on the spine and rang it. Three drawable careers have
 * nought penalty minutes in every session on file — Craig Pope over four
 * sessions and thirty-one games, Jeremy McDonald, Marc DeGiulio — and selecting
 * Penalty minutes drew a flat line on the baseline with a ring on the first of
 * four identical noughts, labelled 0, under a key reading "the best session".
 *
 * The archive names ties rather than breaking them — the longest-absence figure
 * says so in as many words, on the grounds that it was stating a shared fact
 * about one man more confidently than the data supports. A flat line is the
 * whole and honest statement of a clean career and there is nothing to add to
 * it. The same test declines a lone reading, which is a figure and not a best.
 */
export function peakOf(t: Trace, m: TraceMetric): { i: number; v: number } | null {
  let best: { i: number; v: number } | null = null;
  let floor: number | null = null;
  for (let i = 0; i < t.cells.length; i++) {
    const v = cellVal(t, i, m);
    if (v === null) continue;
    if (!best || v > best.v) best = { i, v };
    floor = floor === null ? v : Math.min(floor, v);
  }
  return best && floor !== null && best.v > floor ? best : null;
}

/** Contiguous runs of recorded sessions. Everything between two runs is a break. */
function runsOf(t: Trace, m: TraceMetric): Reading[][] {
  const out: Reading[][] = [];
  let run: Reading[] = [];
  for (let i = 0; i < t.cells.length; i++) {
    const c = t.cells[i];
    const v = cellVal(t, i, m);
    if (c && v !== null) run.push({ i, v });
    else if (run.length) {
      out.push(run);
      run = [];
    }
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * COLUMNS HE IS NAMED IN AND HAS NO FIGURE FOR — the third thing, and it was
 * being drawn as the second.
 *
 * `runsOf` breaks on a null reading, and until now a break had exactly one key
 * under it: "a session not played". Three sessions on file hold a roster and
 * almost no statistics — 2018 - Summer names fifteen and carries one figure,
 * 2018 - Winter fourteen and three, 2019 - Winter sixteen and two — so sixteen
 * drawable careers broke across seasons their own table three inches below
 * prints a row for, including the five longest on file. Richard Fedele's
 * twenty-nine sessions, Brett Koeppel's and Vincent Terrana's twenty-eight.
 *
 * The session-level shading cannot answer it: `shadeOf` sees the session, not
 * the man, and these sessions are not shaded because somebody in them does have
 * figures. It is a per-CELL fact — he is on the roster and the column beside his
 * name is empty — and it gets its own mark, on the baseline, where the reader
 * is already looking for whether there is anything there.
 *
 * The archive's whole thesis is the difference between a season nobody played
 * and a season nobody kept. This is the second one, told one man at a time.
 *
 * ON A RATE, "NOTHING RECORDED" MEANS THE CELL RECORDED NOTHING — not that the
 * division came out null. Points per game is null whenever either half of it is
 * missing, and three careers hold seasons with points and no games beside them:
 * Bryan Karchensky's 2018 - Summer is 19 goals, 18 assists, 37 points and no
 * games-played column, and 2018 - Winter is 72 points. Under this mark those
 * two became baseline ticks keyed "on the roster, nothing recorded", three
 * inches under his own table printing 37 and 72 in full — the archive accusing
 * its sources of a loss that did not happen, on the page of the man it did not
 * happen to. Adam Kaplewicz's 54-point season and Brent Boeing's 37 did the
 * same, and so did Brett Koeppel's real nought-game line, where the figures are
 * on file and there is simply nothing to divide by.
 *
 * So on a rate the tick is drawn only where the cell holds no figure at all,
 * which is the claim the key makes. Where the numerator survives and the
 * denominator does not, nothing is drawn and the line's own break stands.
 */
const EMPTY_OF = ["gp", "g", "a", "pts", "pim"] as const;

const blanksOf = (t: Trace, m: TraceMetric): number[] => {
  const out: number[] = [];
  for (let i = 0; i < t.cells.length; i++) {
    const c = t.cells[i];
    if (!c) continue;
    const blank = isRate(m)
      ? EMPTY_OF.every((k) => c[k] === null)
      : cellVal(t, i, m) === null;
    if (blank) out.push(i);
  }
  return out;
};

/**
 * WHICH MARKS THIS DRAWING ACTUALLY CARRIES.
 *
 * The ghost's key was made conditional on the grey shape being visible, on the
 * stated principle that a key pointing at a mark nobody can find teaches the
 * reader that the legend is decorative. The others were left standing whatever
 * was drawn. Over the 170 player-by-metric arcs the switcher can produce, that
 * was hundreds of rows of legend pointing at nothing on the drawing beside them.
 * A long block of key is the largest thing in the section and on a phone it is
 * twice the height of the drawing it explains; when most of it is inert the
 * reader stops reading the keys that carry the archive's real distinctions.
 *
 * `archiveOnly` was the sixth of these and is not a mark any more: it drew a dot
 * on every session that survives in the Internet Archive alone, which is where a
 * reading came from rather than what it is.
 *
 * Computed off the same functions the drawing marks with, so the legend shrinks
 * as a career fills in and nothing has to be kept in step by hand.
 */
export type Marks = {
  bands: boolean;
  gaps: boolean;
  best: boolean;
  blanks: boolean;
  breaks: boolean;
};

export function marksOf(
  t: Trace,
  m: TraceMetric,
  slots: readonly Slot[],
  detailed = false,
): Marks {
  const runs = runsOf(t, m);
  const read = runs.flat();
  const from = read[0]?.i ?? -1;
  const to = read[read.length - 1]?.i ?? -1;
  return {
    // A run of one draws a stem and a dot; the goal band needs two.
    bands: detailed && m === "pts" && runsOf(t, "g").some((r) => r.length > 1),
    gaps: gapBlocks(slots).length > 0,
    best: peakOf(t, m) !== null,
    blanks: blanksOf(t, m).length > 0,
    /* A BREAK IS A SESSION ON FILE HE IS NOT NAMED IN, which is what its key
       says — and the line also breaks at a column he IS named in with nothing
       in it, which is the tick's job and has its own key. Counted between his
       first reading and his last, because the spine before a man arrives is not
       a hole in his career. */
    breaks:
      from >= 0 &&
      slots.some((s, i) => i > from && i < to && s.kind === "session" && !t.cells[i]),
  };
}

// ------------------------------------------------------------------
// the drawing
// ------------------------------------------------------------------

type RidgeProps = {
  trace: Trace;
  slots: readonly Slot[];
  metric: TraceMetric;
  /** Highlighted column, shared by every row on the page. -1 for none. */
  col?: number;
  onColumn?: (i: number) => void;
  /** The arc: taller, named axis, gap runs answered, the peak labelled. */
  detailed?: boolean;
  className?: string;
};

export function Ridge({
  trace,
  slots,
  metric,
  col = -1,
  onColumn,
  detailed = false,
  className,
}: RidgeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drawn, setDrawn] = useState(!detailed);

  const h = detailed ? ARC_H : ROW_H;
  const padT = detailed ? ARC_PAD_T : ROW_PAD_T;
  const padB = detailed ? ARC_PAD_B : ROW_PAD_B;

  // Column position is by INDEX, never by sort. The spine is a sequence of
  // slots, so a session appearing between two others simply re-lays the row
  // out; nothing here assumes the slots are evenly spaced in time.
  const n = slots.length || 1;
  const cw = RIDGE_W / n;
  const cx = (i: number) => cw * (i + 0.5);
  const base = h - padB;
  const yOf = (v: number, top: number) => base - (v / top) * (h - padT - padB);

  const shared = sharedTop(metric);
  const top = ownTop(trace, metric, shared);
  const runs = runsOf(trace, metric);
  const blanks = blanksOf(trace, metric);
  const peak = peakOf(trace, metric);
  const blocks = gapBlocks(slots);
  const onFile = trace.cells.filter((c) => c).length;
  const sessionSlots = slots.filter((s) => s.kind === "session").length;

  // reveal, once, when the arc scrolls into view
  useEffect(() => {
    if (!detailed) return;
    const el = svgRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [detailed]);

  /**
   * The reveal, measured rather than guessed.
   *
   * This was `strokeDasharray: 2000`, which holds until a path is longer than
   * 2,000 user units — then the reveal finishes early and the tail of the line
   * snaps in. The dash is scaffolding: measured off the path itself, and
   * REMOVED once the reveal is over, because a dash left behind at yesterday's
   * length truncates tomorrow's longer path.
   */
  useIsoLayout(() => {
    if (!detailed) return;
    const el = svgRef.current;
    if (!el) return;
    // globals.css kills every transition under reduced motion, so the dash
    // would hide the line and then un-hide it a frame later with nothing in
    // between. Leave the drawing alone instead.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const paths = Array.from(el.querySelectorAll<SVGPathElement>("path[data-draw]"));
    for (const p of paths) {
      const len = p.getTotalLength();
      p.style.transition = "none";
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    }
    if (!drawn) return;
    const raf = requestAnimationFrame(() => {
      for (const p of paths) {
        p.style.transition = "stroke-dashoffset 1.4s cubic-bezier(0.33,0,0.2,1)";
        p.style.strokeDashoffset = "0";
      }
    });
    const clear = window.setTimeout(() => {
      for (const p of paths) {
        p.style.transition = "";
        p.style.strokeDasharray = "none";
        p.style.strokeDashoffset = "";
      }
    }, 1700);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clear);
    };
  }, [detailed, drawn, metric, trace.slug]);

  const areaPath = (run: Reading[], scale: number) => {
    let d = `M${cx(run[0]!.i).toFixed(1)},${base.toFixed(1)}`;
    for (const p of run) d += ` L${cx(p.i).toFixed(1)},${yOf(p.v, scale).toFixed(1)}`;
    d += ` L${cx(run[run.length - 1]!.i).toFixed(1)},${base.toFixed(1)} Z`;
    return d;
  };
  const linePath = (run: Reading[], scale: number) =>
    `M${run.map((p) => `${cx(p.i).toFixed(1)},${yOf(p.v, scale).toFixed(1)}`).join(" L")}`;

  const goalRuns = detailed && metric === "pts" ? runsOf(trace, "g") : [];

  // A label centred on the first or last column hangs off the edge; near an
  // edge it anchors to the column and reads inward instead.
  const peakX = peak ? cx(peak.i) : 0;
  const peakAnchor = peakX < RIDGE_W * 0.14 ? "start" : peakX > RIDGE_W * 0.86 ? "end" : "middle";
  const peakLabelX =
    peakAnchor === "start" ? peakX - 5 : peakAnchor === "end" ? peakX + 5 : peakX;

  return (
    <svg
      ref={svgRef}
      className={`${detailed ? "ca-arc" : "ca-ridge"}${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${RIDGE_W} ${h}`}
      role="img"
      aria-label={`${trace.name}: ${METRIC_LABEL[metric]} by session, ${onFile} of ${sessionSlots} sessions on file.`}
    >
      <defs>
        <linearGradient id={`ca-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--paint-b)" stopOpacity="0.34" />
          <stop offset="1" stopColor="var(--paint-b)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* sessions the archive never had — a run of one answer is one block */}
      {blocks.map((b) => {
        const mid = cw * (b.from + b.n / 2);
        return (
          <g key={`gap${b.from}`}>
            <rect
              className="ca-gap"
              x={(cw * b.from).toFixed(1)}
              y={0}
              width={(cw * b.n).toFixed(1)}
              height={h}
            />
            {/* At 620px and under these render at 2.59px, which is texture
                rather than type. The shading still says a column is empty and
                the readout and the box both name which. */}
            {detailed && (
              <text
                className="ca-gapword ca-wide"
                x={mid.toFixed(1)}
                y={base - 8}
                transform={`rotate(-90 ${mid.toFixed(1)} ${base - 8})`}
              >
                {b.words.toUpperCase()}
              </text>
            )}
          </g>
        );
      })}

      {/* goals below, assists on top of them. The ridge is still points, and
          points is goals plus assists in every complete line on file. */}
      {goalRuns.map((r, k) =>
        r.length < 2 ? null : (
          <g key={`gl${k}`}>
            <path className="ca-goals" d={areaPath(r, top)} />
            <path className="ca-seam" d={linePath(r, top)} />
            <path className="ca-seam-lit" d={linePath(r, top)} />
          </g>
        ),
      )}

      <line className="ca-base" x1={0} x2={RIDGE_W} y1={base} y2={base} />

      {/* named in the session, nothing in the column beside his name */}
      {blanks.map((i) => (
        <line
          key={`bl${i}`}
          className="ca-blank"
          x1={(cx(i) - (detailed ? 3.4 : 2.4)).toFixed(1)}
          x2={(cx(i) + (detailed ? 3.4 : 2.4)).toFixed(1)}
          y1={base}
          y2={base}
          strokeWidth={detailed ? 2.6 : 2}
        />
      ))}

      {/* his own shape, capped */}
      {runs.map((r, k) => {
        if (r.length === 1) {
          const y = yOf(r[0]!.v, top);
          return (
            <g key={`ow${k}`}>
              <line
                className="ca-stem"
                x1={cx(r[0]!.i)}
                x2={cx(r[0]!.i)}
                y1={y}
                y2={base}
                strokeWidth={detailed ? 1.6 : 1.2}
              />
              <circle className="ca-lone" cx={cx(r[0]!.i)} cy={y} r={detailed ? 3 : 2.2} />
            </g>
          );
        }
        return (
          <g key={`ow${k}`}>
            <path d={areaPath(r, top)} fill={`url(#ca-fill-${uid})`} />
            <path
              className="ca-line"
              data-draw=""
              d={linePath(r, top)}
              strokeWidth={detailed ? 2 : 1.5}
            />
          </g>
        );
      })}

      {col >= 0 && col < n && (
        <g className="ca-crossg">
          <line className="ca-cross" x1={cx(col)} x2={cx(col)} y1={0} y2={h} />
          {cellVal(trace, col, metric) !== null && (
            <circle
              className="ca-here"
              cx={cx(col)}
              cy={yOf(cellVal(trace, col, metric)!, top)}
              r={3}
            />
          )}
        </g>
      )}

      {/* ONE KIND OF DOT: his best. The other marked every session that
          survives in the Internet Archive alone — where the reading was found,
          drawn on top of what the reading is — and the captain's ruling is that
          a reader of a career does not want the source marked here. It was up to
          eleven dots on a single arc, in the register the peak uses, answering a
          question nobody reading a timeline asked. The provenance is untouched
          in the corpus and still on the pages built to state it. */}
      {peak && (
        <g>
          <circle
            className="ca-peak"
            cx={cx(peak.i)}
            cy={yOf(peak.v, top)}
            r={detailed ? 4 : 2.6}
            strokeWidth={detailed ? 1.8 : 1.6}
          />
          {detailed && (
            <>
              {/* A peak in the first or last column would hang its label off
                  the edge of the drawing, so the label turns to face inward. */}
              {/* 25 put the 7.5px session name inside the 13px figure's own
                  box — a measured 2.8px of collision at 1600 down to 1.1px at
                  1280, which is two labels touching rather than two labels
                  stacked. 30 clears it at every width tested, and ARC_PAD_T is
                  42, so the label still has headroom above a peak drawn at the
                  very top of the plot. */}
              <text
                className="ca-peakwhen ca-wide"
                x={peakLabelX}
                y={yOf(peak.v, top) - 30}
                textAnchor={peakAnchor}
              >
                {axisLabel(slots[peak.i]).toUpperCase()}
              </text>
              <text
                className="ca-peakval ca-wide"
                x={peakLabelX}
                y={yOf(peak.v, top) - 11}
                textAnchor={peakAnchor}
              >
                {fmtMetric(peak.v, metric)}
              </text>
              {/* The same figure, alone, at a size that survives the container.
                  Inline rather than an attribute: `.ca-peakval` sets font-size
                  in the stylesheet and a presentation attribute loses to it. */}
              <text
                className="ca-peakval ca-narrow"
                x={peakLabelX}
                y={yOf(peak.v, top) - 14}
                textAnchor={peakAnchor}
                style={{ fontSize: NARROW_PEAK }}
              >
                {fmtMetric(peak.v, metric)}
              </text>
            </>
          )}
        </g>
      )}

      {/* every half-year named: his own record and the archive's holes, once */}
      {detailed && (
        <>
          <text className="ca-zero ca-wide" x={2} y={base - 4}>
            0
          </text>
          {slots.map((s, i) => (
            <text
              key={`ax${s.sort}`}
              className={trace.cells[i] ? "ca-ax ca-wide on" : "ca-ax ca-wide"}
              x={cx(i)}
              y={base + 13}
              transform={`rotate(-54 ${cx(i).toFixed(1)} ${base + 13})`}
            >
              {axisLabel(s)}
            </text>
          ))}

          {/* Three anchors, flat. Thirty-three rotated names at 375 are 3.05px
              of ink and no reader; the whole spine is in the log table under
              the drawing either way. Same construction and the same three ends
              the timelines' own axis has always used. */}
          {[0, Math.floor((n - 1) / 2), n - 1]
            .filter((i, k, all) => i >= 0 && all.indexOf(i) === k)
            .map((i) => (
              <text
                key={`nx${i}`}
                className="ca-axn ca-narrow"
                x={i === 0 ? 0 : i === n - 1 ? RIDGE_W : cx(i)}
                y={base + NARROW_TEXT + 6}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                style={{ fontSize: NARROW_TEXT }}
              >
                {axisLabel(slots[i])}
              </text>
            ))}
        </>
      )}

      {/* one hit target per half-year, carrying its reading as a title */}
      {slots.map((s, i) => (
        <rect
          key={`hit${s.sort}`}
          className="ca-hit"
          x={(cw * i).toFixed(1)}
          y={0}
          width={cw.toFixed(1)}
          height={h}
          onMouseEnter={onColumn ? () => onColumn(i) : undefined}
        >
          <title>
            {`${s.label}: ${
              s.kind === "session"
                ? `${fmtMetric(cellVal(trace, i, metric), metric)} ${METRIC_LABEL[metric]}`
                : "not on file"
            }`}
          </title>
        </rect>
      ))}
    </svg>
  );
}

/**
 * What each mark means, once, for both sizes of the drawing.
 *
 * EVERY KEY IS A MARK ON THE DRAWING BESIDE IT — and, since the ghost came off
 * the drawing, EVERY MARK ON THE DRAWING HAS A KEY. The booleans come from
 * `marksOf`, off the same functions the drawing marks with; the defaults are
 * every key, which is what the grid of forty careers under /seasons needs.
 *
 * The scale keys — "its own scale", "the same career, scaled to the biggest
 * session on file", and the citation under them — were three rows of legend
 * naming another man's season on every career on the site, including on the
 * pages of the men it is not about. Raised twice; reworded once; cut. The grey
 * shape they pointed at outlived them by one round and is cut now as well.
 */
export function RidgeLegend({
  bands = false,
  gaps = true,
  best = true,
  blanks = true,
  breaks = true,
}: Partial<Marks>) {
  return (
    <div className="ca-legend">
      {bands && (
        <>
          <span>
            <i className="ca-key ca-key-goals" />
            goals
          </span>
          <span>
            <i className="ca-key ca-key-line" />
            assists on top of them — the ridge is points
          </span>
        </>
      )}
      {/* ONE KEY FOR EVERY SHADED COLUMN, and one rule behind them: a column is
          shaded where no scoring line survives. That is true of a half-year
          with no session and of a session named men are on with nothing
          recorded beside them, and the arc writes which of the two it is down
          the column itself.
          IT SAID "NO STATISTICS ON FILE", WHICH WAS WIDER THAN ITS OWN TEST.
          The coverage chart calls the same two columns a FRAGMENT of the
          statistics, and the chart is right — 2019 - Summer carries a full
          league standings row and 2020 - Winter a goaltender's season. Two
          instruments a reader crosses between constantly, making opposite
          claims about the two sessions the archive worked hardest to prove
          were played. The predicate never changed; the noun did. */}
      {gaps && (
        <span>
          <i className="ca-key ca-key-gap" />
          no scoring on file
        </span>
      )}
      {/* The archive-only key is gone with the dot it pointed at. */}
      {best && (
        <span>
          <i className="ca-key ca-key-best" />
          the best session
        </span>
      )}
      {/* THE THIRD ANSWER, which used to be told as the second. A man on a
          roster whose statistics never survived was drawn as a break under a
          key reading "a session not played" — the archive telling sixteen
          careers, the five longest among them, that they sat out three seasons
          it names them on. */}
      {blanks && (
        <span>
          <i className="ca-key ca-key-blank" />
          on the roster, nothing recorded
        </span>
      )}
      {/* "a session he did not play" — the archive's word for a player is
          players, and this legend was the last place on the page that said
          otherwise. The claim is narrower than it was, too: with the mark above
          drawn and the empty columns shaded, what is left of a break is a
          session on file that does not carry his name. */}
      {breaks && (
        <span>
          <i className="ca-key ca-key-break" />
          a break — not named in a session on file
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// the player page
// ------------------------------------------------------------------

/**
 * The arc on a man's own page — the whole spine, not his slice of it.
 *
 * `gaps` used to be filtered to `sort >= firstSort && sort <= lastSort`, so a
 * career beginning in 2016 hid the fact that 2013 to 2015 are missing, while
 * the same man's row on /seasons showed it. Two pictures of one career
 * disagreeing about the archive is worse than either picture on its own.
 *
 * FIVE READINGS, THE SAME FIVE THE ARCHIVE'S OWN TIMELINES OFFER. This drew
 * points and nothing else, so a defenceman with 4 goals and 17 assists and a
 * scorer with the reverse were the same picture on their own pages while
 * /seasons could tell them apart. `TRACE_METRICS` is the one list, `Ridge` is
 * the one drawing, and the chips are the control the timelines already use —
 * a reader who clicks a name off that grid arrives at something he recognises.
 *
 * A METRIC WITH NOTHING BEHIND IT IS NOT OFFERED. Absence is not zero (§2.4),
 * and a chip that draws an empty axis is that rule broken in the one place a
 * man reads his own career. Every drawable career on file today carries all
 * five, so the filter removes nothing and guards the day it does not.
 *
 * A CAREER GOALTENDER STILL HAS NO ARC, and a metric switcher does not change
 * that: his scoring columns are the platform's rather than the man's — 22 lines
 * of DigitalShift noughts for Corey Muff, whose one career point is a puck he
 * shot the length of the ice — and every one of the five would draw that. The
 * cut is two SKATER seasons, and it is `drawableSessions` in lib/stats.ts, the
 * same function the /seasons grid cuts on. His record is `In goal`, one section
 * above, in a goaltender's own figures.
 *
 * TWO READINGS, NOT TWO LINES AND NOT TWO MENTIONS. `skaterSeasons.length >= 2`
 * counted rows, and seven careers are one session split into a regular season
 * and a playoff run: both lines fold into the same cell, so the drawing came
 * out one stem and one dot on a thirty-three-column axis under a five-way
 * switcher, every reading of which is already a tile in the hero and a row in
 * the table between them. Dylan McLaughlin's was a dot on the baseline labelled
 * 0 under a key reading "the best session". Counting distinct sessions then let
 * Casey Krug and Matt Phalzer through, who are NAMED in two and have figures in
 * one. lib/stats.ts states the rule both breaches broke — one session is a dot,
 * and there is no line through a dot.
 */
export default function CareerArc({ player }: { player: Player }) {
  const [metric, setMetric] = useState<TraceMetric>("pts");
  if (drawableSessions(player) < TRACE_MIN_SESSIONS) return null;

  const trace = traceOf(player);
  const offered = TRACE_METRICS.filter((m) =>
    trace.cells.some((c) => c !== null && c[m.key] !== null),
  );
  const shown = offered.some((m) => m.key === metric) ? metric : (offered[0]?.key ?? "pts");
  const total = trace.totals[shown];

  return (
    <>
      {/* Outside the figure, not inside it: a figcaption has to be the first or
          the last child of its figure, and a control above the caption makes it
          neither. Same position and the same class the timelines' control
          takes, so the two read as one instrument at two sizes. */}
      {offered.length > 1 && (
        <div className="st-controls">
          <span className="st-field" role="group" aria-label="Metric">
            <span>Show</span>
            {offered.map((m) => (
              <button
                key={m.key}
                type="button"
                className="st-chip"
                aria-pressed={shown === m.key}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </span>
        </div>
      )}

      <figure className="ca">
        <figcaption className="ca-cap">
          {/* THE CAREER IN THE UNITS ON SCREEN. It read "21 points — 4 goals,
              17 assists in 35 games" whatever the drawing was set to, and all
              four of those figures are tiles in the hero at the top of this
              page. One figure, the one the arc is drawn in, through the same
              formatter the timelines use. A rate takes no games clause: "0.60
              points per game in 35 games" divides the number beside it. */}
          <span className="ca-line1">
            <b>{fmtMetric(total, shown)}</b> {METRIC_LABEL[shown]}
            {!isRate(shown) && trace.gp ? ` in ${num(trace.gp)} games` : ""}
          </span>
        </figcaption>

        <Ridge trace={trace} slots={SPINE} metric={shown} detailed />

        {/* The keys this drawing has marks for, and no others. */}
        <RidgeLegend {...marksOf(trace, shown, SPINE, true)} />
      </figure>
    </>
  );
}
