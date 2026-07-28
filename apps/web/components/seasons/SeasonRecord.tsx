import Link from "next/link";
import { shortDate } from "../../lib/dates";
import { plural } from "../../lib/format";
import { rosterStateAt } from "../../lib/scope";
import {
  SEASON_ATLAS,
  jerseyOf,
  recapsAt,
  seasonGames,
  seasonHref,
  seasonPlayers,
  sessionAt,
  trophiesAt,
} from "../../lib/seasons";
import { GAP_WORDS, GAPS } from "../../lib/stats";
import Recaps from "./Recaps";
import s from "./seasons.module.css";

/**
 * The whole index, newest first, one row per half-year.
 *
 * Nothing here opens by default. The season being played has its own section at
 * the top of the page and is shown open there; this is the index behind it, and
 * an index that arrives with its first entry expanded pushes everything below
 * it off the screen. THE NEWEST ROW DOES NOT OPEN AT ALL — it was a verbatim
 * second copy of the top of the page, the same eighteen lineup rows and the
 * same eleven games, 1,250px down the desktop and 2,000px down the phone, and
 * the reader who scrolled the whole record to reach it was handed the thing
 * they started on. It is a way back up now.
 *
 * THE NUMBERING COUNTS SESSIONS. The rail draws the half-year spine, which is
 * 33 slots — 31 sessions and the two halves nobody has — and numbering the
 * slots had the rail counting to 33 under a hero tile that says 31, with no way
 * to tell which two rows were the difference. That difference is the whole
 * point of drawing the empty halves: a season played and lost is not a season
 * nobody played. The empty rows carry no index and say which they are, in the
 * archive's own words, and there is nothing to open on them.
 */
