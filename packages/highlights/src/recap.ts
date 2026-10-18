import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchRinkGame, type Options } from "./daily.ts";
import { findGoals } from "./find.ts";
import { locateGoals, scoreline } from "./locate.ts";
import { readOverlay, type Layout } from "./overlay.ts";
import { clockRuns, type ClockRun } from "./periods.ts";
import { gameDetails, ourTeams, recordedGames, signIn, type Session } from "./rink.ts";
import { joinSegments, openStream, segmentAt, segmentFrames, type Stream } from "./stream.ts";
import { cameraFollower, chances, VIEW_FPS, VIEW_H, VIEW_W, zoneBefore, type View } from "./view.ts";

/**
 * A game recap: the game's goals, both teams', and its shots on goal, cut from
 * the recording and joined into one short video — the condensed game, a few
 * minutes long.
 *
 * The goals are the ones the search found (`locateGoals`). The shots come from
 * the board: the Rink 1 board counts shots on goal, and every time a count goes
 * up is a shot. The count goes up when its operator presses a button, a few
 * seconds after the shot; the goals measure how many, because each goal is a
 * shot too and the search knows when it went in. The chances no one counted —
 * a save the play went on after, a rush — come from where the camera looks
 * (`view.ts`), and so does which whistles were offsides and icings.
 *
 * Read only, like the search. Nothing here uploads or spends anything.
 */

export type Side = "home" | "away";
/** When a side's shots-on-goal count went up to `count`, on the recording's clock. */
export type ShotMark = { t: number; side: Side; count: number };

/** The board at the start of one segment: its clock, and its shot counts where it keeps them. */
export type Coarse = { i: number; t: number; clock: number | null; shots?: { home: number | null; away: number | null } };
/** A reading twice a second. */
export type Dense = { t: number; clock: number | null; shots?: { home: number | null; away: number | null } };
/** When the clock stopped for a whistle, and at what time. */
export type Whistle = { t: number; clock: number };

/**
 * Where the clock stopped: it ran into one segment's start and was still
 * showing the same time at the next two — a stoppage of six seconds and more,
 * long enough to be a whistle and not a misread. Returns the segment the
 * whistle is in.
 */
export function stoppages(coarse: Coarse[]): { segment: number; clock: number }[] {
  const out: { segment: number; clock: number }[] = [];
  for (let k = 2; k < coarse.length; k++) {
    const [a, b, c] = [coarse[k - 2]!, coarse[k - 1]!, coarse[k]!];
    if (a.clock === null || b.clock === null || c.clock === null) continue;
    if (b.clock === c.clock && a.clock > b.clock && a.clock - b.clock <= 8) out.push({ segment: a.i, clock: b.clock });
  }
  return out;
}

/** The moment, in readings twice a second, the clock reached `clock` and held it: the first of four readings that agree. */
export function stoppedAt(dense: Dense[], clock: number): number | null {
  const known = dense.filter((d) => d.clock !== null);
  const k = known.findIndex((d, j) => d.clock === clock && known.slice(j, j + 4).length === 4 && known.slice(j, j + 4).every((x) => x.clock === clock));
  return k >= 0 ? known[k]!.t : null;
}

/**
 * The game, read for its plays. The first frame of every segment gives the
 * clock and, on the boards that count them, the shots on goal, six seconds
 * apart. Where a count went up, or the clock stopped, those segments are read
 * twice a second for the moment.
 *
 * A shot count is believed only once a second reading agrees, and only going
 * up: a misread digit is one frame, a shot stays on the board.
 *
 * The same pass follows the camera, four frames a second, for where the play
 * was (`view.ts`): the segment is read once for both.
 */
