import { data, players, sessions } from "./data";
import type { PlayerSession, Session } from "../../../packages/build/src/types";
import { byArrival, currentFirst } from "./order";

/**
 * Derived metrics for /stats. Everything here is computed at BUILD time from
 * `site.json` and nothing else. No runtime fetch, no interpolation, no
 * smoothing.
 *
 * Three rules carry over from the archive and are enforced in code rather than
 * in prose, because prose does not run:
 *
 * - **Absence is not zero (§2.4).** `tally()` and `rate()` return `null` when
 *   nothing was recorded, and count the rows they had to drop. A session with
 *   no statistics reports NO DATA. It never reports 0.
 * - **A session the archive knows about is a HOLE, not a non-event.** The
 *   spine below is a fixed half-year grid, not a list of what survived. Twelve
 *   of its twenty-eight slots are empty and every one of them says why.
 * - **Derived figures declare themselves.** Anything computed rather than
 *   recorded carries its own arithmetic in `HOW`, and the page prints it.
 */

// ------------------------------------------------------------------
// null-aware arithmetic
// ------------------------------------------------------------------

/** A sum that knows what it never had. `value: null` means nothing was recorded. */
export type Tally = { value: number | null; rows: number; missing: number };

type StatKey = "gp" | "g" | "a" | "pts" | "pim";

export function tally(rows: readonly PlayerSession[], key: StatKey): Tally {
  let value: number | null = null;
  let missing = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === null) missing++;
    else value = (value ?? 0) + v;
  }
  return { value, rows: rows.length, missing };
}

/**
 * A ratio over the rows that carry BOTH halves of it.
 *
 * The exclusion is the point. 2019-20 is nine games played against a blank
 * points column: summing that with null-as-zero yields "0.000 points per game",
 * which is a sentence the archive would be inventing. `excluded` is reported so
 * the reader can see how much of the session went into the number.
 */
export type Rate = { value: number | null; num: number; den: number; excluded: number };

export function rate(rows: readonly PlayerSession[], numKey: StatKey, denKey: StatKey = "gp"): Rate {
  let num = 0;
  let den = 0;
  let excluded = 0;
  for (const r of rows) {
    const a = r[numKey];
    const b = r[denKey];
    if (a === null || b === null) {
      excluded++;
      continue;
    }
    num += a;
    den += b;
  }
  return { value: den > 0 ? num / den : null, num, den, excluded };
}

/** How every derived figure on the page is arrived at. Printed, not hidden. */
export const HOW = {
  ptsPerGame:
    "Derived: points divided by games played, summed only over the season lines that carry both. Lines missing either are excluded and counted.",
  share:
    "Derived: the player's points per game divided by the same figure for the whole session. The session's rate includes the player's own games, so a dominant scorer is partly dividing by himself.",
  people:
    "Derived: distinct people. site.json's own `players` field counts season LINES, which is a different number wherever a session has more than one phase on file.",
} as const;

// ------------------------------------------------------------------
// the spine — a fixed half-year grid, 2012-13 to now
// ------------------------------------------------------------------

export type Half = Session["half"];

/** Summer sorts on the integer, fall/winter on the half. Matches packages/build/src/sessions.ts. */
export const halfOf = (sort: number): Half => (Number.isInteger(sort) ? "summer" : "fall-winter");

export function slotLabel(sort: number): string {
  const year = Math.floor(sort);
  return `${year} - ${halfOf(sort) === "summer" ? "Summer" : "Winter"}`;
}

/**
 * Why a slot on the spine is empty.
 *
 * Transcribed from docs/BACKLOG.md, which is the archive's own record of what
 * it went looking for. Four genuinely different states — "we swept and found
 * nothing" is not the same claim as "we never asked".
 */
export type GapStatus =
  | "heading-only"
  | "searched"
  | "unrecorded"
  | "may-not-exist"
  | "not-played";

/** The answer each status gives, in the archive's own words.
 *
 *  `not-played` is a SETTLED one and the only one that is. The rest are
 *  statements about searching; this is a statement about the season, and the
 *  archive holds two independent confirmations for it. It was being printed as
 *  "may not have been played" — a hedge over a fact — on a site whose whole
 *  distinction is between a record nobody has found and a season nobody
 *  played. */
export const GAP_WORDS: Record<GapStatus, string> = {
  "heading-only": "a heading, no table",
  searched: "searched for, not found",
  unrecorded: "never recorded",
  "may-not-exist": "may not have been played",
  "not-played": "confirmed not played",
};

export type Gap = {
  sort: number;
  label: string;
  status: GapStatus;
};

/**
 * Every gap the archive knows about. The evidence for each is docs/BACKLOG.md.
 *
 * **A session on file always wins this lookup** — `bySess` is consulted first —
 * so a stale entry here is inert rather than wrong on screen. It is still worth
 * deleting, because a list of holes that names seasons we have found reads as a
 * list of things nobody looked for.
 *
 * Ten entries came off on 2026-07-26. The captain's own stats workbook filled
 * 2013-14, Summer 2014, 2014-15, Summer 2015, 2015-16 and Summer 2016; earlier
 * recoveries had already filled Summer 2018, 2018-19, Summer 2019 and 2020-21
 * out of files that were sitting in the corpus the whole time. Two are left.
 * That is the shape of this project: a gap is a statement about what has been
 * found, and it keeps not being a statement about what exists.
 */
export const GAPS: readonly Gap[] = [
  /* "searched", not "unrecorded". These two words are now printed on the
     season record's own rail, and they were the only thing telling a reader
     which of the two empty halves is which — so the one that says the season
     was never written down had better not be the one HANDOFF.md describes as
     "played, record not found". Summer 2017 was played and has been searched
     for; Summer 2020 was not played, confirmed twice. */
  { sort: 2017, label: "Summer 2017", status: "searched" },
  { sort: 2020, label: "Summer 2020", status: "not-played" },
];

