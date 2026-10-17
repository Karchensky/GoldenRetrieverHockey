import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseLayout, duration, encodeForWeb, readClip, verifyClip } from "./clip.ts";
import { findGoals } from "./find.ts";
import { locateGoals, scoreline, type LocatedGoal, type ScoredGoal } from "./locate.ts";
import { loadLayouts } from "./overlay.ts";
import {
  CLIP_MAX, clipsCredit, createMoment, gameDetails, myMoments, ourTeams, recordedGames, requestDownload, signIn,
  type Moment, type RinkGame, type Session,
} from "./rink.ts";
import { openStream } from "./stream.ts";

/**
 * The daily job: every game of ours from `since` on, each of OUR goals clipped
 * from the rink's recording and put beside its line on the box score.
 *
 *   find the game on the rink's platform -> read its recording for the goals
 *   -> mark a clip of each of ours -> ask the rink to render it (ONE CREDIT)
 *   -> fetch it when ready -> check it is that goal -> encode -> R2 -> highlights.json
 *
 * The ledger (`ledger.json`, committed) is what the job knows between runs:
 * which rink game a box score is, and each clip's mark and where it got to. It
 * is not what stops a credit being spent twice, though — the account is: before
 * asking for a download the job looks for a clip of its own at that time, and a
 * clip that already has a download is used, never asked for again. A run that
 * dies halfway cannot double-spend.
 *
 * Nothing is clipped that is not ours, and nothing is asked for unless the goal
 * was found and its score change seen on the board. A goal it cannot pin down
 * is reported and left alone — a credit spent on the wrong goal is gone.
 */

export const LEAD = 15, TAIL = 8;

export type ClipEntry = {
  /** Scoresheet indices of the goals it shows: ours, from 0. */
  goals: number[];
  /** Each of those goals as it was when planned — "1st 06:42" — checked again before a credit is spent. */
  labels?: string[];
  start: number;
  seconds: number;
  moment: string | null;
  status: "queued" | "requested" | "published" | "failed";
  problem?: string;
};
export type GameEntry = {
  rinkGame: number | null;
  board?: string;
  clips: ClipEntry[];
  problem?: string;
  /** Published clips a corrected scoresheet no longer has a goal for, already reported. */
  stale?: string[];
};
export type Ledger = Record<string, GameEntry>;
export type Highlight = { goal: number; period: string; time: string; scorer: string; clip: string; poster: string; seconds: number };
export type Highlights = Record<string, Highlight[]>;

type SiteGame = { id: string; date: string; time: string | null; rink: string | null; status: string; gr: "home" | "away" | null; home: string; away: string; goals: ScoredGoal[] };

export type Options = {
  since: string;
  games: SiteGame[];
  ledger: Ledger;
  highlights: Highlights;
  credentials: () => { email: string; password: string };
  /** Put a finished file where the site serves it. */
  upload: (key: string, file: string, contentType: string) => void;
  /** How long one run waits for the rink to render, before leaving the rest for tomorrow. */
  waitMinutes: number;
  /** Plan and report; spend nothing, upload nothing. */
  dryRun: boolean;
  log: (line: string) => void;
};

export type Report = { published: number; requested: number; queued: number; problems: string[]; nothingToDo: boolean };

const us = (g: SiteGame) => (g.gr === "home" ? g.home : g.away);

/**
 * Windows around our located goals. Credits are what is scarce, so two of ours
 * share one clip whenever that clip stays within the rink's minute — even with a
 * gap between them that a clip of each would not have shown.
 */
export function planClips(goals: LocatedGoal[], ours: Set<number>, lead = LEAD, tail = TAIL): { goals: number[]; start: number; seconds: number }[] {
  const placed = goals.filter((g) => ours.has(g.index) && g.t !== null && g.confirmed).sort((a, b) => a.t! - b.t!);
  const out: { goals: number[]; start: number; seconds: number }[] = [];
  for (const g of placed) {
    const start = Math.max(0, g.t! - lead), end = g.t! + tail, last = out.at(-1);
    if (last && end - last.start <= CLIP_MAX) {
      last.seconds = Math.round((end - last.start) * 10) / 10;
      last.goals.push(g.index);
    } else {
      out.push({ goals: [g.index], start: Math.round(start * 10) / 10, seconds: lead + tail });
    }
  }
  return out;
}

/** The account's clip at this start and length, if one was already marked. */
const sameClip = (m: Moment, c: { start: number; seconds: number }) => Math.abs(m.startSec - c.start) < 0.6 && Math.abs(m.durationSec - c.seconds) < 0.6;

export function matchRinkGame(game: SiteGame, rinkGames: RinkGame[]): RinkGame | null {
  const hits = rinkGames.filter((r) => r.date === game.date && r.time === game.time && (!game.rink || r.rink === game.rink));
  return hits.length === 1 ? hits[0]! : null;
}

