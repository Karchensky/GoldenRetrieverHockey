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
 * /games/[id], which shows a clip beside the goal of ours with its period and
 * time. These run in the refresh job too, after every capture — so they fail
 * for what would be WRONG on the page, and only that. A clip whose goal a
 * corrected scoresheet no longer has is not shown, and is not a failure here:
 * the highlights job reports it, so a scoresheet correction never turns the
 * refresh red.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

type Goal = { period: string; time: string; team: string; scorer: string };
type Game = { id: string; gr: "home" | "away" | null; home: string; away: string; goals: Goal[] };
type Highlight = { goal: number; period: string; time: string; scorer: string; clip: string; poster: string; seconds: number };

const games = new Map((read("apps/web/data/site.json").games as Game[]).map((g) => [g.id, g]));
const highlights = read("apps/web/data/highlights.json") as Record<string, Highlight[]>;

test("a clip is only ever shown beside one of our goals, and beside one goal only", () => {
  for (const [id, clips] of Object.entries(highlights)) {
    const game = games.get(id);
    assert.ok(game, `highlights.json has game ${id}, which site.json does not`);
    const us = game.gr === "home" ? game.home : game.away;
    const shown = new Set<string>();
    for (const h of clips) {
      const at = game.goals.filter((g) => g.period === h.period && g.time === h.time);
      // Theirs at that moment would put our clip beside their goal; two goals would make it a guess.
      assert.ok(at.every((g) => g.team === us), `${id}: clip ${h.clip} matches ${at.find((g) => g.team !== us)?.team}'s goal at ${h.period} ${h.time}`);
      assert.ok(at.length <= 1, `${id}: ${at.length} goals at ${h.period} ${h.time} — clip ${h.clip} would be a guess`);
      const key = `${h.period} ${h.time}`;
      assert.ok(!shown.has(key), `${id}: two clips for the goal at ${key}`);
      shown.add(key);
      assert.ok(h.seconds >= 20 && h.seconds <= 60, `${id}: a ${h.seconds}s clip — the rink cuts 20 to 60`);
    }
  }
});

test("the job's ledger is well formed", () => {
  const ledger = read("packages/highlights/ledger.json") as Record<string, { rinkGame: number | null; clips: { goals: number[]; seconds: number; status: string }[] }>;
  for (const [id, entry] of Object.entries(ledger)) {
    assert.ok(games.has(id), `ledger has game ${id}, which site.json does not`);
    for (const c of entry.clips) {
      assert.ok(["queued", "requested", "published", "failed"].includes(c.status), `${id}: clip status "${c.status}"`);
      assert.ok(c.goals.length > 0 && c.seconds >= 20 && c.seconds <= 60, `${id}: clip of ${c.seconds}s for goals ${c.goals}`);
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
