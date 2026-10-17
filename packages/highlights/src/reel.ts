import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LocatedGoal } from "./locate.ts";

/**
 * From located goals to one short highlights package.
 *
 * Every goal becomes a window — the build-up before the whistle and a few
 * seconds after — and windows that overlap merge, so two goals fourteen seconds
 * apart play as one clip rather than the same rush twice. Only these windows
 * ever leave the recording; the full game is a private input and is never
 * written anywhere this produces.
 */

export type Clip = {
  /** Seconds into the recording. */
  start: number;
  end: number;
  /** Scoresheet indices of the goals inside it. */
  goals: number[];
};

export type Chapter = { index: number; label: string; offset: number };

export type ClipOptions = { lead?: number; tail?: number; duration?: number };

export function planClips(goals: LocatedGoal[], { lead = 15, tail = 8, duration = Infinity }: ClipOptions = {}): Clip[] {
  const placed = goals.filter((g) => g.t !== null).sort((a, b) => a.t! - b.t!);
  const clips: Clip[] = [];
  for (const g of placed) {
    const start = Math.max(0, g.t! - lead), end = Math.min(duration, g.t! + tail);
    const last = clips.at(-1);
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      last.goals.push(g.index);
    } else {
      clips.push({ start, end, goals: [g.index] });
    }
  }
  return clips;
}

export function caption(g: LocatedGoal, home: string, away: string): string[] {
  const assists = g.goal.assists.length ? `Assists: ${g.goal.assists.join(", ")}` : "Unassisted";
  const strength = g.goal.strength && g.goal.strength !== "Even Strength" ? ` · ${g.goal.strength}` : "";
  return [
    `GOAL · ${g.goal.scorer} (${g.goal.team})`,
    assists,
    `${g.goal.period} ${g.goal.time}${strength} · ${away} ${g.after.away} – ${home} ${g.after.home}`,
  ];
}

/** Where each goal lands in the finished reel, for a "jump to" list beside the box score. */
export function chapters(clips: Clip[], goals: LocatedGoal[]): Chapter[] {
  const out: Chapter[] = [];
  let offset = 0;
  for (const clip of clips) {
    for (const index of clip.goals) {
      const g = goals.find((x) => x.index === index)!;
      out.push({ index, label: `${g.goal.period} ${g.goal.time} ${g.goal.scorer}`, offset: Math.round(offset + g.t! - clip.start) });
    }
    offset += clip.end - clip.start;
  }
  return out;
}

export type RenderOptions = {
  recording: string;
  outDir: string;
  /** A .ttf/.otf for the captions. Copied in beside the clips: a Windows path in an ffmpeg filter is an escaping trap. */
  font: string;
  /** How long each goal's caption stays up. */
  captionSeconds?: number;
  ffmpeg?: string;
};

function run(ffmpeg: string, args: string[], cwd: string): void {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg failed (${result.status}): ${result.stderr.slice(-800)}`);
}

/**
 * Cut every clip (re-encoded, so cuts land on the second rather than the
 * nearest keyframe), caption each goal, and join them into reel.mp4 with a
 * poster frame from the first goal. Returns the files written.
 */
export function render(clips: Clip[], goals: LocatedGoal[], home: string, away: string, o: RenderOptions): string[] {
  const ffmpeg = o.ffmpeg ?? "ffmpeg";
  const captionSeconds = o.captionSeconds ?? 6;
  const dir = path.resolve(o.outDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(o.font, path.join(dir, "caption" + path.extname(o.font)));
  const font = "caption" + path.extname(o.font);
  const recording = path.resolve(o.recording);
  const parts: string[] = [];

  for (const [n, clip] of clips.entries()) {
    const filters: string[] = [];
    for (const index of clip.goals) {
      const g = goals.find((x) => x.index === index)!;
      const textFile = `caption-${index}.txt`;
      fs.writeFileSync(path.join(dir, textFile), caption(g, home, away).join("\n"));
      // Up from the whistle, so the caption never gives the goal away before it happens.
      const from = (g.t! - clip.start).toFixed(2), to = (g.t! - clip.start + captionSeconds).toFixed(2);
      filters.push(
        `drawtext=fontfile=${font}:textfile=${textFile}:fontsize=h/24:fontcolor=white:line_spacing=6` +
        `:box=1:boxcolor=black@0.6:boxborderw=14:x=w*0.04:y=h*0.06:enable='between(t,${from},${to})'`,
      );
    }
    const part = `clip-${String(n + 1).padStart(2, "0")}.mp4`;
    run(ffmpeg, [
      "-ss", clip.start.toFixed(3), "-t", (clip.end - clip.start).toFixed(3), "-i", recording,
      "-map", "0:v:0", "-map", "0:a:0?",
      ...(filters.length ? ["-vf", filters.join(",")] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", part,
    ], dir);
    parts.push(part);
  }

  fs.writeFileSync(path.join(dir, "parts.txt"), parts.map((p) => `file '${p}'`).join("\n") + "\n");
  run(ffmpeg, ["-f", "concat", "-safe", "0", "-i", "parts.txt", "-c", "copy", "-movflags", "+faststart", "reel.mp4"], dir);
  const first = goals.find((g) => g.index === clips[0]?.goals[0]);
  const posterAt = first && clips[0] ? Math.max(0, first.t! - clips[0].start - 2) : 0;
  run(ffmpeg, ["-ss", posterAt.toFixed(2), "-i", "reel.mp4", "-frames:v", "1", "-q:v", "3", "poster.jpg"], dir);
  return [...parts, "reel.mp4", "poster.jpg"].map((p) => path.join(dir, p));
}
