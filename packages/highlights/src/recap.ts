import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchRinkGame, type Options } from "./daily.ts";
import { findGoals } from "./find.ts";
import { locateGoals, scoreline, type Reading } from "./locate.ts";
import { readOverlay, type Layout } from "./overlay.ts";
import type { ClockRun } from "./periods.ts";
import { gameDetails, ourTeams, recordedGames, signIn } from "./rink.ts";
import { cutClip, openStream, segmentAt, segmentFrames, type Stream } from "./stream.ts";

/**
 * A game recap: the game's goals, both teams', and its shots on goal, cut from
 * the recording and joined into one short video — the condensed game, a few
 * minutes long.
 *
 * The goals are the ones the search found (`locateGoals`). The shots come from
 * the board: the Rink 1 board counts shots on goal, and every time a count goes
 * up is a shot. The count goes up when its operator presses a button, a few
 * seconds after the shot; the goals measure how many, because each goal is a
 * shot too and the search knows when it went in.
 *
 * Read only, like the search. Nothing here uploads or spends anything.
 */

export type Side = "home" | "away";
/** When a side's shots-on-goal count went up to `count`, on the recording's clock. */
export type ShotMark = { t: number; side: Side; count: number };

/**
 * Every shot on goal in the game, by when the board's count went up. The first
 * frame of every segment gives the counts six seconds apart; where one went up,
 * those segments are read twice a second for the moment. A count is believed
 * only once a second reading agrees, and only going up: a misread digit is one
 * frame, a shot stays on the board.
 */
export async function shotMarks(stream: Stream, layout: Layout, from: number, to: number): Promise<{ marks: ShotMark[]; clock: { t: number; clock: number | null }[] }> {
  const clock: { t: number; clock: number | null }[] = [];
  if (!layout.fields.homeShots) return { marks: [], clock };
  const read = async (i: number, perSecond: number) => (await segmentFrames(stream, i, perSecond)).map(({ t, frame }) => {
    const r = readOverlay(frame, layout);
    if (perSecond) clock.push({ t, clock: r.clock });
    return { t, shots: r.shots! };
  });
  const first = segmentAt(stream, from), last = segmentAt(stream, to);
  const coarse: { i: number; t: number; shots: { home: number | null; away: number | null } }[] = [];
  for (let i = first; i <= last; i++) coarse.push(...(await read(i, 0)).map((r) => ({ i, ...r })));

  const out: ShotMark[] = [];
  for (const side of ["home", "away"] as const) {
    const seen = coarse.filter((r) => r.shots[side] !== null);
    let count = 0, since = first;
    for (let k = 0; k + 1 < seen.length; k++) {
      const v = seen[k]!.shots[side]!;
      // Up, and the next reading agrees: the count really went up, somewhere in the segments since the last one.
      if (v <= count || seen[k + 1]!.shots[side] !== v || v > count + 6) { if (v === count) since = seen[k]!.i; continue; }
      const dense: { t: number; v: number | null }[] = [];
      for (let i = since; i <= seen[k]!.i; i++) dense.push(...(await read(i, 2)).map((r) => ({ t: r.t, v: r.shots[side] })));
      for (let c = count + 1; c <= v; c++) {
        const known = dense.filter((d) => d.v !== null);
        const at = known.findIndex((d, j) => d.v! >= c && (known[j + 1]?.v ?? d.v!) >= c);
        out.push({ t: at >= 0 ? known[at]!.t : seen[k]!.t, side, count: c });
      }
      count = v;
      since = seen[k]!.i;
    }
  }
  return { marks: out.sort((a, b) => a.t - b.t), clock: clock.sort((a, b) => a.t - b.t) };
}

/**
 * How long after a shot its operator puts it on the board: for each goal the
 * search found, the first rise in the scoring side's count from the goal on.
 * The middle of those, so one late press does not move every shot.
 */
export function shotLag(goals: { t: number; side: Side }[], marks: ShotMark[]): number | null {
  const lags = goals.flatMap((g) => {
    const m = marks.find((x) => x.side === g.side && x.t >= g.t - 2 && x.t <= g.t + 60);
    return m ? [m.t - g.t] : [];
  }).sort((a, b) => a - b);
  return lags.length ? lags[lags.length >> 1]! : null;
}

export type Play = { start: number; end: number; kind: "goal" | "shot"; label: string };

