/**
 * Every rule on /stats, scoped under `.stx`.
 *
 * It lives here rather than in globals.css because globals.css belongs to the
 * site and this page is a guest in it. Nothing below can reach a card, a table
 * or a nav link on any other route.
 *
 * THE REVEALS AND THE STAT TILES HAVE LEFT THIS FILE. Both were invented here
 * and both were right, which is exactly why they should never have been
 * scoped to one route: `[data-reveal]`, `[data-stagger]` and the figure
 * treatment are now in globals.css and every route has them. The pattern —
 * pure CSS scroll-driven animation behind an @supports gate, so a reader with
 * JavaScript off gets the archive rather than a blank page — is the site's
 * now. What is left below is genuinely this page's furniture and nobody
 * else's: the spine, the network, the traces.
 */
export default function StatsStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.stx { --st-gap: #2a3040; }
.stx ::selection { background: rgba(212,225,87,0.2); }

/* ---- figures ------------------------------------------------------ */
.stx figure { margin: 0; }
.stx figcaption {
  color: var(--dim); font-size: 11px; line-height: 1.7;
  max-width: var(--measure); margin-top: 12px;
}
.stx .st-derived {
  border-left: 2px solid var(--line); padding-left: 10px; margin-top: 10px;
  color: var(--dim); font-size: 10.5px; line-height: 1.65; max-width: 62ch;
}
.stx .st-derived b { color: var(--ink); font-weight: 400; }

/* ---- controls ----------------------------------------------------- */
.stx .st-controls {
  display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center;
  margin-bottom: 14px;
}
.stx .st-field { display: flex; align-items: center; gap: 6px; }
.stx .st-field > span {
  font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--dim);
}
/* 33px. These were 29px at every width — one pixel under the floor the last
   audit set, and under any touch guidance — across the timelines' Show group,
   the opponents' Order group, the leaders' Half group and the career arc's
   metric switcher, which is now the primary control on a player page. Only the
   block padding grows; the chips already wrap at 375, so it costs one row.

   AND .st-step IS IN THE SAME DECLARATION, because it is the same control.
   The session stepper sits 12px from the Show chips inside one control row and
   kept padding 4px 8px and a line-height of 1 while the chips grew: 35px
   beside 22px, the two halves of one instrument reading as two components, and
   the smallest target on the archive left smaller than the ones that audit
   fixed. The arrows are single glyphs, so a shared box costs no width. */
.stx select, .stx .st-chip, .stx .st-step, .stx .st-sort {
  font: inherit; font-size: 11px; color: var(--ink);
  background: rgba(56,62,78,0.1); border: 1px solid var(--line); border-radius: 2px;
  padding: 8px; cursor: pointer;
}
.stx select { padding-right: 22px; }
.stx .st-chip, .stx .st-step { color: var(--dim); transition: color .18s, border-color .18s, background .18s; }
.stx .st-chip:hover, .stx .st-step:hover { color: var(--ink); border-color: var(--st-gap); }
.stx .st-chip[aria-pressed="true"] {
  color: var(--ink); border-color: var(--ball); background: rgba(212,225,87,0.06);
}
.stx .st-chip[data-gold="1"][aria-pressed="true"] { border-color: var(--gold); background: rgba(196,148,58,0.06); }
/* 24px, so the one slider on the page is a target as well as a control. */
.stx input[type="range"] { accent-color: var(--paint-b); width: 130px; height: 24px; }

/* ---- readout ------------------------------------------------------ */
.stx .st-readout {
  border: 1px solid rgba(182,186,197,0.08); background: rgba(56,62,78,0.1); border-radius: 2px;
  padding: 12px 14px; display: grid; gap: 3px; min-height: 58px;
  align-content: start;
}
/**
 * GOLD HAS ONE JOB AND IT IS HONOURS.
 *
 * It was carrying seven meanings on the archive at once — a trophy, a
 * provenance note, a playoff, a fixture nobody has played yet, and a hole in
 * the record — on a near-black ground where colour is the strongest signal the
 * page has, and a reader cannot learn a meaning for a hue that means five
 * things. Worst pair, inside one rail row: "5 results, no game log" in
 * olive-gold beside "Runner-Up" in gold.
 *
 * Three classes now, and they are steps of brightness rather than hues:
 * absence is --dim, provenance is --ink, and the warm accent is a trophy.
 */
