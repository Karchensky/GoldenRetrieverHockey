import type { ReactNode } from "react";
import { plural } from "../../lib/format";
import {
  COVERAGE,
  COVERAGE_ABSENT,
  COVERAGE_COMPLETE,
  COVERAGE_ROWS,
  COVERAGE_WORDS,
  SCOPE,
} from "../../lib/scope";
import { axisTicks } from "../../lib/stats";
import s from "./seasons.module.css";

/**
 * The archive's coverage, drawn on the session spine.
 *
 * Four dimensions down, one column per session and per half-year nobody has,
 * one mark per cell: complete, a fragment, nothing on file. It replaces six rows
 * of mono prose that named seven seasons inside one middot-separated line, which
 * is a list a reader parses twice and remembers none of.
 *
 * WHY A MATRIX AND NOT FOUR SMALL MULTIPLES. The question a reader actually asks
 * is a COLUMN question: what survives of 2018 - Summer. Down one column is a
 * session's whole state; across one row is one kind of record's whole history,
 * and four separate strips can answer the second while answering neither the
 * first nor the comparison between rows. A stacked bar could not carry it
 * either — coverage is categorical, and a segmented length would be a quantity
 * nobody measured.
 *
 * IT IS NOT ON THE SAME AXIS AS THE CHARTS BELOW IT, and this file used to claim
 * it was. Measured at 1440: the spine here runs 205 to 1283 at a pitch of 32.7,
 * the session history's 293 to 1269 at 29.6, and the career timelines' 320 to
 * 1214 at 27.1 — three origins and three pitches a fifth apart, because each
 * chart's left-hand furniture is a different width and has to be (a player's
 * name is not a row term). Nothing about the argument for a matrix needs a
 * shared axis, so the claim came off rather than three layouts being bent to a
 * common gutter. What they DO share is the tick rule: `axisTicks`, one anchor
 * set, so the same name cannot appear over two different columns on one page —
 * which it did, "2014 Winter" over a season here and over a four-day tournament
 * one section down.
 *
 * THE SHAPE IS THE STATEMENT. The 2011-2016 era is dark on the top two rows —
 * two fragments in it and nothing else — and lit on the bottom two, and that is
 * the archive's oldest and least stated fact: rosters and statistics survive
 * from the beginning, results barely start before 2016-17 and scoresheets are
 * thinner again inside that. Seven caveats and six mono rows both spent two
 * hundred words failing to say it.
 *
 * A PHONE OPENS ON THE RECENT END. The chart holds a 620px floor set by its own
 * axis, so at 375 it is 297px of scrollport and eleven of thirty-three columns;
 * landed at the left it opened on an empty Game log row beside a tally saying
 * fourteen. The scroller lands at the other end and the seam over the pinned
 * terms says the rest is behind it — see `.covScroll` in seasons.module.css.
 *
 * IT IS A TABLE, because it is one. Rows are named, columns are named, and
 * every cell carries its own word — so the chart reads out under a screen
 * reader as "Scoresheets, 2018 - Summer, nothing on file" rather than as a
 * decorative grid with a caption apologising for itself. The row term and the
 * tally stay on screen at any scroll position, because four rows of anonymous
 * marks is what a phone made of this before they were pinned.
 */

const STATE_CLASS = {
  full: s.covFull,
  partial: s.covPart,
  none: s.covNone,
} as const;

/** A session name that cannot snap at its own hyphen: at 375 the note wraps,
 *  and "2017" at the end of a line is not a season name. */
const Label = ({ children }: { children: string }) => (
  <span className={s.covKeyName}>{children}</span>
);

/** Separators carried by the item BEFORE them, so a wrap never leads with one. */
const DOT = " · ";

/** The axis's spelling, and now the note's. One figure, one form of one name:
 *  the ticks strip the hyphen for width and the key beneath them was keeping
 *  it, so "2017 - Summer" and "2018 Winter" sat in the same drawing. */
const plain = (label: string): string => label.replace(" - ", " ");