// ------------------------------------------------------------------
// session rollups
// ------------------------------------------------------------------

export type SessionRollup = {
  id: string;
  sort: number;
  half: Half;
  label: string;
  source: string;
  sourceLabel: string;
  archiveOnly: boolean;
  /** Distinct people. NOT `session.players`, which counts lines. */
  people: number;
  /** Season lines on file. Exceeds `people` wherever a session has two phases. */
  rows: number;
  gp: Tally;
  g: Tally;
  a: Tally;
  pts: Tally;
  pim: Tally;
  ptsPerGame: Rate;
  /** False when not one line in the session carries a points figure. */
  hasStats: boolean;
  /** The tournament's name where this session is one, and null where it is a
   *  league half. Anything counting HALF-YEARS must skip the ones that carry it. */
  tournament: string | null;
  /** The session happened and is provable; the list of who played it is gone. */
  rosterLost: boolean;
  /** The named men are a known fragment — a league-wide table's page one. */
  rosterPartial: boolean;
};

/** A tournament states the year it was played in its own id ("2015 - Greater
 *  Buffalo Invitational"); the sort deliberately sits a quarter-step back in
 *  the previous half, so it cannot be computed. */
const tournamentYear = (s: Session): number =>
  Number(s.id.match(/^(\d{4})/)?.[1]) || Math.floor(s.sort);

const rowsFor = (id: string): PlayerSession[] =>
  players.flatMap((p) => p.seasons.filter((s) => s.session === id));

const peopleIn = (id: string): number =>
  players.filter((p) => p.seasons.some((s) => s.session === id)).length;

function rollSession(s: Session): SessionRollup {
  const rows = rowsFor(s.id);
  const pts = tally(rows, "pts");
  return {
    id: s.id,
    sort: s.sort,
    half: s.half,
    // A tournament is named, not computed. `slotLabel` is a function of the
    // sort alone, and a tournament sorts a quarter-step past the half it was
    // played in — so the 2015 invitational at 2014.75 would come out labelled
    // "2014 - Winter", which the half at 2014.5 already owns. Two columns, one
    // name, and no way to tell them apart. lib/seasons.ts names tournaments
    // for the same reason and off the same field.
    //
    // WITH THE YEAR IT WAS PLAYED. The club entered the Greater Buffalo
    // Invitational three years running, and the bare name is that one string
    // three times: three rows in a timeline log, three ticks on an axis and
    // three entries in a session filter with nothing to tell them apart, on
    // the same page whose leaderboard names them "2014 - Greater Buffalo
    // Invitational". The session id carries the year and is the only thing
    // that does.
    label: s.tournament ? `${tournamentYear(s)} - ${s.tournament}` : slotLabel(s.sort),
    source: s.provenance.source,
    sourceLabel: s.provenance.label,
    archiveOnly: s.provenance.archiveOnly,
    people: peopleIn(s.id),
    rows: rows.length,
    gp: tally(rows, "gp"),
    g: tally(rows, "g"),
    a: tally(rows, "a"),
    pts,
    pim: tally(rows, "pim"),
    ptsPerGame: rate(rows, "pts"),
    hasStats: pts.value !== null,
    tournament: s.tournament,
    rosterLost: s.rosterLost,
    rosterPartial: s.rosterPartial,
  };
}

export const ROLLUPS: readonly SessionRollup[] = sessions
  .map(rollSession)
  .sort((a, b) => a.sort - b.sort);

// ------------------------------------------------------------------
// the spine itself
// ------------------------------------------------------------------

export type Slot =
  | { kind: "session"; sort: number; half: Half; label: string; roll: SessionRollup }
  | { kind: "gap"; sort: number; half: Half; label: string; gap: Gap };

/**
 * Every half-year from the first session on file to the last, whether or not
 * anything survived it. The grid is the point: a site that lists only what it
 * has is a site that has quietly decided the rest never happened.
 */
export const SPINE: readonly Slot[] = (() => {
  const sorts = ROLLUPS.map((r) => r.sort);
  const first = Math.min(...sorts);
  const last = Math.max(...sorts);
  const byGap = new Map(GAPS.map((g) => [g.sort, g]));
  const bySess = new Map(ROLLUPS.map((r) => [r.sort, r]));

  /**
   * The half-year grid, UNION every sort a session actually claims.
   *
   * The grid on its own is a bet that a session always lands on a half-year,
   * and a session that does not — a tournament filed as its own slot between
   * two halves — would simply not be looked up, would not be drawn, and
   * nothing anywhere would say a session had gone missing. The union makes the
   * grid the FLOOR rather than the whole story: every half-year still gets a
   * slot whether or not it was played, and anything else on file gets one too.
   */
  const marks = new Set<number>();
  for (let t = first; t <= last + 1e-9; t += 0.5) marks.add(Math.round(t * 2) / 2);
  for (const sort of sorts) marks.add(sort);

  return [...marks]
    .sort((a, b) => a - b)
    .map((sort): Slot => {
      const half = halfOf(sort);
      const roll = bySess.get(sort);
      if (roll) return { kind: "session", sort, half, label: roll.label, roll };
      const gap: Gap = {
        ...(byGap.get(sort) ?? { sort, status: "unrecorded" as const }),
        label: slotLabel(sort),
      };
      return { kind: "gap", sort, half, label: gap.label, gap };
    });
})();