/** A goal's play: the rush, the goal, the start of the celebration. */
export const GOAL_LEAD = 10, GOAL_TAIL = 5;
/** A shot's: the chance being made, and the save or the miss. */
export const SHOT_LEAD = 6, SHOT_TAIL = 3;

/**
 * The plays, in order, within `budget` seconds. Every goal found is in it; shots
 * fill the rest, the ones the clock stopped straight after first — a save held,
 * a scramble whistled dead — then the ones furthest from any play already in,
 * so the package covers the game rather than one shift. Plays that overlap or
 * nearly touch become one.
 */
export function planRecap(
  goals: { t: number; label: string }[], shots: { t: number; label: string; stopped: boolean }[], budget: number,
): Play[] {
  const plays: Play[] = goals.map((g) => ({ start: g.t - GOAL_LEAD, end: g.t + GOAL_TAIL, kind: "goal", label: g.label }));
  const used = () => merge(plays).reduce((s, p) => s + p.end - p.start, 0);
  const left = [...shots];
  while (left.length) {
    const near = (t: number) => Math.min(Infinity, ...plays.map((p) => Math.abs((p.start + p.end) / 2 - t)));
    left.sort((a, b) => Number(b.stopped) - Number(a.stopped) || near(b.t) - near(a.t));
    const s = left.shift()!;
    const play: Play = { start: s.t - SHOT_LEAD, end: s.t + SHOT_TAIL, kind: "shot", label: s.label };
    plays.push(play);
    if (used() > budget) { plays.pop(); break; }
  }
  return merge(plays);
}

/** Plays within two seconds of each other become one, a goal's label winning over a shot's. */
function merge(plays: Play[]): Play[] {
  const out: Play[] = [];
  for (const p of [...plays].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && p.start <= last.end + 2) {
      last.end = Math.max(last.end, p.end);
      if (p.kind === "goal" && last.kind === "shot") { last.kind = "goal"; last.label = p.label; }
    } else out.push({ ...p });
  }
  return out;
}

/** Did the clock stop within `seconds` after `t`? Two readings a second apart showing one time, in the readings there are. */
export function stoppedAfter(readings: Pick<Reading, "t" | "clock">[], t: number, seconds = 5): boolean {
  const near = readings.filter((r) => r.t >= t && r.t <= t + seconds && r.clock !== null);
  return near.some((r, i) => near.slice(i + 1).some((x) => x.t - r.t >= 1.5 && x.clock === r.clock));
}

const FONT = process.env.RECAP_FONT ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/**
 * The recap itself: a title card, then each play cut from the recording, its
 * label along the bottom, a quick fade between them. 720p at 30 fps, as the
 * goal clips are. Labels go through text files, never the command line, so a
 * name with a colon or a quote in it cannot break the filter.
 */
