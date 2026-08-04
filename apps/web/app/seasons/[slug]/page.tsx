import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AnimatedCounter from "../../../components/AnimatedCounter";
import GameList from "../../../components/games/GameList";
import { rows } from "../../../components/games/games";
import Recaps from "../../../components/seasons/Recaps";
import s from "../../../components/seasons/seasons.module.css";
import { leagueRecord, plural, record } from "../../../lib/format";
import { rosterStateAt } from "../../../lib/scope";
import {
  AVAILABLE_SEASONS,
  SEASON_ATLAS,
  divisionAt,
  jerseyOf,
  recapsAt,
  seasonGames,
  seasonHref,
  seasonPlayers,
  sessionAt,
  sortFromSeasonSlug,
  honorStage,
  trophiesAt,
} from "../../../lib/seasons";
import { ROLLUPS } from "../../../lib/stats";
import type { SessionRollup } from "../../../lib/stats";

export function generateStaticParams() {
  return AVAILABLE_SEASONS.map((entry) => ({ slug: entry.href!.split("/").at(-1)! }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sort = sortFromSeasonSlug(slug);
  const entry = sort === null ? undefined : SEASON_ATLAS.find((item) => item.sort === sort && item.href);
  if (!entry) return { title: "Season not found" };
  return {
    title: entry.label,
    description: `${entry.label}: ${entry.players} players, ${entry.games} games${entry.record ? `, ${entry.record}` : ""}.`,
  };
}

const nsum = (values: (number | null)[]): number | null =>
  values.reduce<number | null>((total, value) => value === null ? total : (total ?? 0) + value, null);

/** Goals, assists and points off the season's own stat lines. */
const scoringFigures = (rollup: SessionRollup | undefined): [string, number][] =>
  ([["Goals", rollup?.g.value], ["Assists", rollup?.a.value], ["Points", rollup?.pts.value]] as const)
    .flatMap(([label, value]) => (value === null || value === undefined ? [] : [[label, value] as [string, number]]));

export default async function SeasonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sort = sortFromSeasonSlug(slug);
  const atlasIndex = sort === null ? -1 : AVAILABLE_SEASONS.findIndex((entry) => entry.sort === sort);
  const entry = atlasIndex < 0 ? undefined : AVAILABLE_SEASONS[atlasIndex];
  if (!entry || sort === null) notFound();

  const session = sessionAt(sort);
  const rollup = ROLLUPS.find((roll) => roll.sort === sort);
  const games = seasonGames(sort);
  const lineup = session ? seasonPlayers(session.id) : [];
  const honors = trophiesAt(sort);
  const stories = recapsAt(sort);
  const played = games.filter((game) => game.result !== null);
  const wins = played.filter((game) => game.result === "W").length;
  const losses = played.filter((game) => game.result === "L").length;
  const ties = played.filter((game) => game.result === "T").length;
  const previous = AVAILABLE_SEASONS[atlasIndex - 1];
  const next = AVAILABLE_SEASONS[atlasIndex + 1];

  const lineupRows = lineup
    .map(({ player, lines }) => ({
      player,
      lines,
      gp: nsum(lines.map((line) => line.gp)),
      g: nsum(lines.map((line) => line.g)),
      a: nsum(lines.map((line) => line.a)),
      pts: nsum(lines.map((line) => line.pts)),
      pim: nsum(lines.map((line) => line.pim)),
      /* The number he played the season in — the line carrying the games, not
         the last one in corpus order. See `jerseyOf`. */
      jersey: jerseyOf(lines) ?? player.jerseys[0] ?? null,
      phase: [...new Set(lines.map((line) => line.phase).filter(Boolean))].join(" / "),
    }))
    .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || b.player.career.pts - a.player.career.pts);

  /**
   * THE LEAGUE'S OWN LINE LEADS, AND THE GAME LOG STANDS UNDER IT.
   *
   * Where a league published a final table, those figures ARE the season — the
   * record, the points, the goals and the place it finished, which nothing
   * derived here can supply. This used to be gated on `played.length === 0`,
   * so Summer 2018 — the only session holding both — printed 9–4 over thirteen
   * schedule rows and buried a stored HarborCenter row reading 6-2-3-1 over
   * twelve games, 74 goals for, 59 against and THIRD OF ELEVEN, the club's
   * second-best placing anywhere in the file. It was the one place in the
   * archive where a published table was discarded for a derived one.
   *
   * Both accounts are on the page and each sits with its own source: this hero
   * is the league's, and the game log below carries its own record in its head.
   * They disagree about that season by one game, and the archive cannot say
   * which is right — so it prints both rather than choosing.
   */
  const standing = session?.record ?? null;
  /* THE COVERAGE CHART'S PREDICATE, so a season's own page cannot disagree with
     the chart and the rail about its own roster. It read the build flags, and
     `rosterPartial` is set at the parse boundary and never re-evaluated: 2020-21
     kept it for a single goaltender lifted out of a goalie table, long after the
     captain's email supplied the other eighteen — nineteen men against a league
     breakdown of nineteen, and the page told them they were missing. */
  const rosterHole = session ? rosterStateAt(sort) : null;
  const partial =
    rosterHole === "none" && lineupRows.length === 0
      ? "roster not found"
      : rosterHole === "partial"
        ? "roster incomplete"
        : null;
  const division = divisionAt(sort);

  const figures: [string, number | string][] = [
    ...(standing
      ? [["Record", leagueRecord(standing)] as [string, string]]
      : played.length
        ? [["Record", record(wins, losses, ties)] as [string, string]]
        : []),
    ...(standing
      ? standing.gp === null ? [] : [["Games", standing.gp] as [string, number]]
      : played.length ? [["Games", played.length] as [string, number]] : []),
    ...(standing && standing.pts !== null ? [["Points", standing.pts] as [string, number]] : []),
    ...(standing && standing.gf !== null ? [["Goals for", standing.gf] as [string, number]] : []),
    ...(standing && standing.ga !== null ? [["Goals against", standing.ga] as [string, number]] : []),
    ...(standing?.place ? [["Finished", `${standing.place} of ${standing.of}`] as [string, string]] : []),
    /* GOALS COME OFF THE GAMES WHEREVER THE GAMES SURVIVE AND NO TABLE DOES.
       They used to be the sum of the season's player lines while the record and
       the log on the same screen came off the games, and the two disagreed on
       every session that has both: Summer 2018 printed "Goals 19" over a
       thirteen-game log whose own scores add to 78, because one player's line
       is all that survives of that roster. Where there is a log, the log is the
       team's scoring and it is the thing directly below the figure. */
    ...(!standing && played.length
      ? ([["Goals", played.reduce((total, game) => total + (game.gf ?? 0), 0)],
          ["Goals against", played.reduce((total, game) => total + (game.ga ?? 0), 0)]] as [string, number][])
      : []),
    /* With neither a log nor a standings row, the surviving player lines are
       the only account of the season there is — but a fragment published as a
       total is worse than no figure, so a known-partial roster prints none. */
    ...(!played.length && !standing && !partial ? scoringFigures(rollup) : []),
    ...(lineupRows.length ? [["Players", lineupRows.length] as [string, number]] : []),
  ];

  return (
    <>
      <div className="wrap page">
        <header className={`hero ${s.seasonHero} seq`}>
          <span className="kicker">
            <Link href="/seasons">Seasons</Link>
            {division && <> · {division} division</>}
            {session && <> · {session.provenance.label}</>}
            {/* The rail one click away has flagged the hollow rosters since
                they were computed; the season's own page did not, so fifteen
                names of which fourteen are dashes read as fourteen players who
                registered nothing rather than as a source that kept one line. */}
            {partial && <span className={s.seasonPartial}> · {partial}</span>}
          </span>
          <h1 className={s.seasonTitle}>
            <span className={s.seasonYear}>{entry.year}</span>
            <span className={s.seasonHalf}>{entry.half}</span>
          </h1>

          {honors.length > 0 && (
            /* The stage goes in the headline, not only in the Honours block
               further down. "Adams Division Champions · Runner-Up" is what a
               reader sees first and it looks like a contradiction until you
               know one is the table and the other is the final. */
            <p className="hero-p" style={{ color: "var(--gold)" }}>
              {honors
                .map((honor) => {
                  const stage = honorStage(honor);
                  return stage ? `${honor.title} (${stage})` : honor.title;
                })
                .join(" · ")}
            </p>
          )}

          {figures.length > 0 && (
            <dl className="figs" data-stagger>
              {figures.map(([label, value]) => (
                <div className="fig" key={label}>
                  <dt>{label}</dt>
                  <dd>{typeof value === "number" ? <AnimatedCounter value={value} /> : value}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        {lineupRows.length > 0 && (
          <section className="section" data-reveal>
            <div className="card">
              <div className="head">
                <h2>Lineup & statistics</h2>
                <span className="kicker">{plural(lineupRows.length, "player")}</span>
              </div>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="l">#</th>
                      <th className="l">Player</th>
                      <th className="l">Phase</th>
                      <th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineupRows.map((row) => (
                      <tr key={row.player.slug}>
                        <td className="l" style={{ color: "var(--ball)" }}>{row.jersey ?? "—"}</td>
                        <td className="l"><Link href={`/players/${row.player.slug}`}>{row.player.name}</Link></td>
                        <td className="l" style={{ color: "var(--dim)", fontSize: 10 }}>{row.phase}</td>
                        {[row.gp, row.g, row.a, row.pts, row.pim].map((value, index) => (
                          <td key={index}>{value ?? <span style={{ color: "var(--dim)" }}>—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {games.length > 0 && (
          <section className="section" data-reveal>
            <div className="card">
              <div className="head">
                <h2>Game log</h2>
                {/* Only where something was played. The kicker read "0–0" over
                    a single row saying "Postponed". */}
                {played.length > 0 && <span className="kicker">{record(wins, losses, ties)}</span>}
              </div>
              <GameList
                games={rows().filter((game) => game.sessionSort === sort)}
                sessions={[{ sort, label: entry.label }]}
              />
            </div>
          </section>
        )}

        {honors.length > 0 && (
          <section className="section" data-reveal>
            <div className="card">
              <div className="head"><h2>Honours</h2><span className="kicker">{honors.length}</span></div>
              {/* Ten of the twelve honours come off a stored trophy case. Two
                  are read off the shape of a playoff schedule — two wins, then
                  the final lost — and were rendering in the same gold as a
                  recorded title on a site whose thesis is that every figure
                  traces back to a stored page. The provenance line says which
                  page. */}
              <div className={s.honors}>
                {honors.map((honor, index) => (
                  <div className={`${s.honor} ${honor.scheduleEstablished ? s.honorDerived : ""}`} key={`${honor.title}-${index}`}>
                    <strong>{honor.year}</strong>
                    <span>{honor.title}</span>
                    <small>
                      {[honorStage(honor), honor.league, honor.scheduleEstablished ? "playoff schedule" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {stories.length > 0 && (
          <section className="section" data-reveal>
            <div className="card">
              <div className="head">
                <h2>From the room</h2>
                <span className="kicker">{plural(stories.filter((story) => story.recap).length, "dispatch", "dispatches")}</span>
              </div>
              <Recaps stories={stories} />
            </div>
          </section>
        )}

        {/* NO `On the record`. The last two rulings came off here on
            2026-08-04, with the three on the player pages. They were working
            notes from reconciling the corpus — which source won, and why — and
            a reader did not ask to watch that argument. The decisions stand in
            the figures; the reasoning does not belong on the page. */}

        <nav className={s.seasonNav} aria-label="Adjacent seasons">
          <span>{previous && <Link href={seasonHref(previous.sort)} className="kicker">← {previous.label}</Link>}</span>
          <span>{next && <Link href={seasonHref(next.sort)} className="kicker">{next.label} →</Link>}</span>
        </nav>
        <footer className="site"><Link href="/seasons">All seasons</Link></footer>
      </div>
    </>
  );
}
