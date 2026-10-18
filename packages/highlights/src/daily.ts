import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clipBeside, type Highlight } from "./beside.ts";
import { clipThumbs, duration, encodeForWeb, readBoard, verifyClip } from "./clip.ts";
import { crossCheck, recordingThumbs } from "./crosscheck.ts";
import { findGoals } from "./find.ts";
import { locateGoals, scoreline, type LocatedGoal, type ScoredGoal } from "./locate.ts";
import {
  CLIP_MAX, clipsCredit, createMoment, gameDetails, myMoments, ourTeams, recordedGames, requestDownload, signIn,
  type Moment, type RinkGame, type Session,
} from "./rink.ts";
import { cutClip, openStream, type Stream } from "./stream.ts";

/**
 * The daily job: every game of ours from `since` on, each of OUR goals clipped
 * from the rink's recording and put beside its line on the box score.
 *
 *   find the game on the rink's platform -> read its recording for the goals
 *   -> mark a clip of each of ours -> ask the rink to render it (ONE CREDIT)
 *   -> fetch it when ready -> check it is that goal, twice -> encode -> R2
 *   -> highlights.json
 *
 * THE BACKUP: a clip can instead be cut straight from the recording the job
 * already reads (`cutClip`), which asks the rink for nothing and spends no
 * download. `source` says when: "download" only ever downloads, and a clip
 * with no download left waits for next month's; "auto", the workflow's, cuts
 * from the recording only once the month's downloads are used up; "recording"
 * always does. A game before `seasonStart` — the one-time look at older games —
 * is only ever cut from the recording: downloads are for this season. A cut
 * clip gets the same two checks as a download before it goes anywhere.
 *
 * The two checks are separate readings that must agree: the clip's own
 * scoreboard (`verifyClip`), and the clip compared frame by frame with the
 * stretch of the recording it was asked for, with the goal where the search
 * through the recording found it (`crossCheck`).
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
 *
 * Every state a game or clip can be left in ends: reported once and left for a
 * person, or retried by the next run. None turns the job red day after day for
 * the same thing, and none searches or spends again without a reason.
 */

export const LEAD = 15, TAIL = 8;
/** A game still not on the rink's site, or without a recording, this long after it was played is reported and not looked for again. */
export const NOT_RECORDED_DAYS = 7;
/** A clip the rink has not finished rendering this long after it was asked for is reported. It takes minutes. */
export const RENDER_DAYS = 3;
/** Runs in a row that publishing one clip may break off with an error before it is reported and left. */
export const TRIES = 3;

export type ClipEntry = {
  /** Scoresheet indices of the goals it shows, from 0, when it was planned. Where they are NOW is `currentGoals`. */
  goals: number[];
  /** Each of those goals as "1st 06:42" — how it is found on a corrected scoresheet, and checked before a credit is spent. */
  labels?: string[];
  /** Seconds into the recording where the search found each goal: what the downloaded clip is checked against. */
  at?: number[];
  /** The board's clock at each goal, where the search found it — the clip's own clock is checked against this, not the scoresheet's time. */
  clocks?: (number | null)[];
  start: number;
  seconds: number;
  moment: string | null;
  status: "queued" | "requested" | "published" | "failed";
  /**
   * What it was published from, or failed as: the rink's download, or cut from
   * the recording. Absent on the clips from before the backup, all downloads.
   * A queued clip has none — which it uses is decided each run.
   */
  source?: Source;
  /** The day its download was asked for. */
  asked?: string;
  /** Runs in which publishing it broke off with an error. */
  tries?: number;
  problem?: string;
};
export type GameEntry = {
  rinkGame: number | null;
  board?: string;
  clips: ClipEntry[];
  /** Why its goals are not being looked for — reported once. */
  problem?: string;
  /** The scoresheet `problem` was found on. A corrected one is looked at again. */
  sheet?: string;
  /** Published clips a corrected scoresheet no longer has a goal for, already reported. */
  stale?: string[];
};
export type Ledger = Record<string, GameEntry>;
export type Source = "download" | "recording";
export type Highlights = Record<string, Highlight[]>;

type SiteGame = { id: string; date: string; time: string | null; rink: string | null; status: string; gr: "home" | "away" | null; home: string; away: string; goals: ScoredGoal[] };

