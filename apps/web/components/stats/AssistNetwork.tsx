"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { num, plural } from "../../lib/format";
import type { NetEdge, NetNode } from "../../lib/stats";

/**
 * Nobody ever recorded a line chart. Every edge here is a scorekeeper writing
 * two names next to one goal, and the only thing this drawing adds is that the
 * names are now in the same place at the same time.
 *
 * The layout is computed at build time and shipped in the HTML, so the graph is
 * a picture before any JavaScript runs. What the JavaScript adds is the ability
 * to ask it a question. Everything below — the light on each man, the lit edges
 * — is markup and CSS for the same reason: it is all in the first paint, and
 * none of it is computed in a frame loop. There is no drift; twenty lines down
 * is the measurement that took it out, and this list named it for a round after.
 *
 * Direction is real and is preserved: an assist goes FROM a passer TO a scorer,
 * and those are different acts. Each pair curves to one side, so a mutual pair
 * draws as two arcs and a one-way pair draws as one.
 */

const S = 560;
const PAD = 42;
const SPAN = S - PAD * 2;
const px = (v: number) => PAD + (v / 100) * SPAN;

/**
 * THE DRIFT IS GONE, AND THE MEASUREMENT IS WHY.
 *
 * Forty disc groups wandered on a 34-second loop at 1.9 units in a 560-unit
 * box. Measured on the built layout: 2.57 screen pixels at the worst node at
 * 1440 and 2.15 on average, over half a minute — less than the stroke width on
 * the arcs, and below the threshold of noticing. Frame-differencing the figure
 * put 0.12% of its pixels past six levels in half a second.
 *
 * It could not be taken up to where it would read, either. The arcs are fixed
 * and end at a node's CENTRE, so an arc stays joined only while the joint is
 * still under the disc that is painted over it — and the smallest disc in the
 * graph has a radius of 4.05 against a worst wander of 1.93, which is 2.12
 * units of headroom. Anything past about four detaches the thinnest arcs from
 * the smallest men, one node at a time, in a drawing whose whole subject is who
 * is joined to whom.
 *
 * The gate was inverted as well: it asked for 901px and up, which is the width
 * at which the figure goes to two columns and the drawing SHRINKS to about
 * 480px. The one band where the graph is largest — a single-column phone or
 * tablet — was the band with no drift at all.
 *
 * A permanent repaint of a 744px SVG for two and a half pixels is not an
 * element earning its place. The lamps stay: they are doing real work.
 */

/**
 * THE LIGHT.
 *
 * The site's one visual rule is a near-black ground with subjects that glow
 * from within, and this figure had none of it: twenty-eight — now forty —
 * flat grey discs on a smudge of grey arcs, with every man the same
 * temperature as the ruled lines behind him.
 *
 * So each man is a lamp, and the lamp says something. Its SIZE follows the
 * disc, which already carries how many goals he is named on. Its COLOUR is the
 * direction his assists run — the same blue and red the arcs and the legend
 * already use for setting up and being set up — so a passer burns blue, a
 * finisher burns red, and a man who does both in equal measure barely tints at
 * all. Nothing is added to the page to explain that; the key under the drawing
 * already says what the two colours mean.
 */
function lampOf(gave: number, got: number, total: number) {
  const tilt = (gave - got) / Math.max(1, gave + got);
  // A man with one assist is 100 per cent one thing and it means nothing, so
  // how far the colour commits is damped by how much there is to go on.
  const said = Math.min(1, Math.abs(tilt) * 2.6) * Math.min(1, total / 25);
  // sqrt, because the disc radius is sqrt too and the light has to sit with it
  const size = 0.24 + Math.min(0.44, Math.sqrt(total) / 46);
  return {
    blue: tilt >= 0,
    // A balanced man is dim rather than absent: he still glows, he just does
    // not claim a side.
    glow: +(size * (0.6 + 0.4 * said)).toFixed(3),
  };
}

