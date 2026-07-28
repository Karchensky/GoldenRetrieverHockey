import Link from "next/link";
import { plural } from "../../../lib/format";
import { SIN_BIN } from "../../../lib/hubs";
import s from "./hubs.module.css";

/**
 * What this team gets penalised for, and who does it.
 *
 * The site shows penalty minutes as a bare column on a table. A minute total
 * cannot tell a slasher from a fighter, and the sheets have always said which
 * — the infraction is written into the penalty row in prose, alongside the
 * name of the man who took it.
 *
 * A single-hue sequential ramp, deliberately: this is one quantity, not nine
 * categories, so it needs no categorical palette. Every cell prints its own
 * count, so the colour is a second reading rather than the only one.
 */

const COLUMNS = 10;

export default function SinBin() {
  const columns = SIN_BIN.infractions.filter((i) => i.infraction !== "Unspecified").slice(0, COLUMNS);
  const people = SIN_BIN.people;
  const grid = `minmax(178px, 1.5fr) repeat(${columns.length}, minmax(30px, 1fr)) 58px`;

  const peak = Math.max(
    1,
    ...people.flatMap((person) => columns.map((c) => person.mix.find((m) => m.infraction === c.infraction)?.n ?? 0)),
  );

  return (
    <>
      <div className={s.hScrollWrap}>
      <div className={s.hScroll}>
        <div className={s.mxInner}>
          <div className={s.mxHead} style={{ gridTemplateColumns: grid }}>
            <span />
            {columns.map((c) => <span key={c.infraction}>{c.infraction}</span>)}
            <span className={s.mxHeadTotal}>Total</span>
          </div>

          <div className={s.mx}>
            {people.map((person) => (
              <div className={s.mxRow} style={{ gridTemplateColumns: grid }} key={person.name}>
                <div className={s.mxName}>
                  <span>
                    {/* THE RANKING, ON SCREEN, WITHOUT A GESTURE — and without
                        a sticky column painting over a column of the matrix.
                        Pinning `Total` to the right edge made it reachable and
                        made whatever sat under it permanently unreadable: at
                        390px the third infraction and half the fourth were
                        inside a 92%-opaque box at every scroll position, and
                        the scroll cue was drawn under the same pin. The figure
                        the rows are sorted by leads the row on a phone; the
                        column itself is still there at the end of the matrix. */}
                    <i className={s.mxRank}>{person.n}</i>
                    {person.slug
                      ? <Link href={`/players/${person.slug}`}>{person.name}</Link>
                      : person.name}
                  </span>
                  {/* Only when the season tables corroborate. Penalty minutes
                      are summed from a different source than these rows, and
                      for two players the tables carry a nought beside a
                      scoresheet that plainly records a penalty. A nought
                      printed next to a total of one reads as a fault in the
                      site rather than as the disagreement between two sources
                      that it is.
                      OVER THE SAME SESSIONS THE COUNT COVERS — see the note on
                      `SinBinPlayer.pim`. It used to be the whole career, so a
                      row read 79 penalties beside 256 minutes with the scope
                      line above it describing only the smaller span. */}
                  {person.pim !== null && person.pim > 0 && <small>{plural(person.pim, "penalty minute")}</small>}
                </div>

                {columns.map((c) => {
                  const n = person.mix.find((m) => m.infraction === c.infraction)?.n ?? 0;
                  const weight = n / peak;
                  return (
                    <div className={s.mxCell} key={c.infraction} title={`${person.name} · ${c.infraction} · ${n}`}>
                      <i
                        className={s.mxFill}
                        style={{ background: n > 0 ? `rgba(91,155,213,${(0.1 + 0.72 * weight).toFixed(3)})` : "transparent" }}
                      />
                      <b style={{ color: weight > 0.55 ? "var(--ice)" : "var(--ink)" }}>{n > 0 ? n : ""}</b>
                    </div>
                  );
                })}

                <div className={s.mxTot}>{person.n}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>

      <div className={s.legend}>
        <span>
          <i
            className={`${s.key} ${s.keyRamp}`}
            style={{ background: "linear-gradient(90deg, rgba(91,155,213,.10), rgba(91,155,213,.82))" }}
          />
          1 to {peak}
        </span>
      </div>

      <details>
        <summary>Every infraction the sheets name</summary>
        <div className="scroll st-tall">
          <table>
            <thead>
              <tr><th className="l">Infraction</th><th>Penalties</th><th>Share</th></tr>
            </thead>
            <tbody>
              {SIN_BIN.infractions.map((row) => (
                <tr key={row.infraction}>
                  <td className="l">{row.infraction}</td>
                  <td>{row.n}</td>
                  <td>{((row.n / SIN_BIN.rows) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
