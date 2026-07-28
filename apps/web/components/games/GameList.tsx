"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { plural } from "../../lib/format";
import s from "./games.module.css";

export type GameRow = {
  id: string;
  date: string;
  sessionSort: number;
  opponent: string;
  gr: "home" | "away";
  gf: number | null;
  ga: number | null;
  result: "W" | "L" | "T" | null;
  round: string | null;
  ot: boolean;
  shootoutWinner: string | null;
  status: string;
  hasDetail: boolean;
  archiveOnly: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function short(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m! < 3 ? y! - 1 : y!;
  const dow = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m! - 1]! + d!) % 7;
  return `${DAYS[dow]} ${MONTHS[m! - 1]} ${d}`;
}

function GameRow({ g }: { g: GameRow }) {
  const res = g.result ?? "—";
  const cls = g.result === "W" ? s.win : g.result === "L" ? s.loss : s.none;
  return (
    <Link key={g.id} href={`/games/${g.id}`} className={s.row}>
      <time className={s.date} dateTime={g.date}>{short(g.date)}</time>
      <span className={`${s.res} ${cls}`}>{res}</span>
      <span className={s.opp}>
        <span className={s.score}>
          {g.gf === null ? "—" : g.gf}&ndash;{g.ga === null ? "—" : g.ga}
        </span>{" "}
        <span className={s.venue}>{g.gr === "home" ? "vs" : "at"}</span> {g.opponent}
      </span>
      <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {g.round && <span className={s.tag}>{g.round}</span>}
        {g.ot && <span className={s.tag}>{g.shootoutWinner ? "Shootout" : "OT"}</span>}
        {g.status === "Postponed" && <span className={s.tag}>Postponed</span>}
      </span>
    </Link>
  );
}

export default function GameList({
  games,
  sessions,
}: {
  games: GameRow[];
  sessions: { sort: number; label: string }[];
}) {
  const [expandAll, setExpandAll] = useState(false);

  const grouped = useMemo(() => {
    const bySession = new Map<number, GameRow[]>();
    for (const g of games) {
      const list = bySession.get(g.sessionSort) ?? [];
      list.push(g);
      bySession.set(g.sessionSort, list);
    }
    return sessions.map((sess) => {
      const gms = bySession.get(sess.sort) ?? [];
      gms.sort((a, b) => b.date.localeCompare(a.date));
      const played = gms.filter((g) => g.result !== null);
      const w = played.filter((g) => g.result === "W").length;
      const l = played.filter((g) => g.result === "L").length;
      return { ...sess, games: gms, w, l, played: played.length };
    });
  }, [games, sessions]);

  return (
    <>
      <div className={s.filters}>
        <button
          type="button"
          className={s.chip}
          onClick={() => setExpandAll((v) => !v)}
        >
          {expandAll ? "Collapse all" : "Expand all"}
        </button>
        <span className="kicker" style={{ marginLeft: "auto" }}>
          {plural(games.length, "game")} · {plural(sessions.length, "session")}
        </span>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {grouped.map((sess, i) => (
          <details key={sess.sort} open={expandAll || i === 0}>
            <summary className={s.seasonHead}>
              <span className={s.seasonLabel}>{sess.label}</span>
              <span className={s.seasonMeta}>
                {plural(sess.games.length, "game")}
                {sess.played > 0 && <> · {sess.w}&ndash;{sess.l}</>}
              </span>
            </summary>
            <div className={s.rows}>
              {sess.games.map((g) => (
                <GameRow key={g.id} g={g} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
