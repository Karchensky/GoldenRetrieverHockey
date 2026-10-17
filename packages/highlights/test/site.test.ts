import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isHighlight } from "../../../workers/checkout/highlight-name.ts";

/**
 * The clips on the box scores, held to the box scores.
 *
 * `apps/web/data/highlights.json` is written by the daily job and read by
 * /games/[id]. A clip is attached by the goal's place on the scoresheet, so a
 * corrected scoresheet could otherwise slide one goal's clip onto the next
 * line — and only our goals are clipped, so a clip on theirs is a bug.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

type Goal = { period: string; time: string; team: string; scorer: string };
type Game = { id: string; gr: "home" | "away" | null; home: string; away: string; goals: Goal[] };
type Highlight = { goal: number; period: string; time: string; scorer: string; clip: string; poster: string; seconds: number };

const games = new Map((read("apps/web/data/site.json").games as Game[]).map((g) => [g.id, g]));
const highlights = read("apps/web/data/highlights.json") as Record<string, Highlight[]>;

test("every clip sits beside one of our goals, the one it was cut for", () => {
  for (const [id, clips] of Object.entries(highlights)) {
    const game = games.get(id);
    assert.ok(game, `highlights.json has game ${id}, which site.json does not`);
    const us = game.gr === "home" ? game.home : game.away;
    const seen = new Set<number>();
    for (const h of clips) {
      const goal: Goal | undefined = game.goals[h.goal];
      assert.ok(goal, `${id}: no goal ${h.goal} on the scoresheet`);
      assert.equal(goal.team, us, `${id}: goal ${h.goal} is ${goal.team}'s, and only ours are clipped`);
      assert.deepEqual(
        { period: h.period, time: h.time, scorer: h.scorer },
        { period: goal.period, time: goal.time, scorer: goal.scorer },
        `${id}: clip ${h.clip} was cut for a different goal than the scoresheet now has at ${h.goal}`,
      );
      assert.ok(!seen.has(h.goal), `${id}: goal ${h.goal} has two clips`);
      seen.add(h.goal);
      assert.ok(h.seconds >= 20 && h.seconds <= 60, `${id}: a ${h.seconds}s clip — the rink cuts 20 to 60`);
    }
  }
});

test("every clip's files are named so the Worker will serve them", () => {
  for (const [id, clips] of Object.entries(highlights)) {
    for (const h of clips) {
      assert.equal(h.clip, `${id}-${h.goal}.mp4`);
      assert.equal(h.poster, `${id}-${h.goal}.jpg`);
      assert.ok(isHighlight(`/highlights/${h.clip}`) && isHighlight(`/highlights/${h.poster}`));
    }
  }
  assert.equal(isHighlight("/highlights/../site.json"), false);
  assert.equal(isHighlight("/highlights/1335913-2.mp4.exe"), false);
});
