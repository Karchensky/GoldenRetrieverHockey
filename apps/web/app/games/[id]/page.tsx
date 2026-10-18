import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "../../../components/JsonLd";
import Reveal from "../../../components/games/Reveal";
import { clipFor, games, gameById, grSide, recapFor } from "../../../components/games/games";
import s from "../../../components/games/games.module.css";
import { longDate } from "../../../lib/dates";
import { plural } from "../../../lib/format";
import { pageMeta } from "../../../lib/meta";
import { breadcrumbSchema, gameCrumbs, gameSchema } from "../../../lib/schema";

export function generateStaticParams() {
  return games.map((g) => ({ id: g.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = gameById(id);
  if (!g) return { title: "Not found" };
  return pageMeta({
    // A game that was never played has no score, so it is not given a pair of
    // dashes where two numbers would go.
    title: g.result === null
      ? `${g.away} at ${g.home} — ${g.status}`
      : `${g.away} ${g.awayScore} at ${g.home} ${g.homeScore}`,
    path: `/games/${g.id}`,
    // COUNT THE NOUN. This read "1 penalties" on 22 of the 328 game pages, and
    // a meta description is the sentence a search result shows. `plural` is the
    // same helper GameList already uses; "penalty" is the one word here whose
    // plural a default `${word}s` cannot guess.
    description:
      `${g.dateRecorded}. ${g.status}.` +
      (g.hasDetail
        ? ` ${plural(g.goals.length, "goal")}, ${plural(g.penalties.length, "penalty", "penalties")}.`
        : ""),
  });
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = gameById(id);
  if (!g) notFound();

  const us = grSide(g);
  const recap = recapFor(g);
  const periods = [...new Set(g.goals.map((x) => x.period))];
  const idx = games.findIndex((x) => x.id === g.id);
  const prev = games[idx - 1];
  const next = games[idx + 1];

  return (
    <>
      {/* 119 of these 328 sheets do not record which club was at home, and the
          markup says so by naming an unordered pair instead of inventing one.
          See `gameSchema`. */}
      <JsonLd data={gameSchema(g)} />
      <JsonLd data={breadcrumbSchema(gameCrumbs(g))} />
      <div className="wrap page">
      <div style={{ paddingTop: 8 }}>
        <Link href="/seasons#seasons" className="kicker">&larr; All seasons</Link>
      </div>

      <header style={{ padding: "clamp(24px,5vh,48px) 0 0", display: "grid", gap: 14 }}>
        <span className="kicker">
          {g.session} · {g.league}
          {g.round && <> · {g.round}</>}
        </span>

        {/* The scoreline. The team we are is the one on the left, always —
            a reader should not have to work out which side they are on. */}
        <div style={{ display: "grid", gap: 6 }}>
          <h1
            style={{
              fontFamily: "var(--disp)", fontWeight: 300, margin: 0,
              fontSize: "clamp(1.6rem,5vw,3rem)", letterSpacing: "0.01em", lineHeight: 1.05,
            }}
          >
            {us}
            {/* No score where a game was never played: two dashes would read
                as a nil-all draw, and it was not one. */}
            {g.result !== null && (
              <>
                {" "}
                <b style={{ fontWeight: 400, color: g.result === "W" ? "var(--paint-b)" : "var(--paint-r)" }}>
                  {g.gf}
                </b>
              </>
            )}
            <span style={{ color: "var(--dim)" }}>{g.gr === "home" ? " vs " : " at "}</span>
            {g.opponent}
            {g.result !== null && (
              <> <b style={{ fontWeight: 400, color: "var(--dim)" }}>{g.ga}</b></>
            )}
          </h1>
          <p style={{ margin: 0, color: "var(--dim)", fontSize: 12, lineHeight: 1.7 }}>
            <time dateTime={g.date}>{longDate(g.date)}</time>
            {g.time && <> · {g.time}</>}
            {g.rink && <> · {g.rink}</>} · {g.status}
          </p>
        </div>
      </header>

      {/* ---- recap ---- */}
      {recap && (
        <section className="section">
          <div className="card">
            <div className="head">
              <h2>Game recap</h2>
              <span className="kicker">
                {Math.floor(recap.seconds / 60)}:{String(recap.seconds % 60).padStart(2, "0")}
                {" · "}{plural(recap.goals, "goal")}
                {recap.shots > 0 && <> · {plural(recap.shots, "shot")}</>}
                {recap.whistles > 0 && <> · {plural(recap.whistles, "more play", "more plays")}</>}
              </span>
            </div>
            {/* Nothing loads until it is played, as with the goal clips. */}
            <video
              className={s.recap}
              src={`/highlights/${recap.clip}`}
              poster={`/highlights/${recap.poster}`}
              controls
              playsInline
              preload="none"
              aria-label={`Recap of ${g.away} at ${g.home}`}
            />
            {/* A recap is only made with most of the goals in it; say which are not. */}
            {recap.goals < recap.of && (
              <p className="lede" style={{ margin: "12px 0 0", color: "var(--dim)" }}>
                {plural(recap.of - recap.goals, "goal")} could not be found in the rink&apos;s recording, so
                {recap.of - recap.goals === 1 ? " it is" : " they are"} not in it.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ---- box score ---- */}
      {g.linescore.length > 0 && (
        <section className="section">
          <div className="card">
            <div className="head">
              <h2>Box score</h2>
              <span className="kicker">as recorded</span>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">Team</th>
                    {g.periodLabels.map((p) => <th key={p}>{p}</th>)}
                    <th>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {g.linescore.map((row) => {
                    // A score-only sheet leaves the linescore finals blank even
                    // though the result is known from the headline; carry it down.
                    let final = row.final;
                    if (final === null && g.result !== null && g.linescore.length === 2) {
                      const isOpp = row.team === g.opponent;
                      const isUs = /retriever/i.test(row.team);
                      if (isOpp && !isUs) final = String(g.ga);
                      else if (isUs && !isOpp) final = String(g.gf);
                    }
                    return (
                      <tr key={row.team}>
                        <td className="l">{row.team}</td>
                        {row.periods.map((v, i) => (
                          <td key={i} style={{ color: v === null ? "var(--dim)" : undefined }}>
                              {v ?? "—"}
                          </td>
                        ))}
                        <td>{final ?? <span style={{ color: "var(--dim)" }}>—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {g.shootoutWinner && (
              <p className="lede" style={{ margin: "16px 0 0" }}>
                <b>{g.shootoutWinner}</b> won in a shootout.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ---- scoring ---- */}
      {g.goals.length > 0 && (
        <section className="section">
          <div className="card">
            <div className="head">
              <h2>Scoring</h2>
              <span className="kicker">
                {g.goals.length} goals · {g.goals.filter((x) => x.assists.length === 0).length} unassisted
              </span>
            </div>
            {periods.map((p, pi) => (
              <Reveal key={p} index={pi}>
                <h3 className={s.periodHead}>{p} period</h3>
                {g.goals.map((x, n) => ({ x, n })).filter(({ x }) => x.period === p).map(({ x, n }) => {
                  const ours = x.team === us;
                  const clip = clipFor(g, n);
                  return (
                    <div key={n} className={`${s.event} ${ours ? s.us : s.them}`}>
                      <span className={s.evTime}>{x.time}</span>
                      <span>
                        <span className={s.scorer}>
                          {x.scorer}
                          {!ours && <span className={s.assist}> · {x.team}</span>}
                        </span>
                        <br />
                        <span className={s.assist}>
                          {x.assists.length > 0
                            ? <>from {x.assists.join(", ")}</>
                            : "unassisted"}
                          {x.strength && x.strength !== "even strength" && <> · {x.strength}</>}
                        </span>
                        {/* Nothing loads until it is played: a page of four goals
                            is four posters, not four videos. */}
                        {clip && (
                          <video
                            className={s.clip}
                            src={`/highlights/${clip.clip}`}
                            poster={`/highlights/${clip.poster}`}
                            controls
                            playsInline
                            preload="none"
                            aria-label={`${x.scorer}'s goal, ${x.period} period ${x.time}`}
                          />
                        )}
                      </span>
                    </div>
                  );
                })}
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* ---- penalties ---- */}
      {g.penalties.length > 0 && (
        <section className="section">
          <div className="card">
            <div className="head">
              <h2>Penalties</h2>
              <span className="kicker">{g.penalties.length} penalties</span>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">Time</th>
                    <th className="l">Team</th>
                    <th className="l">Infraction</th>
                  </tr>
                </thead>
                <tbody>
                  {g.penalties.map((p, i) => (
                    <tr key={i}>
                      <td className="l" style={{ color: "var(--dim)", whiteSpace: "nowrap" }}>
                        {p.period} · {p.time}
                      </td>
                      <td className="l" style={{ color: p.team === us ? "var(--ink)" : "var(--dim)" }}>
                        {p.team}
                      </td>
                      <td className="l">{p.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ---- goaltending ---- */}
      {g.goalies.length > 0 && (
        <section className="section">
          <div className="card">
            <div className="head">
              <h2>Goaltending</h2>
              <span className="kicker">{g.goalies.length} lines</span>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">Team</th>
                    <th className="l">Goaltender</th>
                    <th>Minutes</th>
                    <th>Goals against</th>
                    <th>Saves</th>
                    <th className="l">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {g.goalies.map((k, i) => (
                    <tr key={i}>
                      <td className="l" style={{ color: "var(--dim)" }}>{k.team}</td>
                      <td className="l">
                        {k.jersey && <span style={{ color: "var(--dim)" }}>#{k.jersey} </span>}
                        {k.name}
                      </td>
                      <td>{k.minutes}</td>
                      {/* The column is LABELLED "Sh". It holds goals against — it
                          equals the other team's score. The label is wrong at the
                          source and is not repeated here. */}
                      <td>{k.shotsLabelled}</td>
                      <td style={{ color: "var(--gold)" }}>{k.savesLabelled}</td>
                      <td className="l" style={{ color: "var(--dim)" }}>{k.decision || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <nav
        style={{
          display: "flex", justifyContent: "space-between", gap: 16,
          borderTop: "1px solid var(--line)", marginTop: 64, paddingTop: 16,
        }}
      >
        {prev
          ? <Link href={`/games/${prev.id}`} className="kicker">&larr; {longDate(prev.date)}</Link>
          : <span />}
        {next
          ? <Link href={`/games/${next.id}`} className="kicker">{longDate(next.date)} &rarr;</Link>
          : <span />}
      </nav>

      <footer className="site">
        {g.dateRecorded}
      </footer>
      </div>
    </>
  );
}