.stx .st-readout[data-gold="1"] { border-left: 2px solid var(--ink); }
.stx .st-readout .k { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: var(--dim); }
/* The subtitle drops to its own line rather than running off the edge. It used
   to be two words ("2 holes") and is now the holes by name, which does not fit
   beside a display-face line on a phone — and a nowrapped span in a block ran
   the first half of the sentence off the left of the panel. */
.stx .st-readout .v {
  font-family: var(--disp); font-weight: 300; font-size: 1.3rem; letter-spacing: 0.01em; line-height: 1.15;
  display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; row-gap: 2px; min-width: 0;
}
.stx .st-readout .v small {
  font-family: var(--mono); font-size: 11px; color: var(--dim);
  letter-spacing: 0.02em; white-space: nowrap;
}
.stx .st-readout .n { font-size: 11px; color: var(--dim); line-height: 1.6; }

/* ---- the spine ---------------------------------------------------- */
.stx .st-spine { width: 100%; height: auto; display: block; overflow: visible; touch-action: pan-y; }
.stx .st-slot { cursor: pointer; }
.stx .st-slot rect.hit { fill: transparent; }
.stx .st-slot:focus { outline: none; }
.stx .st-slot:focus-visible rect.hit { outline: 2px solid var(--paint-b); outline-offset: -1px; }
.stx .st-bar { transition: opacity .2s, fill .2s; }
.stx .st-slot:hover .st-bar { opacity: 1; }
.stx .st-tick { font-size: 6.4px; fill: var(--dim); font-family: var(--mono); }
.stx .st-tick.on { fill: var(--ink); }
.stx .st-rule { stroke: var(--rule); stroke-width: .5; }
.stx .st-mean { stroke: var(--paint-r); stroke-width: .6; stroke-dasharray: 2 2; opacity: .5; }

/* ---- network ------------------------------------------------------ */
/* THE GRAPH AND ITS READOUT, AND A WIDTH AT WHICH THEY STOP SHARING A ROW.
   This was an inline 1.55fr / 1fr with no media query anywhere — the only
   instrument on the archive with no narrow-width treatment, on a page where
   every other one has a deliberate one. At 375 it resolved to 170px of graph
   against a 560-unit viewBox, so "Bryan Karchensky" measured 27px by 4px —
   worse than the 2.59px that bought the career arc its whole .ca-wide and
   .ca-narrow system — while the 109px readout broke a pair of names over four
   lines. Stacked, the graph gets the full 297px and the readout the full
   measure under it, at the same 720px the row heads and the control groups
   already restack on. */
.stx .st-graph {
  display: grid; grid-template-columns: minmax(0,1.55fr) minmax(0,1fr);
  gap: 18px; align-items: start;
}
.stx .st-graph > div { display: grid; gap: 12px; position: sticky; top: 96px; }
/* THE WIDTH AT WHICH THE SPLIT STARVES THE DRAWING, measured rather than
   guessed. Every label in here is 9 units in a 560-unit box, so it renders at
   9 x (width / 560): the two-column split needs about 940px of viewport before
   a name reaches 8px, and stacked it needs 615. So the columns go at 900 — the
   breakpoint the rail already restacks on — and under 620 the names come off
   the drawing entirely, which is the same threshold and the same reasoning the
   career arc cuts its own annotation at. The circles stay, the readout names
   whoever is picked, and every pair is in the table under the figure. */
@media (max-width: 900px) {
  .stx .st-graph { grid-template-columns: minmax(0,1fr); }
  /* Nothing to stick to below it: stacked, the readout is the last thing in
     the section and a sticky panel at the end of a scroll never moves. */
  .stx .st-graph > div { position: static; }
}
@media (max-width: 620px) {
  .stx .st-graph .st-node text { display: none; }
}
/* THE PAIR LIST IS AS LONG AS THE COLUMN IT SITS IN, AT EVERY WIDTH.
   Measured at 1440: the graph is 744px tall and the right column's content was
   412 — a 480 x 332 empty rectangle, 12% of the card, the largest piece of
   unearned space left on the page. The list was capped twice, at eight rows and
   at 300px, in a column with room for eighteen.
   A FIXED HEIGHT WOULD ONLY BE RIGHT AT ONE WIDTH, which is the error two other
   fixes on this page have just been corrected for. The relationship is exact
   instead: the drawing is square and fills the left column, the columns are
   1.55fr and 1fr, so THE GRAPH'S HEIGHT IS 1.55 TIMES THE RIGHT COLUMN'S WIDTH.
   The readout above the list is 87px and the legend below it 37, with two 12px
   gaps. Stacked, or where container units are not understood, the 300px box it
   has always had stands. */