export async function readGame(stream: Stream, layout: Layout, from: number, to: number): Promise<{ marks: ShotMark[]; whistles: Whistle[]; dense: Dense[]; coarse: Coarse[]; views: View[] }> {
  const coarse: Coarse[] = [];
  const camera = cameraFollower();
  for (let i = segmentAt(stream, from); i <= segmentAt(stream, to); i++) {
    for (const { t, frame } of await segmentFrames(stream, i, 0)) {
      const r = readOverlay(frame, layout);
      coarse.push({ i, t, clock: r.clock, ...(r.shots ? { shots: r.shots } : {}) });
    }
    for (const { t, frame } of await segmentFrames(stream, i, VIEW_FPS, [VIEW_W, VIEW_H])) camera.add(t, frame);
  }
  const denseOf = new Map<number, Dense[]>();
  const dense = async (i: number) => {
    if (!denseOf.has(i)) {
      denseOf.set(i, (await segmentFrames(stream, i, 2)).map(({ t, frame }) => {
        const r = readOverlay(frame, layout);
        return { t, clock: r.clock, ...(r.shots ? { shots: r.shots } : {}) };
      }));
    }
    return denseOf.get(i)!;
  };

  const whistles: Whistle[] = [];
  for (const s of stoppages(coarse)) {
    const t = stoppedAt([...await dense(s.segment), ...await dense(s.segment + 1)], s.clock);
    if (t !== null) whistles.push({ t, clock: s.clock });
  }

  const marks: ShotMark[] = [];
  for (const side of ["home", "away"] as const) {
    const seen = coarse.filter((r) => r.shots?.[side] !== null && r.shots?.[side] !== undefined);
    let count = 0, since = coarse[0]?.i ?? 0;
    for (let k = 0; k + 1 < seen.length; k++) {
      const v = seen[k]!.shots![side]!;
      // Up, and the next reading agrees: the count really went up, somewhere in the segments since the last one.
      if (v <= count || seen[k + 1]!.shots![side] !== v || v > count + 6) { if (v === count) since = seen[k]!.i; continue; }
      const rows: Dense[] = [];
      for (let i = since; i <= seen[k]!.i; i++) rows.push(...await dense(i));
      const known = rows.filter((d) => d.shots?.[side] !== null && d.shots?.[side] !== undefined);
      for (let c = count + 1; c <= v; c++) {
        const at = known.findIndex((d, j) => d.shots![side]! >= c && (known[j + 1]?.shots![side] ?? d.shots![side]!) >= c);
        marks.push({ t: at >= 0 ? known[at]!.t : seen[k]!.t, side, count: c });
      }
      count = v;
      since = seen[k]!.i;
    }
  }
  return { marks: marks.sort((a, b) => a.t - b.t), whistles, dense: [...denseOf.values()].flat().sort((a, b) => a.t - b.t), coarse, views: camera.views };
}

/**
 * The game clock at any moment, from the board's readings — every segment's
 * first frame, six seconds apart, and the twice-a-second ones where there are
 * some. The same time on the readings either side is a stopped clock; a lower
 * one after, by no more than the seconds between, a running one, and the
 * moment's time lies between them. Null with no readings within eight
 * seconds either side.
 */
export function boardClock(readings: { t: number; clock: number | null }[]): (t: number) => { clock: number; running: boolean } | null {
  const rows = readings.filter((r) => r.clock !== null).sort((a, b) => a.t - b.t) as { t: number; clock: number }[];
  return (t) => {
    let lo = 0, hi = rows.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid]!.t <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    const a = rows[k], b = rows[k + 1];
    if (!a || !b || t - a.t > 8 || b.t - t > 8) return null;
    const running = b.clock < a.clock && a.clock - b.clock <= b.t - a.t + 3;
    return { clock: running ? Math.max(b.clock, Math.round(a.clock - (t - a.t))) : a.clock, running };
  };
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

export type Play = { start: number; end: number; kind: "goal" | "penalty" | "shot" | "chance" | "whistle"; label: string };
/**
 * A play that is not a goal, and how much it is worth: a shot the clock
 * stopped on 3, a penalty 2.5, a shot 2, a whistle in a zone 1.5 — on 22 July
 * three in four came straight after a shot — a chance (`view.ts`) 1.2, a
 * whistle whose zone the camera could not tell 1. `lead` and `tail`, where
 * given, are how much of the play to show either side of `t`.
 */
export type Candidate = { t: number; kind: "penalty" | "shot" | "chance" | "whistle"; label: string; worth: number; lead?: number; tail?: number };

