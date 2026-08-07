import Link from "next/link";
import { notFound } from "next/navigation";
import AnimatedCounter from "../../../components/AnimatedCounter";
import JsonLd from "../../../components/JsonLd";
import CareerArc from "../../../components/CareerArc";
import ScoringHonours, { AWARD, ordinal, placing, tone } from "../../../components/players/ScoringHonours";
import AssistNetwork from "../../../components/stats/AssistNetwork";
import StatsStyles from "../../../components/stats/styles";
import s from "../../../components/seasons/seasons.module.css";
import { players, bySlug, goaltending, linemates, recorded, savePctOf, savesOf, sessions } from "../../../lib/data";
import { shortDate } from "../../../lib/dates";
import { num, plural, record } from "../../../lib/format";
import { bestGame } from "../../../lib/best-game";
import { pageMeta } from "../../../lib/meta";
import { ARCHIVE_CRUMB, breadcrumbSchema, playerSchema } from "../../../lib/schema";
import { ScopeNote } from "../../../components/seasons/DataCoverage";
import { SCOPE } from "../../../lib/scope";
import { NETWORK, TRACE_MIN_SESSIONS, drawableSessions } from "../../../lib/stats";
import { divisionAt, seasonHrefForId } from "../../../lib/seasons";
import type { PlayerSession, ScoringRank, StatKey } from "../../../../../packages/build/src/types";

/** The season table's measurement columns, and the race each one is ranked in. */
const SEASON_COLUMNS: { head: string; of: (s: PlayerSession) => number | null; stat: StatKey | null }[] = [
  { head: "GP", of: (s) => s.gp, stat: null },
  { head: "G", of: (s) => s.g, stat: "goals" },
  { head: "A", of: (s) => s.a, stat: "assists" },
  { head: "Pts", of: (s) => s.pts, stat: "points" },
  { head: "PIM", of: (s) => s.pim, stat: "pim" },
];

/** "F", "F / D", "P" → "F / D". A source value, split on its own separator,
 *  deduped in the order it was recorded, and with DigitalShift's generic
 *  Player code dropped because it carries no information. */
const positionsOf = (positions: readonly string[]): string =>
  [...new Set(positions.flatMap((token) => token.split("/").map((part) => part.trim())))]
    .filter((token) => token !== "" && token !== "P")
    .join(" / ");

export function generateStaticParams() {
  return players.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = bySlug(slug);
  if (!p) return { title: "Not found" };  // the layout template appends the site name

  const jersey = p.jerseys[0] ? `#${p.jerseys[0]} ` : "";
  const pts = recorded(p, "pts");
  return pageMeta({
    title: `${jersey}${p.name}`,
    path: `/players/${p.slug}`,
    // A man whose columns were never filled in is not summarised as a nought
    // here either — the description is the first thing a search result shows.
    description: pts === null
      ? `${plural(p.career.sessions, "session")} in the Golden Retrievers archive.`
      : `${pts} points across ${p.career.sessions} sessions, `
        + `${p.career.g} goals and ${p.career.a} assists in ${p.career.gp} games.`,
  });
}