/**
 * Runs of consecutive shaded slots that give the same answer, as one block.
 *
 * Four adjacent columns each repeating "never recorded" is wallpaper. One
 * block that says it once is a statement, and it is the same statement.
 *
 * ONE RULE DECIDES THE SHADING, AND IT IS `hasStats`: a column is shaded where
 * no scoring line survives. Every kind of nothing satisfies that — a half-year
 * with no session, a session with no roster, a session with a roster and no
 * figures — and the sub-status below only chooses which of them the arc writes
 * down the column.
 *
 * IT WAS `rosterLost` ALONE, AND THAT FLAG DISAGREED WITH THE ARCHIVE'S OWN
 * COVERAGE BOX. 2020 - Winter carries the flag, which `lib/scope.ts` counts as a
 * fragment rather than a loss — so the box named it as a roster the archive
 * holds while every ridge on the site shaded the same column and printed NO
 * ROSTER ON FILE down it, two thousand pixels below.
 *
 * AND THE WORD SAYS SCORING, NOT STATISTICS, because that is the test. It read
 * "no statistics on file" while the coverage chart called the same two columns a
 * FRAGMENT of the statistics — and the chart is right: 2019 - Summer carries a
 * full league standings row and 2020 - Winter a goaltender's season. Two
 * instruments a reader crosses between constantly were making opposite claims
 * about the two sessions this archive worked hardest to prove were played. The
 * predicate never changed; the noun over it was wider than the predicate.
 */
export type ShadeStatus = GapStatus | "roster-lost" | "stats-lost";
export type GapBlock = { from: number; n: number; status: ShadeStatus; words: string; span: string };

/** A slot with no statistic in it: never on file, on file with no roster, or on
 *  file with a roster nobody filled a figure in beside. */
const shadeOf = (slot: Slot): ShadeStatus | null => {
  if (slot.kind === "gap") return slot.gap.status;
  if (slot.roll.hasStats) return null;
  return slot.roll.people === 0 ? "roster-lost" : "stats-lost";
};

const SHADE_WORDS: Record<ShadeStatus, string> = {
  ...GAP_WORDS,
  "roster-lost": "no roster on file",
  "stats-lost": "no scoring on file",
};

export function gapBlocks(slots: readonly Slot[]): GapBlock[] {
  const out: GapBlock[] = [];
  slots.forEach((s, i) => {
    const status = shadeOf(s);
    if (status === null) return;
    const last = out[out.length - 1];
    if (last && last.status === status && last.from + last.n === i) {
      last.n++;
      last.span = `${slots[last.from]!.label} to ${s.label}`;
      return;
    }
    out.push({ from: i, n: 1, status, words: SHADE_WORDS[status], span: s.label });
  });
  return out;
}

/**
 * WHICH COLUMNS GET A NAME OVER A SPINE, AND IT IS ONE RULE FOR EVERY CHART
 * DRAWN ON ONE.
 *
 * Five: both ends and the three quarter points. Thirty-three names over
 * thirty-three columns is 4px of type and no reader, and every column names
 * itself on hover and to a screen reader.
 *
 * A TICK NEVER LANDS ON A TOURNAMENT. A tick is a POSITION IN TIME and cannot
 * be placed on a four-day event, so it steps to the nearest league half. The
 * coverage chart had this rule and the session history did not, which is worse
 * than either chart getting it wrong on its own: the quarter point falls on the
 * 2015 Greater Buffalo Invitational, `slotLabel` calls the slot at 2014.75
 * "2014 - Winter", and the two charts on one page printed that one name over two
 * different columns — one of them a season, the other a weekend.
 */
export const axisTicks = (columns: readonly { tournament: string | null }[]): Set<number> => {
  const n = columns.length;
  const half = (i: number): number => {
    for (let step = 0; step < n; step++) {
      for (const j of [i - step, i + step]) {
        if (j >= 0 && j < n && columns[j]!.tournament === null) return j;
      }
    }
    return i;
  };
  return new Set(
    [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1]
      .filter((i) => i >= 0 && i < n)
      .map(half),
  );
};

export const SPINE_COUNTS = {
  slots: SPINE.length,
  onFile: SPINE.filter((s) => s.kind === "session").length,
  gaps: SPINE.filter((s) => s.kind === "gap").length,
  /** On file, but not one statistic in it. */
  emptyOnFile: ROLLUPS.filter((r) => !r.hasStats).length,
  archiveOnly: ROLLUPS.filter((r) => r.archiveOnly).length,
};

// ------------------------------------------------------------------
// eras — the four platforms
// ------------------------------------------------------------------

export type Era = {
  source: string;
  label: string;
  archiveOnly: boolean;
  sessions: SessionRollup[];
  first: number;
  last: number;
  people: number;
  rows: number;
  gp: Tally;
  g: Tally;
  a: Tally;
  pts: Tally;
  pim: Tally;
  ptsPerGame: Rate;
};

export const ERAS: readonly Era[] = (() => {
  const order = [...new Set(ROLLUPS.map((r) => r.source))];
  return order
    .map((source) => {
      const mine = ROLLUPS.filter((r) => r.source === source);
      const ids = new Set(mine.map((r) => r.id));
      const rows = players.flatMap((p) => p.seasons.filter((s) => ids.has(s.session)));
      const people = players.filter((p) => p.seasons.some((s) => ids.has(s.session))).length;
      const head = mine[0]!;
      return {
        source,
        label: head.sourceLabel,
        archiveOnly: mine.every((r) => r.archiveOnly),
        sessions: mine,
        first: Math.min(...mine.map((r) => r.sort)),
        last: Math.max(...mine.map((r) => r.sort)),
        people,
        rows: rows.length,
        gp: tally(rows, "gp"),
        g: tally(rows, "g"),
        a: tally(rows, "a"),
        pts: tally(rows, "pts"),
        pim: tally(rows, "pim"),
        ptsPerGame: rate(rows, "pts"),
      };
    })
    .sort((a, b) => a.first - b.first);
})();

// ------------------------------------------------------------------
// the assist network
// ------------------------------------------------------------------

export type NetNode = {
  name: string;
  slug: string;
  x: number;
  y: number;
  gave: number;
  got: number;
  total: number;
  partners: number;
};

export type NetEdge = { from: string; to: string; n: number; mutual: boolean };

