import Link from "next/link";
import AnimatedCounter from "../AnimatedCounter";
import { shortDate } from "../../lib/dates";
import { plural, record } from "../../lib/format";
import {
  AVAILABLE_SEASONS,
  divisionAt,
  jerseyOf,
  seasonGames,
  seasonHref,
  seasonPlayers,
  sessionAt,
  trophiesAt,
} from "../../lib/seasons";
import s from "./seasons.module.css";

/**
 * The season being played, opened, at the top of the archive.
 *
 * Everything else on this page is the past. This is not: it is the newest
 * session on file, its lineup, its record and its games — including the ones
 * that have not been played yet, which is the only place on the site that
 * shows what is coming.
 *
 * Which season that is comes out of the data every time it renders. A capture
 * that lands a new half-year moves this section to it with nothing to change
 * here, and a season with no games behind it still renders its lineup.
 */

const nsum = (values: (number | null)[]): number | null =>
  values.reduce<number | null>((total, value) => value === null ? total : (total ?? 0) + value, null);

/**
 * The team's calendar feeds — the INDEX, not the .ics file behind it.
 *
 * Both exist and the file is real: `ics/golden-retrievers-summer-2026.ics`,
 * served as text/calendar, rebuilt from the same HarborCenter pages this
 * archive captures. It is still the wrong link to put here, for two reasons
 * the index page states about itself. A browser handed an .ics downloads it,
 * and an imported file is a copy taken once — "Tapping the link on Android
 * typically downloads a file (one-time import) and won't auto-update" — where
 * subscribing means pasting the address into a calendar and being told about
 * the game that moves. The index is where that address is, next to the steps
 * for doing it on either platform.
 *
 * And its name does not turn over. The feed's does: a filename carrying a
 * session — `summer-2026`, `fallwinter-202526` — is a URL this site would have
 * to guess the next time the season rolls, off a convention it does not own.
 * The index has listed every session so far and will list the next one.
 */
const CALENDAR = "https://karchensky.github.io/hockey_events/";

/**
 * A status that says the game will NOT be played as scheduled.
 *
 * `result === null` is not enough on its own and the corpus proves it: one game
 * has no result because it was postponed in April 2020 and never made up, and
 * four have none because they have not been skated yet. Both are absences and
 * only one of them is coming.
 */
const CALLED_OFF = /postpon|cancel|forfeit|suspend/i;