export default function SeasonRecord() {
  const entries = [...SEASON_ATLAS].sort((a, b) => b.sort - a.sort);
  const newest = entries.find((entry) => entry.href !== null);
  const gapWords = new Map(GAPS.map((gap) => [gap.sort, GAP_WORDS[gap.status]]));

  /** Position in the record, counted over sessions and never over spine slots. */
  let ordinal = entries.filter((entry) => sessionAt(entry.sort)).length + 1;

  return (
    <section className={s.chronicle} id="seasons" aria-labelledby="chronicle-title">
      <header className={s.chronicleHead}>
        <div>
          {/* SEASON INDEX, for parity with the player index at the other end of
              the archive. The two are the same object — every season, every
              player — and they were named as two different kinds of thing. The
              `#seasons` anchor is unchanged; it is linked from the season pages
              and from every player's page. */}
          <h2 id="chronicle-title">Season index</h2>
        </div>
      </header>

      <div className={s.chronicleRail}>
        {entries.map((entry) => {
          const session = sessionAt(entry.sort);
          if (session) ordinal--;

          const games = seasonGames(entry.sort).sort((a, b) => b.date.localeCompare(a.date));
          const played = games.filter((game) => game.result !== null);
          const playoffs = played.filter((game) => game.round !== null);
          const honors = trophiesAt(entry.sort);
          const stories = recapsAt(entry.sort);
          const lineup = session ? seasonPlayers(session.id) : [];
          const lineupRows = lineup
            .map(({ player, lines }) => ({
              player,
              /* THE NUMBER HE PLAYED THE SEASON IN, which is the line carrying
                 the games and never the last line in corpus order. Adam
                 Kaplewicz has two 2017 - Winter lines — #96 over 23 games and
                 67 points, and #26 over a single game — so the lineup labelled
                 the season's leading scorer "26" while the franchise board, the
                 timelines, the player index and his own page all said 96. Same
                 tie-break the rest of the site's `jerseys[0]` lands on. */
              jersey: jerseyOf(lines) ?? player.jerseys[0] ?? null,
              gp: nsum(lines.map((line) => line.gp)),
              g: nsum(lines.map((line) => line.g)),
              a: nsum(lines.map((line) => line.a)),
              pts: nsum(lines.map((line) => line.pts)),
            }))
            .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || a.player.name.localeCompare(b.player.name));
          const hasRecord = games.length > 0 || lineupRows.length > 0 || honors.length > 0 || stories.length > 0;
          const isCurrent = newest !== undefined && entry.sort === newest.sort;

          const heading = (
            <div className={s.chronicleSummary}>
              <span className={s.chronicleIndex}>
                {session ? String(ordinal).padStart(2, "0") : ""}
              </span>
              <span className={s.chronicleYear}>{entry.year}</span>
              <span className={s.chronicleHalf}>{entry.half}</span>
              <span className={s.chronicleSignals}>
                {entry.record && <b>{entry.record}</b>}
                {/* EVERY GAME FIGURE ON THIS STRIP BELONGS TO THE FIGURE BESIDE
                    IT. Three idioms were in play. The masthead prints "268 /
                    263 played" and the current-season card prints "11 / 7
                    played"; this rail printed a bare "7 games" for the same
                    season, which is the played count under the other two's
                    noun. And where the record comes off a league table, the
                    table's own game count was nowhere: Summer 2018 read "9–3"
                    over a log of thirteen results containing four losses,
                    because the record is the league's twelve-game row and the
                    count was the archive's thirteen-row log. A reader who
                    counts the losses under the record — and a former player
                    does — got a different answer and no way to reconcile it.
                    So a standings record carries the standings' count, and a
                    log carries its own. */}
                {entry.recordFromStanding && entry.standingGames !== null && (
                  <span>{plural(entry.standingGames, "game")}</span>
                )}
                {entry.recordFromStanding && entry.games > 0 && entry.games !== entry.standingGames && (
                  <em className={s.chroniclePartial}>{entry.games} in the log</em>
                )}
                {!entry.recordFromStanding && entry.games > 0 && (
                  <span>{plural(entry.scheduled, "game")}</span>
                )}
                {!entry.recordFromStanding && entry.games > 0 && entry.scheduled > entry.games && (
                  <span>{entry.games} played</span>
                )}
                {/* A RESULT IS NOT A GAME, and the column was spending two
                    nouns on the difference with nothing to tell them apart.
                    "27 results" is a dated final score recovered from a
                    write-up; "25 games" is a captured log that this row opens
                    on. Same treatment as the roster flags, because it is the
                    same class of fact: what survives, which the reader cannot
                    get by looking. */}
                {session && entry.games === 0 && entry.results > 0 && (
                  <em className={s.chroniclePartial}>{plural(entry.results, "result")}, no game log</em>
                )}
                {/* ON EVERY SESSION THAT HAS NONE, not only the four with a
                    standings row. Seventeen sessions have no game log and
                    eleven of them said nothing at all about it — the whole
                    2011-2016 block, which is the largest remaining gap in the
                    archive, reading as eleven ordinary seasons that simply do
                    not show their games. The rail is the one surface where the
                    SHAPE of that gap can be seen rather than counted, and it
                    was invisible on two thirds of the rows it covers. The
                    empty half-years are excluded: a season nobody played has no
                    log to be missing, and it says so in its own words. */}
                {session && entry.games === 0 && entry.results === 0 && (
                  <em className={s.chroniclePartial}>no game log</em>
                )}
                {entry.players > 0 && <span>{plural(entry.players, "player")}</span>}
                {playoffs.length > 0 && <span>{playoffs.length} playoff</span>}
                {/* The archive has always known which rosters are incomplete —
                    `rosterLost` and `rosterPartial` are computed at build time
                    and were plumbed onto every rollup — and until now nothing
                    read them. A season showing four names when fourteen played
                    was indistinguishable from a season where four played. It
                    is not a caption explaining the page; it is the one fact
                    about these rows the reader cannot get by looking. */}
                {/* OFF THE COVERAGE CHART'S OWN PREDICATE, not off the flags.
                    `rosterPartial` is set where a name came from a league-wide
                    ranking and is never re-evaluated, so 2020-21 carried it for
                    one goaltender lifted out of a goalie table long after the
                    captain's email supplied the other eighteen — nineteen men
                    against a published nineteen, called incomplete on the rail
                    and a fragment on the chart. `rosterStateAt` decides for both
                    surfaces now, so a correction to one cannot leave the other
                    contradicting it fifteen thousand pixels away. */}
                {rosterStateAt(entry.sort) === "none" && lineupRows.length === 0 && (
                  <em className={s.chroniclePartial}>roster not found</em>
                )}
                {rosterStateAt(entry.sort) === "partial" && lineupRows.length > 0 && (
                  <em className={s.chroniclePartial}>roster incomplete</em>
                )}
                {/* A half nobody has. Two of these on the rail and, until now,
                    nothing to tell them apart — and they are not the same
                    thing at all: one was played and lost, the other was
                    confirmed twice as never played. */}
                {!session && (
                  <em className={s.chronicleGap}>{gapWords.get(entry.sort) ?? GAP_WORDS.unrecorded}</em>
                )}
              </span>
              <span className={s.chronicleHonor}>
                {/* The provenance of an honour read off a playoff schedule
                    rather than off a trophy case is stated where it can be
                    stated — on the season's own page, and here on the mark
                    itself. What it may not be is a dotted rule that reads as a
                    link nobody can click. */}
                {honors.map((honor) => (
                  <i
                    className={honor.scheduleEstablished ? s.honorDerivedMark : undefined}
                    title={honor.scheduleEstablished ? "Established from the playoff schedule" : undefined}
                    key={honor.title}
                  >
                    {honor.title}
                  </i>
                ))}
              </span>
              {!isCurrent && hasRecord && <span className={s.chronicleToggle} aria-hidden="true">+</span>}
              {isCurrent && <span className={s.chronicleToggle} aria-hidden="true">↑</span>}
              {!isCurrent && !hasRecord && entry.href && (
                <span className={s.chronicleToggle} aria-hidden="true">↗</span>
              )}
            </div>
          );

          if (isCurrent) {
            return (
              <div className={s.chronicleSeason} key={entry.sort}>
                <Link className={s.chronicleCurrent} href="#current">{heading}</Link>
              </div>
            );
          }

          if (!hasRecord) {
            /* A SEASON WITH A RECORD AND NOTHING TO OPEN STILL HAS A PAGE.
               2019 - Summer has no roster, no games and no honours, and a
               complete final standings row: twelve games, 5-7-0, fifteen
               points, fifth of eight. It was a dead row on the rail — no
               disclosure, no link — for the one season the archive worked
               hardest to prove was played. There is nothing to expand, so the
               row is the link. */
            return entry.href ? (
              <div className={s.chronicleSeason} key={entry.sort}>
                <Link className={s.chronicleLink} href={entry.href}>{heading}</Link>
              </div>
            ) : (
              <div className={`${s.chronicleSeason} ${s.chronicleEmpty}`} key={entry.sort}>{heading}</div>
            );
          }

          return (
            <details className={s.chronicleSeason} key={entry.sort}>
              <summary>{heading}</summary>
              <div className={s.chronicleBody}>
                {lineupRows.length > 0 && (
                  <section className={s.chronicleBlock} aria-labelledby={`lineup-${entry.sort}`}>
                    {/* No count beside the heading. The summary strip this
                        block opens out of already prints the season's player
                        count and its record, and a tally over a table is the
                        page counting its own rows out loud. */}
                    <div className={s.chronicleBlockHead}>
                      <h3 id={`lineup-${entry.sort}`}>Lineup &amp; statistics</h3>
                    </div>
                    <div className="scroll">
                      <table className={s.chronicleTable}>
                        <thead><tr><th className="l">#</th><th className="l">Player</th><th>GP</th><th>G</th><th>A</th><th>Pts</th></tr></thead>
                        <tbody>
                          {lineupRows.map((row) => (
                            <tr key={row.player.slug}>
                              <td className="l">{row.jersey ?? "—"}</td>
                              <td className="l"><Link href={`/players/${row.player.slug}`}>{row.player.name}</Link></td>
                              {[row.gp, row.g, row.a, row.pts].map((value, cell) => <td key={cell}>{value ?? "—"}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* COUNTED THE SAME WAY THE STRIP COUNTS IT. This was
                    `games.length` — schedule rows — while the strip's figure is
                    results, so 2019 - Winter printed the words "no game log"
                    and opened on a section headed "Game log" holding one row: a
                    Mad Dogs fixture postponed in April 2020 and never made up.
                    The row told the reader there was no log and then showed him
                    one. The fixture is still on /seasons/2019-winter and in
                    /games, which is where a schedule row that never became a
                    game belongs. */}
                {played.length > 0 && (
                  <section className={s.chronicleBlock} aria-labelledby={`games-${entry.sort}`}>
                    <div className={s.chronicleBlockHead}>
                      <h3 id={`games-${entry.sort}`}>Game log</h3>
                    </div>
                    <div className={s.compactGames}>
                      {/* THE STATUS IS NOT A SCORE AND DOES NOT FIT IN A SCORE'S
                          TRACK. "Postponed" overflowed a 44px cell by 9px and
                          painted past the row's right edge; "Not Started"
                          wrapped to two lines at every width. The column holds
                          a score or an em dash, and the word moves in beside
                          the club, which is the only cell on the row with room
                          — and where a game that has not happened belongs. */}
                      {games.map((game) => {
                        const noScore = game.gf === null || game.ga === null;
                        return (
                          <Link href={`/games/${game.id}`} className={s.compactGame} data-result={game.result ?? ""} key={game.id}>
                            <time dateTime={game.date}>{shortDate(game.date)}</time>
                            <span>
                              {game.round && <small className={s.compactPlayoff}>Playoff</small>}
                              {game.opponent}
                              {noScore && <small className={s.compactStatus}>{game.status}</small>}
                            </span>
                            <b>{game.result ?? ""}</b>
                            <strong>{noScore ? "—" : `${game.gf}–${game.ga}`}</strong>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                )}

                {stories.length > 0 && (
                  <section className={s.chronicleBlock} aria-labelledby={`stories-${entry.sort}`}>
                    <div className={s.chronicleBlockHead}>
                      <h3 id={`stories-${entry.sort}`}>From the room</h3>
                    </div>
                    <Recaps stories={stories} />
                  </section>
                )}

                <Link className={s.seasonDeepLink} href={seasonHref(entry.sort)}>
                  Open the season page <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

const nsum = (values: (number | null)[]): number | null =>
  values.reduce<number | null>((total, value) => value === null ? total : (total ?? 0) + value, null);