const slugOf = new Map(players.map((p) => [p.name, p.slug]));

/**
 * A deterministic force-directed layout, run at BUILD time.
 *
 * 28 nodes and 153 edges is four hundred iterations of arithmetic, which is a
 * build step's problem and not the browser's. Running it here also means the
 * graph is in the served HTML: it draws with JavaScript switched off, and the
 * client code only adds the hovering.
 *
 * No RNG. Nodes seed on a circle in a stable order, so the same corpus lays out
 * the same way every build and the picture does not lurch between deploys.
 */
function layout(names: string[], edges: NetEdge[], weight: Map<string, number>) {
  const n = names.length;
  const idx = new Map(names.map((nm, i) => [nm, i]));
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    px[i] = Math.cos(a) * 40;
    py[i] = Math.sin(a) * 40;
  }

  const links = edges.map((e) => ({
    a: idx.get(e.from)!,
    b: idx.get(e.to)!,
    // Strong pairs pull harder, but logarithmically: a 24-assist edge is not
    // twenty-four times shorter than a 1-assist edge, it is just clearly shorter.
    w: Math.log1p(e.n),
  }));
  const mass = names.map((nm) => Math.sqrt(weight.get(nm) ?? 1));

  const ITER = 500;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  for (let it = 0; it < ITER; it++) {
    dx.fill(0);
    dy.fill(0);

    // repulsion, scaled by involvement so the busy names get elbow room
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ax = px[i]! - px[j]!;
        let ay = py[i]! - py[j]!;
        let d2 = ax * ax + ay * ay;
        if (d2 < 1e-6) {
          ax = (i - j) * 1e-3;
          ay = 1e-3;
          d2 = 1e-6;
        }
        const f = (260 * mass[i]! * mass[j]!) / d2;
        const d = Math.sqrt(d2);
        const ux = (ax / d) * f;
        const uy = (ay / d) * f;
        dx[i]! += ux;
        dy[i]! += uy;
        dx[j]! -= ux;
        dy[j]! -= uy;
      }
    }

    // springs
    for (const l of links) {
      const ax = px[l.b]! - px[l.a]!;
      const ay = py[l.b]! - py[l.a]!;
      const d = Math.hypot(ax, ay) || 1e-6;
      const f = (d - 26) * 0.02 * l.w;
      const ux = (ax / d) * f;
      const uy = (ay / d) * f;
      dx[l.a]! += ux;
      dy[l.a]! += uy;
      dx[l.b]! -= ux;
      dy[l.b]! -= uy;
    }

    // gravity, so isolates do not sail off
    for (let i = 0; i < n; i++) {
      dx[i]! -= px[i]! * 0.012;
      dy[i]! -= py[i]! * 0.012;
    }

    const step = 0.9 * (1 - it / ITER) + 0.05;
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(dx[i]!, dy[i]!);
      const c = m > 4 ? 4 / m : 1;
      px[i]! += dx[i]! * c * step;
      py[i]! += dy[i]! * c * step;
    }
  }

  // normalise into a 0..100 box, preserving aspect
  const minX = Math.min(...px);
  const maxX = Math.max(...px);
  const minY = Math.min(...py);
  const maxY = Math.max(...py);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const k = 92 / span;
  return names.map((nm, i) => ({
    name: nm,
    x: 50 + (px[i]! - cx) * k,
    y: 50 + (py[i]! - cy) * k,
  }));
}

export const NETWORK: {
  nodes: NetNode[];
  edges: NetEdge[];
  assists: number;
  people: number;
  passers: number;
  mutualPairs: number;
  onewayPairs: number;
  singles: number;
} = (() => {
  const gave = new Map<string, number>();
  const got = new Map<string, number>();
  const partners = new Map<string, Set<string>>();
  const has = new Set(data.assists.map((e) => `${e.from}|${e.to}`));

  for (const e of data.assists) {
    gave.set(e.from, (gave.get(e.from) ?? 0) + e.n);
    got.set(e.to, (got.get(e.to) ?? 0) + e.n);
    for (const [x, y] of [
      [e.from, e.to],
      [e.to, e.from],
    ] as const) {
      const set = partners.get(x) ?? new Set<string>();
      set.add(y);
      partners.set(x, set);
    }
  }

  const names = [...new Set(data.assists.flatMap((e) => [e.from, e.to]))].sort((a, b) => {
    const ta = (gave.get(a) ?? 0) + (got.get(a) ?? 0);
    const tb = (gave.get(b) ?? 0) + (got.get(b) ?? 0);
    return tb - ta || a.localeCompare(b);
  });

  const total = new Map(names.map((n) => [n, (gave.get(n) ?? 0) + (got.get(n) ?? 0)]));

  const edges: NetEdge[] = data.assists.map((e) => ({
    from: e.from,
    to: e.to,
    n: e.n,
    mutual: has.has(`${e.to}|${e.from}`),
  }));

  const pos = new Map(layout(names, edges, total).map((p) => [p.name, p]));

  const nodes: NetNode[] = names.map((name) => {
    const p = pos.get(name)!;
    return {
      name,
      slug: slugOf.get(name) ?? "",
      x: Number(p.x.toFixed(2)),
      y: Number(p.y.toFixed(2)),
      gave: gave.get(name) ?? 0,
      got: got.get(name) ?? 0,
      total: total.get(name) ?? 0,
      partners: partners.get(name)?.size ?? 0,
    };
  });

  const mutual = edges.filter((e) => e.mutual).length / 2;
  return {
    nodes,
    edges: edges.sort((a, b) => a.n - b.n),
    assists: data.assists.reduce((s, e) => s + e.n, 0),
    people: names.length,
    passers: [...gave.keys()].length,
    mutualPairs: mutual,
    onewayPairs: edges.filter((e) => !e.mutual).length,
    singles: edges.filter((e) => e.n === 1).length,
  };
})();

