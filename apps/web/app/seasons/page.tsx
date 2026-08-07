import type { Metadata } from "next";
import AnimatedCounter from "../../components/AnimatedCounter";
import JsonLd from "../../components/JsonLd";
import StatsStyles from "../../components/stats/styles";
import AssistNetwork from "../../components/stats/AssistNetwork";
import Trajectories from "../../components/stats/Trajectories";
import FirstAndLast from "../../components/stats/hubs/FirstAndLast";
import Opponents from "../../components/stats/hubs/Opponents";
import SinBin from "../../components/stats/hubs/SinBin";
import ArchiveNav from "../../components/seasons/ArchiveNav";
import CurrentSeason from "../../components/seasons/CurrentSeason";
import DataCoverage, { ScopeNote } from "../../components/seasons/DataCoverage";
import FranchiseLeaderboard from "../../components/seasons/FranchiseLeaderboard";
import PlayerIndex from "../../components/seasons/PlayerIndex";
import type { IndexTile } from "../../components/seasons/PlayerIndex";
import SeasonRecord from "../../components/seasons/SeasonRecord";
import { assistScope, data, goaltending, players, recorded, totals, FOUNDED, TEAM_GAMES } from "../../lib/data";
import { num, plural, record } from "../../lib/format";
import {
  LOG_SORTS,
  OPPONENTS,
  OPPONENT_COLUMNS,
  OPPONENT_SUMMARY,
  SHEET_SORTS,
  SIN_BIN,
  SPAN_SUMMARY,
} from "../../lib/hubs";
import { pageMeta } from "../../lib/meta";
import { teamSchema } from "../../lib/schema";
import { SCOPE } from "../../lib/scope";
import {
  BOARD_CELLS,
  BOARD_PEOPLE,
  ERAS,
  NETWORK,
  ROLLUPS,
  SPINE,
  TRACES,
} from "../../lib/stats";

export const metadata: Metadata = pageMeta({
  title: "Team Archive",
  path: "/seasons",
  description: `${totals.sessions} seasons of Golden Retrievers rosters, statistics, games, honours, and stories in one chronological archive.`,
});

/**
 * The archive, in the order a reader wants it.
 *
 * TWO SPINES AND SEVEN INSTRUMENTS. `Season index` and `Player index` are
 * the archive itself — every season, every player — and they are set in the
 * display face, outside a card, at the size that says so. The seven between
 * them are readings taken off those two, and they sit in cards at a heading
 * size to match. The type was already doing this and the navigation was
 * contradicting it, listing nine equals; it does not now.
 *
 * The season being PLAYED leads, then the instruments, then the two spines.
 * `Session history` and `Career timelines` are drawn on the same axis — every
 * player against the session spine, presence in one and magnitude in the other
 * — so they run as a pair, and the pair leads the instruments: who was here is
 * the question a reader brings, and how much they scored is the question that
 * follows it. `Franchise leaders` sits under them because it is those same
 * careers collapsed to one row apiece. `The sin bin` follows the assist network
 * because both are about what a player does with other players on the ice.
 * `The opponents` immediately precedes the season record because both are the
 * same games — one collapsed by club, the other by season.
 *
 * THE NAVIGATION IS IN THE ORDER OF THE PAGE. It listed the two spines first
 * because the type gives them the most weight, which had the first two entries
 * on a nineteen-thousand-pixel map pointing at the bottom of the document. The
 * spines keep their colour where they actually sit.
 *
 * COVERAGE IS DRAWN ONCE, UNDER THE CURRENT SEASON. Every section built on the
 * game log covers a much shorter span than the sections built on rosters, and
 * seven of them carried a caveat apiece saying so — the same sentence with a
 * different subject, seven times down nineteen thousand pixels, and not one of
 * them able to name a season. Then it was six rows of mono prose naming them in
 * lists. `DataCoverage` is the whole statement as a chart, on the same session
 * spine the timelines and the history are drawn against. The two sections whose
 * scope is narrower than the chart's own rows — the penalties and the opponents
 * — carry one labelled row apiece and nothing else repeats it.
 *
 * KICKERS DO NOT RESTATE THE THING BELOW THEM. Three of them did — the
 * chemistry totals were printed again ninety pixels down in the live readout,
 * the sin bin's first tile reprinted its own kicker, and the opponents' `Most
 * played` tile was the first row of the table it sat on top of. A kicker that
 * restates its own table is the page counting its own rows out loud, and it
 * spends the most valuable typographic slot in the section doing it.
 */