/** A goal's play: the rush, the goal, the start of the celebration. */
export const GOAL_LEAD = 10, GOAL_TAIL = 5;
/** A shot's: the chance being made, and the save or the miss. */
export const SHOT_LEAD = 6, SHOT_TAIL = 3;
/** A whistle's: the play that ended in it — a save held, a scramble, the puck out. */
export const WHISTLE_LEAD = 8, WHISTLE_TAIL = 1;
/**
 * A penalty's, from the whistle that called it: the infraction, and a delayed
 * call's play on until the offending side touched the puck. Where no whistle
 * fits, the moment the clock showed the penalty's time, with the seconds after
 * it for the whistle to come.
 */
export const PENALTY_LEAD = 15, PENALTY_TAIL = 4, PENALTY_UNTIMED_LEAD = 8, PENALTY_UNTIMED_TAIL = 12;
/** How long after the scoresheet's time its whistle may come: a delayed call is blown once the offending side touches the puck. */
export const PENALTY_DELAY = 30;
/** The longest a recap runs, title aside. */
export const MAX_SECONDS = 480;

/**
 * The plays, in order, within `budget` seconds. Every goal found is in it.
 * The rest fill it, the most worth first — a shot the clock stopped straight
 * after, a shot, a whistle — and among equals the ones furthest from any play
 * already in, so the package covers the game rather than one shift. Plays that
 * overlap or nearly touch become one, a flurry in front of a net one play.
 */
export function planRecap(goals: { t: number; label: string }[], others: Candidate[], budget = MAX_SECONDS): Play[] {
  const plays: Play[] = goals.map((g) => ({ start: g.t - GOAL_LEAD, end: g.t + GOAL_TAIL, kind: "goal", label: g.label }));
  const used = () => merge(plays).reduce((s, p) => s + p.end - p.start, 0);
  const left = [...others];
  while (left.length) {
    const near = (t: number) => Math.min(Infinity, ...plays.map((p) => Math.abs((p.start + p.end) / 2 - t)));
    left.sort((a, b) => b.worth - a.worth || near(b.t) - near(a.t));
    const c = left.shift()!;
    const [lead, tail] = c.lead !== undefined && c.tail !== undefined ? [c.lead, c.tail] : c.kind === "shot" ? [SHOT_LEAD, SHOT_TAIL] : [WHISTLE_LEAD, WHISTLE_TAIL];
    plays.push({ start: c.t - lead, end: c.t + tail, kind: c.kind, label: c.label });
    if (used() > budget) plays.pop();
  }
  return merge(plays);
}

/** Plays within two seconds of each other become one, a goal's label winning over a penalty's, a penalty's over a shot's, a shot's over a chance's. */
function merge(plays: Play[]): Play[] {
  const out: Play[] = [];
  for (const p of [...plays].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && p.start <= last.end + 2) {
      last.end = Math.max(last.end, p.end);
      const rank = { goal: 5, penalty: 4, shot: 3, chance: 2, whistle: 1 };
      if (rank[p.kind] > rank[last.kind]) { last.kind = p.kind; last.label = p.label; }
    } else out.push({ ...p });
  }
  return out;
}

/** A penalty as the scoresheet has it: "#28 John Rein Tripping (Minor) 02:00". */
export type Penalty = { period: string; time: string; team: string; detail: string };

/**
 * Where each penalty is on the recording: the whistle in its period at the
 * scoresheet's time, or up to `PENALTY_DELAY` seconds after it — the nearest
 * — and failing one, the moment the board's clock passed that time. Penalties
 * at one moment (coincidental minors, roughing both ways) are one play. The
 * scoresheet's "OT1" is whatever overtime the clock found.
 */