const goalLabel = (g: ScoredGoal) => `${g.period} ${g.time}`;
const ourGoals = (g: SiteGame) => g.goals.map((x, n) => ({ x, n })).filter(({ x }) => x.team === us(g)).map(({ n }) => n);
/** A goal is done when a clip is shown beside it: the page finds a clip by the goal's period and time. */
const done = (o: Pick<Options, "highlights">, g: SiteGame, n: number) =>
  (o.highlights[g.id] ?? []).some((h) => h.period === g.goals[n]!.period && h.time === g.goals[n]!.time);
/** Published clips beside no goal of ours any more — a scoresheet corrected since — not yet reported. */
const staleClips = (o: Pick<Options, "highlights" | "ledger">, g: SiteGame) =>
  (o.highlights[g.id] ?? []).filter((h) =>
    !g.goals.some((x) => x.team === us(g) && x.period === h.period && x.time === h.time) && !(o.ledger[g.id]?.stale ?? []).includes(h.clip));

/**
 * Goals of a planned clip that the scoresheet no longer has where they were
 * found — corrected since, a goal added or a time fixed — or that are not ours.
 * A credit is only ever spent on a clip for which this is empty.
 */
export function movedSincePlanned(game: SiteGame, clip: Pick<ClipEntry, "goals" | "labels">): number[] {
  return clip.goals.filter((n, i) => game.goals[n]?.team !== us(game) || (clip.labels !== undefined && goalLabel(game.goals[n]!) !== clip.labels[i]));
}

/**
 * The games with something to do, from the files alone: no sign-in, no network,
 * nothing installed. Most days it is none, and the workflow stops there.
 */
export function gamesWithWork(o: Pick<Options, "since" | "games" | "ledger" | "highlights">): SiteGame[] {
  // A game whose goals could not be pinned down is not searched again — that was reported
  // once, and is for a person to look at — but clips already found for it still go ahead.
  const unlocated = (g: SiteGame) => {
    const covered = new Set((o.ledger[g.id]?.clips ?? []).flatMap((c) => c.goals));
    return !o.ledger[g.id]?.problem && ourGoals(g).some((n) => !done(o, g, n) && !covered.has(n));
  };
  const waiting = (g: SiteGame) => (o.ledger[g.id]?.clips ?? []).some((c) => c.status === "queued" || c.status === "requested");
  return o.games.filter((g) => g.date >= o.since && g.status === "Final" && g.goals.length > 0 && (unlocated(g) || waiting(g) || staleClips(o, g).length > 0));
}