// ------------------------------------------------------------------
// where the network comes from, and where it disagrees with itself
// ------------------------------------------------------------------

/**
 * The network is undated. `site.json` records who set up whom and how often,
 * and not one date, so its era has to be established rather than assumed.
 *
 * It is established by reconciliation. For each source, this counts how many of
 * the network's people have a season line on that source, and how many assists
 * those people are credited with there. One source accounts for all of them.
 */
export type Coverage = {
  source: string;
  label: string;
  archiveOnly: boolean;
  sessions: number;
  /** How many of the network's people ever appear on this source. */
  peopleHere: number;
  /** Assists credited to those people in this source's season lines. */
  assistsHere: number;
};

export const NETWORK_COVERAGE: readonly Coverage[] = ERAS.map((era) => {
  const ids = new Set(era.sessions.map((s) => s.id));
  const inNet = new Set(NETWORK.nodes.map((n) => n.name));
  const mine = players.filter((p) => inNet.has(p.name));
  return {
    source: era.source,
    label: era.label,
    archiveOnly: era.archiveOnly,
    sessions: era.sessions.length,
    peopleHere: mine.filter((p) => p.seasons.some((s) => ids.has(s.session))).length,
    assistsHere: mine.reduce(
      (t, p) => t + p.seasons.filter((s) => ids.has(s.session)).reduce((u, s) => u + (s.a ?? 0), 0),
      0,
    ),
  };
});

/** The source that carries every one of the network's people, when ONE does. */
export const NETWORK_SOURCE: Coverage | undefined = NETWORK_COVERAGE.find(
  (c) => c.peopleHere === NETWORK.people,
);

/**
 * The sessions the network is actually drawn from — every one with a
 * goal-by-goal record, across every platform.
 *
 * This used to be a single platform's sessions (NETWORK_SOURCE), which was true
 * only while the whole network came from Erie Metro. The HarborCenter boxscore
 * capture took it to thirteen sessions across two platforms, so no single
 * source carries all the people any more, NETWORK_SOURCE went undefined, and
 * everything scoped to it silently emptied — the reconciliation below read
 * "0 of 0 passers" for a while because of exactly this.
 *
 * Derived from the games themselves: a session contributes iff a game in it
 * has a scored goal on file. Matched on the sort key, because a game says
 * "2016-17" and a season line says "2016-17 Regular Season".
 */
const DETAIL_SORTS = new Set(
  data.games.filter((g) => (g.goals?.length ?? 0) > 0).map((g) => g.sessionSort),
);
export const NETWORK_SESSION_IDS: ReadonlySet<string> = new Set(
  sessions.filter((s) => DETAIL_SORTS.has(s.sort)).map((s) => s.id),
);

export type Recon = {
  name: string;
  slug: string;
  /** Assists the scoresheets credit him with. */
  sheet: number;
  /** Assists his season lines credit him with, in the same source. */
  lines: number;
  delta: number;
};

/**
 * Scoresheet assists against season-table assists, player by player.
 *
 * Two records of the same two seasons, written by the same league, disagreeing
 * about exactly one man by exactly six assists. Neither has been adjusted.
 */