export function placePenalties(
  penalties: Penalty[], whistles: Whistle[], periods: ClockRun[], readings: { t: number; clock: number | null }[],
): { t: number; label: string; lead: number; tail: number }[] {
  const placed: { t: number; details: string[]; teams: Set<string>; period: string; time: string; whistle: boolean }[] = [];
  for (const p of penalties) {
    const run = periods.find((r) => r.period === p.period || (/^OT/.test(p.period) && /^OT/.test(r.period ?? "")));
    const m = /^(\d+):(\d{2})$/.exec(p.time);
    if (!run || !m) continue;
    const clock = Number(m[1]) * 60 + Number(m[2]);
    const inRun = (t: number) => t >= run.from - 10 && t <= run.to + 10;
    const w = whistles.filter((x) => inRun(x.t) && x.clock <= clock + 3 && x.clock >= clock - PENALTY_DELAY)
      .sort((a, b) => Math.abs(a.clock - clock) - Math.abs(b.clock - clock))[0];
    const passed = readings.filter((r) => r.clock !== null && inRun(r.t) && r.clock <= clock).sort((a, b) => a.t - b.t)[0];
    const t = w?.t ?? passed?.t;
    if (t === undefined) continue;
    const detail = p.detail.replace(/\s+\d{1,2}:\d{2}\s*$/, "").replace(/\s*\(Minor\)$/i, "");
    const same = placed.find((x) => Math.abs(x.t - t) < 1);
    if (same) { same.details.push(detail); same.teams.add(p.team); continue; }
    placed.push({ t, details: [detail], teams: new Set([p.team]), period: p.period, time: p.time, whistle: w !== undefined });
  }
  return placed.map((x) => ({
    t: x.t,
    label: `PENALTY  ${x.details.join(", ")}${x.teams.size === 1 ? `  ·  ${[...x.teams][0]}` : ""}  ·  ${x.period} ${x.time}`,
    lead: x.whistle ? PENALTY_LEAD : PENALTY_UNTIMED_LEAD, tail: x.whistle ? PENALTY_TAIL : PENALTY_UNTIMED_TAIL,
  }));
}