export default function DataCoverage() {
  const ticks = axisTicks(COVERAGE);
  const onFile = COVERAGE.filter((column) => column.states !== null).length;

  return (
    <section className="section" id="coverage" data-reveal>
      {/* The chart's own numbers live on the card, not on the scroller: the
          legend is a sibling of the chart and drew its swatches from custom
          properties it could not see, so every key collapsed to nothing. */}
      <div className={`card ${s.covCard}`}>
        <div className="head">
          <h2>Data coverage</h2>
          <span className="kicker">{plural(SCOPE.sessions, "session")}</span>
        </div>

        <div className={s.covScroll}>
          <table
            className={s.covChart}
            aria-label="What survives of each session: the game log, the scoresheets, the roster and the statistics"
          >
            <thead>
              <tr>
                <th scope="col" className={s.covCorner}>
                  <span className={s.covHidden}>Record</span>
                </th>
                {/* Every column names itself, five of them visibly. The other
                    twenty-eight are read out under a screen reader and shown
                    on hover, which is what a tick under a 14px column cannot
                    do. The two ends read inward so a name cannot hang off the
                    edge of the chart. */}
                {COVERAGE.map((column, i) => (
                  <th scope="col" key={column.sort}>
                    <span
                      className={ticks.has(i) ? s.covTick : s.covHidden}
                      data-end={i === 0 ? "l" : i === COVERAGE.length - 1 ? "r" : undefined}
                    >
                      {plain(column.label)}
                    </span>
                  </th>
                ))}
                <th scope="col" className={s.covTotalHead}>Complete</th>
              </tr>
            </thead>
            <tbody>
              {COVERAGE_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className={s.covTerm}>{row.term}</th>
                  {COVERAGE.map((column) => {
                    const state = column.states?.[row.key] ?? null;
                    /* A HALF-YEAR WITH NO SESSION ANSWERS "NO SESSION" FIRST,
                       and then in its own words — "searched for, not found" is
                       not the same claim as "confirmed not played", and this
                       archive exists on the difference. The verdict alone
                       could not survive the row it sits in: every cell is read
                       out under its own row term, so eight of them said
                       "Roster: confirmed not played", and a roster cannot be
                       not played. */
                    const word = state === null
                      ? `no session${column.words ? ` — ${column.words}` : ""}`
                      : COVERAGE_WORDS[state];
                    return (
                      <td
                        key={column.sort}
                        className={state === null ? s.covGap : STATE_CLASS[state]}
                        title={`${column.label} · ${row.term}: ${word}`}
                      >
                        <i aria-hidden="true" />
                        <span className={s.covHidden}>{word}</span>
                      </td>
                    );
                  })}
                  {/* The figure and what it is out of. The denominator was in
                      the visually-hidden span alone, so a sighted reader had a
                      bare 4 under a heading reading COMPLETE and a chart of
                      thirty-three columns to guess it against. */}
                  <td className={s.covTotal}>
                    {COVERAGE_COMPLETE[row.key]}
                    <span className={s.covOf} aria-hidden="true">/{onFile}</span>
                    <span className={s.covHidden}> of {onFile} sessions</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* One key per mark on the chart and no others — the rule every legend
            on this site is built to. Four swatches, four terms, one grammar.
            The fourth used to carry the two half-years and their verdicts as
            well, which made it 541px against 67, 79 and 108 for the other three
            — a key four times the width of the thing it is a key to, and on a
            phone the heaviest mark in the section. */}
        <div className={s.covLegend}>
          <span><i className={`${s.covKey} ${s.covKeyFull}`} />{COVERAGE_WORDS.full}</span>
          <span><i className={`${s.covKey} ${s.covKeyPart}`} />{COVERAGE_WORDS.partial}</span>
          <span><i className={`${s.covKey} ${s.covKeyNone}`} />{COVERAGE_WORDS.none}</span>
          {COVERAGE_ABSENT.length > 0 && (
            <span><i className={`${s.covKey} ${s.covKeyGap}`} />no session</span>
          )}
        </div>

        {/* THE ONE THING ON THE CHART A READER CANNOT REACH BY LOOKING, in the
            archive's own register rather than in a key's. A season searched for
            and not found is not a season nobody played, and that difference is
            this archive's whole argument — it just is not a swatch-and-term. */}
        {COVERAGE_ABSENT.length > 0 && (
          <p className={s.covGaps}>
            {COVERAGE_ABSENT.map((gap, i): ReactNode => (
              <span key={gap.label}>
                <Label>{plain(gap.label)}</Label>
                {`, ${gap.words}`}
                {i < COVERAGE_ABSENT.length - 1 ? DOT : ""}
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * ONE ROW OF THE OLD BOX, for a page that is not the archive.
 *
 * The player pages answer "what does this cover" for the scoresheets, and they
 * answered it as a grey sentence under a heading while /seasons answered it as
 * a labelled row — two grammars and two type treatments for one job, on the two
 * page types a reader crosses between constantly. The box is a chart now and a
 * chart is not worth building for one figure, so the row survives here at the
 * row's own size, with the row's own rule: it states scope and stops.
 */
export function ScopeNote({ term, children }: { term: string; children: ReactNode }) {
  return (
    <dl className={`${s.dataScope} ${s.scopeNote}`}>
      <div>
        <dt>{term}</dt>
        <dd>{children}</dd>
      </div>
    </dl>
  );
}