export const RECONCILIATION: readonly Recon[] = (() => {
  const ids = NETWORK_SESSION_IDS;
  if (ids.size === 0) return [];
  const gave = new Map<string, number>();
  for (const e of data.assists) gave.set(e.from, (gave.get(e.from) ?? 0) + e.n);

  return [...gave]
    .map(([name, sheet]) => {
      const p = players.find((x) => x.name === name);
      const lines =
        p?.seasons.filter((s) => ids.has(s.session)).reduce((t, s) => t + (s.a ?? 0), 0) ?? 0;
      return { name, slug: p?.slug ?? "", sheet, lines, delta: sheet - lines };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.sheet - a.sheet);
})();

export const RECON_SUMMARY = {
  passers: RECONCILIATION.length,
  agree: RECONCILIATION.filter((r) => r.delta === 0).length,
  disagree: RECONCILIATION.filter((r) => r.delta !== 0),
  sheetTotal: RECONCILIATION.reduce((t, r) => t + r.sheet, 0),
  lineTotal: RECONCILIATION.reduce((t, r) => t + r.lines, 0),
};

/**
 * The same disagreement at the team level: goals counted as events on the
 * sheets against goals counted in the season tables for the same sessions.
 */
export const GOAL_RECON = (() => {
  const era = NETWORK_SOURCE
    ? ERAS.find((e) => e.source === NETWORK_SOURCE.source)
    : undefined;
  return {
    onSheets: data.totals.goals,
    inLines: era?.g.value ?? null,
    sheets: data.totals.gameSheets,
    assistsPerGoal: data.totals.goals ? NETWORK.assists / data.totals.goals : null,
  };
})();

// ------------------------------------------------------------------
// careers
// ------------------------------------------------------------------

export type Trace = {
  slug: string;
  name: string;
  aliases: string[];
  /**
   * The first number on file for him, verbatim — a STRING, and one of them is
   * "0". Anything that tests a jersey for truth rather than for null turns
   * Dylan McLaughlin's real number into a missing one. site.json also does not
   * mark which numbers are evidenced and which are the 99 default, so nothing
   * here may claim a number was worn.
   */
  jersey: string | null;
  sessions: number;
  gp: number;
  pts: number;
  /** Career points over career games, or null where no points were recorded —
   *  the same derivation as `totals.ppg`, the franchise board and the player
   *  hero. There is one points-per-game on this site. */
  ppg: number | null;
  /** One cell per spine slot, in spine order. null = nothing on file. */
  cells: (TraceCell | null)[];
  /**
   * Spine index of his first and last slot — arrival and departure.
   *
   * Off the cells, which is the same thing `recent` is read off and for the
   * same reason: a cell exists exactly where a season line does. They are
   * indices, not session sorts, which is all an ORDER needs — the two run the
   * same way. `SPANS` in hubs.ts carries the sorts themselves because it also
   * prints them.
   */
  first: number;
  last: number;
  /**
   * The career figure for each metric, arrived at honestly.
   *
   * Counting stats are null-aware sums. Points per game is career points over
   * career games, NOT the average of the session rates — averaging rates over
   * sessions of 5 and 26 games weights them equally, which is a different
   * statistic wearing this one's name. Share is a mean of the session shares
   * and is labelled as one.
   */
  totals: Record<TraceMetric, number | null>;
  /** Named in one of the last `RECENT_HALVES` league halves. See RECENT_FROM. */
  recent: boolean;
};

export type TraceCell = {
  gp: number | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pim: number | null;
  /** Points per game for this player in this session. */
  ppg: number | null;
  /** The player's rate over the session's rate. Derived — see HOW.share. */
  share: number | null;
  /** Season lines behind this cell. Two means a phase split the dump does not label. */
  rows: number;
  archiveOnly: boolean;
};

/**
 * The cut, and it is the only honest one available.
 *
 * A timeline needs two readings. One session is a dot — there is no line
 * through it, no rise, no fall, nothing a trajectory could mean. So everyone
 * the archive can draw a line through is drawn, and the players it cannot are
 * in the player index instead.
 *
 * This was 6, a number derived from nothing, which yielded eighteen rows and
 * quietly retired every player with two, three, four or five sessions on file.
 */
export const TRACE_MIN_SESSIONS = 2;

/**
 * How far back a career counts as still being played: the current half and the
 * one before it.
 *
 * Two, because a summer and a fall/winter are both sessions and both halves of
 * one calendar year — so this is the last twelve months of hockey and no more.
 * One would work out of the same arithmetic and is worse: the newest session is
 * the one being PLAYED, it is captured while it runs, and a half caught in its
 * first week would drop every regular who has not yet dressed. The half behind
 * it is the backstop. Three would reach eighteen months and, on this corpus,
 * adds one man.
 */
export const RECENT_HALVES = 2;

/**
 * The oldest sort key that still counts as recent — DERIVED, and it moves on
 * its own the next time a session lands.
 *
 * Counted over league halves only. `Session.tournament` names the ones that are
 * not: a four-day invitational is a session and sorts as one, but spending a
 * slot of "the last two sessions" on a week-long event would cut the window to
 * about six months and put a man who played one tournament ahead of a regular.
 * The floor is a half; anything at or past it counts as activity, tournaments
 * included, because a tournament inside the window is still hockey played now.
 */
export const RECENT_FROM: number = (() => {
  const halves = ROLLUPS.filter((r) => r.tournament === null).map((r) => r.sort);
  // ROLLUPS is sorted ascending. Falls back to every session if the archive is
  // ever all tournaments, and to -Infinity if it is empty — never to a year.
  const spine = halves.length > 0 ? halves : ROLLUPS.map((r) => r.sort);
  return spine[Math.max(0, spine.length - RECENT_HALVES)] ?? -Infinity;
})();

/** A sum that stays null until something real goes into it. */
const nsum = (xs: (number | null | undefined)[]): number | null =>
  xs.reduce<number | null>((t, v) => (v === null || v === undefined ? t : (t ?? 0) + v), null);

/**
 * One man laid out on the whole spine.
 *
 * Lifted out of TRACES so a player page can draw the same career the /seasons
 * row draws, off the same arithmetic and the same grid. Two pictures of one
 * career disagreeing was a real defect: the career arc filtered the archive's
 * holes down to the player's own span, so a man who started in 2016 had no
 * 2013-15 on his page and four empty columns on his /seasons row.
 */
export function traceOf(p: (typeof players)[number]): Trace {
  const cells = SPINE.map((slot): TraceCell | null => {
    if (slot.kind !== "session") return null;
    const rows = p.seasons.filter((s) => s.session === slot.roll.id);
    if (rows.length === 0) return null;
    const gp = tally(rows, "gp").value;
    const pts = tally(rows, "pts").value;
    const ppg = gp !== null && pts !== null && gp > 0 ? pts / gp : null;
    const sessionRate = slot.roll.ptsPerGame.value;
    return {
      gp,
      g: tally(rows, "g").value,
      a: tally(rows, "a").value,
      pts,
      pim: tally(rows, "pim").value,
      ppg,
      share: ppg !== null && sessionRate ? ppg / sessionRate : null,
      rows: rows.length,
      archiveOnly: rows.some((r) => r.provenance.archiveOnly),
    };
  });

  /**
   * ONE POINTS-PER-GAME, AND IT DIVIDES THE TWO FIGURES PRINTED BESIDE IT.
   *
   * This was `rate(p.seasons, "pts")` — the stricter figure, summed only over
   * the lines carrying both halves — while the franchise leaderboard and the
   * player hero both divide the career totals. Two of Karchensky's lines record
   * points with no games beside them, so the board said 2.94 and the timeline
   * two sections down said 2.68 for the same career, and the panel wrote the
   * smaller one out as a sentence — "2.68 points per game in 422 games" — which
   * is 1130 ÷ 422 with 422 printed. Same split for Kaplewicz and Boeing: ranks
   * one, two and four.
   *
   * The blank rule still comes first. No points, no rate — the goaltender is
   * not 0.00, he is a column nobody filled in.
   */
  const careerPts = nsum(p.seasons.map((s) => s.pts));
  const careerPpg = careerPts !== null && p.career.gp > 0 ? careerPts / p.career.gp : null;
  const shares = cells.flatMap((c) => (c && c.share !== null ? [c.share] : []));

  return {
    slug: p.slug,
    name: p.name,
    aliases: p.aliases,
    jersey: p.jerseys[0] ?? null,
    sessions: p.career.sessions,
    gp: p.career.gp,
    pts: p.career.pts,
    ppg: careerPpg,
    cells,
    // Off the cells rather than off p.seasons: a cell exists exactly where a
    // season line does, and the spine is the only thing that knows which slot
    // is which.
    recent: SPINE.some((slot, i) => slot.sort >= RECENT_FROM && cells[i] !== null),
    first: cells.findIndex((c) => c !== null),
    // Not `findLastIndex`: it is outside the lib target this app compiles
    // against, and `next build` refuses it where the root `tsc --noEmit` does
    // not. A reduce keeps the last index seen and needs no newer library.
    last: cells.reduce((seen, c, i) => (c !== null ? i : seen), -1),
    totals: {
      pts: nsum(cells.map((c) => c?.pts)),
      g: nsum(cells.map((c) => c?.g)),
      a: nsum(cells.map((c) => c?.a)),
      pim: nsum(cells.map((c) => c?.pim)),
      ppg: careerPpg,
      share: shares.length ? shares.reduce((s, v) => s + v, 0) / shares.length : null,
    },
  };
}

/**
 * SESSIONS A MAN CAN BE DRAWN THROUGH — with a reading in them, and skater
 * lines only.
 *
 * Two different mistakes were made with one number, on two pages a reader moves
 * between by clicking a name, and this is the one test both use now.
 *
 * DISTINCT, because `seasons` counts LINES. Seven careers are one session split
 * into a regular season and a playoff, and a length test on the array let them
 * through: both lines fold into the same cell, so the drawing came out a single
 * dot on a thirty-three-column axis with a five-way metric switcher over it,
 * every reading of which is already a tile in the hero and a row in the table
 * either side of it.
 *
 * WITH A FIGURE IN IT, because being NAMED in a session is not being drawable
 * in one. The fix above landed on the letter of the rule stated at
 * TRACE_MIN_SESSIONS and missed the rule: Casey Krug and Matt Phalzer are named
 * in two sessions each and their 2016 - Winter line is null in every column, so
 * both pages drew one stem, one ring and one blank tick on a thirty-three-
 * column axis, under a five-chip switcher whose five chips all drew the same
 * single dot — a dot already printed as a hero tile and as a row in the
 * two-line table above it. A timeline needs two readings, not two mentions.
 *
 * SKATER, because a goaltender's scoring columns are the platform's rather than
 * the man's. Corey Muff rode the timelines grid as "18 sessions · 2 pts" with a
 * flat ridge, and Brent Seymour as nine sessions of empty grid — drawn by the
 * same component his own page deliberately withholds from him. 258 games, 132
 * wins and seven shutouts are not a scoring line. Every goaltender is still in
 * the player index and in `First and last`, and his record is `In goal`.
 */
const READ_COLUMNS = ["gp", "g", "a", "pts", "pim"] as const;

export const drawableSessions = (p: (typeof players)[number]): number =>
  new Set(
    p.seasons
      .filter((s) => s.kind !== "goalie" && READ_COLUMNS.some((k) => s[k] !== null))
      .map((s) => s.session),
  ).size;

/**
 * THE SAME ORDER THE SESSION HISTORY DRAWS, AND DELIBERATELY SO.
 *
 * This sorted on career points, which put the same man at the head of the grid
 * every time and made a chart of thirty-four careers read as a ranking of one.
 * The two charts sit within a screen of each other, on one spine, answering
 * presence and magnitude — so a reader who has just read down one of them
 * should not have to re-find everybody in the other.
 *
 * THE SAME COMPARATORS `SPANS` USES, out of `lib/order.ts` — the men still
 * playing lead, deepest tenure first, and everybody else keeps the arrival
 * order behind them. Two passes rather than one compound comparator, because
 * `sort` is stable and the second leaves the non-current group exactly as the
 * first left it. `order.ts` explains why it is a file of its own.
 *
 * The timelines draw a SUBSET — the men with two readings on file, against the
 * history's everybody-on-a-roster — so this is the same order over fewer rows,
 * not the same list.
 */
export const TRACES: readonly Trace[] = players
  .filter((p) => drawableSessions(p) >= TRACE_MIN_SESSIONS)
  .map(traceOf)
  .sort(byArrival)
  .sort(currentFirst<Trace>((t) => t.recent));

/**
 * The careers still being played, which is what the timelines open on.
 *
 * Every trace is drawable and all of them stay reachable; this is the cut that
 * decides which ones a reader is shown first. The rest of the grid is one
 * disclosure away and the whole set is in the table under it.
 */
export const RECENT_TRACES: readonly Trace[] = TRACES.filter((t) => t.recent);

export type TraceMetric = "pts" | "g" | "a" | "pim" | "ppg" | "share";

/**
 * The largest single session on file for each metric, and whose it is.
 *
 * This is the scale the grey ghost is drawn to in every row, so it has to be
 * one number for the whole page and it has to be able to name itself: a
 * reference nobody can point at is not a reference. Taken over the careers
 * that are drawn, because the ghost is a comparison between the rows on
 * screen and its own top must be visible among them.
 */
export type Peak = { value: number; name: string; slug: string; label: string };

export const TRACE_PEAK: Record<TraceMetric, Peak | null> = (() => {
  const keys: TraceMetric[] = ["pts", "g", "a", "pim", "ppg", "share"];
  const out = {} as Record<TraceMetric, Peak | null>;
  for (const m of keys) {
    let best: Peak | null = null;
    for (const t of TRACES)
      t.cells.forEach((c, i) => {
        const v = c?.[m];
        if (v === null || v === undefined) return;
        if (!best || v > best.value)
          best = { value: v, name: t.name, slug: t.slug, label: SPINE[i]!.label };
      });
    out[m] = best;
  }
  return out;
})();

/**
 * The five the timeline offers, out of the six every cell carries.
 *
 * GOALS AND ASSISTS ARE NOT A SECOND PICTURE OF POINTS, and the correlation
 * that says they are is an arithmetic identity, not evidence. Points is
 * DEFINED as goals plus assists, so of course each tracks it at r ≈ 0.96;
 * measuring that and calling it redundancy is measuring the definition. A
 * player with 40 goals and 5 assists and a player with 5 goals and 40 assists
 * are the same row on the points list and are not remotely the same player.
 * Both were cut on that reasoning once. They are first-class here.
 *
 * Share of session rate is the one that stays off, for a reason that is not
 * about correlation: the session's rate includes the player's own games, so a
 * dominant scorer is partly dividing by himself, and the figure cannot be read
 * honestly without that sentence beside it. A statistic that needs a paragraph
 * to be true is one this page cannot carry, because the paragraph is the site
 * explaining itself. HOW.share and the cell survive; the chip does not.
 */
export const TRACE_METRICS: { key: TraceMetric; label: string; derived: boolean }[] = [
  { key: "pts", label: "Points", derived: false },
  { key: "g", label: "Goals", derived: false },
  { key: "a", label: "Assists", derived: false },
  { key: "ppg", label: "Points per game", derived: true },
  { key: "pim", label: "Penalty minutes", derived: false },
];

// ------------------------------------------------------------------
// leaderboard rows
// ------------------------------------------------------------------

export type BoardRow = {
  slug: string;
  name: string;
  aliases: string[];
  jersey: string | null;
  /** Distinct sessions inside the current filter. */
  sessions: number;
  gp: number | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pim: number | null;
  ppg: number | null;
  archiveOnly: boolean;
  /** Names this person was filed under inside the filter, when not the canonical one. */
  recordedAs: string[];
};

/** Everything the leaderboard needs, per player per session. Filtered on the client. */
export type BoardCell = {
  slug: string;
  session: string;
  sort: number;
  half: Half;
  source: string;
  archiveOnly: boolean;
  recordedAs: string;
  /** Which table the line came off. A goaltender's scoring columns are the
   *  platform's, not the man's — see the note on the board's `scoring`. */
  goalie: boolean;
  gp: number | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pim: number | null;
};

export const BOARD_CELLS: readonly BoardCell[] = players.flatMap((p) =>
  p.seasons.map((s) => {
    const sess = sessions.find((x) => x.id === s.session);
    return {
      slug: p.slug,
      session: s.session,
      sort: sess?.sort ?? 0,
      half: sess?.half ?? "fall-winter",
      source: s.provenance.source,
      archiveOnly: s.provenance.archiveOnly,
      recordedAs: s.recordedAs,
      goalie: s.kind === "goalie",
      gp: s.gp,
      g: s.g,
      a: s.a,
      pts: s.pts,
      pim: s.pim,
    };
  }),
);

export const BOARD_PEOPLE: readonly { slug: string; name: string; aliases: string[]; jersey: string | null }[] =
  players.map((p) => ({
    slug: p.slug,
    name: p.name,
    aliases: p.aliases,
    jersey: p.jerseys[0] ?? null,
  }));

// ------------------------------------------------------------------
// the goaltender
// ------------------------------------------------------------------

/**
 * Who the blanks belong to, deepest first.
 *
 * This was written when every null in the file belonged to one man — the
 * goaltender, whose table has a different shape and whose columns landed one
 * place over. It is thirty-two men now: four rosters arrived from the captain's
 * inbox as names with no figures beside them, which is a roster recovered and a
 * statistic still missing. Nothing renders this today; it is derived rather
 * than stated, so a page that wants to say it can check first.
 */
export const NULL_HOLDERS: readonly { slug: string; name: string; nulls: number; sessions: number }[] =
  players
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      sessions: p.career.sessions,
      nulls: p.seasons.reduce(
        (t, s) =>
          t +
          (["gp", "g", "a", "pts", "pim"] as const).filter((k) => s[k] === null).length,
        0,
      ),
    }))
    .filter((x) => x.nulls > 0)
    .sort((a, b) => b.nulls - a.nulls);