export async function daily(o: Options): Promise<Report> {
  const report: Report = { published: 0, requested: 0, queued: 0, problems: [], nothingToDo: false };
  const todo = gamesWithWork(o);
  if (!todo.length) { report.nothingToDo = true; return report; }

  // Reported once each, and never undone by the job: a person decides what the clip should be beside.
  for (const game of todo) {
    for (const h of staleClips(o, game)) {
      report.problems.push(`${game.date} ${game.away} at ${game.home} (${game.id}): clip ${h.clip} (${h.period} ${h.time}, ${h.scorer}) matches no goal of ours on the corrected scoresheet, so it is not shown`);
      const entry = (o.ledger[game.id] ??= { rinkGame: null, clips: [] });
      (entry.stale ??= []).push(h.clip);
    }
  }

  let session: Session | null = null;
  const signedIn = async () => (session ??= await signIn(o.credentials().email, o.credentials().password));
  let rinkGames: RinkGame[] | null = null;

  for (const game of todo) {
    const label = `${game.date} ${game.away} at ${game.home} (${game.id})`;
    const entry = (o.ledger[game.id] ??= { rinkGame: null, clips: [] });
    const s = await signedIn();

    if (entry.rinkGame === null) {
      rinkGames ??= await recordedGames(await ourTeams(), o.since);
      const hit = matchRinkGame(game, rinkGames);
      if (!hit) { o.log(`${label}: not on the rink's site yet`); continue; }
      entry.rinkGame = hit.id;
    }
    const rink = entry.rinkGame;

    // Locate every goal of ours that has no clip yet.
    const mine = new Set(ourGoals(game));
    const covered = new Set(entry.clips.flatMap((c) => c.goals));
    const missing = [...mine].filter((n) => !covered.has(n) && !done(o, game, n));
    if (missing.length && !entry.problem) {
      const details = await gameDetails(s, rink);
      if (details.live || !details.streamUrl) { o.log(`${label}: no recording yet`); continue; }
      const stream = await openStream(details.streamUrl);
      const found = await findGoals(stream, game.goals, game.home, game.away);
      if ("problem" in found) {
        entry.problem = found.problem;
        report.problems.push(`${label}: ${found.problem}`);
        continue;
      }
      entry.board = found.layout.name;
      const located = locateGoals(found.readings, game.goals, game.home, game.away);
      o.log(`${label}: read ${found.fetched.segments} of ${stream.segments.length} segments of the recording, board ${found.layout.name}`);
      const unsure = located.goals.filter((g) => missing.includes(g.index) && !(g.t !== null && g.confirmed));
      for (const g of unsure) {
        const p = `${g.goal.period} ${g.goal.time} ${g.goal.scorer}: ${g.problem ?? "not found"}`;
        report.problems.push(`${label}: ${p}`);
        entry.problem = entry.problem ? `${entry.problem}; ${p}` : p;
      }
      const wanted = new Set(missing.filter((n) => !unsure.some((g) => g.index === n)));
      for (const c of planClips(located.goals, wanted)) entry.clips.push({ ...c, labels: c.goals.map((n) => goalLabel(game.goals[n]!)), moment: null, status: "queued" });
    }

    // Mark and ask for every queued clip there is a credit for.
    const queued = entry.clips.filter((c) => c.status === "queued");
    if (queued.length) {
      const existing = await myMoments(s, rink);
      let credit = o.dryRun ? queued.length : await clipsCredit(s);
      for (const c of queued) {
        // The scoresheet may have been corrected since this was planned: a credit is only ever
        // spent on a goal that is still ours, still where it was found.
        const moved = movedSincePlanned(game, c);
        if (moved.length) {
          c.status = "failed";
          c.problem = `the scoresheet changed since goal ${moved.join(",")} was found — nothing spent`;
          report.problems.push(`${label}: ${c.problem}`);
          continue;
        }
        let m = existing.find((x) => sameClip(x, c)) ?? null;
        if (m?.download) { c.moment = m.id; c.status = "requested"; continue; }
        if (credit <= 0) { report.queued++; o.log(`${label}: no download credit left — goal ${c.goals.join(",")} waits for next month's`); continue; }
        if (o.dryRun) { o.log(`${label}: would clip ${c.start}s +${c.seconds}s for goal ${c.goals.join(",")}`); continue; }
        m ??= await createMoment(s, rink, c.start, c.seconds);
        c.moment = m.id;
        await requestDownload(s, m.id);
        credit--;
        c.status = "requested";
        report.requested++;
        o.log(`${label}: asked the rink for the clip of goal ${c.goals.join(",")} (${credit} credits left)`);
      }
    }
  }

  // Fetch, check and publish whatever the rink has rendered — waiting a while for what it has not.
  const deadline = Date.now() + o.waitMinutes * 60_000;
  for (;;) {
    let pending = 0;
    for (const game of o.games) {
      const entry = o.ledger[game.id];
      if (!entry || entry.rinkGame === null) continue;
      const requested = entry.clips.filter((c) => c.status === "requested");
      if (!requested.length || o.dryRun) continue;
      const label = `${game.date} ${game.away} at ${game.home} (${game.id})`;
      const moments = await myMoments(await signedIn(), entry.rinkGame);
      for (const c of requested) {
        const m = moments.find((x) => x.id === c.moment);
        if (!m?.download) { c.status = "failed"; c.problem = "the rink has no download for this clip"; report.problems.push(`${label}: ${c.problem}`); continue; }
        if (m.download.status !== "COMPLETE" || !m.download.url) { pending++; continue; }
        const r = await publish(game, c, m.download.url, o);
        if (r === true) { c.status = "published"; report.published += c.goals.length; o.log(`${label}: published goal ${c.goals.join(",")}`); }
        else { c.status = "failed"; c.problem = r; report.problems.push(`${label}: goal ${c.goals.join(",")}: ${r}`); }
      }
    }
    if (!pending || Date.now() > deadline) {
      if (pending) o.log(`${pending} clip(s) still rendering — tomorrow's run picks them up`);
      break;
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return report;
}

/** Fetch, check, encode, upload. True, or why not. */
async function publish(game: SiteGame, c: ClipEntry, url: string, o: Options): Promise<true | string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grh-clip-"));
  try {
    const raw = path.join(dir, "rink.mp4");
    const r = await fetch(url);
    if (!r.ok) return `the rink's file would not download (${r.status})`;
    fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
    const picked = chooseLayout((l) => readClip(raw, l), loadLayouts());
    if (!picked) return "no known scoreboard reads in the clip";
    const scores = scoreline(game.goals, game.home, game.away);
    const length = duration(raw);
    const entries: Highlight[] = [];
    for (const n of c.goals) {
      const goal = game.goals[n]!;
      const v = verifyClip(picked.readings, goal, n === 0 ? { home: 0, away: 0 } : scores[n - 1]!, scores[n]!, picked.layout.name, length);
      if (!v.ok) return v.problem;
      const files = { mp4: path.join(dir, `${game.id}-${n}.mp4`), jpg: path.join(dir, `${game.id}-${n}.jpg`) };
      encodeForWeb(raw, files, v.goalAt);
      o.upload(path.basename(files.mp4), files.mp4, "video/mp4");
      o.upload(path.basename(files.jpg), files.jpg, "image/jpeg");
      entries.push({ goal: n, period: goal.period, time: goal.time, scorer: goal.scorer, clip: path.basename(files.mp4), poster: path.basename(files.jpg), seconds: Math.round(duration(files.mp4)) });
    }
    const list = (o.highlights[game.id] ??= []);
    for (const e of entries) {
      const i = list.findIndex((h) => h.goal === e.goal);
      if (i >= 0) list[i] = e; else list.push(e);
    }
    list.sort((a, b) => a.goal - b.goal);
    return true;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