export type Options = {
  since: string;
  /** The first day the daily job covers. A game before it is the one-time look at older games, and is never downloaded. */
  seasonStart: string;
  /** Where a clip comes from — see the top of this file. */
  source: Source | "auto";
  /** YYYY-MM-DD, in Buffalo. */
  today: string;
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

export type Report = { published: number; requested: number; cut: number; queued: number; problems: string[]; nothingToDo: boolean };

const us = (g: SiteGame) => (g.gr === "home" ? g.home : g.away);
const goalLabel = (g: ScoredGoal) => `${g.period} ${g.time}`;
const ourGoals = (g: SiteGame) => g.goals.map((x, n) => ({ x, n })).filter(({ x }) => x.team === us(g)).map(({ n }) => n);
/** "Final", and "Final/OT" — the overtime games are ours too. */
const played = (g: SiteGame) => /^final/i.test(g.status);
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** The scoresheet as the job saw it. A problem is tied to it, so a corrected scoresheet is looked at afresh. */
export const sheetOf = (g: SiteGame) => g.goals.map((x) => `${goalLabel(x)} ${x.team}`).join("; ");

/**
 * Windows around our located goals. Credits are what is scarce, so two of ours
 * share one clip whenever that clip stays within the rink's minute — even with a
 * gap between them that a clip of each would not have shown.
 */
type Plan = { goals: number[]; at: number[]; clocks: (number | null)[]; start: number; seconds: number };

export function planClips(goals: LocatedGoal[], ours: Set<number>, lead = LEAD, tail = TAIL): Plan[] {
  const placed = goals.filter((g) => ours.has(g.index) && g.t !== null && g.confirmed).sort((a, b) => a.t! - b.t!);
  const out: Plan[] = [];
  for (const g of placed) {
    const start = Math.max(0, g.t! - lead), end = g.t! + tail, last = out.at(-1);
    if (last && end - last.start <= CLIP_MAX) {
      last.seconds = round1(end - last.start);
      last.goals.push(g.index);
      last.at.push(round1(g.t!));
      last.clocks.push(g.clock);
    } else {
      out.push({ goals: [g.index], at: [round1(g.t!)], clocks: [g.clock], start: round1(start), seconds: lead + tail });
    }
  }
  return out;
}

/**
 * Which way a queued clip goes this run, when no download of it was asked for
 * yet: one of the month's downloads, cut from the recording, or wait. An older
 * game — before the season the job covers — is never a download.
 */
export function routeClip(source: Options["source"], older: boolean, credit: number): Source | "wait" {
  if (source === "download") return older || credit <= 0 ? "wait" : "download";
  if (source === "recording" || older || credit <= 0) return "recording";
  return "download";
}

/** The account's clip at this start and length, if one was already marked. */
const sameClip = (m: Moment, c: { start: number; seconds: number }) => Math.abs(m.startSec - c.start) < 0.6 && Math.abs(m.durationSec - c.seconds) < 0.6;

/** "Rink 2", "New Wave Energy Rink 2" -> "2": the league's rink names carry a sponsor that comes and goes. */
const rinkNumber = (r: string) => /rink\s*(\d+)/i.exec(r)?.[1] ?? r.trim().toLowerCase();

/** "20:30", "8:30 PM", "9:20 PM EDT" -> minutes after midnight; null for anything else. */
export function minuteOfDay(t: string | null): number | null {
  const m = t ? /^(\d{1,2}):(\d{2})\s*([ap]m)?\b/i.exec(t.trim()) : null;
  if (!m) return null;
  const pm = m[3]?.toLowerCase() === "pm";
  const h = m[3] ? (Number(m[1]) % 12) + (pm ? 12 : 0) : Number(m[1]);
  return h * 60 + Number(m[2]);
}

/**
 * The rink's recording of a box score: ours on that date, at that time, on that
 * rink — or, failing that, our only recorded game that date, whatever time the
 * rink filed it under. Anything less certain is no match. The scoreboard check
 * that follows confirms it is this game: its score has to go goal by goal the
 * way this scoresheet does.
 */
export function matchRinkGame(game: SiteGame, rinkGames: RinkGame[]): RinkGame | null {
  const sameDay = rinkGames.filter((r) => r.date === game.date);
  const exact = sameDay.filter((r) =>
    minuteOfDay(r.time) !== null && minuteOfDay(r.time) === minuteOfDay(game.time) && (!game.rink || rinkNumber(r.rink) === rinkNumber(game.rink)));
  if (exact.length === 1) return exact[0]!;
  return exact.length === 0 && sameDay.length === 1 ? sameDay[0]! : null;
}

/**
 * Each goal of a planned clip, where it is on the scoresheet now — found by its
 * period and time, which a goal added or removed elsewhere does not change — or
 * null for one no longer there, or no longer ours.
 */
export function currentGoals(game: SiteGame, clip: Pick<ClipEntry, "goals" | "labels">): (number | null)[] {
  return clip.goals.map((n, i) => {
    const label = clip.labels?.[i];
    if (label === undefined) return game.goals[n]?.team === us(game) ? n : null;
    const at = ourGoals(game).filter((k) => goalLabel(game.goals[k]!) === label);
    return at.length === 1 ? at[0]! : null;
  });
}

/** The planned goals of a clip that are no longer ours at the time they were found. A credit is only ever spent when this is empty. */
export function movedSincePlanned(game: SiteGame, clip: Pick<ClipEntry, "goals" | "labels">): number[] {
  const now = currentGoals(game, clip);
  return clip.goals.filter((_, i) => now[i] === null);
}

/** A goal is done when the page shows a clip beside it — by the page's own rule. */
const done = (o: Pick<Options, "highlights">, g: SiteGame, n: number) => clipBeside(o.highlights[g.id], g.goals, n, us(g)) !== undefined;
/** Our goals that already have a clip planned, asked for, or given up on — found by where they are now. */
const covered = (o: Pick<Options, "ledger">, g: SiteGame) =>
  new Set((o.ledger[g.id]?.clips ?? []).flatMap((c) => currentGoals(g, c)).filter((n): n is number => n !== null));
/** Published clips the page shows beside no goal any more — a scoresheet corrected since — not yet reported. */
const staleClips = (o: Pick<Options, "highlights" | "ledger">, g: SiteGame) => {
  const shown = new Set(g.goals.map((_, n) => clipBeside(o.highlights[g.id], g.goals, n, us(g))));
  return (o.highlights[g.id] ?? []).filter((h) => !shown.has(h) && !(o.ledger[g.id]?.stale ?? []).includes(h.clip));
};

/** What there is to do for one game, from the files alone. */
function workOn(o: Pick<Options, "ledger" | "highlights">, g: SiteGame) {
  const entry = o.ledger[g.id];
  // A problem is reported once and is for a person — unless the scoresheet it was found on has been corrected.
  const blocked = !!entry?.problem && entry.sheet === sheetOf(g);
  const planned = covered(o, g);
  return {
    locate: !blocked && ourGoals(g).some((n) => !done(o, g, n) && !planned.has(n)),
    collect: (entry?.clips ?? []).some((c) => c.status === "queued" || c.status === "requested"),
    stale: staleClips(o, g),
  };
}

/**
 * The games with something to do, from the files alone: no sign-in, no network,
 * nothing installed. Most days it is none, and the workflow stops there.
 */
export function gamesWithWork(o: Pick<Options, "since" | "games" | "ledger" | "highlights">): SiteGame[] {
  return o.games.filter((g) => {
    if (g.date < o.since || g.gr === null || !played(g) || g.goals.length === 0) return false;
    const w = workOn(o, g);
    return w.locate || w.collect || w.stale.length > 0;
  });
}

export async function daily(o: Options): Promise<Report> {
  const report: Report = { published: 0, requested: 0, cut: 0, queued: 0, problems: [], nothingToDo: false };
  const problem = (p: string) => { if (!report.problems.includes(p)) report.problems.push(p); };
  const todo = gamesWithWork(o);
  if (!todo.length) { report.nothingToDo = true; return report; }
  const labelOf = (g: SiteGame) => `${g.date} ${g.away} at ${g.home} (${g.id})`;

  // Reported once each, and never undone by the job: a person decides what the clip should be beside.
  for (const game of todo) {
    for (const h of workOn(o, game).stale) {
      problem(`${labelOf(game)}: clip ${h.clip} (${h.period} ${h.time}, ${h.scorer}) matches no single goal of ours on the corrected scoresheet, so it is not shown`);
      const entry = (o.ledger[game.id] ??= { rinkGame: null, clips: [] });
      (entry.stale ??= []).push(h.clip);
    }
  }

  const online = todo.filter((g) => { const w = workOn(o, g); return w.locate || w.collect; });
  if (!online.length) return report;

  // The one failure every game shares — a password changed, the subscription ended — stops the run,
  // red, before anything is recorded. Everything after it is per game and per clip.
  const s: Session = await signIn(o.credentials().email, o.credentials().password);
  let rinkGames: RinkGame[] | null = null;
  const streams = new Map<string, Promise<Stream | null>>();
  /** The recording: its lightest variant to read the board on, its best to cut a clip from. */
  const recording = (rink: number, pick: "lightest" | "best" = "lightest") => {
    const key = `${rink} ${pick}`;
    if (!streams.has(key)) {
      // Live, or posted but still growing, is no recording yet: a goal searched for in half a game is not found.
      streams.set(key, gameDetails(s, rink).then(async (d) => {
        if (d.live || !d.streamUrl) return null;
        const stream = await openStream(d.streamUrl, pick);
        return stream.ended ? stream : null;
      }));
    }
    return streams.get(key)!;
  };
  const brokeOff = new Set<ClipEntry>();
  const whichOf = (c: ClipEntry) => c.labels?.join(", ") ?? `goal ${c.goals.join(",")}`;
  const fail = (label: string, c: ClipEntry, p: string) => { c.status = "failed"; c.problem = p; problem(`${label}: ${whichOf(c)}: ${p}`); };

  /** Publish one clip from `source`, and record how it went: published, failed a check, or broken off for the next run. */
  async function attempt(game: SiteGame, rink: number, c: ClipEntry, source: Source, fetchRaw: (file: string) => Promise<void>): Promise<void> {
    const label = labelOf(game);
    try {
      const r = await publish(game, rink, c, fetchRaw);
      c.source = source;
      if (r === true) {
        c.status = "published";
        delete c.tries;
        report.published += c.goals.length;
        o.log(`${label}: published ${whichOf(c)}${source === "recording" ? ", cut from the recording" : ""}`);
      } else fail(label, c, r);
    } catch (e) {
      // Broke off — a download cut short, the recording not answering. Tomorrow tries again, up to a point.
      brokeOff.add(c);
      c.tries = (c.tries ?? 0) + 1;
      if (c.tries >= TRIES) { c.source = source; fail(label, c, `publishing broke off ${TRIES} runs running, last: ${(e as Error).message}`); }
      else problem(`${label}: ${whichOf(c)}: ${(e as Error).message} — tried again next run`);
    }
  }

  for (const game of online) {
    const label = labelOf(game);
    const entry = (o.ledger[game.id] ??= { rinkGame: null, clips: [] });
    try {
      await findAndAsk(game, entry, label);
    } catch (e) {
      // Not recorded: whatever broke, the next run tries again.
      problem(`${label}: ${(e as Error).message}`);
    }
    // An older game the rink has no recording of is the usual case, not a problem: nothing kept, so a later look tries again.
    if (game.date < o.seasonStart && entry.rinkGame === null && !entry.clips.length && !entry.problem && !entry.stale) delete o.ledger[game.id];
  }

  async function findAndAsk(game: SiteGame, entry: GameEntry, label: string): Promise<void> {
    if (entry.problem && entry.sheet !== sheetOf(game)) {
      o.log(`${label}: the scoresheet has changed since "${entry.problem}" — looking again`);
      delete entry.problem;
      delete entry.sheet;
    }
    const giveUp = (p: string) => { entry.problem = p; entry.sheet = sheetOf(game); problem(`${label}: ${p}`); };
    const overdue = daysBetween(game.date, o.today) > NOT_RECORDED_DAYS;

    const planned = covered(o, game);
    const missing = ourGoals(game).filter((n) => !planned.has(n) && !done(o, game, n));
    if (missing.length && !entry.problem) {
      if (entry.rinkGame === null) {
        rinkGames ??= await recordedGames(await ourTeams(), o.since);
        const hit = matchRinkGame(game, rinkGames);
        if (hit) entry.rinkGame = hit.id;
        else if (game.date < o.seasonStart) o.log(`${label}: not on the rink's video site — older than its recordings, or filed under another date`);
        else if (overdue) giveUp(`not on the rink's video site ${NOT_RECORDED_DAYS} days after it was played, by date, time or rink`);
        else o.log(`${label}: not on the rink's video site yet`);
      }
      const stream = entry.rinkGame === null ? null : await recording(entry.rinkGame);
      if (entry.rinkGame !== null && !stream) {
        if (overdue) giveUp(`no recording on the rink's video site ${NOT_RECORDED_DAYS} days after it was played`);
        else o.log(`${label}: no recording yet`);
      }
      if (stream) {
        const found = await findGoals(stream, game.goals, game.home, game.away);
        if ("problem" in found) {
          giveUp(found.problem);
        } else {
          entry.board = found.layout.name;
          const located = locateGoals(found.readings, game.goals, game.home, game.away);
          o.log(`${label}: read ${found.fetched.segments} of ${stream.segments.length} segments of the recording, board ${found.layout.name}`);
          const unsure = located.goals.filter((g) => missing.includes(g.index) && !(g.t !== null && g.confirmed));
          if (unsure.length) giveUp(unsure.map((g) => `${g.goal.period} ${g.goal.time} ${g.goal.scorer}: ${g.problem ?? "not found"}`).join("; "));
          const wanted = new Set(missing.filter((n) => !unsure.some((g) => g.index === n)));
          for (const p of planClips(located.goals, wanted)) {
            entry.clips.push({ ...p, labels: p.goals.map((n) => goalLabel(game.goals[n]!)), moment: null, status: "queued" });
          }
        }
      }
    }

    // Mark and ask for every queued clip there is a credit for — or cut it from the recording, when that is the source.
    const queued = entry.clips.filter((c) => c.status === "queued");
    if (!queued.length || entry.rinkGame === null) return;
    const rink = entry.rinkGame;
    const older = game.date < o.seasonStart;
    const existing = await myMoments(s, rink);
    // Reading what is left spends nothing, so a dry run reads it too and says truly which way each clip would go.
    let credit = routeClip(o.source, older, 1) === "download" ? await clipsCredit(s) : 0;
    for (const c of queued) {
      // The scoresheet may have been corrected since this was planned: a credit is only ever
      // spent on a goal that is still ours, at the time it was found at.
      const moved = movedSincePlanned(game, c);
      if (moved.length) {
        c.status = "failed";
        c.problem = `the scoresheet changed since ${c.labels?.join(", ") ?? `goal ${moved.join(",")}`} was found — nothing spent`;
        problem(`${label}: ${c.problem}`);
        continue;
      }
      let m = existing.find((x) => sameClip(x, c)) ?? null;
      // A download already asked for is used, whatever the source: it is paid for.
      if (m?.download) { c.moment = m.id; c.status = "requested"; c.asked ??= o.today; continue; }
      const route = routeClip(o.source, older, credit);
      if (route === "wait") {
        report.queued++;
        o.log(older
          ? `${label}: older than this season, so cut from the recording or not at all — ${whichOf(c)} waits for a run with --source auto or recording`
          : `${label}: no download credit left — ${whichOf(c)} waits for next month's`);
        continue;
      }
      if (route === "recording") {
        if (o.dryRun) { o.log(`${label}: would cut ${c.start}s +${c.seconds}s for ${whichOf(c)} from the recording`); continue; }
        await attempt(game, rink, c, "recording", async (file) => {
          const best = await recording(rink, "best");
          if (!best) throw new Error("the recording is not available to cut the clip from");
          await cutClip(best, c.start, c.seconds, file);
        });
        if (c.status === "published") report.cut++;
        continue;
      }
      if (o.dryRun) { credit--; o.log(`${label}: would clip ${c.start}s +${c.seconds}s for ${whichOf(c)} (${credit} credits left after)`); continue; }
      m ??= await createMoment(s, rink, c.start, c.seconds);
      c.moment = m.id;
      await requestDownload(s, m.id);
      credit--;
      c.status = "requested";
      c.asked = o.today;
      report.requested++;
      o.log(`${label}: asked the rink for the clip of ${c.labels?.join(", ")} (${credit} credits left)`);
    }
  }

  // Fetch, check and publish whatever the rink has rendered — waiting a while for what it has not.
  const deadline = Date.now() + o.waitMinutes * 60_000;
  for (;;) {
    let pending = 0;
    for (const game of online) {
      const entry = o.ledger[game.id];
      const requested = (entry?.clips ?? []).filter((c) => c.status === "requested" && !brokeOff.has(c));
      if (!entry || entry.rinkGame === null || !requested.length || o.dryRun) continue;
      const label = labelOf(game);
      let moments: Moment[];
      try {
        moments = await myMoments(s, entry.rinkGame);
      } catch (e) {
        problem(`${label}: ${(e as Error).message}`);
        continue;
      }
      for (const c of requested) {
        const m = moments.find((x) => x.id === c.moment);
        if (!m?.download) { fail(label, c, "the rink has no download for this clip"); continue; }
        const status = m.download.status;
        if (/fail|error|cancel|reject|expire/i.test(status)) { fail(label, c, `the rink's render ended ${status}`); continue; }
        const url = m.download.url;
        if (status !== "COMPLETE" || !url) {
          if (c.asked && daysBetween(c.asked, o.today) > RENDER_DAYS) fail(label, c, `still ${status} at the rink ${RENDER_DAYS} days after it was asked for`);
          else pending++;
          continue;
        }
        await attempt(game, entry.rinkGame, c, "download", (file) => download(url, file));
      }
    }
    if (!pending || Date.now() > deadline) {
      if (pending) o.log(`${pending} clip(s) still rendering — tomorrow's run picks them up`);
      break;
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return report;

  /** Fetch, check twice, encode, upload. True, why not — or a throw, for the next run to try again. */
  async function publish(game: SiteGame, rink: number, c: ClipEntry, fetchRaw: (file: string) => Promise<void>): Promise<true | string> {
    const now = currentGoals(game, c);
    if (now.some((n) => n === null)) return "the scoresheet changed since it was asked for: a goal in it is no longer ours at that time";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grh-clip-"));
    try {
      const raw = path.join(dir, "rink.mp4");
      await fetchRaw(raw);
      const stream = await recording(rink);
      if (!stream) throw new Error("the recording is not available to check the clip against");
      const goals = await checkClip(game, c, now as number[], raw, stream);
      if (typeof goals === "string") return goals;

      const entries: Highlight[] = [];
      for (const { n, goal, goalAt } of goals) {
        const files = { mp4: path.join(dir, "web.mp4"), jpg: path.join(dir, "web.jpg") };
        encodeForWeb(raw, files, goalAt);
        // Named for what is in it: a clip replaced is a new name, so the year-long cache is never stale.
        const hash = crypto.createHash("sha256").update(fs.readFileSync(files.mp4)).digest("hex").slice(0, 8);
        const name = `${game.id}-${n}-${hash}`;
        o.upload(`${name}.mp4`, files.mp4, "video/mp4");
        o.upload(`${name}.jpg`, files.jpg, "image/jpeg");
        entries.push({ goal: n, period: goal.period, time: goal.time, scorer: goal.scorer, clip: `${name}.mp4`, poster: `${name}.jpg`, seconds: Math.round(duration(files.mp4)) });
      }
      const list = (o.highlights[game.id] ??= []);
      for (const e of entries) {
        // Beside its goal by period and time, as the page finds it — never by a position a correction can shift.
        const i = list.findIndex((h) => h.period === e.period && h.time === e.time);
        if (i >= 0) list[i] = e; else list.push(e);
      }
      list.sort((a, b) => a.goal - b.goal);
      return true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The rink's rendered file, to `file`. The link is never printed. */
export async function download(url: string, file: string): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`the rink's file would not download (${r.status})`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

export type Checked = { n: number; goal: ScoredGoal; goalAt: number }[];

/**
 * The two checks every clip gets before it is published, downloaded or cut:
 * the goals in it and where — or why it is not that goal. `now` is where its
 * goals are on the scoresheet (`currentGoals`); `stream` is the recording.
 */
export async function checkClip(game: SiteGame, c: Pick<ClipEntry, "at" | "clocks" | "start" | "seconds">, now: number[], raw: string, stream: Stream): Promise<Checked | string> {
  // One: the clip's own scoreboard shows each goal going in, at the score either side of it.
  const picked = readBoard(raw);
  if (!picked) return "no known scoreboard reads in the clip";
  const scores = scoreline(game.goals, game.home, game.away);
  const length = duration(raw);
  const goals: (Checked[number] & { at: number | undefined })[] = [];
  for (const [i, n] of now.entries()) {
    const goal = game.goals[n]!;
    const v = verifyClip(picked.readings, goal, n === 0 ? { home: 0, away: 0 } : scores[n - 1]!, scores[n]!, picked.layout.name, length, c.clocks?.[i] ?? undefined);
    if (!v.ok) return v.problem;
    goals.push({ n, goal, goalAt: v.goalAt, at: c.at?.[i] });
  }

  // Two: it is the stretch of the recording it was asked for, with the goal where the recording put it.
  const x = crossCheck(clipThumbs(raw), await recordingThumbs(stream, c.start, c.seconds), c.start,
    goals.filter((g) => g.at !== undefined).map((g) => ({ label: goalLabel(g.goal), at: g.at!, goalAt: g.goalAt })));
  if (!x.ok) return x.problem;
  return goals.map(({ n, goal, goalAt }) => ({ n, goal, goalAt }));
}