/**
 * Season lines whose `position` is a number.
 *
 * A position column holding "22" is a column that is not holding a position.
 * Reported, not repaired: the archive does not get to decide what the page
 * meant to say.
 */
export const NUMERIC_POSITIONS: readonly { slug: string; name: string; session: string; position: string }[] =
  players.flatMap((p) =>
    p.seasons
      .filter((s) => s.position !== null && /^\d+$/.test(s.position))
      .map((s) => ({ slug: p.slug, name: p.name, session: s.session, position: s.position! })),
  );

/**
 * Every season line that actually says "G".
 *
 * There is one. It is the session that lost everything else.
 */
export const POSITION_G: readonly {
  slug: string;
  name: string;
  session: string;
  /** The short form — "2019-20", not "2019-20 Regular Season". */
  label: string;
  gp: number | null;
}[] = players.flatMap((p) =>
  p.seasons
    .filter((s) => s.position === "G")
    .map((s) => ({
      slug: p.slug,
      name: p.name,
      session: s.session,
      label: ROLLUPS.find((r) => r.id === s.session)?.label ?? s.session,
      gp: s.gp,
    })),
);

// ------------------------------------------------------------------
// headline figures
// ------------------------------------------------------------------

export const HEADLINE = {
  /** Goals in the season tables, which is not `totals.goals` — see GOAL_RECON. */
  goalsInLines: players.reduce((t, p) => t + p.career.g, 0),
  assistsInLines: players.reduce((t, p) => t + p.career.a, 0),
  ptsInLines: players.reduce((t, p) => t + p.career.pts, 0),
  gpInLines: players.reduce((t, p) => t + p.career.gp, 0),
  pimInLines: players.reduce((t, p) => t + p.career.pim, 0),
  onceOnly: players.filter((p) => p.career.sessions === 1).length,
  scoreless: players.filter((p) => p.career.pts === 0).length,
  withAliases: players.filter((p) => p.aliases.length > 0).length,
};