.stx .st-pairs { max-height: 300px; }
@media (min-width: 901px) {
  .stx .st-graph > div { container-type: inline-size; }
  .stx .st-graph .st-pairs { max-height: calc(155cqw - 87px - 37px - 24px); }
}
.stx .st-net { width: 100%; height: auto; display: block; overflow: visible; }
.stx .st-edge { fill: none; transition: stroke-opacity .22s, stroke .22s; }
.stx .st-node { cursor: pointer; }
.stx .st-node:focus { outline: none; }
.stx .st-node circle { transition: fill .22s, stroke .22s, r .22s; }
.stx .st-node:focus-visible circle.ring { stroke: var(--paint-b); stroke-width: 1.4; }
.stx .st-node text { font-size: 2.5px; font-family: var(--mono); fill: var(--dim); transition: fill .22s, opacity .22s; pointer-events: none; }
.stx .st-node.hot text { fill: var(--ink); }

/* ---- the ridge -----------------------------------------------------
 *
 * One drawing, one scale, two sizes. The 78-unit row on this page and the
 * 268-unit arc on a player page are the same component, so every rule below
 * is shared, and only the handful that differ are qualified with .ca-arc.
 * Both routes mount this stylesheet; nothing here may be scoped tighter.
 *
 * .ca-ghost came off with the grey second ridge, the way .ca-keytext and
 * .ca-key-ghost came off with its key one round earlier. A stylesheet keeping
 * a rule for a mark that is no longer drawn is where the next reader starts
 * looking for the mark.
 */
.stx .ca-ridge, .stx .ca-arc { width: 100%; height: auto; display: block; overflow: visible; }
.stx .ca-gap { fill: var(--st-gap); opacity: .22; }
.stx .ca-arc .ca-gap { opacity: .16; }
.stx .ca-gapword {
  fill: #565c6b; font-family: var(--mono); font-size: 6.8px;
  letter-spacing: .2em; text-anchor: start;
}
.stx .ca-goals { fill: var(--paint-b); opacity: .2; }
/* the surface gap: without it the two stacked fills bleed into one mass */
.stx .ca-seam { fill: none; stroke: var(--ice); stroke-width: 2.6; opacity: .9; }
.stx .ca-seam-lit { fill: none; stroke: var(--paint-b); stroke-width: .8; opacity: .55; }
.stx .ca-base { stroke: var(--rule); stroke-width: 1; }
.stx .ca-line {
  fill: none; stroke: var(--paint-b); stroke-linejoin: round; stroke-linecap: round;
  filter: drop-shadow(0 0 4px rgba(91,155,213,0.55));
}
.stx .ca-stem { stroke: var(--paint-b); opacity: .55; }
.stx .ca-lone { fill: var(--paint-b); filter: drop-shadow(0 0 4px rgba(91,155,213,0.55)); }
.stx .ca-cross { stroke: var(--paint-b); stroke-width: .9; opacity: .55; }
.stx .ca-here { fill: var(--paint-b); stroke: var(--ice); stroke-width: 1.5; }
/* ca-only is gone with the dot it filled — a mark on every session that
   survives in the Internet Archive alone, drawn over a career in the register
   the peak uses. A reader of a timeline is not reading it for the source. */
.stx .ca-peak { fill: var(--ice); stroke: var(--paint-b); }
/* No text-anchor here: a peak in the first or last column sets its own, and a
   CSS declaration would beat the presentation attribute that does it. */
