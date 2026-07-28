import Link from "next/link";
import { plural } from "../../../lib/format";
import { HUB_SPINE, SPANS, SPAN_SUMMARY, slotIndex } from "../../../lib/hubs";
import { axisTicks, slotLabel } from "../../../lib/stats";
import s from "./hubs.module.css";

/**
 * Every player the archive can name, on the half-year spine, from his first
 * session to his last.
 *
 * The career timelines carry the long tenures — the players with six sessions
 * or more. This carries all of them, which is the only place the archive shows
 * the ones who turn up once and are never recorded again. They are close to
 * half the roster book and they appear nowhere else as a group.
 *
 * THE MEN STILL PLAYING LEAD IT, deepest tenure first, and a hairline closes
 * the block. Everybody else keeps the archive's own order behind it — by
 * arrival, then by how long the man lasted — so the lower two thirds read as a
 * history rather than as a list. `SPANS` in lib/hubs.ts does the sorting and
 * `CURRENT_FROM` beside it decides who is current, off the newest league half
 * rather than off the newest session: a four-day tournament landing last on the
 * spine would otherwise cut this block to whoever entered it.
 *
 * AND THAT IS THE ONLY THING THE CHART EMPHASISES. The name, the bar's opacity
 * and the dot at the end of a run are three marks of one fact — still playing —
 * and the legend keys all three at once. The names used to answer a different
 * question from the marks beside them: brightness was career length, so the one
 * man in the current block with a single session on file was the only grey name
 * in it while men gone a decade were as bright as the side that took the ice
 * this summer. Two rules on one chart is no rule at all.
 *
 * The dark columns are the ones nobody can be drawn in, drawn rather than
 * closed over: absence is not zero. Today that is the two half-years with no
 * session at all, and the key under the chart says so — it said "no roster on
 * file", which is the archive's central distinction stated backwards about a
 * season it has confirmed twice was never played. It named 2019 - Summer and
 * 2020-21 as the other two, and both of them have since come out of the
 * captain's inbox with seventeen and nineteen names.
 */

const W = 900;
const H = 11;

/** What the shaded columns are, off the columns themselves. A half-year with no
 *  session and a session nobody survives are both undrawable and are not the
 *  same fact, so the key names whichever is on the spine — and both, where the
 *  archive ever holds both at once.
 *
 *  "NO SESSION", NOT "NO SESSION ON FILE", and the difference is the archive's
 *  argument rather than a shade of phrasing. "On file" says the record is
 *  missing; of the two shaded half-years, Summer 2020 has two independent
 *  confirmations that it was never played. It is also the word the coverage
 *  chart's fourth swatch uses for the same two columns twelve thousand pixels
 *  above, and two charts on one page describing one thing in two vocabularies is
 *  what sends a reader looking for a distinction that is not there. The words
 *  that DO tell the two apart — searched for and not found, confirmed not
 *  played — are printed under that chart, where they belong. */
const shadeWord = (() => {
  const shaded = HUB_SPINE.filter((slot) => slot.noRoster);
  if (shaded.length === 0) return "";
  if (shaded.every((slot) => !slot.onFile)) return "no session";
  if (shaded.every((slot) => slot.onFile)) return "no roster on file";
  return "no names on file";
})();

