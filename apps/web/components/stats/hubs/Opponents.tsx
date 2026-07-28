"use client";

import { useState } from "react";
import { plural } from "../../../lib/format";
import type { HubSlot, OpponentRow } from "../../../lib/hubs";
import s from "./hubs.module.css";

/**
 * Every club this team has ever met, and how it went.
 *
 * Nothing else on the site names an opponent. The row carries three readings
 * at once — WHEN they were met, drawn on the same half-year spine the rest of
 * the archive uses; HOW MANY times; and the goal difference, signed, drawn
 * either side of a centre line and direct-labelled so the colour is never
 * carrying the meaning on its own.
 *
 * Takes its data as props because it is a client component: importing the
 * corpus here would ship `site.json` to the browser.
 */

type Order = "gp" | "diff" | "w" | "l";

const ORDERS: { key: Order; label: string }[] = [
  { key: "gp", label: "Most played" },
  { key: "diff", label: "Goal difference" },
  { key: "w", label: "Most beaten" },
  { key: "l", label: "Most lost to" },
];

const ordered = (rows: OpponentRow[], order: Order): OpponentRow[] => {
  const by = [...rows];
  if (order === "diff") return by.sort((a, b) => b.diff - a.diff || b.gp - a.gp);
  if (order === "w") return by.sort((a, b) => b.w - a.w || b.diff - a.diff);
  if (order === "l") return by.sort((a, b) => b.l - a.l || a.diff - b.diff);
  return by.sort((a, b) => b.gp - a.gp || b.diff - a.diff);
};

const year = (iso: string) => iso.slice(0, 4);

type Props = {
  rows: OpponentRow[];
  columns: HubSlot[];
  maxDiff: number;
  shown: number;
};

export default function Opponents({ rows, columns, maxDiff, shown }: Props) {
  const [order, setOrder] = useState<Order>("gp");
  const n = Math.max(1, columns.length);
  const at = (sort: number) => columns.findIndex((c) => c.sort === sort);

  return (
    <>
      <div className="st-controls">
        <span className="st-field" role="group" aria-label="Order">
          <span>Order</span>
          {ORDERS.map((o) => (
            <button
              type="button"
              className="st-chip"
              key={o.key}
              aria-pressed={order === o.key}
              onClick={() => setOrder(o.key)}
            >
              {o.label}
            </button>
          ))}
        </span>
      </div>

      <div className={s.oppHead}>
        <span>Club</span>
        {/* Just "Met". The span used to be welded onto this column head as the
            section's stand-in for a scope line — a two-line axis label, in a
            different grammar and a different unit from the six standardised
            ones, and `display: none` at 860px and below, which is where most
            readers are. The section carries the same sentence as every other
            one now. */}
        <span>Met</span>
        <span>GP</span>
        <span>Record</span>
        <span>Goal difference</span>
      </div>

      <div className={s.oppGrid}>
        {ordered(rows, order).slice(0, shown).map((row) => {
          const step = 118 / n;
          const bar = (Math.abs(row.diff) / maxDiff) * 96;
          const positive = row.diff > 0;
          return (
            <div className={s.oppRow} key={row.name}>
              <div>
                <div className={s.oppName}>{row.name}</div>
                {/* SESSIONS, the archive's own word, and printed even when
                    there is one of them: the guard left a club met once in a
                    four-day invitational showing a bare "2017–2018", which
                    reads as two seasons of hockey. Sixteen rows said "seasons"
                    here while the same value was read out as "sessions" to a
                    screen reader four lines below. */}
                <div className={s.oppWhen}>
                  {year(row.first)}{row.last !== row.first && `–${year(row.last)}`}
                  {` · ${plural(row.sessions, "session")}`}
                  {row.playoff > 0 && (
                    <span className={s.oppPlayoff}>{` · ${row.playoff} in the playoffs`}</span>
                  )}
                </div>
              </div>

              <svg
                className={s.oppMet}
                viewBox="0 0 118 13"
                role="img"
                aria-label={`Met in ${plural(row.sessions, "session")}, ${year(row.first)} to ${year(row.last)}`}
              >
                <line x1="0" x2="118" y1="6.5" y2="6.5" stroke="var(--rule)" strokeWidth="1" />
                {columns.map((column, i) => column.onFile ? null : (
                  <rect key={column.sort} x={step * i} y="1" width={step} height="11" fill="#2a3040" opacity=".2" />
                ))}
                {row.sorts.map((sort) => {
                  const i = at(sort);
                  return i < 0 ? null : (
                    <rect
                      key={sort}
                      x={step * i + step * 0.16}
                      y="2.5"
                      width={step * 0.68}
                      height="8"
                      fill="var(--paint-b)"
                      opacity=".78"
                    />
                  );
                })}
              </svg>

              <div className={s.oppNum}>{row.gp}</div>
              <div className={s.oppRec}>{row.w}–{row.l}{row.t > 0 && `–${row.t}`}</div>

              <svg className={s.oppDiff} viewBox="0 0 260 15" aria-hidden="true">
                <line x1="130" x2="130" y1="0" y2="15" stroke="#2a3040" strokeWidth="1" />
                {bar > 0.4 && (
                  <rect
                    x={positive ? 131 : 129 - bar}
                    y="4"
                    width={bar}
                    height="7"
                    rx="3"
                    fill={positive ? "var(--paint-b)" : "var(--paint-r)"}
                    opacity=".85"
                  />
                )}
                <text
                  x={row.diff >= 0 ? 135 + bar : 125 - bar}
                  y="11.5"
                  textAnchor={row.diff >= 0 ? "start" : "end"}
                  fill="var(--dim)"
                  fontSize="9"
                  fontFamily="var(--mono)"
                >
                  {row.diff > 0 ? "+" : ""}{row.diff}
                </text>
              </svg>

              <div className={s.oppDiffText}>{row.diff > 0 ? "+" : ""}{row.diff}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