.stx .ca-peakval {
  fill: var(--ink); font-family: var(--disp); font-weight: 300; font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.stx .ca-peakwhen {
  fill: var(--dim); font-family: var(--mono); font-size: 7.5px; letter-spacing: .1em;
}
/* NAMED, AND NOTHING BESIDE THE NAME. A tick ON the baseline rather than a
   shape above it: there is no quantity here to draw, and any height at all
   would be a figure the archive does not have. --dim, the step absence takes
   everywhere on this site. */
.stx .ca-blank { stroke: var(--dim); opacity: .75; stroke-linecap: round; }
.stx .ca-ax { fill: #4a4f5c; font-family: var(--mono); font-size: 8px; letter-spacing: .04em; text-anchor: end; }
.stx .ca-ax.on { fill: var(--ink); }
/* The phone's three anchors. No font-size and no text-anchor here — the arc
   sets both per tick, and a declaration in this file would beat them. */
.stx .ca-axn { fill: var(--ink); font-family: var(--mono); letter-spacing: .04em; }
/* TWO ANNOTATIONS, ONE DRAWING, AND THE STYLESHEET CHOOSES. Every <text> in
   the arc scales with a 780-unit viewBox stretched to its container, so at 375
   the axis rendered at 3.05px and the shaded columns' words at 2.59px — a
   metric switcher offering five readings of a chart nobody can read. The narrow
   set is three flat ticks and the peak's figure; the wide set is the
   thirty-three rotated names, the words down the columns and the peak's season.
   Chosen here rather than in a hook, because the drawing has to work with
   JavaScript off. */
.stx .ca-arc .ca-narrow { display: none; }
@media (max-width: 620px) {
  .stx .ca-arc .ca-wide { display: none; }
  .stx .ca-arc .ca-narrow { display: initial; }
}
.stx .ca-zero { fill: var(--dim); font-family: var(--mono); font-size: 8px; letter-spacing: .1em; }
.stx .ca-hit { fill: transparent; }

.stx .ca { margin: 0; display: grid; gap: 14px; }
.stx .ca-cap { display: grid; gap: 6px; margin: 0; max-width: none; color: var(--dim); }
.stx .ca-line1 {
  font-family: var(--disp); font-weight: 300; font-size: clamp(1rem, 2.2vw, 1.25rem);
  letter-spacing: .02em; color: var(--ink);
}
.stx .ca-line1 b { color: var(--ball-pure); font-weight: 300; }
.stx .ca-sub { font-size: 11px; color: var(--dim); line-height: 1.7; }
.stx .ca-legend {
  display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center;
  font-size: 10px; color: var(--dim);
}
.stx .ca-legend span { display: flex; align-items: center; gap: 7px; }
/* .ca-keytext and .ca-key-ghost came off with the ghost's key — two rules
   nothing has emitted since RidgeLegend stopped naming another man's season
   under every career on the site. A stylesheet keeping a rule for a mark that
   is no longer drawn is where the next reader starts looking for the mark. */
.stx .ca-key { width: 12px; height: 10px; border-radius: 1px; flex: none; display: inline-block; }
.stx .ca-key-goals { background: rgba(91,155,213,0.28); }
.stx .ca-key-line {
  background: linear-gradient(180deg, rgba(91,155,213,0.5), rgba(91,155,213,0.05));
  border-top: 2px solid var(--paint-b);
}
.stx .ca-key-best { background: var(--ice); border: 1.5px solid var(--paint-b); border-radius: 50%; width: 10px; height: 10px; }
.stx .ca-key-gap { background: var(--st-gap); }
.stx .ca-key-blank { background: none; border-top: 2.5px solid var(--dim); height: 0; width: 10px; align-self: center; opacity: .75; }
.stx .ca-key-break { background: none; border-top: 1.5px dotted var(--paint-b); height: 0; align-self: center; }

/* ---- career timelines ---------------------------------------------- */
/* The x-axis, on the same tracks as the row under it so a tick lands on the
   column it names: the .st-rhead grid, its gap and its inline padding, or the
   labels would sit against a drawing they do not line up with. */
.stx .st-axis {
  display: grid;
  grid-template-columns: minmax(150px,190px) minmax(0,1fr) minmax(62px,auto) 18px;
  gap: 16px; align-items: end; padding: 0 14px 5px;
}
.stx .st-axis svg { width: 100%; height: auto; display: block; overflow: visible; }
.stx .st-axis text { fill: var(--dim); font-family: var(--mono); font-size: 9px; letter-spacing: .06em; }
.stx .st-rows { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); }
.stx .st-row { background: rgba(56,62,78,0.06); transition: background .2s cubic-bezier(0.33,0,0.2,1); min-width: 0; }
.stx .st-row:hover, .stx .st-row.open, .stx .st-row:focus-within { background: rgba(56,62,78,0.14); }
.stx .st-rhead {
  display: grid; grid-template-columns: minmax(150px,190px) minmax(0,1fr) minmax(62px,auto) 18px;
  gap: 16px; align-items: center; padding: 10px 14px; width: 100%;
  background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.stx .st-rhead > * { min-width: 0; }
.stx .st-who { display: grid; grid-template-columns: auto 1fr; gap: 0 9px; align-items: baseline; min-width: 0; }
.stx .st-jer {
  font-family: var(--disp); font-weight: 200; font-size: 19px; color: var(--dim);
  font-variant-numeric: tabular-nums; line-height: 1; grid-row: 1/3;
  align-self: center; min-width: 2.2ch; text-align: right;
}
.stx .st-nm { font-size: 12.5px; color: var(--ink); letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stx .st-sub { font-size: 9.5px; color: var(--dim); letter-spacing: .04em; }
.stx .st-tot {
  font-family: var(--disp); font-weight: 300; font-size: 19px; letter-spacing: 0;
  font-variant-numeric: tabular-nums; color: var(--dim); text-align: right; transition: color .18s;
}
.stx .st-row:hover .st-tot, .stx .st-row.lit .st-tot { color: var(--ink); }
.stx .st-caret { color: var(--dim); font-size: 11px; transition: transform .2s, color .2s; justify-self: end; }
.stx .st-row.open .st-caret { transform: rotate(90deg); color: var(--ball-pure); }

.stx .st-panel { padding: 4px 14px 22px; border-top: 1px solid var(--rule); min-width: 0; overflow: hidden; }
.stx .st-ptop { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; padding: 14px 0 10px; }
.stx .st-pt { font-family: var(--disp); font-weight: 300; font-size: 1.15rem; letter-spacing: .02em; }
.stx .st-pt b { color: var(--ball-pure); font-weight: 300; }
.stx .st-plink { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); border-bottom: 1px solid transparent; }
/* The session log.
 *
 * A ROW PER SESSION, not a column. The strip this replaced laid twenty-four
 * 94px columns across the panel, each carrying a nowrapped uppercase label; a
 * label wider than the track set the min-content width of every span in its
 * cell, so "Greater Buffalo Invitational" ran 79px past its own column and
 * printed on top of the two beside it. Rows have the full measure to spend on
 * a name and cannot collide with each other, whatever the name turns out to
 * be. The global table rules carry the type; only the spacing is local. */
.stx .st-log { margin-top: 16px; font-size: 12px; }
.stx .st-log th { padding: 7px 8px; white-space: nowrap; }
.stx .st-log td { padding: 6px 8px; }
.stx .st-log td:not(.l) { font-size: 12px; }
.stx .st-log td.l { color: var(--dim); letter-spacing: .01em; }
.stx .st-log th.on { color: var(--ball-pure); border-bottom-color: var(--ball); }
.stx .st-log td.on { background: rgba(212,225,87,0.045); }
.stx .st-log tbody tr:hover td.on { background: rgba(212,225,87,0.1); }

/* The rest of the careers.
 *
 * A disclosure BETWEEN two grids rather than under one: the summary sits where
 * the leading list stops and the men behind it open directly beneath it, same
 * order, same grid, same peak. Its inline padding is the row's, so the +/−
 * lands under the jerseys above it and the two blocks read as one column. The
 * rule and the top margin that every other details on this page carries come
 * off: there is already a hairline there, drawn by the grid it follows. */
.stx details.st-more { margin-top: 0; border-top: 0; }
.stx .st-more > summary { padding: 11px 14px; }

.stx .st-colname {
  font-size: 11px; letter-spacing: 0; text-transform: none; color: var(--dim);
  min-width: 13ch; max-width: 24ch; text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.stx .st-colname.lit { color: var(--ink); }

/* ---- tables (scoped; the global table rules already fit) ----------
 *
 * SCOPED TO THE DISCLOSURES THIS FILE OWNS, and nothing else. These rules were
 * written for the instrument cards, where the only disclosure on the page is
 * "... as a table". The archive mounts the same stylesheet and is itself a
 * .stx, so every rule below was reaching its thirty season rows and seventeen
 * recap headers: a second, gold, left-aligned "+" on its own line above each
 * season's strip beside the grey one the row actually has, 34px of dead height
 * per row, and - because the pseudo-element becomes grid item 1 - a recap
 * header whose score, opponent and date each landed in the wrong track, with
 * the date wrapping to the left of the score and the club shouted in uppercase.
 *
 * .stx > .section is the whole scope: a disclosure inside a card inside a
 * section, which is every one this file was written for. The archive's own
 * rail and recaps sit outside a .section and are now untouched.
 */
.stx > .section details { border-top: 1px solid var(--rule); margin-top: 14px; }
.stx > .section summary {
  cursor: pointer; padding: 9px 0; font-size: 10px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--dim); list-style: none;
}
.stx summary::-webkit-details-marker { display: none; }
.stx > .section summary::before { content: "+ "; color: var(--ball); }
.stx > .section details[open] summary::before { content: "− "; }
.stx > .section summary:hover { color: var(--ink); }
.stx summary:focus-visible { outline: 2px solid var(--paint-b); outline-offset: 2px; }
.stx .st-tall { max-height: 380px; overflow: auto; }
/* TEN ROWS ON THE FRANCHISE BOARD, AT EVERY WIDTH — and the first pass at this
   held only at the two it was measured at.
   Its head is 43.2px, because its column labels are sort buttons and carry block
   padding the other four heads do not. A row is 46.1px at 1440 and at 768, so
   380px stopped it at seven and 506px cleared the tenth. Under about 480 the
   player cell wraps to two lines and the tallest rows go to 77.1px — measured at
   430, 375 and 320 — so the same 506px held the head and SEVEN rows, which is
   the exact cut the change was made to fix, on the form factor this site treats
   as a tier rather than a refusal.
   The arithmetic is the declaration now rather than a note beside a number: the
   height is the head plus ten rows, and a row is redefined where a row changes
   size. The narrow figure is the WRAPPED height, so ten clear even when all ten
   names wrap; where they do not, the box runs on past ten rather than stopping
   short of them, which is the error worth making. */
.stx .st-board { --st-head: 43.2px; --st-row: 46.2px; max-height: calc(var(--st-head) + 10 * var(--st-row)); }
@media (max-width: 480px) {
  .stx .st-board { --st-row: 77.2px; }
}
/* THE FULL RECORD, IN ITS OWN ROOM.
   "20 more careers" is a continuation of the grid above it; "All 36 careers,
   session by session, as a table" is the same set in another form. They sat
   86px apart in identical 10px uppercase with the same marker, with the
   section's densest block of legend type wedged between — the only place on the
   page where a reader has to choose between two adjacent doors and cannot tell
   them apart. A rule and some air says which one closes the section. */
.stx .st-close { margin-top: 26px; padding-top: 20px; border-top: 1px solid rgba(182,186,197,0.08); }
.stx th[aria-sort] { cursor: pointer; user-select: none; }
.stx th[aria-sort]:hover { color: var(--ink); }
.stx th[aria-sort="descending"], .stx th[aria-sort="ascending"] { color: var(--ink); }
/* A sortable head is a button and a button is a target: 9.5px of type in a
   zero-padding box is a 12px hit area on the control that reorders the largest
   table on the site. The block padding is the only dimension that grows and it
   grows one row, once. */
.stx th button {
  font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit;
  background: none; border: 0; padding: 6px 0; cursor: pointer; width: 100%; text-align: inherit;
}
/* A session that survives in the Internet Archive alone, against session
   labels set in --dim. Brightness, not a hue — see the note on --gold above. */
.stx td .gold, .stx .gold { color: var(--ink); }
.stx .st-miss { color: var(--dim); }

/* ---- legend ------------------------------------------------------- */
.stx .st-legend {
  display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px;
  font-size: 10px; color: var(--dim);
}
.stx .st-legend span { display: flex; align-items: center; gap: 6px; }
.stx .st-key { width: 10px; height: 10px; border-radius: 1px; flex: none; }
/* The disc's own reading: a rim that is half one colour and half the other,
   which is what a man who both sets up and is set up is drawn as. Same size as
   the count's circle beside it, because they are both discs on the drawing. */
.stx .st-key-tilt {
  width: 10px; height: 10px; border-radius: 50%; background: var(--dim);
  border: 1.5px solid var(--paint-b); border-right-color: var(--paint-r); border-bottom-color: var(--paint-r);
}

@media (max-width: 720px) {
  .stx .st-controls .st-field { flex-wrap: wrap; max-width: 100%; }
  .stx .st-controls .st-field[role="group"] { width: 100%; }
  .stx .st-rhead { grid-template-columns: minmax(0,1fr) auto; gap: 8px 12px; }
  .stx .st-rhead > .ca-ridge { grid-column: 1 / -1; grid-row: 2; }
  /* The drawing takes the whole row here, so the axis does too. */
  .stx .st-axis { display: block; }
  .stx .st-axis > span { display: none; }
  .stx .st-tot { font-size: 16px; }
  .stx .st-panel { padding-left: 8px; padding-right: 8px; }
}
`,
      }}
    />
  );
}