export default function FirstAndLast() {
  const n = HUB_SPINE.length;
  const step = W / n;
  /* THE SAME TICK RULE THE COVERAGE CHART DRAWS WITH, and it is shared because
     the two disagreed. Both take the quarter points; this one took them raw, so
     its second tick landed on the 2015 Greater Buffalo Invitational at 2014.75
     and `slotLabel` printed that four-day event as "2014 Winter" — the name the
     coverage chart puts over the season at 2014.5, one column earlier. One name
     over two different columns on one page, and a reader who trusts this axis
     reads a weekend as a season. */
  const ticks = [...axisTicks(HUB_SPINE)];

  return (
    <div className={s.hScrollWrap}>
    <div className={s.hScroll}>
      <div className={s.spanInner}>
        <div className={s.spanAxis}>
          <span />
          <svg viewBox={`0 0 ${W} 14`} style={{ display: "block", width: "100%", height: "auto" }} aria-hidden="true">
            {/* A TICK IS A POSITION IN TIME, so it prints the half-year and
                never the slot's own name. One of the five landed on the 2014.75
                tournament slot and took its label, so a row of half-years read
                "2011 Winter · Greater Buffalo Invitational · 2018 Winter" —
                a name three times the width of every other tick, in the one
                place on the chart where a name cannot be placed. Tournaments
                keep their names on the rows. */}
            {ticks.map((i) => (
              <text
                key={i}
                x={step * i + step / 2}
                y="10"
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                fill="var(--dim)"
                fontSize="8"
                letterSpacing=".08em"
                fontFamily="var(--mono)"
              >
                {HUB_SPINE[i] ? slotLabel(HUB_SPINE[i]!.sort).replace(" - ", " ") : ""}
              </text>
            ))}
          </svg>
          <span />
        </div>

        <div className={s.spans}>
          {SPANS.map((player, i) => {
            const from = slotIndex(player.first);
            const to = slotIndex(player.last);
            /* The first row that is not a current player closes the block above
               it. Without it the chart runs eighteen rows of one order straight
               into sixty-one of another, and the change of sort reads as no
               sort at all. */
            const opensTheRest = !player.current && (SPANS[i - 1]?.current ?? false);
            return (
              <div
                className={`${s.spanRow} ${player.current ? s.spanHere : ""} ${opensTheRest ? s.spanBreak : ""}`}
                key={player.slug}
              >
                <div className={s.spanName}>
                  {player.jersey !== null && <i>{player.jersey}</i>}
                  <Link href={`/players/${player.slug}`}>{player.name}</Link>
                </div>

                <svg
                  className={s.spanBar}
                  viewBox={`0 0 ${W} ${H}`}
                  role="img"
                  aria-label={`${player.name}: ${plural(player.sessions, "session")}, ${HUB_SPINE[from]?.label} to ${HUB_SPINE[to]?.label}`}
                >
                  {/* Shaded where NOBODY is on file, which is the same test the
                      coverage chart's roster row counts with. It was
                      `!rosterLost` — the session's flag — so 2020 - Winter
                      shaded here and said no roster survives, four and a half
                      thousand pixels under a chart naming its men. */}
                  {HUB_SPINE.map((slot, i) => !slot.noRoster ? null : (
                    <rect key={slot.sort} x={step * i} y="0" width={step} height={H} fill="#2a3040" opacity=".2" />
                  ))}
                  {to > from && (
                    <line
                      x1={step * from + step / 2}
                      x2={step * to + step / 2}
                      y1={H / 2}
                      y2={H / 2}
                      stroke="var(--paint-b)"
                      strokeWidth=".8"
                      opacity=".28"
                    />
                  )}
                  {player.sorts.map((sort) => {
                    const i = slotIndex(sort);
                    return i < 0 ? null : (
                      <rect
                        key={sort}
                        x={step * i + step * 0.2}
                        y="2"
                        width={step * 0.6}
                        height={H - 4}
                        fill="var(--paint-b)"
                        opacity={player.current ? ".85" : ".42"}
                      />
                    );
                  })}
                  {player.current && (
                    <circle cx={step * to + step / 2} cy={H / 2} r="2.6" fill="var(--ball-pure)" />
                  )}
                </svg>

                <div className={s.spanCount}>{player.sessions}</div>
              </div>
            );
          })}
        </div>

        <div className={s.legend}>
          <span><i className={s.key} style={{ background: "rgba(91,155,213,.85)" }} />a session on file</span>
          <span><i className={`${s.key} ${s.keyDot}`} style={{ background: "var(--ball-pure)" }} />named in {SPAN_SUMMARY.currentLabel}</span>
          {/* One key for every shaded column, because they are one statement:
              nobody can be drawn here. WHICH kind of nothing that is, is read
              off the columns rather than typed — it has been wrong twice, and
              both times because a phrase outlived the data under it. "Session
              not on file" went stale when two sessions came back with rosters;
              "no roster on file" replaced it and was then the only thing left
              shaded, on two half-years the archive says were never played at
              all, which is its own central distinction stated backwards. */}
          {shadeWord !== "" && (
            <span><i className={s.key} style={{ background: "#2a3040" }} />{shadeWord}</span>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
