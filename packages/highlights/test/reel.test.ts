import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LocatedGoal } from "../src/locate.ts";
import { caption, chapters, planClips, render } from "../src/reel.ts";

const HOME = "The Golden Retrievers", AWAY = "Buffalo Cigars";

function goal(index: number, t: number | null, over: Partial<LocatedGoal["goal"]> = {}): LocatedGoal {
  return {
    index, t, confirmed: t !== null, candidates: [],
    before: { home: 0, away: index }, after: { home: 0, away: index + 1 },
    goal: { period: "1st", time: "06:56", team: AWAY, scorer: "Mike Kline", assists: ["James Wieczorek"], strength: "Even Strength", ...over },
  };
}

test("each goal gets its build-up and aftermath, and close goals share one clip", () => {
  // 1st 06:56 and 06:42 were fourteen game-seconds apart on 2026-10-15.
  const clips = planClips([goal(0, 100), goal(1, 160), goal(2, 170), goal(3, null)], { lead: 15, tail: 8 });
  assert.deepEqual(clips, [
    { start: 85, end: 108, goals: [0] },
    { start: 145, end: 178, goals: [1, 2] },
  ]);
});

test("clips stay inside the recording", () => {
  assert.deepEqual(planClips([goal(0, 5), goal(1, 98)], { lead: 15, tail: 8, duration: 100 }), [
    { start: 0, end: 13, goals: [0] },
    { start: 83, end: 100, goals: [1] },
  ]);
});

test("chapters say where each goal lands in the finished reel", () => {
  const goals = [goal(0, 100), goal(1, 160), goal(2, 170)];
  assert.deepEqual(chapters(planClips(goals), goals).map((c) => c.offset), [15, 23 + 15, 23 + 25]);
});

test("captions carry the scoresheet, and say so when a goal is unassisted or on the power play", () => {
  assert.deepEqual(caption(goal(0, 1), HOME, AWAY), [
    "GOAL · Mike Kline (Buffalo Cigars)",
    "Assists: James Wieczorek",
    "1st 06:56 · Buffalo Cigars 1 – The Golden Retrievers 0",
  ]);
  const pp = caption(goal(0, 1, { assists: [], strength: "Power Play" }), HOME, AWAY);
  assert.equal(pp[1], "Unassisted");
  assert.match(pp[2]!, /Power Play/);
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const font = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"].find((f) => fs.existsSync(f));

test("renders captioned clips and a reel from a recording", { skip: !ffmpeg || !font ? "needs ffmpeg and a font" : false }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gr-reel-"));
  try {
    const recording = path.join(dir, "recording.mp4");
    const made = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=60",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=60",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", recording,
    ]);
    assert.equal(made.status, 0, String(made.stderr));
    const goals = [goal(0, 20), goal(1, 45), goal(2, 50)];
    const clips = planClips(goals, { lead: 6, tail: 3, duration: 60 });
    const files = render(clips, goals, HOME, AWAY, { recording, outDir: path.join(dir, "out"), font: font! });
    assert.deepEqual(files.map((f) => path.basename(f)), ["clip-01.mp4", "clip-02.mp4", "reel.mp4", "poster.jpg"]);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", files[2]!], { encoding: "utf8" });
    const info = JSON.parse(probe.stdout) as { format: { duration: string }; streams: { codec_type: string }[] };
    // 9 s + 14 s of clips, and both the picture and the sound came through.
    assert.ok(Math.abs(Number(info.format.duration) - 23) < 0.5, info.format.duration);
    assert.deepEqual(info.streams.map((s) => s.codec_type).sort(), ["audio", "video"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
