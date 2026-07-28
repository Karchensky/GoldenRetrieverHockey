"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import s from "./seasons.module.css";

/**
 * Everyone, alphabetically, one tile each.
 *
 * "A to Z / every recorded player" is gone: the grid is visibly alphabetical
 * and visibly everybody. The count stays — sixty-odd tiles is not a number
 * anyone reads off a grid.
 *
 * A GOALTENDER IS NOT A ZERO. The tiles printed "9 seasons · 0 pts" for the
 * seven men who only ever tended goal, off a career total that is a column of
 * nulls summed to nothing — and the franchise board on the same page prints an
 * em dash for exactly those players, deliberately, with the reason written into
 * its source. Brent Seymour has 95 wins and 4,981 saves and his tile summarised
 * the career as zero. A goaltender's tile carries a goaltender's record.
 *
 * The section is the door out of the page and was the heaviest thing on it —
 * 79 tiles, no way to reach a name but the scrollbar. The field filters as you
 * type and nothing else changes.
 */

export type IndexTile = {
  slug: string;
  name: string;
  jersey: string;
  sessions: number;
  /** The line under the name: points for a skater, a record for a goaltender. */
  line: string;
};

export default function PlayerIndex({ tiles }: { tiles: IndexTile[] }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === "" ? tiles : tiles.filter((tile) => tile.name.toLowerCase().includes(needle));
  }, [tiles, query]);

  return (
    <section className={s.playerIndex} id="players" aria-labelledby="player-index-title">
      <header className={s.chronicleHead}>
        <div><h2 id="player-index-title">Player index</h2></div>
        {/* The label is a LABEL, not a kicker. It was set in the class eight
            other sections use for their summary figures, in the same size and
            the same slot, so the one head zone on the page whose right-hand
            side is a control looked like the eight whose right-hand side is a
            fact. */}
        <label className={s.playerFind}>
          <span className={s.playerFindLabel}>Find</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter players by name"
          />
          <b>{shown.length}</b>
        </label>
      </header>
      <div className={s.playerGrid}>
        {shown.map((tile) => (
          <Link href={`/players/${tile.slug}`} className={s.playerIndexLink} key={tile.slug}>
            <span>{tile.jersey}</span>
            <strong>{tile.name}</strong>
            <small>{tile.line}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}
