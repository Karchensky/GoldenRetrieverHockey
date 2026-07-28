import { divisionName } from "../../lib/format";
import type { ScoringRank, StatKey } from "../../../../packages/build/src/types";

/**
 * A player's scoring honours — the top-ten finishes he has, across every race a
 * season has: points, goals, assists and penalty minutes.
 *
 * ONE MEDAL PER RACE PER SEASON, and it is the DIVISION placing. A man who led
 * his division and led the league led one field of players, once; printing that
 * twice inflates a career by counting the same season from two distances. The
 * division is the field a Silver or Bronze team actually plays in, so it is the
 * one that means something and it is the one kept. A full-league placing is
 * used only where the season has no division recorded at all.
 *
 * Leading a division in penalty minutes is a finish too, and an honest one — it
 * just is not a scoring honour, so it wears the penalty colour, not the gold.
 *
 * Where he stood in every OTHER season — the placings outside the top ten —
 * is carried by the season-by-season table on the same page, which is the same
 * fact against the line that produced it. Nothing here is authored: the numbers
 * come straight off HarborCenter's own leaderboards.
 *
 * Shown ONLY on a player's own page, and only when there is something to show.
 */

export const AWARD = 10; // top ten in a stat is an award; the rest is where he stood

type Scope = "division" | "league";

/**
 * The ONE placing a season has for a stat.
 *
 * His division finish, or — only where the season carries no division at all —
 * his finish in the whole league. Exported because the season-by-season table
 * marks the same placing against the line that produced it, and the two must
 * never disagree about which number a man finished.
 */
export function placing(r: ScoringRank, stat: StatKey): { rank: number; scope: Scope } | null {
  const division = r.divisionRanks[stat];
  if (division !== null) return { rank: division, scope: "division" };
  if (r.division !== null) return null;
  const league = r.leagueRanks[stat];
  return league === null ? null : { rank: league, scope: "league" };
}

const STATS: { key: StatKey; label: string; word: string; value: (r: ScoringRank) => number | null }[] = [
  { key: "points", label: "Points", word: "pts", value: (r) => r.pts },
  { key: "goals", label: "Goals", word: "goals", value: (r) => r.g },
  { key: "assists", label: "Assists", word: "assists", value: (r) => r.a },
  { key: "pim", label: "Penalty min", word: "PIM", value: (r) => r.pim },
];
const STAT_PRIORITY: Record<StatKey, number> = { points: 0, goals: 1, assists: 2, pim: 3 };

export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Penalties wear the penalty colour. Scoring: champion gold, podium bright. */
export function tone(stat: StatKey, rank: number): string {
  if (stat === "pim") return "var(--paint-r)";
  if (rank === 1) return "var(--gold)";
  if (rank <= 3) return "var(--ball-pure)";
  return "var(--ball)";
}

type Medal = {
  scope: Scope;
  stat: StatKey;
  label: string;
  word: string;
  rank: number;
  value: number;
  session: string;
  sessionSort: number;
  division: string | null;
};

export default function ScoringHonours({ ranks }: { ranks: ScoringRank[] }) {
  if (ranks.length === 0) return null;

  const medals: Medal[] = [];
  for (const r of ranks) {
    for (const s of STATS) {
      const stood = placing(r, s.key);
      const value = s.value(r);
      if (stood && stood.rank <= AWARD && value !== null) {
        medals.push({
          scope: stood.scope, stat: s.key, label: s.label, word: s.word,
          rank: stood.rank, value,
          // "Bronze A" on one line and "Bronze A Division" on the next is one
          // division wearing two names, on the tiles a man reads first.
          session: r.session, sessionSort: r.sessionSort,
          division: r.division === null ? null : divisionName(r.division),
        });
      }
    }
  }
  if (medals.length === 0) return null;

  // Best first: sharper rank, then the marquee stats before penalties, then
  // most recent.
  medals.sort(
    (a, b) =>
      a.rank - b.rank ||
      STAT_PRIORITY[a.stat] - STAT_PRIORITY[b.stat] ||
      b.sessionSort - a.sessionSort,
  );
  // A career like the franchise scorer's runs to dozens of finishes; the medals
  // are a highlight reel, and the season table below carries every placing.
  const TILE_CAP = 12;
  const shown = medals.slice(0, TILE_CAP);
  const capped = medals.length - shown.length;

  return (
    <section className="section" data-reveal>
      <div className="card">
        <div className="head">
          <h2>Honours</h2>
          <span className="kicker">
            {medals.length} top-ten finish{medals.length === 1 ? "" : "es"}
          </span>
        </div>

        <div
          data-stagger
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(184px, 1fr))",
            gap: 1,
            background: "var(--line)",
            border: "1px solid var(--line)",
          }}
        >
          {shown.map((m, i) => {
            const c = tone(m.stat, m.rank);
            return (
              <div
                key={i}
                style={{
                  background: "rgba(56,62,78,0.12)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  padding: "16px 16px 18px",
                  display: "grid",
                  gap: 6,
                  alignContent: "start",
                  borderTop: `2px solid ${c}`,
                }}
              >
                <span className="kicker" style={{ color: c }}>
                  {m.scope === "league" ? "League" : m.division} · {m.label}
                </span>
                <div
                  style={{
                    fontFamily: "var(--disp)",
                    fontWeight: 300,
                    fontSize: "clamp(2rem, 4.6vw, 2.8rem)",
                    lineHeight: 0.9,
                    letterSpacing: "-0.02em",
                    color: c,
                    fontVariantNumeric: "tabular-nums lining-nums",
                  }}
                >
                  {ordinal(m.rank)}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink)" }}>
                  {m.value} {m.word}
                </div>
                <div style={{ fontSize: 11, color: "var(--dim)" }}>
                  {m.session.replace(" - ", " · ")}
                </div>
              </div>
            );
          })}
        </div>

        {capped > 0 && (
          <p style={{ fontSize: 11, color: "var(--dim)", margin: "20px 0 0" }}>
            {capped} more top-ten finish{capped === 1 ? "" : "es"}, marked against the seasons below.
          </p>
        )}
      </div>
    </section>
  );
}