export default function CurrentSeason() {
  const entry = AVAILABLE_SEASONS.at(-1);
  if (!entry) return null;

  const session = sessionAt(entry.sort);
  const games = [...seasonGames(entry.sort)].sort((a, b) => a.date.localeCompare(b.date));
  const played = games.filter((game) => game.result !== null);
  const wins = played.filter((game) => game.result === "W").length;
  const losses = played.filter((game) => game.result === "L").length;
  const ties = played.filter((game) => game.result === "T").length;
  const gf = played.reduce((total, game) => total + (game.gf ?? 0), 0);
  const ga = played.reduce((total, game) => total + (game.ga ?? 0), 0);
  const honors = trophiesAt(entry.sort);

  /**
   * The next fixture: the first game of this season still to be played.
   *
   * Derived, and deliberately without a clock. This site is a static export, so
   * `new Date()` would be the BUILD's date baked into the HTML — no fresher
   * than the schedule beside it, and it would make two builds of one corpus
   * disagree. A game leaves this slot when the capture carrying its result
   * lands, which is the same moment the log below starts showing a score for
   * it. `sync:current` is what makes this true, not the render.
   *
   * Empty is a real answer. The last game of a season is played, nothing takes
   * its place, and nothing is drawn until the next schedule is captured.
   */
  const nextGame = games.find((game) => game.result === null && !CALLED_OFF.test(game.status));

  /**
   * The last one skated, with what it came to.
   *
   * Same derivation as the fixture beside it and the same refusal to consult a
   * clock: the newest game in the season that carries a result. A result is what
   * makes a game past — not a date, which a static export cannot compare
   * anything to — so a postponement never lands here and neither does a fixture
   * whose sheet has not been captured yet.
   *
   * BOTH HALVES ARE OPTIONAL AND NEITHER IMPLIES THE OTHER. A season opens with
   * no result and no last game; it ends with no fixture and no next; and between
   * the final whistle and the capture that carries the score, this one is a game
   * behind. Each is drawn only if it exists, and if neither does the row is not
   * drawn at all.
   */
  const lastGame = [...played].reverse()[0];

  const lineup = session ? seasonPlayers(session.id) : [];
  const lineupRows = lineup
    .map(({ player, lines }) => ({
      player,
      /* The number he played the season in — the line carrying the games, not
         the last one in corpus order. See `jerseyOf`. */
      jersey: jerseyOf(lines) ?? player.jerseys[0] ?? null,
      gp: nsum(lines.map((line) => line.gp)),
      g: nsum(lines.map((line) => line.g)),
      a: nsum(lines.map((line) => line.a)),
      pts: nsum(lines.map((line) => line.pts)),
    }))
    .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || a.player.name.localeCompare(b.player.name));

  if (games.length === 0 && lineupRows.length === 0) return null;

  const figures: { key: string; value: number | string; note?: string }[] = [
    ...(played.length > 0 ? [{ key: "Record", value: record(wins, losses, ties) }] : []),
    ...(games.length > 0
      ? [{ key: "Games", value: games.length, note: `${played.length} played` }]
      : []),
    ...(played.length > 0 ? [{ key: "Goals", value: gf, note: `${ga} against` }] : []),
    ...(lineupRows.length > 0 ? [{ key: "Players", value: lineupRows.length }] : []),
  ];

  return (
    <section className="section" id="current" data-reveal>
      <div className="card">
        <div className="head">
          <h2>Current season</h2>
          {/* The division comes off the scoring leaderboards where the session
              does not carry one, which is every session since 2020-21. It is
              the fact that explains the last three summers. */}
          <span className="kicker">
            {entry.label}
            {divisionAt(entry.sort) && <> · {divisionAt(entry.sort)} division</>}
            {session && <> · {session.provenance.label}</>}
          </span>
        </div>

        {/* WHERE THE SEASON IS: the last one skated and the next one on the
            card, side by side, at the head of the only section that is not the
            past. The fixture stood here alone, and a schedule with no score
            beside it answers half of what a reader arrives for. Home and away
            are spelled the way the game page spells them, because that is where
            both of these go. */}
        {/* "NEXT GAME" WAS A CLAIM ABOUT THE CLOCK, made by a static build
            that has none. Between the fixture and the capture that carries its
            result, the banner sat over a date that had already passed and said
            it was next — and this is the one element a returning reader checks
            first. What is true whatever the date is that the game is on the
            schedule and has no result, which is exactly what the label says
            now. Its neighbour is the same refusal read the other way: a game is
            past because it carries a result, never because a date says so. Both
            dates are set in the same form as the log three hundred pixels below,
            which used to print the same fixture as an ISO string. */}
        {(nextGame || lastGame) && (
          <div className={s.fixtures}>
            {nextGame && (
              <Link className={s.fixture} href={`/games/${nextGame.id}`}>
                <span className={s.fixtureLabel}>Next on the schedule</span>
                <strong className={s.fixtureName}>
                  {nextGame.gr === "home" ? "vs" : "at"} {nextGame.opponent}
                </strong>
                <span className={s.fixtureWhen}>
                  <time dateTime={nextGame.date}>{shortDate(nextGame.date)}</time>
                  {nextGame.time && <> · {nextGame.time}</>}
                  {nextGame.rink && <> · {nextGame.rink}</>}
                </span>
              </Link>
            )}

            {/* THE SCORE IS THE FIXTURE'S OWN LINE HERE, not a caption under it.
                A result read as "W · 6–3" on one line and the club on another is
                two readings of one row; the game log three hundred pixels below
                sets the same three things in the same order, so a reader
                crossing between them is reading one grammar. */}
            {lastGame && (
              <Link className={s.fixture} href={`/games/${lastGame.id}`} data-result={lastGame.result ?? ""}>
                <span className={s.fixtureLabel}>Last result</span>
                <strong className={s.fixtureName}>
                  <b>{lastGame.result}</b>
                  {lastGame.gf !== null && lastGame.ga !== null && ` ${lastGame.gf}–${lastGame.ga}`}
                  {` ${lastGame.gr === "home" ? "vs" : "at"} ${lastGame.opponent}`}
                </strong>
                <span className={s.fixtureWhen}>
                  <time dateTime={lastGame.date}>{shortDate(lastGame.date)}</time>
                  {lastGame.rink && <> · {lastGame.rink}</>}
                </span>
              </Link>
            )}
          </div>
        )}

        {honors.length > 0 && (
          <p className={s.currentHonor}>{honors.map((honor) => honor.title).join(" · ")}</p>
        )}

        {figures.length > 0 && (
          <dl className="figs" data-stagger>
            {figures.map((figure) => (
              <div className="fig" key={figure.key}>
                <dt>{figure.key}</dt>
                <dd>{typeof figure.value === "number" ? <AnimatedCounter value={figure.value} /> : figure.value}</dd>
                {figure.note && <small>{figure.note}</small>}
              </div>
            ))}
          </dl>
        )}

        <div className={s.currentBody}>
          {lineupRows.length > 0 && (
            <section className={s.chronicleBlock} aria-labelledby="current-lineup">
              <div className={s.chronicleBlockHead}>
                <h3 id="current-lineup">Lineup &amp; statistics</h3>
              </div>
              <div className="scroll">
                <table className={s.chronicleTable}>
                  <thead>
                    <tr><th className="l">#</th><th className="l">Player</th><th>GP</th><th>G</th><th>A</th><th>Pts</th></tr>
                  </thead>
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

          {games.length > 0 && (
            <section className={s.chronicleBlock} aria-labelledby="current-games">
              <div className={`${s.chronicleBlockHead} ${s.headAction}`}>
                <h3 id="current-games">Game log</h3>
                {/* ONE LINE, NO DOMAIN. This carried `karchensky.github.io`
                    under the action on the reasoning that the arrow alone does
                    not say "another site" — this site puts ↗ on its own deep
                    links too — so a domain said it without a sentence. The
                    captain took it off on 2026-08-04: it reads as a stray
                    fragment on the head of a log, and the arrow carries it. */}
                <a className={s.calendarLink} href={CALENDAR} target="_blank" rel="noreferrer">
                  <span>
                    Subscribe to the schedule <i aria-hidden="true">↗</i>
                  </span>
                </a>
              </div>
              {/* THE BANNER'S FIXTURE IS MARKED HERE, NOT PRINTED TWICE.
                  The banner and this log sit inside one 900px viewport on a
                  laptop — 639px apart — and both carried the same date, club
                  and status, pointing at the same URL. The banner stays: it is
                  the only forward-looking thing on the site. The row it names
                  says so, and the status word replaces a score rather than
                  overflowing the track sized for one. */}
              <div className={s.compactGames}>
                {games.map((game) => {
                  const noScore = game.gf === null || game.ga === null;
                  const isNext = nextGame !== undefined && game.id === nextGame.id;
                  return (
                    <Link href={`/games/${game.id}`} className={s.compactGame} data-result={game.result ?? ""} key={game.id}>
                      <time dateTime={game.date}>{shortDate(game.date)}</time>
                      <span>
                        {game.round && <small className={s.compactPlayoff}>Playoff</small>}
                        {isNext && <small className={s.compactNext}>Next</small>}
                        {game.opponent}
                        {noScore && !isNext && <small className={s.compactStatus}>{game.status}</small>}
                      </span>
                      <b>{game.result ?? ""}</b>
                      <strong>{noScore ? "—" : `${game.gf}–${game.ga}`}</strong>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <Link className={s.seasonDeepLink} href={seasonHref(entry.sort)}>
          Open the season page <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
}