/**
 * THE LAMP IS AN ANNULUS, NOT A CLOUD.
 *
 * The disc is drawn over the middle of it, so the only part of the gradient a
 * reader ever sees is the ring outside radius r — and a falloff tuned as if the
 * centre were visible puts all its light where the disc already is and leaves a
 * grey fog outside. Capped as well: unclamped, the biggest man's light is
 * fifty-one units across against twenty-seven between the closest two discs,
 * and forty lamps that overlap are one haze.
 */
const lampR = (r: number) => Math.min(r * 1.9 + 5, 36);

/**
 * WHAT YOU CAN ACTUALLY HIT.
 *
 * The disc carries how many goals a man is named on, so the smallest men in the
 * graph are the smallest targets — and every one of the forty is announced as a
 * button and wears a pointer. Measured at 375, where the drawing has the whole
 * 297px column: the transparent ring rendered at 7.48px minimum and 11.47px
 * median, thirty-seven of forty under 24px and all forty under the 44px this
 * page's own nav links were deliberately raised to. Even at 1440 fifteen are
 * under 24. On a phone hover does not exist, so tapping is the only way to drive
 * the readout, and the labels are correctly hidden below 620px — so it is also
 * the only way to learn who any disc is.
 *
 * 24 UNITS, WHICH IS THE LARGEST FLOOR THE LAYOUT ALLOWS. The hit circle is
 * transparent and may overlap another man's hit circle without harm, but it may
 * NOT reach another man's disc, or a tap on a disc lands on somebody else.
 * Measured on the built layout, the tightest a node sits to a neighbour's drawn
 * edge is 28.93 units, so 24 clears every disc in the graph with room. It
 * renders 25.4px at 375, 20.7px at 320 and 41.1px at 1440 — the reference width
 * clears the floor, the narrowest does not, and no radius that clears it there
 * leaves the discs alone.
 *
 * It is its own circle rather than a bigger `.ring`, because `.ring` is what the
 * pin and the focus outline are drawn on and a 24-unit halo around a four-unit
 * disc is a different drawing.
 */
const HIT_R = 24;

/** The figure's own rules, kept with the figure. */
const NET_CSS = `
.st-net .lamp { pointer-events: none; transition: opacity .3s cubic-bezier(0.33,0,0.2,1); }
/* The target, and nothing else: never a stroke, never a fill, never a
   transition. See HIT_R for why it is 24 units and not 12 or 44. */
.st-net .hit { fill: transparent; }
.st-net .st-node:hover .core, .st-net .st-node:focus-visible .core { stroke: var(--ball); }
/* The answer to the question glows; the rest of the web does not. Bounded to
   the arcs of one man — a drop-shadow is a filter, and 324 of them is a
   different page. */
.st-net .st-edge.lit-b { filter: drop-shadow(0 0 2.5px rgba(91,155,213,0.75)); }
.st-net .st-edge.lit-r { filter: drop-shadow(0 0 2.5px rgba(212,85,90,0.75)); }
`;

type Props = { nodes: NetNode[]; edges: NetEdge[]; assists: number };