const hasAudio = (file: string) =>
  spawnSync(process.env.FFPROBE ?? "ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]).stdout.toString().trim() !== "";

/** Seconds of title card. */
const TITLE = 3;

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
    const T = TITLE;
    const inputs: string[] = [], filters: string[] = [];
    const text = (name: string, s: string) => { const f = path.join(dir, name); fs.writeFileSync(f, s); return f; };
    const draw = (file: string, size: number, y: string) =>
      `drawtext=fontfile=${FONT}:textfile=${file}:fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y}`;

    // The title card: three seconds of black with the game on it, and silence.
    inputs.push("-f", "lavfi", "-t", String(T), "-i", `color=c=black:s=${W}x${H}:r=30`, "-f", "lavfi", "-t", String(T), "-i", "anullsrc=r=48000:cl=stereo");
    filters.push(`[0:v]${title.map((line, i) => draw(text(`title${i}.txt`, line), i === 0 ? 44 : 32, `${H / 2 - 60 + i * 56}`)).join(",")},` +
      `fade=t=in:st=0:d=${FADE},fade=t=out:st=${T - FADE}:d=${FADE},format=yuv420p[v0];[1:a]anull[a0]`);

    for (const [n, p] of plays.entries()) {
      // Each play's segments as they came, trimmed in the one encode below: cutting each to a file first
      // encoded every frame twice, and doubled the time a recap took.
      const joined = path.join(dir, `play${n}.ts`);
      const from = Math.max(0, p.start), len = p.end - from;
      const offset = await joinSegments(best, from, len, joined);
      const k = n + 1, idx = 2 + n;
      inputs.push("-i", joined);
      filters.push(`[${idx}:v]trim=start=${offset.toFixed(3)}:duration=${len.toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H},fps=30,` +
        // A long label — two penalties at once — a size down, so it stays on the picture.
        `drawbox=x=0:y=${H - 70}:w=${W}:h=70:color=black@0.55:t=fill,${draw(text(`label${n}.txt`, p.label), p.label.length > 70 ? 22 : 28, `${H - (p.label.length > 70 ? 48 : 52)}`)},` +
        `fade=t=in:st=0:d=${FADE},fade=t=out:st=${(len - FADE).toFixed(2)}:d=${FADE},format=yuv420p[v${k}];` +
        // The rink's sound where the recording has it; silence of the same length where it has none.
        (hasAudio(joined)
          ? `[${idx}:a]atrim=start=${offset.toFixed(3)}:duration=${len.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,`
          : `anullsrc=r=48000:cl=stereo,atrim=duration=${len.toFixed(3)},`) +
        `afade=t=in:st=0:d=${FADE},afade=t=out:st=${(len - FADE).toFixed(2)}:d=${FADE}[a${k}]`);
    }
    const n = plays.length + 1;
    filters.push(`${Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[v][a]`);
    const r = spawnSync(process.env.FFMPEG ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...inputs, "-filter_complex", filters.join(";"),
      // "faster", not the goal clips' "slow": a recap is minutes long, and on the job's two cores "slow" took twice the time for the same
      // size. A notch lighter than a clip, too: eight minutes at 23 was 115 MB.
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "faster", "-crf", "24", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out,
    ], { maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`recap render failed: ${r.stderr.toString().slice(-600)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Where the game runs on the recording, so shots are read inside it only: the
 * last game's count is still up as the recording opens. A game that went to
 * overtime is read on past the 3rd, for it.
 */
const gameSpan = (periods: ClockRun[], overtime: boolean) => ({ from: periods[0]!.from - 60, to: periods.at(-1)!.to + (overtime ? 900 : 180) });

/**
 * The overtime of a game the scoresheet says had one, when the goal search did
 * not need it — no goal was scored in it: the first stretch of the clock
 * running down, a minute and more from ten minutes at most, that starts
 * within six minutes of the last period's end, read from the board every six
 * seconds. On 2026-10-15 the board's label called both the 3rd and the
 * overtime "OT2" (`periods.ts`), so the clock is the only witness.
 */
export function overtimeOf(coarse: { t: number; clock: number | null }[], last: ClockRun): ClockRun | null {
  // Running: the board sits at 0:00 for a while after a period, and that is no overtime.
  const run = clockRuns(coarse.filter((c) => c.t > last.to + 20)).find((r) => r.from - last.to <= 360 && r.samples >= 3 && r.first <= 600 && r.first - r.last >= 60);
  return run ? { ...run, period: "OT" } : null;
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

type RecapGame = Options["games"][number] & { homeScore?: string | number | null; awayScore?: string | number | null; ot?: boolean; penalties?: Penalty[] };

/** What a recap holds, for the page: how long, and of what. */
export type RecapSummary = { seconds: number; goals: number; of: number; penalties: number; shots: number; chances: number; whistles: number; edition: number };

/**
 * Which way of making a recap a recap was made by. A recap of an earlier
 * edition is made again, as one of a corrected scoresheet is. 2: chances
 * from where the camera looks, no whistles from the neutral zone, and the
 * penalties.
 */
export const RECAP_EDITION = 2;

/**
 * A recap leaves out no more than a quarter of the game's goals: one that
 * skipped most of the scoring would say the game went differently than it did.
 */
export const RECAP_SHARE = 0.75;

/**
 * One game's recap, to `out` and its poster to `poster`: its recording searched
 * for its goals, read for its shots and whistles, planned to `budget` seconds
 * and rendered. A summary — or why there is none, for a game this cannot make
 * a fair recap of. A throw is something that broke, for another run to try.
 * Says what it did through `log`, never the recording's address.
 */
export async function recapGame(o: {
  game: RecapGame;
  session: Session;
  rinkGame: number;
  out: string;
  poster: string;
  budget: number;
  log: (line: string) => void;
}): Promise<RecapSummary | string> {
  const { game } = o;
  const d = await gameDetails(o.session, o.rinkGame);
  // Not posted yet, or still growing: for a later run, not a reason there is none.
  if (d.live || !d.streamUrl) throw new Error("no recording on the rink's video site yet");
  const stream = await openStream(d.streamUrl);
  if (!stream.ended) throw new Error("the recording is not finished yet");
  const found = await findGoals(stream, game.goals, game.home, game.away);
  if ("problem" in found) return found.problem;
  const located = locateGoals(found.readings, game.goals, game.home, game.away);
  const goals = located.goals.filter((g) => g.t !== null && g.confirmed);
  o.log(`${goals.length} of ${game.goals.length} goals found, board ${found.layout.name}`);
  if (goals.length < game.goals.length * RECAP_SHARE) return `only ${goals.length} of its ${game.goals.length} goals could be found`;

  const regulation = !found.periods.some((p) => /^OT/.test(p.period ?? ""));
  const span = gameSpan(found.periods, game.ot === true && regulation);
  const { marks, whistles, dense, coarse, views } = await readGame(stream, found.layout, span.from, span.to);
  const overtime = game.ot === true && regulation ? overtimeOf(coarse, found.periods.at(-1)!) : null;
  if (overtime) o.log(`overtime read from the clock, ${Math.round(overtime.from)}s to ${Math.round(overtime.to)}s`);
  const periods = overtime ? [...found.periods, overtime] : found.periods;
  const sideOf = (team: string): Side => (team === game.home ? "home" : "away");
  const lag = shotLag(goals.map((g) => ({ t: g.t!, side: sideOf(g.goal.team) })), marks) ?? 2;
  if (found.layout.fields.homeShots) {
    o.log(`${marks.filter((m) => m.side === "home").length} shots for ${game.home}, ${marks.filter((m) => m.side === "away").length} for ${game.away}; the board puts a shot up ${lag.toFixed(1)}s after it`);
  }
  const seen = views.filter((v) => v.seen).length;
  o.log(`${whistles.length} whistles; the camera's zone read on ${views.length ? Math.round((seen / views.length) * 100) : 0}% of ${views.length} frames`);

  // "2nd 11:38": where a moment is in the game, by the clock-read periods and the nearest reading of the clock.
  const clockAt = boardClock([...coarse, ...dense]);
  const when = (t: number) => {
    // The period the moment is in; else one it is a couple of minutes from — an overtime starts that soon after the 3rd ends.
    const period = (periods.find((p) => t >= p.from && t <= p.to) ?? periods.find((p) => t >= p.from - 130 && t <= p.to + 130))?.period;
    const c = clockAt(t)?.clock;
    return period && c !== undefined ? `${period} ${Math.floor(c / 60)}:${String(c % 60).padStart(2, "0")}` : period ?? "";
  };
  // A goal is a shot and a whistle too: those are the goal, already in.
  const nearGoal = (t: number) => goals.some((g) => t >= g.t! - 4 && t <= g.t! + 15);
  // Only plays of the game: a warm-up's countdown running out, or the last game's end, is no whistle of ours.
  const inGame = (t: number) => periods.some((p) => t >= p.from - 30 && t <= p.to + 130);
  // A chance needs the clock running: the camera swings and settles in a zone between periods, and on a faceoff dot through a stoppage.
  const inPlay = (t: number) => periods.some((p) => t >= p.from && t <= p.to) && clockAt(t)?.running !== false;
  const shots: Candidate[] = marks.map((m) => ({ t: m.t - lag, side: m.side })).filter((m) => inGame(m.t) && !nearGoal(m.t)).map((m) => {
    const held = whistles.some((w) => w.t >= m.t && w.t <= m.t + 6);
    return { t: m.t, kind: "shot", worth: held ? 3 : 2, label: `Shot  ·  ${m.side === "home" ? game.home : game.away}  ·  ${when(m.t)}` };
  });
  // A whistle a shot already explains is that shot's.
  // A clock run down to 0:00 is the end of a period, not a whistle.
  // A whistle in the neutral zone is an offside or an icing: no chance in it.
  const kept = whistles.filter((w) => w.clock > 0 && inGame(w.t) && !nearGoal(w.t) && !shots.some((x) => w.t >= x.t && w.t <= x.t + 6))
    .map((w) => ({ ...w, zone: zoneBefore(views, w.t) }));
  const stopped = kept.filter((w) => w.zone !== "neutral");
  const chancesFound = chances(views, inPlay).filter((c) => !nearGoal(c.t) && !shots.some((x) => Math.abs(x.t - c.t) <= 6));
  o.log(`${kept.length - stopped.length} whistles in the neutral zone left out; ${chancesFound.filter((c) => c.kind === "rush").length} rushes, ${chancesFound.filter((c) => c.kind === "pressure").length} spells of pressure`);
  const penalties = placePenalties(game.penalties ?? [], whistles, periods, [...coarse, ...dense]);
  if (game.penalties?.length) o.log(`${penalties.length} of ${game.penalties.length} penalties placed`);
  const others: Candidate[] = [
    ...penalties.map((p) => ({ ...p, kind: "penalty" as const, worth: 2.5 })),
    ...shots,
    ...stopped.map((w) => ({ t: w.t, kind: "whistle" as const, worth: w.zone ? 1.5 : 1, label: when(w.t) })),
    // All worth the same: a longer swing or spell was no likelier to hold a shot, and equals are spread over the game.
    ...chancesFound.map((c) => ({ t: c.t, kind: "chance" as const, worth: 1.2, lead: c.lead, tail: c.tail, label: `Chance  ·  ${when(c.t)}` })),
  ];
  const scores = scoreline(game.goals, game.home, game.away);
  const plays = planRecap(
    goals.map((g) => {
      const after = scores[g.index]!;
      const helpers = g.goal.assists.length ? ` (${g.goal.assists.join(", ")})` : "";
      return { t: g.t!, label: `GOAL  ${g.goal.scorer}${helpers}  ·  ${g.goal.period} ${g.goal.time}  ·  ${after.away}–${after.home}` };
    }),
    others,
    o.budget,
  );
  const seconds = plays.reduce((n, p) => n + p.end - p.start, 0);
  o.log(`${plays.filter((p) => p.kind === "goal").length} goal plays, ${plays.filter((p) => p.kind === "penalty").length} penalties, ${plays.filter((p) => p.kind === "shot").length} shots, ${plays.filter((p) => p.kind === "chance").length} chances, ${plays.filter((p) => p.kind === "whistle").length} whistles: ${Math.round(seconds)}s`);
  o.log(`chances in it: ${plays.filter((p) => p.kind === "chance").map((p) => p.label.replace(/^Chance\s+·\s+/, "")).join(", ") || "none"}`);

  const best = await openStream(d.streamUrl, "best");
  const final = game.homeScore !== undefined && game.homeScore !== null ? `  ·  Final ${game.awayScore}–${game.homeScore}` : "";
  await renderRecap(best, plays, [`${game.away} at ${game.home}`, `${DAY.format(new Date(`${game.date}T00:00:00Z`))}${final}`], o.out);

  // The poster: a moment before the first goal, where the rendered recap has it — never the title card.
  const first = plays.findIndex((p) => p.kind === "goal");
  const at = first < 0 ? TITLE + 1 : TITLE + plays.slice(0, first).reduce((n, p) => n + p.end - p.start, 0) + Math.max(0, plays[first]!.end - GOAL_TAIL - plays[first]!.start - 2);
  const r = spawnSync(process.env.FFMPEG ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", at.toFixed(2), "-i", o.out, "-frames:v", "1", "-q:v", "4", o.poster]);
  if (r.status !== 0) throw new Error(`recap poster failed: ${r.stderr.toString().slice(-300)}`);
  return {
    seconds: Math.round(TITLE + seconds), goals: goals.length, of: game.goals.length, penalties: plays.filter((p) => p.kind === "penalty").length,
    shots: plays.filter((p) => p.kind === "shot").length, chances: plays.filter((p) => p.kind === "chance").length,
    whistles: plays.filter((p) => p.kind === "whistle").length, edition: RECAP_EDITION,
  };
}

/** For a person at the command line: sign in, find the game on the rink's site, and make its recap. */
export async function recapFromSite(o: Omit<Parameters<typeof recapGame>[0], "session" | "rinkGame"> & { credentials: Options["credentials"] }): Promise<RecapSummary | string> {
  const session = await signIn(o.credentials().email, o.credentials().password);
  const hit = matchRinkGame(o.game, await recordedGames(await ourTeams(), o.game.date));
  if (!hit) return "not on the rink's video site";
  return recapGame({ ...o, session, rinkGame: hit.id });
}