export default function SeasonsPage() {
  const busiestPeriod = [...SIN_BIN.periods].sort((a, b) => b.n - a.n)[0];
  /* WHAT 505 PENALTIES COME TO A GAME — the one reading of them the section
     does not already carry. The tile here was `Roughing / 136 / 27% of them`,
     which is the leftmost column of the matrix under it and the first row of
     the table under that: the same two figures printed three times in one
     section, at two precisions. The opponents' `Most played` tile came off for
     exactly this and this one was left. */
  /* OVER THE GAMES THAT RECORDED SOMETHING. It divided by every game with a
     sheet, and twenty-six of those sheets carry no event detail at all — no
     goals and no penalties, on games with real scores, including a 13–0
     semi-final and a 7–6 in overtime. Counting them was twenty-six games in
     which nobody took a penalty, which is absence read as zero in the one tile
     on the page that is a division, in the section whose caveat is about
     exactly which games recorded anything. site.json names the figure itself. */
  const withDetail = data.gameTotals.withSheet - data.gameTotals.sheetsWithoutDetail;
  const perGame = withDetail > 0 ? (SIN_BIN.rows / withDetail).toFixed(2) : null;

  /* A goaltender's tile carries a goaltender's record, because his scoring
     columns were never filled in and a null summed to nought is not a career.
     AND NEITHER IS A SKATER'S: two men have one season line each with every
     column blank, and their tiles read "1 session · 0 pts" while the franchise
     board on this same page prints an em dash for both. Where nothing was
     recorded the tile carries the sessions and stops.
     Built here rather than in the index: the index is a client component and
     the corpus does not go to the browser. */
  const tiles: IndexTile[] = [...players]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((player) => {
      const net = goaltending(player);
      const pts = recorded(player, "pts");
      const sessions = plural(player.career.sessions, "session");
      return {
        slug: player.slug,
        name: player.name,
        jersey: player.jerseys[0] ?? "99",
        sessions: player.career.sessions,
        /* "2 sessions · 6–4" is a win-loss record and reads as a score. The
           two-number form is only ambiguous while it is unlabelled, and every
           tile beside it carries points. */
        line: net.primary
          ? `${sessions} · ${record(net.w, net.l, net.t)} in goal`
          : pts === null
            ? sessions
            : `${sessions} · ${num(pts)} pts`,
      };
    });

  /* THE MAP IS IN THE ORDER OF THE THING IT MAPS. It led with the two spines,
     which are eighth and ninth on the page — 11,206px and 15,299px down — so
     the first two entries pointed at the bottom of the document and the third
     at the top. The type already carries the hierarchy and still does: the two
     spines keep their own colour, in the places they occupy. */
  const sections = [
    ["#current", "Current season"],
    ["#coverage", "Data coverage"],
    ["#history", "Session history"],
    ["#timelines", "Career timelines"],
    ["#leaders", "Franchise leaders"],
    ["#chemistry", "Who set up whom"],
    ["#sinbin", "Penalties"],
    ["#opponents", "The opponents"],
  ] as const;
  const spine = [
    ["#seasons", "Season index"],
    ["#players", "Player index"],
  ] as const;

  return (
    <>
      {/* The same `@id` the home page states, deliberately. This is the
          archive's front door and the page most likely to be found first, and a
          crawler arriving here should get the club rather than a table with no
          subject. Repeating a node under one identifier is not a contradiction;
          stating the club twice under two would be. */}
      <JsonLd data={teamSchema()} />
      <div className="wrap wrap-wide page stx">
        <StatsStyles />

        {/* No kicker over the headline. "Everything on file · newest first" was
            the page describing its own sort order and its own scope to a reader
            who is looking straight at both. The lede below it stays: it names
            honours and the recaps, which are a long way down and invisible from
            here. */}
        <header className="hero seq">
          <h1 className="hero-h">
            The team
            <br />
            <i>archive.</i>
          </h1>
          {/* No lede. "Seasons, players, results, honours, statistics, and the
              words left behind" was a list of the nine section headings a
              reader is about to scroll past, with a closing flourish that means
              nothing. The headline says what this is. */}

          {/* THE RECORD, WITH ITS TIES, AND GAMES THAT AGREE WITH IT. The
              masthead printed 141–120 over 268 games — a record silently
              missing its tie column and a games total counting five fixtures
              nobody played, so the first two numbers a reader meets could not
              be reconciled with each other or with the 141–120–2 over 263 games
              nine thousand pixels below. One derivation now, and the subtitle
              is the idiom the current-season tile already uses. */}
          <dl className="figs" data-stagger>
            {/* SESSIONS, not seasons. The same 31 was printed under three
                nouns — seasons in the masthead, sessions in every scope line
                and readout, half-years under the absence figure — and three of
                the thirty-one are four-day tournaments rather than seasons at
                all. One word, and it is the archive's own. */}
            <div className="fig"><dt>Sessions</dt><dd><AnimatedCounter value={totals.sessions} /></dd></div>
            <div className="fig"><dt>Players</dt><dd><AnimatedCounter value={totals.people} /></dd></div>
            {/* GAMES PLAYED, not games on file. This printed 268 — the size of
                the game LOG, which starts at 2016-17 — directly above careers
                of 422, 373 and 361 games. Not a disagreement, an impossibility.
                TEAM_GAMES counts every session: its standings row where one
                survives, and otherwise the largest games-played figure any
                player recorded in it, since nobody plays more games than the
                team. The log is a scope statement, not a total. */}
            <div className="fig">
              <dt>Games</dt>
              <dd><AnimatedCounter value={TEAM_GAMES} /></dd>
              <small>{data.gameTotals.played} on file</small>
            </div>
            {/* WITHOUT ITS OWN CAVEAT. It read "over 14 of the 31 sessions",
                which is the first of seven printings of one sentence and the
                one the coverage chart's top row now draws. The half of the
                archive this record is drawn from is stated once, four hundred
                pixels down, session by session. */}
            <div className="fig">
              <dt>Record</dt>
              <dd>{record(data.gameTotals.w, data.gameTotals.l, data.gameTotals.t)}</dd>
            </div>
          </dl>
        </header>

        {/* The page's only map, and it used to end at 748px on a document
            nineteen thousand pixels long — 21 screens with no way back. It
            travels now, and every label is the heading it lands on: two of them
            were not ("Chemistry" for `Who set up whom`, "Penalties" for `The
            sin bin`), so the reader who scrolled back for the word they needed
            did not find it. */}
        {/* The map carries coverage as an ordinary stop. It used to sit ahead
            of the route with a rule between it, on the grounds that it is the
            key to the sections rather than one of them — which put an entry
            first in a list whose only promise is that it is in the order of the
            page. One list, one order, and the chart is where the route says. */}
        <ArchiveNav sections={sections} spine={spine} />

        {/* THE SEASON BEING PLAYED LEADS. Coverage is the key to everything
            under it and follows immediately, which is where a reader meets it
            on the way from the current side into the record. */}
        <CurrentSeason />

        <DataCoverage />

        {/* WHO WAS HERE, BEFORE HOW MUCH THEY SCORED. This and the timelines
            are the same picture read two ways — every player against the
            session spine, presence here and magnitude there — and they now run
            as a pair at the head of the instruments, because presence is the
            question a reader brings and scoring is the one that follows it.
            They are not one section: this is drawn off ROSTERS and covers all
            79 players, the timelines are drawn off SCORING and cover the 34 who
            have two readings, and the coverage chart says which is which.

            THE MEN STILL PLAYING LEAD IT, deepest tenure first, and everybody
            else keeps the arrival order behind them. Seventy-nine rows in order
            of arrival buried the eighteen a reader might recognise. */}
        <section className="section" id="history" data-reveal>
          <div className="card">
            <div className="head">
              <h2>Session history</h2>
              <span className="kicker">{SPAN_SUMMARY.firstLabel} to {SPAN_SUMMARY.lastLabel}</span>
            </div>
            {/* FOUR FIGURES AND NOT ONE LINE UNDER THEM. Each tile carried a
                caption — "of 80 on file", "every session on file · Bryan
                Karchensky", "3 sessions · …" — and a row of four figures wearing
                four explanatory sub-lines is the page reading its own tiles out
                loud. The figures are the row.
                LONGEST ABSENCE IS GONE ENTIRELY. It is the only tile here that
                measures nobody's achievement, it needed two of the archive's
                narrowest caveats to be true at all, and it was the one figure a
                reader could not use.
                These four are the chart below, counted: how many rows it draws,
                how many of them are lit, the deepest of them, and how many are a
                single mark. */}
            <dl className="figs" data-stagger style={{ marginBottom: 18 }}>
              <div className="fig">
                <dt>Total players</dt>
                <dd><AnimatedCounter value={SPAN_SUMMARY.people} /></dd>
              </div>
              <div className="fig">
                {/* DERIVED, and off the newest LEAGUE HALF rather than the
                    newest session — see `CURRENT_FROM` in lib/hubs.ts. A
                    four-day tournament landing last on the spine would
                    otherwise cut this to whoever entered it. It is also the
                    count of the lit rows in the chart below, which is now one
                    rule and this figure. */}
                <dt>Current players</dt>
                <dd><AnimatedCounter value={SPAN_SUMMARY.stillHere} /></dd>
              </div>
              {SPAN_SUMMARY.longestTenure && (
                <div className="fig">
                  <dt>Longest tenured</dt>
                  <dd><AnimatedCounter value={SPAN_SUMMARY.longestTenure.n} /></dd>
                </div>
              )}
              {/* Five sessions or more — the club's regulars. This counted the
                  men who appear exactly once instead, which is a fact about the
                  roster book rather than about the team: close to half the names
                  the archive can produce turn up for one session and never
                  again, and a tile leading with that describes the record's
                  shape rather than the club's. */}
              <div className="fig">
                <dt>5+ sessions</dt>
                <dd><AnimatedCounter value={SPAN_SUMMARY.regulars} /></dd>
              </div>
            </dl>

            <FirstAndLast />
          </div>
        </section>

        <section className="section" id="timelines" data-reveal>
          <div className="card">
            <div className="head">
              <h2>Career timelines</h2>
              {/* A COUNT, LIKE EVERY OTHER KICKER ON THE PAGE. It read "17
                  active · 40 with two seasons or more" — a sentence wearing a
                  kicker's clothes, and its first clause was the only place the
                  word "active" appears on the site, anchored to nothing and
                  landing 17 within a screen of two other counts of who is here
                  now, both of which are 18. The grid opens on the men still
                  playing and the list is the answer; this is how many careers
                  are drawn. */}
              <span className="kicker">{plural(TRACES.length, "career")}</span>
            </div>
            {/* No scope line of its own. The coverage chart under the map says
                which sessions carry statistics, and the readout above the grid
                names the two sessions that are not on file. */}
            <Trajectories traces={[...TRACES]} slots={[...SPINE]} />
          </div>
        </section>

        {/* THE SAME CAREERS, COLLAPSED TO A ROW APIECE. It follows the two
            charts of them rather than leading, because a table of totals is
            what a reader reaches for once he knows whose totals they are. */}
        <section className="section" id="leaders" data-reveal>
          <div className="card">
            {/* "All seasons · sortable" told the reader that a board with
                clickable column heads is sortable, and that a franchise board
                covers the franchise. */}
            <div className="head">
              <h2>Franchise leaders</h2>
            </div>
            {/* THE FILTER OFFERS THE SESSIONS IT CAN NAME SOMEBODY FOR, which
                is now all thirty-one: 2019 - Summer was the one column with
                nobody on it, so choosing it emptied the board with nothing to
                say why, and the captain's inbox has since put seventeen men on
                it. The predicate stays for the next hollow session.
                A SESSION IT CAN NAME IS NOT A SESSION IT CAN RANK, and the two
                were being conflated here. Five sessions hold rosters and almost
                no scoring, so the board they produce is a list of men with blank
                columns — which is honest, and was being numbered 1 to 17 like a
                ranking. The rank column is the thing that had to give, not the
                filter: `Leaderboard` prints an ordinal only where the sorted
                column has a figure, so the same rows read as a roster. */}
            <FranchiseLeaderboard
              cells={[...BOARD_CELLS]}
              people={[...BOARD_PEOPLE]}
              sessions={ROLLUPS.filter((roll) => roll.people > 0).map((roll) => ({
                id: roll.id,
                label: roll.label,
                sort: roll.sort,
                archiveOnly: roll.archiveOnly,
              }))}
              sources={ERAS.map((era) => ({
                source: era.source,
                label: era.label,
                archiveOnly: era.archiveOnly,
              }))}
            />
          </div>
        </section>

        <section className="section" id="chemistry" data-reveal>
          <div className="card">
            <div className="head">
              <h2>Who set up whom</h2>
              {/* No kicker. It read "1310 assists · 324 pairs" and the slider
                  readout ninety pixels below prints both figures, live, and has
                  to — so the section's most valuable typographic slot was
                  spending itself on the line under it. A player count in its
                  place was no better: it landed within a screen of the
                  timelines' unrelated 40. */}
            </div>
            {/* The third limited display, and now the third to say so in the
                same grammar. An assist is a name written beside a goal on a
                scoresheet, so this graph is scoped exactly as the penalties
                are — and a reader meeting 1,310 assists has no way to know
                whether that is the whole club's record or half of it. */}
            <ScopeNote term="Sessions captured">
              {assistScope.count} of {SCOPE.sessions}
            </ScopeNote>
            <AssistNetwork nodes={[...NETWORK.nodes]} edges={[...NETWORK.edges]} assists={NETWORK.assists} />
          </div>
        </section>

        <section className="section" id="sinbin" data-reveal>
          <div className="card">
            <div className="head">
              {/* "The sin bin" was a joke, and this page does not make them.
                  The section counts penalties; it is called Penalties. */}
              <h2>Penalties</h2>
              <span className="kicker">{plural(SIN_BIN.rows, "penalty", "penalties")} · {plural(SIN_BIN.people.length, "player")}</span>
            </div>
            {/* ONE LABELLED ROW OF SCOPE, AND NO CAPTIONS. A penalty is an
                event on a scoresheet, so this section can only speak for the
                sessions whose sheets survive — thirteen of thirty-one — and
                that is the single thing about these figures a reader cannot
                read off them. What sat here instead was a caption under every
                tile restating the tile: "29 beyond a minor, 5 of them majors"
                under `Minors`, the first period's count under the third's.
                Derived off `SHEET_SORTS`, the same set the counts are made
                from. */}
            <ScopeNote term="Sessions captured">
              {SHEET_SORTS.length} of {SCOPE.sessions}
            </ScopeNote>

            {/* PER GAME, TOTAL, AND THE THREE PERIODS IN ORDER. It printed the
                BUSIEST period alone, so the tile's own label moved with the
                data and a reader could not compare one period against another
                — the interesting fact about penalties by period is the shape
                across all three, and one number cannot carry a shape. The
                minors count went with it: a total the reader can see the parts
                of is worth more than a subtotal of one severity.

                Periods are read out of the data rather than listed here, so
                overtime does not need a tile of its own and does not vanish
                either — it is in the total, where it belongs. */}
            <dl className="figs" data-stagger style={{ marginBottom: 18 }}>
              {perGame && (
                <div className="fig">
                  <dt>Per game</dt>
                  <dd>{perGame}</dd>
                </div>
              )}
              <div className="fig">
                <dt>Total</dt>
                <dd><AnimatedCounter value={SIN_BIN.rows} /></dd>
              </div>
              {["1st", "2nd", "3rd"].map((period) => {
                const found = SIN_BIN.periods.find((p) => p.period === period);
                return found ? (
                  <div className="fig" key={period}>
                    <dt>{period}</dt>
                    <dd><AnimatedCounter value={found.n} /></dd>
                  </div>
                ) : null;
              })}
            </dl>

            <SinBin />
          </div>
        </section>

        <section className="section" id="opponents" data-reveal>
          <div className="card">
            {/* A COUNT, LIKE `Career timelines` AND ITS 36 CAREERS. It read
                "62 clubs · 2016 - Winter onward", which is the exact phrasing
                lib/scope.ts rejects in a comment on the field it was built
                from: "'14 sessions, 2016 - Winter onward' reads as the last
                fourteen; there are eighteen, and four of them are holes in the
                middle of the log rather than before the start of it." It was
                also the last per-section scope statement standing after the
                coverage statement took the other six, so the page stated the
                log's coverage twice, in two grammars, and the one nearest the
                data was the misleading one. The chart draws the fourteen and
                the map goes back to it. */}
            {/* NO KICKER. It counted the clubs, which is the first tile ninety
                pixels below it in a bigger face — the same defect that took
                `Most played` off this row. */}
            <div className="head">
              <h2>The opponents</h2>
            </div>
            {/* The same row the penalties carry, in the same grammar, off the
                same corpus: a club-by-club ledger is built from games, and the
                game log covers eighteen of the thirty-one sessions. */}
            <ScopeNote term="Sessions captured">
              {LOG_SORTS.length} of {SCOPE.sessions}
            </ScopeNote>

            {/* THE LEDGER, SPLIT FOUR WAYS — every club the archive holds a game
                against, and how that ledger came out. `Met once`, `Goals` and
                `Beaten` each carried a caption doing a quarter of this job in
                prose: "5 finished level", "1,240 against", "18 have the better
                of it". Four labelled figures, no captions, and they add up. */}
            <dl className="figs" data-stagger style={{ marginBottom: 18 }}>
              <div className="fig">
                <dt>Total played</dt>
                <dd><AnimatedCounter value={OPPONENT_SUMMARY.clubsPlayed} /></dd>
              </div>
              <div className="fig">
                <dt>Winning record against</dt>
                <dd><AnimatedCounter value={OPPONENT_SUMMARY.beaten} /></dd>
              </div>
              <div className="fig">
                <dt>Even record</dt>
                <dd><AnimatedCounter value={OPPONENT_SUMMARY.level} /></dd>
              </div>
              <div className="fig">
                <dt>Losing record</dt>
                <dd><AnimatedCounter value={OPPONENT_SUMMARY.lostTo} /></dd>
              </div>
            </dl>

            <Opponents
              rows={[...OPPONENTS]}
              columns={[...OPPONENT_COLUMNS]}
              maxDiff={OPPONENT_SUMMARY.maxDiff}
              shown={18}
            />

            <details>
              <summary>All {OPPONENT_SUMMARY.clubs} clubs, as a table</summary>
              <div className="scroll st-tall">
                <table>
                  <thead>
                    <tr>
                      <th className="l">Club</th>
                      <th>GP</th><th>W</th><th>L</th><th>T</th><th>GF</th><th>GA</th><th>Diff</th>
                      <th>First</th><th>Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPPONENTS.map((row) => (
                      <tr key={row.name}>
                        <td className="l">{row.name}</td>
                        <td>{row.gp}</td><td>{row.w}</td><td>{row.l}</td><td>{row.t}</td>
                        <td>{row.gf}</td><td>{row.ga}</td>
                        <td>{row.diff > 0 ? "+" : ""}{row.diff}</td>
                        <td>{row.first}</td><td>{row.last}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </section>

        <SeasonRecord />

        {/* The roll of everybody. */}
        <PlayerIndex tiles={tiles} />

        <footer className="site">Est. {FOUNDED} · Buffalo, N.Y.</footer>
      </div>
    </>
  );
}