export default function AssistNetwork({ nodes, edges, assists }: Props) {
  const [hot, setHot] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [min, setMin] = useState(1);
  const refs = useRef<(SVGGElement | null)[]>([]);

  const at = useMemo(() => new Map(nodes.map((n) => [n.name, n])), [nodes]);
  const live = useMemo(() => edges.filter((e) => e.n >= min), [edges, min]);
  /** The busiest pairs, deepest first — the readout takes the first and the
   *  list under it takes the ones behind it. Off `live`, so the slider moves
   *  both: a filter that hides pairs has to hide them here too. */
  const ranked = useMemo(() => [...live].sort((x, y) => y.n - x.n), [live]);
  const top = ranked[0] ?? null;
  const restPairs = useMemo(() => ranked.slice(1, 19), [ranked]);
  const who = hot ?? pin;

  const neighbours = useMemo(() => {
    if (!who) return null;
    const s = new Set<string>([who]);
    for (const e of live) {
      if (e.from === who) s.add(e.to);
      if (e.to === who) s.add(e.from);
    }
    return s;
  }, [who, live]);

  const focus = who ? at.get(who) : undefined;
  const focusEdges = useMemo(
    () => (who ? live.filter((e) => e.from === who || e.to === who).sort((a, b) => b.n - a.n) : []),
    [who, live],
  );
  const gaveHere = focusEdges.filter((e) => e.from === who).reduce((t, e) => t + e.n, 0);
  const gotHere = focusEdges.filter((e) => e.to === who).reduce((t, e) => t + e.n, 0);

  const shownAssists = live.reduce((t, e) => t + e.n, 0);
  // At rest only the busiest six are named, because 28 labels over 153 curves is
  // a smudge. Everyone is named on hover, on focus, and in the table below.
  const big = new Set(nodes.slice(0, 6).map((n) => n.name));

  const move = (i: number, d: number) => {
    const n = Math.min(nodes.length - 1, Math.max(0, i + d));
    refs.current[n]?.focus();
  };

  const arc = (e: NetEdge) => {
    const a = at.get(e.from)!;
    const b = at.get(e.to)!;
    const x1 = px(a.x);
    const y1 = px(a.y);
    const x2 = px(b.x);
    const y2 = px(b.y);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy) || 1;
    // Bend consistently to one side of the direction of travel, so from->to and
    // to->from never sit on top of each other.
    const bend = Math.min(d * 0.18, 26);
    return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${(mx - (dy / d) * bend).toFixed(1)},${(my + (dx / d) * bend).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NET_CSS }} />
      <div className="st-controls">
        <label className="st-field">
          <span>Pairs of at least</span>
          <input
            type="range"
            min={1}
            max={8}
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            aria-label={`Show pairs of at least ${min} assists`}
          />
          {/* THE SLIDER'S OWN VALUE AND NOTHING ELSE. The section's permanent
              summary — every pair and every assist on file — was wedged in here
              too, in 11px inside a form control, while a mouse-over state 200px
              below got a bordered panel and a display face. This section gave
              up its kicker on the grounds that the readout prints both figures
              and has to; it now prints them. */}
          <span style={{ letterSpacing: 0, textTransform: "none", fontSize: 11, color: min > 1 ? "var(--ink)" : "var(--dim)" }}>
            {plural(min, "assist")}
          </span>
        </label>
        {pin && (
          <button type="button" className="st-chip" onClick={() => setPin(null)}>
            Unpin {pin}
          </button>
        )}
      </div>

      <div className="st-graph">
        <svg
          className="st-net"
          viewBox={`0 0 ${S} ${S}`}
          role="group"
          aria-label={`Assist network: ${plural(nodes.length, "player")}, ${plural(edges.length, "directed pair")}, ${plural(assists, "assist")}. Every pair is listed in the table below this figure.`}
          onMouseLeave={() => setHot(null)}
        >
          <defs>
            <marker id="st-ar-b" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,1 L7,4 L0,7 z" fill="var(--paint-b)" />
            </marker>
            <marker id="st-ar-r" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,1 L7,4 L0,7 z" fill="var(--paint-r)" />
            </marker>
            {/* The lamp. Two gradients, not forty: the colour is which way a
                man's assists run, and there are two ways. */}
            <radialGradient id="st-lamp-b">
              <stop offset="0%" style={{ stopColor: "var(--paint-b)", stopOpacity: 1 }} />
              <stop offset="52%" style={{ stopColor: "var(--paint-b)", stopOpacity: 0.86 }} />
              <stop offset="76%" style={{ stopColor: "var(--paint-b)", stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: "var(--paint-b)", stopOpacity: 0 }} />
            </radialGradient>
            <radialGradient id="st-lamp-r">
              <stop offset="0%" style={{ stopColor: "var(--paint-r)", stopOpacity: 1 }} />
              <stop offset="52%" style={{ stopColor: "var(--paint-r)", stopOpacity: 0.86 }} />
              <stop offset="76%" style={{ stopColor: "var(--paint-r)", stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: "var(--paint-r)", stopOpacity: 0 }} />
            </radialGradient>
          </defs>

          <g>
            {live.map((e) => {
              const out = who === e.from;
              const inn = who === e.to;
              const dim = who !== null && !out && !inn;
              return (
                <path
                  key={`${e.from}|${e.to}`}
                  className={`st-edge${out ? " lit-b" : inn ? " lit-r" : ""}`}
                  d={arc(e)}
                  stroke={out ? "var(--paint-b)" : inn ? "var(--paint-r)" : "var(--dim)"}
                  strokeOpacity={dim ? 0.06 : out || inn ? 0.85 : 0.24}
                  strokeWidth={0.4 + Math.log1p(e.n) * 1.15}
                  strokeLinecap="round"
                  markerEnd={out ? "url(#st-ar-b)" : inn ? "url(#st-ar-r)" : undefined}
                />
              );
            })}
          </g>

          <g>
            {nodes.map((n, i) => {
              const near = neighbours?.has(n.name) ?? true;
              const self = who === n.name;
              const r = 3 + Math.sqrt(n.total) * 1.05;
              const label = self || (who ? near : big.has(n.name));
              const lamp = lampOf(n.gave, n.got, n.total);

              // Names ride outward, away from the middle. A force layout puts
              // the busiest men in the centre, which is exactly where their
              // labels would otherwise land on top of each other.
              const ang = Math.atan2(px(n.y) - S / 2, px(n.x) - S / 2);
              const lx = px(n.x) + Math.cos(ang) * (r + 6);
              const ly = px(n.y) + Math.sin(ang) * (r + 6) + 3;
              const anchor = Math.cos(ang) > 0.3 ? "start" : Math.cos(ang) < -0.3 ? "end" : "middle";
              return (
                <g
                  key={n.name}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  className={`st-node${near ? " hot" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-pressed={pin === n.name}
                  aria-label={`${n.name}: set up ${n.gave} goals, was set up for ${n.got}, with ${n.partners} different teammates.`}
                  onMouseEnter={() => setHot(n.name)}
                  onFocus={() => setHot(n.name)}
                  onBlur={() => setHot(null)}
                  onClick={() => setPin((p) => (p === n.name ? null : n.name))}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
                    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
                    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPin((p) => (p === n.name ? null : n.name)); }
                  }}
                >
                  <circle
                    className="lamp"
                    cx={px(n.x)}
                    cy={px(n.y)}
                    r={lampR(r)}
                    fill={`url(#st-lamp-${lamp.blue ? "b" : "r"})`}
                    opacity={who ? (self ? Math.min(0.85, lamp.glow * 2.1) : near ? lamp.glow : lamp.glow * 0.16) : lamp.glow}
                  />
                  <circle
                    className="hit"
                    cx={px(n.x)}
                    cy={px(n.y)}
                    r={Math.max(r + 3, HIT_R)}
                    fill="transparent"
                  />
                  <circle
                    className="ring"
                    cx={px(n.x)}
                    cy={px(n.y)}
                    r={r + 3}
                    fill="transparent"
                    stroke={pin === n.name ? "var(--ball)" : "transparent"}
                    strokeWidth="1.4"
                  />
                  <circle
                    className="core"
                    cx={px(n.x)}
                    cy={px(n.y)}
                    r={r}
                    fill={self ? "var(--ball-pure)" : "var(--dim)"}
                    // The rim carries the same reading as the light: every disc
                    // used to wear the passer's blue whether the man passed or
                    // finished. It has a key under the drawing now — a ratio is
                    // not a direction, and no reader gets there unaided.
                    stroke={self ? "var(--ball)" : lamp.blue ? "var(--paint-b)" : "var(--paint-r)"}
                    strokeWidth={self ? 1.6 : 1}
                    opacity={who && !near ? 0.22 : 1}
                  />
                  {/* a white halo, so a name over a bundle of curves is still a name */}
                  <text
                    x={lx}
                    y={ly}
                    textAnchor={anchor}
                    style={{ fontSize: 9, paintOrder: "stroke", strokeLinejoin: "round" }}
                    stroke="var(--ice)"
                    strokeWidth="3"
                    opacity={label ? 1 : 0}
                    fill={self ? "var(--ink)" : undefined}
                  >
                    {n.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div>
          <div className="st-readout" aria-live="polite">
            {/* THE EMPTY STATE SAYS NOTHING ABOUT THE INTERFACE. It used to
                carry three sentences of instruction — hover, tab or click; what
                size means; which way a line runs — under a heading that repeats
                the section's own. The colour half of it was already in the
                legend below, and the rest belongs there too: an encoding key is
                a legend, not a paragraph, and this page does not explain itself
                to a reader looking straight at it. */}
            {!focus ? (
              <>
                {/* "Pick a name" was the only imperative addressed to the reader
                    anywhere on this page, and the slot beside it holds a figure
                    in every other state. It holds one here too: the busiest pair
                    on file, which is the answer the graph exists to give. */}
                <span className="k">{top ? `${top.from} → ${top.to}` : "Assist network"}</span>
                <span className="v" style={{ color: "var(--dim)" }}>
                  {top ? `${top.n} assist${top.n === 1 ? "" : "s"}` : "—"}
                </span>
                {/* WHAT IS DRAWN, IN THE PANEL THAT ANSWERS FOR IT. The resting
                    state is the section's only permanent statement of its own
                    size, and it counts out of the whole the moment the filter
                    starts hiding pairs — which is the one place the reader can
                    see what the slider just did. */}
                <span className="n">
                  {min > 1 ? `${live.length} of ${edges.length}` : num(edges.length)} pairs ·{" "}
                  {min > 1 ? `${num(shownAssists)} of ${num(assists)}` : num(assists)} assists
                </span>
              </>
            ) : (
              <>
                <span className="k">
                  {focus.partners} teammate{focus.partners === 1 ? "" : "s"}
                  {pin === focus.name ? " · pinned" : ""}
                </span>
                <span className="v">
                  <Link href={`/players/${focus.slug}`}>{focus.name}</Link>
                </span>
                <span className="n">
                  Set up <b style={{ color: "var(--paint-b)" }}>{gaveHere}</b> goals · was set up for{" "}
                  <b style={{ color: "var(--paint-r)" }}>{gotHere}</b>
                  {min > 1 && (
                    <>
                      {" "}
                      <span className="st-miss">(of {focus.gave} and {focus.got}; the filter is hiding the rest)</span>
                    </>
                  )}
                </span>
              </>
            )}
          </div>

          {/* THE COLUMN HOLDS SOMETHING BEFORE A NAME IS PICKED.
              At 1440 the figure is 1242 wide, laid out 744 and 480, and the
              right column's whole content was a 115px card — a quarter of the
              section's area was one empty rectangle, and it is the only place on
              the page where a whole screen-third carries nothing. What fills it
              is not decoration: it is the same list the focused state already
              draws, holding the pairs behind the one the panel has just named.
              STARTING AT THE SECOND, because the first is the line directly
              above it and this page does not print a figure twice.
              AND IT FILLS THE COLUMN NOW. Eight rows under a 300px cap left 332
              of the graph's 744px still empty — 12% of the card, and the largest
              piece of unearned space left on the page. The list is as long as
              the column is: eighteen rows rendered, capped at the graph's height
              where the two share a row and at the old 300px where the layout
              stacks, so a phone does not get eighteen rows in a scroller. */}
          {(focus ? focusEdges : restPairs).length > 0 && (
            <div className="st-pairs" style={{ display: "grid", gap: 1, background: "var(--line)", border: "1px solid var(--line)", overflow: "auto" }}>
              {(focus ? focusEdges : restPairs).map((e) => {
                const out = !focus || e.from === focus.name;
                const other = focus ? (out ? e.to : e.from) : `${e.from} → ${e.to}`;
                return (
                  <div
                    key={`${e.from}|${e.to}`}
                    style={{
                      background: "rgba(56,62,78,0.12)",
                      padding: "7px 10px",
                      display: "grid",
                      gridTemplateColumns: focus ? "auto 1fr auto" : "1fr auto",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 11.5,
                    }}
                  >
                    {/* The arrow is the focused man's side of the pair. At rest
                        neither name is the subject, so the direction is inside
                        the row and the column comes off rather than standing
                        empty. */}
                    {focus && (
                      <span style={{ color: out ? "var(--paint-b)" : "var(--paint-r)" }}>{out ? "→" : "←"}</span>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{other}</span>
                    <b style={{ fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>{e.n}</b>
                  </div>
                );
              })}
            </div>
          )}

          {/* ONE KEY PER MARK ACTUALLY DRAWN, WHICH AT REST IS THREE.
              `stroke` falls through to --dim for every one of the curves unless
              a name is picked, so at rest the figure holds grey arcs and
              blue-and-red discs — and the legend opened with a blue swatch
              reading "set up a goal" and a red one reading "was set up", about
              two colours no arc on screen is wearing. The same two hues ARE on
              every disc, carrying something else entirely: a ratio, which way a
              man's own assists run. One pair of colours, two meanings, both
              stated, nothing distinguishing them, and the reading that is on
              screen was the third of five entries.
              This component already retired the arrowhead key on exactly this
              reasoning — "a key claiming direction over a picture that does not
              show it is a key for something else" — and left the two colour keys
              standing with the same defect. They belong to the focused state and
              appear with it, in the two colours the readout beside them prints
              `Set up N · was set up for N` in, and as RULES rather than blocks,
              because the mark they point at is a curve. */}
          <div className="st-legend" aria-hidden="true" style={{ marginTop: 0 }}>
            {/* THE DISCS CARRY A SECOND READING AND THE KEY HAD NOTHING FOR IT.
                Every rim and every lamp used to be the passer's blue; they take
                the tilt of a man's own assists now, which is a RATIO rather than
                a direction — and no reader gets from a red halo to "set up more
                often than he sets up" unaided. It is not the site explaining
                what can be seen; it is a reading that cannot be seen at all.
                Size keeps its own line, because size is a count. */}
            <span><i className="st-key st-key-tilt" /> which way his assists run</span>
            <span><i className="st-key" style={{ background: "var(--ink)", borderRadius: "50%", opacity: .5 }} /> goals named on</span>
            <span><i className="st-key" style={{ height: 0, borderTop: "1.5px solid var(--dim)", borderRadius: 0 }} /> a pair</span>
            {focus && (
              <>
                <span><i className="st-key" style={{ height: 0, borderTop: "1.5px solid var(--paint-b)", borderRadius: 0 }} /> he set up</span>
                <span><i className="st-key" style={{ height: 0, borderTop: "1.5px solid var(--paint-r)", borderRadius: 0 }} /> he was set up</span>
              </>
            )}
          </div>
        </div>
      </div>

      <details>
        <summary>All {edges.length} pairs, as a table</summary>
        <div className="scroll st-tall">
          <table>
            <thead>
              <tr>
                <th className="l" scope="col">Passer</th>
                <th className="l" scope="col">Scorer</th>
                <th scope="col">Assists</th>
                <th className="l" scope="col">Return trip</th>
              </tr>
            </thead>
            <tbody>
              {[...edges]
                .sort((a, b) => b.n - a.n || a.from.localeCompare(b.from))
                .map((e) => (
                  <tr key={`${e.from}|${e.to}`}>
                    <td className="l">{e.from}</td>
                    <td className="l">{e.to}</td>
                    <td>{e.n}</td>
                    <td className="l st-miss" style={{ fontSize: 11 }}>
                      {e.mutual ? "yes" : "never"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