export async function renderRecap(best: Stream, plays: Play[], title: string[], out: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grh-recap-"));
  try {
    const W = 1280, H = 720, FADE = 0.3;
    const inputs: string[] = [], filters: string[] = [];
    const text = (name: string, s: string) => { const f = path.join(dir, name); fs.writeFileSync(f, s); return f; };
    const draw = (file: string, size: number, y: string) =>
      `drawtext=fontfile=${FONT}:textfile=${file}:fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y}`;

    // The title card: three seconds of black with the game on it, and silence.
    inputs.push("-f", "lavfi", "-t", "3", "-i", `color=c=black:s=${W}x${H}:r=30`, "-f", "lavfi", "-t", "3", "-i", "anullsrc=r=48000:cl=stereo");
    filters.push(`[0:v]${title.map((line, i) => draw(text(`title${i}.txt`, line), i === 0 ? 44 : 32, `${H / 2 - 60 + i * 56}`)).join(",")},` +
      `fade=t=in:st=0:d=${FADE},fade=t=out:st=${3 - FADE}:d=${FADE},format=yuv420p[v0];[1:a]anull[a0]`);

    for (const [n, p] of plays.entries()) {
      const clip = path.join(dir, `play${n}.mp4`);
      await cutClip(best, Math.max(0, p.start), p.end - Math.max(0, p.start), clip);
      const k = n + 1, idx = 2 + n, len = p.end - Math.max(0, p.start);
      inputs.push("-i", clip);
      filters.push(`[${idx}:v]scale=${W}:${H},fps=30,` +
        `drawbox=x=0:y=${H - 70}:w=${W}:h=70:color=black@0.55:t=fill,${draw(text(`label${n}.txt`, p.label), 28, `${H - 52}`)},` +
        `fade=t=in:st=0:d=${FADE},fade=t=out:st=${(len - FADE).toFixed(2)}:d=${FADE},format=yuv420p[v${k}];` +
        `[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=${FADE},afade=t=out:st=${(len - FADE).toFixed(2)}:d=${FADE}[a${k}]`);
    }
    const n = plays.length + 1;
    filters.push(`${Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[v][a]`);
    const r = spawnSync(process.env.FFMPEG ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...inputs, "-filter_complex", filters.join(";"),
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out,
    ], { maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`recap render failed: ${r.stderr.toString().slice(-600)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Where the game runs on the recording, so shots are read inside it only: the last game's count is still up as the recording opens. */
const gameSpan = (periods: ClockRun[]) => ({ from: periods[0]!.from - 60, to: periods.at(-1)!.to + 180 });

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * One game's recap, to `out`: found on the rink's site, searched for its goals,
 * read for its shots, planned to `budget` seconds and rendered. Says what it
 * did through `log`, never the recording's address.
 */
export async function recapGame(o: {
  game: Options["games"][number] & { homeScore?: string | number; awayScore?: string | number };
  credentials: Options["credentials"];
  out: string;
  budget: number;
  log: (line: string) => void;
}): Promise<void> {
  const { game } = o;
  const s = await signIn(o.credentials().email, o.credentials().password);
  const hit = matchRinkGame(game, await recordedGames(await ourTeams(), game.date));
  if (!hit) throw new Error(`game ${game.id} is not on the rink's video site`);
  const d = await gameDetails(s, hit.id);
  if (d.live || !d.streamUrl) throw new Error(`game ${game.id} has no recording`);
  const stream = await openStream(d.streamUrl);
  const found = await findGoals(stream, game.goals, game.home, game.away);
  if ("problem" in found) throw new Error(found.problem);
  const located = locateGoals(found.readings, game.goals, game.home, game.away);
  const goals = located.goals.filter((g) => g.t !== null && g.confirmed);
  o.log(`${goals.length} of ${game.goals.length} goals found, board ${found.layout.name}`);

  const span = gameSpan(found.periods);
  const { marks, clock } = await shotMarks(stream, found.layout, span.from, span.to);
  const sideOf = (team: string): Side => (team === game.home ? "home" : "away");
  const lag = shotLag(goals.map((g) => ({ t: g.t!, side: sideOf(g.goal.team) })), marks) ?? 3;
  o.log(`${marks.filter((m) => m.side === "home").length} shots for ${game.home}, ${marks.filter((m) => m.side === "away").length} for ${game.away}; the board puts a shot up ${lag.toFixed(1)}s after it`);

  // A goal is a shot too: the count's rise for it is the goal, already in.
  const isGoal = (m: ShotMark) => goals.some((g) => sideOf(g.goal.team) === m.side && m.t - lag >= g.t! - 4 && m.t - lag <= g.t! + 8);
  const scores = scoreline(game.goals, game.home, game.away);
  const plays = planRecap(
    goals.map((g) => {
      const after = scores[g.index]!;
      const helpers = g.goal.assists.length ? ` (${g.goal.assists.join(", ")})` : "";
      return { t: g.t!, label: `GOAL  ${g.goal.scorer}${helpers}  ·  ${g.goal.period} ${g.goal.time}  ·  ${after.away}–${after.home}` };
    }),
    marks.filter((m) => !isGoal(m)).map((m) => ({
      t: m.t - lag, stopped: stoppedAfter(clock, m.t - lag),
      label: `Shot  ·  ${m.side === "home" ? game.home : game.away}`,
    })),
    o.budget,
  );
  const seconds = plays.reduce((n, p) => n + p.end - p.start, 0);
  o.log(`${plays.filter((p) => p.kind === "goal").length} goal plays and ${plays.filter((p) => p.kind === "shot").length} shots, ${Math.round(seconds)}s`);

  const best = await openStream(d.streamUrl, "best");
  const final = game.homeScore !== undefined ? `  ·  Final ${game.awayScore}–${game.homeScore}` : "";
  await renderRecap(best, plays, [`${game.away} at ${game.home}`, `${DAY.format(new Date(`${game.date}T00:00:00Z`))}${final}`], o.out);
}