export default async function PlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = bySlug(slug);
  if (!p) notFound();

  const best = bestGame(p);
  const mates = linemates(p.name).slice(0, 8);
  const maxMate = mates[0]?.total ?? 1;
  const jersey = p.jerseys[0];

  // NOBODY ON FILE IS BOTH — the mixed case is a GUARD, not a description.
  // These two comments claimed Corey Muff has a skater line and a goalie line
  // in the same session and "skated more games than he tended, so he leads as a
  // skater". He has twenty-two goalie lines and no skater line at all; `skated`
  // is 0, `net.primary` is true, and his page leads with Games, Wins, Losses
  // and Goals against, as a goaltender. Seven men have goalie lines and not one
  // of them has a skater line beside it. The comments described the opposite of
  // what the code does for the one man the whole goaltender branch exists for,
  // and the next writer would have "fixed" the hero to match them.
  //
  // The goaltending block reads only the goalie rows, and its totals sum the
  // strings the source printed rather than trusting a career aggregate that was
  // never computed for goalies. `goaltending` also refuses DigitalShift's
  // nought saves and .000 percentages, which are an empty column rather than a
  // goaltender who stopped nothing.
  const goalieSeasons = p.seasons.filter((s) => s.kind === "goalie" && s.goalie);
  const net = goaltending(p);
  // `primary` is "he tended more than he skated", which today means "he only
  // ever tended". It stays a comparison so that the day a man's two careers
  // land in one file the page leads with the larger one.
  const pureGoalie = net.primary;

  /**
   * THE RATE DIVIDES THE TWO NUMBERS BESIDE IT.
   *
   * `career.ppg` is computed over the season lines that carry both points and
   * games, and `career.pts` is not: two of Karchensky's lines record points
   * with no games-played beside them, so 109 points were in the numerator of
   * the headline and outside the rate, and the hero printed "Points 1239 ·
   * Games 422 · Pts / game 2.68" — three columns on one row that do not
   * divide. Every player does this arithmetic on his own page. The rate is now
   * the two figures printed next to it, and nothing else — the same derivation
   * the franchise board and the career timelines use.
   *
   * AND EVERY FIGURE IN THE ROW IS NULL-AWARE. `career` sums nulls to nought,
   * so two skaters whose only season line is blank in every column led with
   * "Points 0 · Goals 0 · Assists 0 · Games 0" twenty pixels above a table
   * printing an em dash in all four. See `recorded` in lib/data.ts.
   */
  const careerPts = recorded(p, "pts");
  const careerGp = recorded(p, "gp");
  const perGame = careerPts !== null && careerGp !== null && careerGp > 0 ? careerPts / careerGp : null;

  // The full network holds every directed pair the archive knows about.
  // A player's page shows only HIS slice — the people he set up and the
  // people who set him up — so the graph answers "who did this man play
  // with" rather than "here is everything".
  const myEdges = NETWORK.edges.filter((e) => e.from === p.name || e.to === p.name);
  const myNames = new Set([p.name, ...myEdges.flatMap((e) => [e.from, e.to])]);
  const myNodes = NETWORK.nodes.filter((n) => myNames.has(n.name));
  /**
   * TWO DIRECTIONS, COUNTED SEPARATELY, BECAUSE THEY ARE NOT ONE FIGURE.
   *
   * The kicker read "42 connections · 410 assists" and the widget's readout
   * repeated "410 of 410 assists" — the sum of every edge touching him in both
   * directions, which is 153 assists he made plus 257 assists other people made
   * on his goals. It is neither his assists in these sessions (153) nor his
   * career assists (502, printed in the hero three sections above), so the
   * reader was invited to reconcile 410 with 502 and could not.
   */
  const myAssists = myEdges.reduce((t, e) => t + e.n, 0);
  const gave = myEdges.filter((e) => e.from === p.name).reduce((t, e) => t + e.n, 0);
  const got = myAssists - gave;

  /* ONE SCOPE LINE, ON WHICHEVER OF THE SHEET-DERIVED SECTIONS COMES FIRST.
     The assist network leads wherever a man has an edge at all; a solo goal
     makes a best game with no edge behind it, and then the note belongs to
     that section instead. `Who he plays with` is drawn off the same edges as
     the network, so it can never be the first of the three. */
  const sheetNote = myEdges.length > 0 ? "network" : best && !pureGoalie ? "best" : null;

  // WHERE HE FINISHED, AGAINST THE LINE IT WAS DRAWN FROM.
  //
  // These used to be a second table of their own, printing the same seasons
  // over again one section below the first. They are one table now: the
  // division he played in is a column, and every placing sits under the number
  // that earned it. The medals above are the top tens out of exactly this.
  //
  // A session can carry two recorded lines — two platforms, or a man who
  // changed his number mid-season — so a standing is attached to the single
  // line whose points it was computed from, and never printed twice.
  /**
   * IN THE ORDER THE CAREER HAPPENED.
   *
   * The table rendered `p.seasons` in corpus order, and one pair in the largest
   * career on file came out inverted — "2015 - Summer · Playoffs" above "2015 -
   * Summer · Regular Season", where all thirty-six other rows run the regular
   * season first. On the one page where a reader traces a career line by line,
   * a single inverted pair reads as a mistake in the record rather than in the
   * sort. Off the session's own sort key, with the playoffs after the season
   * they belong to.
   */
  const sortOfSession = new Map(sessions.map((session) => [session.id, session.sort]));
  const isPlayoff = (phase: string | null) => (phase !== null && /playoff/i.test(phase) ? 1 : 0);
  const seasonRows = [...p.seasons].sort(
    (a, b) =>
      (sortOfSession.get(a.session) ?? Infinity) - (sortOfSession.get(b.session) ?? Infinity)
      || isPlayoff(a.phase) - isPlayoff(b.phase),
  );

  const rankOfRow = new Map<number, ScoringRank>();
  const divisionOfSession = new Map<string, string>();
  for (const rank of p.scoringRanks) {
    // THROUGH THE SAME REFUSAL EVERY OTHER SURFACE USES. `divisionAt` settles
    // two things this column was getting wrong on its own: the source spells
    // one division two ways ("Bronze A" and "Bronze A Division") across the
    // three seasons the club spent in it, and Erie Metro files its leaderboards
    // under the league's own name — so a column headed Division printed "Erie
    // Metro" on every 2016-17 and 2017-18 row, with "Erie Metro" already
    // printed as the source two words away.
    const division = divisionAt(rank.sessionSort);
    if (division) divisionOfSession.set(rank.session, division);
    const lines = seasonRows.map((season, index) => ({ season, index })).filter((row) => row.season.session === rank.session);
    if (lines.length === 0) continue;
    const line = lines.find((row) => row.season.pts === rank.pts)
      ?? lines.reduce((best, row) => ((row.season.pts ?? -1) > (best.season.pts ?? -1) ? row : best));
    rankOfRow.set(line.index, rank);
  }
  /**
   * A CAREER GOALTENDER DOES NOT GET A SKATER'S TABLE.
   *
   * Corey Muff's twenty-two season lines are all goalie lines, and this table
   * set them as GP / G / A / Pts / PIM: eight rows of em dashes and fourteen
   * reading 0 | 0 | 0 | 0, DigitalShift's empty scoring columns, directly under
   * a hero rewritten to refuse exactly that reading. Every informative column
   * in it — the session, the games — is repeated in `In goal` immediately
   * below. Brent Seymour's page was thirteen rows of dashes.
   *
   * What is left is what the archive actually recorded him doing with the puck:
   * a goal in 2022-23 and an assist in Summer 2026. A goaltender with no point
   * on file has no table, and his career is the one under it.
   */
  const scored = (line: PlayerSession): boolean =>
    (line.g ?? 0) > 0 || (line.a ?? 0) > 0 || (line.pts ?? 0) > 0 || (line.pim ?? 0) > 0;
  const scoringRows = seasonRows
    .map((line, index) => ({ line, index }))
    .filter((row) => !pureGoalie || scored(row.line));

  /* ONLY WHERE THE TABLE HAS A ROW TO PUT IT ON. Three players carry scoring
     ranks for sessions they have no roster line in, and `divisionOfSession.size
     > 0` switched the column on for them: Seth Hamilton's page drew a Division
     column whose single row printed an em dash, because both his ranks are for
     sessions that appear nowhere in the table the column decorates. Tested
     against the rows actually rendered, which for a goaltender is the two his
     name is on a scoresheet for. */
  const showDivision = scoringRows.some((row) => divisionOfSession.has(row.line.session));

  /**
   * THE GOALTENDER'S COLUMNS, BUILT FROM THE ROWS ACTUALLY RENDERED.
   *
   * The page fixed this exact defect one section higher — `showDivision` exists
   * because Seth Hamilton's page drew a Division column whose single row was an
   * em dash — and the franchise goaltender's own record carried a wider version
   * of it. `savePctOf` correctly refuses DigitalShift's ".000", so SV% is an em
   * dash in all twenty-two of Corey Muff's rows and in every row on five other
   * goaltenders' pages: six of the seven on file had a fully empty column with
   * a header over it. The hero on the same page already knows — it swaps the
   * Saves tile for Goals against when the saves cover less than half his games
   * — and the table applied no such test.
   *
   * Tested per column, so nothing is special-cased and nothing is named: a
   * column no rendered line carries is not drawn. On Muff that removes SV% and
   * keeps the one SV figure the archive does hold for him, 148 saves in Summer
   * 2016, which is the only place on the site it survives.
   */
  const GOALIE_COLUMNS: { head: string; of: (line: PlayerSession) => string | number | null }[] = [
    { head: "GP", of: (line) => line.gp },
    { head: "W", of: (line) => line.goalie?.w ?? null },
    { head: "L", of: (line) => line.goalie?.l ?? null },
    { head: "T", of: (line) => line.goalie?.t ?? null },
    { head: "GA", of: (line) => line.goalie?.ga ?? null },
    { head: "GAA", of: (line) => line.goalie?.gaa ?? null },
    { head: "SV", of: (line) => savesOf(line) },
    { head: "SV%", of: (line) => savePctOf(line) },
  ];
  const goalieColumns = GOALIE_COLUMNS.filter((column) =>
    goalieSeasons.some((line) => {
      const value = column.of(line);
      return value !== null && value !== "";
    }),
  );

  /**
   * TWO ROWS, ONE SEASON, AND THE ARCHIVE HOLDS THE THING THAT TELLS THEM APART.
   *
   * Corey Muff's table prints two rows both labelled "2017 - Winter · Regular
   * Season" — 22 GP, 17–5, 107 GA against 1 GP, 1–0, 2 GA. It is one man filed
   * twice by one source: Erie Metro spelled him "Corey Muff" on one line and
   * "Coroy Muff" on the other, the merge kept both, and the season he went 17–5
   * appears twice with different figures and identical labels on the franchise
   * goaltender's own record. The scoring table above guards this case
   * explicitly; this one had nothing.
   *
   * The lines are not folded: 22 and 1 add, but 4.86 and 2.00 do not, and a
   * goals-against average this archive computed itself is a figure nobody
   * recorded. `recordedAs` is on the line and is the whole explanation, so it is
   * printed — on the row that disagrees with his name, and only where two rows
   * would otherwise be indistinguishable.
   */
  const goalieRowKey = (line: PlayerSession) => `${line.session}|${line.phase ?? ""}`;
  const sharedGoalieRows = new Set(
    goalieSeasons
      .map(goalieRowKey)
      .filter((key, i, all) => all.indexOf(key) !== i),
  );

  return (
    <>
      {/* Name, page and club — nothing the page does not already print. These
          eighty men being findable under their own names is the archive's whole
          argument; this is the machine-readable half of it. */}
      <JsonLd data={playerSchema(p)} />
      <JsonLd data={breadcrumbSchema([ARCHIVE_CRUMB, { name: p.name, path: `/players/${p.slug}` }])} />
      <StatsStyles />
      <div className="wrap page stx">
      <div style={{ paddingTop: 8 }}>
        <Link href="/seasons#players" className="kicker">← Team archive</Link>
      </div>

      <header style={{ padding: "clamp(28px,6vh,64px) 0", display: "grid", gap: 18 }}>
        {/* Club and position. The session count came off — it is printed as a
            figure eighty pixels below this line, and saying a number twice on
            one screen is not emphasis. */}
        {/* THE POSITIONS, SPLIT AND DEDUPED, AND WITHOUT "P".
            `positions.join(" / ")` printed the source value straight through,
            so one page read "F / F / D / P" — a duplicate and a placeholder in
            a four-token line under a man's own name. Half of those entries are
            themselves a slashed pair ("F/D", "F / D"), and every one of the 87
            "P" tokens comes from DigitalShift's generic Player code, which is
            not a position anybody has played. */}
        <span className="kicker">
          Golden Retrievers · {positionsOf(p.positions) || "Skater"}
        </span>

        {jersey && (
          <div
            style={{
              fontFamily: "var(--disp)", fontWeight: 200, fontSize: "clamp(5rem,18vw,13rem)", lineHeight: 0.74,
              letterSpacing: "-0.02em", color: "var(--ball)", margin: 0,
            }}
          >
            {jersey}
          </div>
        )}

        <h1 style={{ fontFamily: "var(--disp)", fontWeight: 300, fontSize: "clamp(1.8rem,5.4vw,3.4rem)", letterSpacing: "0.02em", margin: 0 }}>
          {p.name}
        </h1>

        {/* The headline numbers. A goaltender gets HIS numbers, not a skater's:
            showing a franchise goalie as "0 points, 0 goals, 0.00 per game" is
            not a stat line, it is an accusation. A man who only ever tended goal
            leads with wins and saves; a man who did both (Corey Muff) is more
            skater than goalie by games and leads as one. */}
        {/* SAVES ARE ONLY A HEADLINE WHERE THEY WERE RECORDED. Every
            HarborCenter line stores `sv: "0"`, so the club's longest-serving
            goaltender led with "Saves 148" over 258 games — 0.57 saves a game,
            which is not a statistic, it is an accusation. Where the column was
            never filled in, the slot goes to goals against, which every goalie
            line on file carries. */}
        {/* GOALS AGAINST CARRIES ITS RATE. 1288 with no denominator beside it
            is the harshest possible reading of a fourteen-year career that ran
            a 3.10 in its last full winter, and the table below prints a GAA for
            every season that has one. The two figures it divides are both in
            this row. */}
        <dl className="figs" data-stagger style={{ margin: "8px 0 0" }}>
          {/* GAMES AND A RECORD IN ONE ROW, WITH THE DIFFERENCE STATED. Corey
              Muff's tiles read Games 258 · Wins 132 · Losses 111, and 132, 111
              and the two ties account for 245: thirteen games he neither won
              nor lost nor tied, on the row a goaltender reads first. Eight of
              his twenty-two season lines are short of their own games and
              Brent Seymour is short by two — a decision the source never
              credited to him is not a game he did not play, and it is not a
              figure this archive gets to invent either. Same idiom as the
              masthead's "268 / 263 played". */}
          {(pureGoalie
            ? ([
                {
                  k: "Games",
                  v: net.gp,
                  note: net.w + net.l + net.t < net.gp
                    ? `${net.w + net.l + net.t} with a decision`
                    : undefined,
                },
                { k: "Wins", v: net.w },
                { k: "Losses", v: net.l },
                net.svGp * 2 >= net.gp
                  ? {
                      k: "Saves",
                      v: num(net.sv),
                      // OVER THE GAMES THE COLUMN WAS FILLED IN FOR. Brent
                      // Seymour's hero reads Games 163 and Saves 4,981, and
                      // the two are measured over different sets of games:
                      // his 2016 - Winter line carries no saves at all, so
                      // 4,981 covers 141. Divided by the figure beside it that
                      // is 30.6 a game; over the games on file it is 35.3. The
                      // Games tile states its own short coverage two tiles
                      // left — "161 with a decision" — and Goals against
                      // carries its rate for exactly this reason. `svGp` was
                      // already computed and printed nowhere.
                      note: net.svGp < net.gp ? `over ${plural(net.svGp, "game")}` : undefined,
                    }
                  : {
                      k: "Goals against",
                      // Through `num`, like the saves figure it stands in for:
                      // one of the two printed 4,981 and the other 1288.
                      v: num(net.ga),
                      note: net.gp > 0 ? `${(net.ga / net.gp).toFixed(2)} a game` : undefined,
                    },
                { k: "Shutouts", v: net.shutouts },
                { k: "Sessions", v: p.career.sessions },
              ] as const)
            : ([
                { k: "Points", v: careerPts ?? "—" },
                { k: "Goals", v: recorded(p, "g") ?? "—" },
                { k: "Assists", v: recorded(p, "a") ?? "—" },
                { k: "Games", v: careerGp ?? "—" },
                { k: "Pts / game", v: perGame === null ? "—" : perGame.toFixed(2) },
                { k: "Sessions", v: p.career.sessions },
              ] as const)
          ).map((figure) => (
            <div key={figure.k} className="fig">
              <dt>{figure.k}</dt>
              <dd>{typeof figure.v === "number" ? <AnimatedCounter value={figure.v} /> : figure.v}</dd>
              {"note" in figure && figure.note && <small>{figure.note}</small>}
            </div>
          ))}
        </dl>
      </header>

      {/* The medals: his top-ten finishes in his own division. Renders nothing
          for players the leaderboards never ranked. Every placing, medal or
          not, is marked in the season table below. */}
      <ScoringHonours ranks={p.scoringRanks} />

      {scoringRows.length > 0 && (
      <section className="section" data-reveal>
        <div className="card">
        {/* "N rows · N ranked" was the table describing itself: the rows are
            right there and every placing is printed in the cell that earned
            it. */}
        <div className="head">
          <h2>Season by season</h2>
        </div>
        <div className="scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: showDivision ? 560 : 460, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr>
                {["Session", ...(showDivision ? ["Division"] : []), ...SEASON_COLUMNS.map((c) => c.head)].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i <= (showDivision ? 1 : 0) ? "left" : "right", fontSize: 9.5, letterSpacing: ".11em",
                      textTransform: "uppercase", color: "var(--dim)", fontWeight: 400,
                      borderBottom: "1px solid var(--line)", padding: "8px 10px",
                      paddingLeft: i === 0 ? 0 : undefined,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoringRows.map(({ line: s, index: i }) => {
                const stood = rankOfRow.get(i);
                return (
                  <tr key={i}>
                    <td style={{ padding: "9px 10px 9px 0", borderBottom: "1px solid var(--rule)" }}>
                      {seasonHrefForId(s.session) ? (
                        <Link href={seasonHrefForId(s.session)!}>{s.session}</Link>
                      ) : s.session}
                      {s.phase && !s.session.toLowerCase().includes(s.phase.toLowerCase()) && (
                        <span style={{ color: "var(--dim)" }}> · {s.phase}</span>
                      )}
                    </td>
                    {showDivision && (
                      <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--rule)", color: "var(--dim)", whiteSpace: "nowrap" }}>
                        {divisionOfSession.get(s.session) ?? "—"}
                      </td>
                    )}
                    {SEASON_COLUMNS.map((c) => {
                      const value = c.of(s);
                      // No placing under a blank: a season nobody filled in has
                      // no standing to report, whatever the leaderboard says.
                      const rank = stood && c.stat && value !== null ? placing(stood, c.stat) : null;
                      const award = rank !== null && rank.rank <= AWARD;
                      return (
                        <td key={c.head} style={{ textAlign: "right", padding: "9px 10px", borderBottom: "1px solid var(--rule)" }}>
                          {value === null ? <span style={{ color: "var(--dim)" }}>—</span> : value}
                          {rank && (
                            <div style={{ fontSize: 9.5, marginTop: 1, color: award ? tone(c.stat!, rank.rank) : "var(--dim)", fontWeight: award ? 500 : 400 }}>
                              {ordinal(rank.rank)}
                              {rank.scope === "league" && " · league"}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      </section>
      )}

      {goalieSeasons.length > 0 && (
        <section className="section" data-reveal>
          <div className="card">
            {/* THE RECORD ALONE. It read "258 games · 132–111–2", and 132 and
                111 and 2 account for 245 of those games — the sources disagree
                and the archive cannot say why, so the section's most prominent
                line was carrying an unreconciled sum. The games figure is
                already a tile in the hero above; the record is not. */}
            <div className="head">
              <h2>In goal</h2>
              <span className="kicker">
                {/* A man who mostly skated leads as a skater, so his hero
                    carries no goaltending games and this line is the only
                    place they are stated. */}
                {!pureGoalie && <>{plural(net.gp, "game")} · </>}
                {record(net.w, net.l, net.t)}
              </span>
            </div>
            <div className="scroll">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 200 + goalieColumns.length * 58, fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr>
                    {/* THE T COLUMN THE RECORD ALREADY HAS. The kicker prints a
                        third figure — 132–111–2 — off a column the table did
                        not carry, so a goaltender reading his own career row by
                        row found two ties stated above a table with nowhere to
                        put them. */}
                    {["Session", ...goalieColumns.map((column) => column.head)].map((h, i) => (
                      <th
                        key={h}
                        style={{
                          textAlign: i === 0 ? "left" : "right", fontSize: 9.5, letterSpacing: ".11em",
                          textTransform: "uppercase", color: "var(--dim)", fontWeight: 400,
                          borderBottom: "1px solid var(--line)", padding: "8px 10px",
                          paddingLeft: i === 0 ? 0 : undefined,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {goalieSeasons.map((s, i) => (
                    <tr key={i}>
                      <td style={{ padding: "8px 10px 8px 0", borderBottom: "1px solid var(--rule)" }}>
                        {seasonHrefForId(s.session) ? (
                          <Link href={seasonHrefForId(s.session)!}>{s.session}</Link>
                        ) : s.session}
                        {s.phase && !s.session.toLowerCase().includes(s.phase.toLowerCase()) && (
                          <span style={{ color: "var(--dim)" }}> · {s.phase}</span>
                        )}
                        {sharedGoalieRows.has(goalieRowKey(s)) && s.recordedAs !== p.name && (
                          <span style={{ color: "var(--dim)" }}> · recorded as {s.recordedAs}</span>
                        )}
                      </td>
                      {/* Saves and save percentage come through `savesOf` and
                          `savePctOf`: a nought behind a dozen goals conceded is
                          a column the platform never published, and it printed
                          here as fourteen rows reading SV 0 and SV% .000. The
                          workbook's "0.863%" — a ratio with a percent sign
                          welded on — comes out as .863. */}
                      {goalieColumns.map((column) => {
                        const v = column.of(s);
                        return (
                          <td key={column.head} style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid var(--rule)", color: column.head === "SV" && v !== null ? "var(--ink)" : undefined }}>
                            {v === null || v === "" ? <span style={{ color: "var(--dim)" }}>&mdash;</span> : v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* TWO SESSIONS, NOT TWO LINES — the same cut `TRACES` makes, so the two
          surfaces stop disagreeing about whether a man has a career to draw.
          This tested `skaterSeasons.length >= 2`, which counts rows: seven men
          have one session split into a regular season and a playoff run and
          passed it, and /seasons excluded exactly those seven. */}
      {drawableSessions(p) >= TRACE_MIN_SESSIONS && (
        <section className="section" data-reveal>
          <div className="card">
            {/* No kicker. It read "points per session" — the chart's own metric
                control now names what is drawn, and it is no longer only
                points. */}
            <div className="head">
              <h2>Career arc</h2>
            </div>
            <CareerArc player={p} />
          </div>
        </section>
      )}

      {/* THE THREE SECTIONS BUILT ON A SCORESHEET, AND ONE ROW FOR ALL THREE.
          They cover a much shorter span than the hero above them: the hero says
          "Assists 502" and this section says "153 given · 257 received", both
          right and measured over two different halves of the archive. `Best
          game` has the same floor — it can only ever return a game from 2016-17
          onward, so a career whose two largest seasons are 2012-13 and 2015-16
          has its best game named in 2018. All three sat under one sentence each
          and the three sections are consecutive, so a reader met the same
          caveat three times in three screens.

          IN THE ARCHIVE'S GRAMMAR, NOT A SECOND ONE. It was a grey sentence —
          "A scoresheet survives for 13 of the 31 sessions." — while /seasons
          answers the identical question as a labelled row in a bordered box,
          and every timeline row on that page links straight here. Two patterns
          for one job on the two page types a reader crosses between constantly.
          Same component, same treatment, one row. */}
      {myEdges.length > 0 && (
        <section className="section" data-reveal>
          <div className="card">
            <div className="head">
              <h2>Assist network</h2>
              <span className="kicker">{num(gave)} given · {num(got)} received</span>
            </div>
            {sheetNote === "network" && (
              <ScopeNote term="Scoresheets">
                {SCOPE.assists.covered} of {SCOPE.sessions} sessions
              </ScopeNote>
            )}
            <AssistNetwork nodes={[...myNodes]} edges={[...myEdges]} assists={myAssists} />
          </div>
        </section>
      )}

      {best && !pureGoalie && (
        <section className="section" data-reveal>
          <div className="card">
            {/* NOT FOR A GOALTENDER. `bestGame` scores a game by goals plus
                assists, so an eighteen-season goaltending career came out as
                "L 3–7 vs Bandits · Goals 1 · Assists 0" — the one time he shot
                the puck the length of the ice, reported as the best game of it,
                four sections under a hero printing seven shutouts. His record
                is measured the way a goaltender's record is measured, in the
                section above this one. */}
            <div className="head">
              <h2>Best game</h2>
              <span className="kicker">{best.session}</span>
            </div>
            {sheetNote === "best" && (
              <ScopeNote term="Scoresheets">
                {SCOPE.assists.covered} of {SCOPE.sessions} sessions
              </ScopeNote>
            )}
            <div style={{ display: "grid", gap: 8, padding: "4px 0" }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                <b>{best.result}</b> {best.gf}–{best.ga} vs {best.opponent}
                {/* The one date on this page was the one ISO string on the
                    site. Every other date — the game log, the season record,
                    the next fixture — goes through `shortDate`, and the
                    machine value belongs on the attribute. */}
                <time dateTime={best.date} style={{ color: "var(--dim)", marginLeft: 8 }}>
                  {shortDate(best.date)}
                </time>
              </p>
              <dl className="figs" data-stagger>
                <div className="fig">
                  <dt>Goals</dt>
                  <dd>{best.goals}</dd>
                </div>
                <div className="fig">
                  <dt>Assists</dt>
                  <dd>{best.assists}</dd>
                </div>
                <div className="fig">
                  <dt>Points</dt>
                  <dd>{best.points}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      )}

      {mates.length > 0 && (
        <section className="section" data-reveal>
          <div className="card">
          {/* "career connections" restated the heading in other words. */}
          <div className="head">
            <h2>Who he plays with</h2>
          </div>
          <div style={{ display: "grid", gap: 1, background: "var(--line)", border: "1px solid var(--line)" }}>
            {mates.map((m) => (
              <div
                key={m.who}
                style={{
                  display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, alignItems: "center",
                  padding: "11px 16px", background: "rgba(56,62,78,0.06)", position: "relative", overflow: "hidden",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute", inset: "0 auto 0 0", width: `${(m.total / maxMate) * 100}%`,
                    background: "rgba(212,225,87,0.04)", borderRight: "1px solid rgba(212,225,87,0.12)",
                  }}
                />
                <span style={{ position: "relative", fontSize: 13 }}>{m.who}</span>
                <span style={{ position: "relative", fontSize: 10.5, color: "var(--dim)" }}>
                  set up {m.gave} · was set up {m.got}
                </span>
                <b style={{ position: "relative", color: "var(--ball)", fontWeight: 400, fontSize: 14 }}>{m.total}</b>
              </div>
            ))}
          </div>
          </div>
        </section>
      )}

      {/* NO `On the record` HERE ANY MORE.
          Three of the archive's five rulings settle a name against itself, and
          this page carried them: "Recorded across the archive as Vincent
          Terrana, Vinny Terana, Vinny Terrana, Vinny Terrara… Resolved. One
          player." It is a true account of how the corpus was reconciled and it
          is a conversation between the archivist and the sources — a man's own
          page is not where his spelling gets adjudicated in public. Taken off
          on 2026-08-04.
          The rulings stay in `site.json`, which is the record of how the
          figures on this page were arrived at. What went is the printing of
          them. The two SUBSTANTIVE matters — the 2013 - Summer and 2014 -
          Winter tables, where the workbook and the archived page disagree
          about figures rather than about a name — still render on those
          seasons' own pages, where they explain numbers a reader can see. */}

      <footer className="site">
        <Link href="/seasons#players">← Team archive</Link>
      </footer>
      </div>
    </>
  );
}
