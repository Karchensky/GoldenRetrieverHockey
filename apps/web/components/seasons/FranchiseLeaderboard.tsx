"use client";

import { useState } from "react";
import Leaderboard from "../stats/Leaderboard";
import type { BoardCell } from "../../lib/stats";

type Props = {
  cells: BoardCell[];
  people: { slug: string; name: string; aliases: string[]; jersey: string | null }[];
  sessions: { id: string; label: string; sort: number; archiveOnly: boolean }[];
  sources: { source: string; label: string; archiveOnly: boolean }[];
};

export default function FranchiseLeaderboard(props: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  return <Leaderboard {...props} selected={selected} onSelect={setSelected} />;
}

