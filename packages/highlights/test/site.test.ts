import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isHighlight } from "../../../workers/checkout/highlight-name.ts";
import { clipBeside, type Highlight } from "../src/beside.ts";

/**
 * The clips on the box scores, held to the box scores.
 *
 * `apps/web/data/highlights.json` is written by the daily job and read by
 * /games/[id] through `clipBeside`, the same rule used here. These run in the
 * refresh job too, after every capture — so they fail for what would be WRONG
 * on the page, and only that. A clip whose goal a corrected scoresheet no
 * longer has is shown beside nothing, which is not wrong, and is not a failure
 * here: the highlights job reports it, so a scoresheet correction never turns
 * the refresh red.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

type Goal = { period: string; time: string; team: string; scorer: string };
type Game = { id: string; gr: "home" | "away" | null; home: string; away: string; goals: Goal[] };

const games = new Map((read("apps/web/data/site.json").games as Game[]).map((g) => [g.id, g]));
const highlights = read("apps/web/data/highlights.json") as Record<string, Highlight[]>;

test("a clip is only ever shown beside one goal, and that goal is ours", () => {
  for (const [id, clips] of Object.entries(highlights)) {
    const game = games.get(id);
    assert.ok(game, `highlights.json has game ${id}, which site.json does not`);
    const us = game.gr === "home" ? game.home : game.away;
    for (const h of clips) {
      const beside = game.goals.flatMap((g, n) => (clipBeside(clips, game.goals, n, us) === h ? [g] : []));
      assert.ok(beside.length <= 1, `${id}: clip ${h.clip} is shown beside ${beside.length} goals`);
      assert.ok(beside.every((g) => g.team === us), `${id}: clip ${h.clip} is shown beside ${beside[0]?.team}'s goal`);
    }
    // Two clips at one moment: the page would show the first and the job would never write it.
    const keys = clips.map((h) => `${h.period} ${h.time}`);
    assert.equal(new Set(keys).size, keys.length, `${id}: two clips for one moment — ${keys.join(", ")}`);
  }
});

test("the job's ledger is well formed", () => {
  const ledger = read("packages/highlights/ledger.json") as Record<string, { rinkGame: number | null; clips: { goals: number[]; labels?: string[]; at?: number[]; seconds: number; status: string }[] }>;
  for (const [id, entry] of Object.entries(ledger)) {
    assert.ok(games.has(id), `ledger has game ${id}, which site.json does not`);
    for (const c of entry.clips) {
      assert.ok(["queued", "requested", "published", "failed"].includes(c.status), `${id}: clip status "${c.status}"`);
      assert.ok(c.goals.length > 0 && c.seconds >= 20 && c.seconds <= 60, `${id}: clip of ${c.seconds}s for goals ${c.goals}`);
      assert.ok(!c.labels || c.labels.length === c.goals.length, `${id}: ${c.labels?.length} labels for ${c.goals.length} goals`);
      assert.ok(!c.at || c.at.length === c.goals.length, `${id}: ${c.at?.length} goal times for ${c.goals.length} goals`);
    }
  }
});

test("every clip's files are named so the Worker will serve them", () => {
  for (const [id, clips] of Object.entries(highlights)) {
    for (const h of clips) {
      const stem = new RegExp(`^${id}-${h.goal}(-[0-9a-f]{8})?\\.mp4$`).exec(h.clip);
      assert.ok(stem, `${id}: clip named ${h.clip}`);
      assert.equal(h.poster, h.clip.replace(/\.mp4$/, ".jpg"));
      assert.ok(isHighlight(`/highlights/${h.clip}`) && isHighlight(`/highlights/${h.poster}`));
    }
  }
  assert.ok(isHighlight("/highlights/1335913-2-9f2c41ab.mp4"));
  assert.equal(isHighlight("/highlights/../site.json"), false);
  assert.equal(isHighlight("/highlights/1335913-2.mp4.exe"), false);
  assert.equal(isHighlight("/highlights/1335913-2-9F2C41AB.mp4"), false);
  assert.equal(isHighlight("/highlights/1335913-2-9f2c41ab/x.mp4"), false);
});

test("every recap is of a game on the site, named so the Worker will serve it, and says what is in it", () => {
  const recaps = read("apps/web/data/recaps.json") as Record<string, { clip: string; poster: string; seconds: number; goals: number; of: number; sheet: string }>;
  for (const [id, r] of Object.entries(recaps)) {
    assert.ok(games.has(id), `recaps.json has game ${id}, which site.json does not`);
    assert.match(r.clip, new RegExp(`^${id}-recap-[0-9a-f]{8}\\.mp4$`), `${id}: recap named ${r.clip}`);
    assert.equal(r.poster, r.clip.replace(/\.mp4$/, ".jpg"));
    assert.ok(isHighlight(`/highlights/${r.clip}`) && isHighlight(`/highlights/${r.poster}`));
    assert.ok(r.goals <= r.of && r.seconds > 0, `${id}: ${r.goals} of ${r.of} goals in ${r.seconds}s`);
  }
  assert.ok(isHighlight("/highlights/1335913-recap-9f2c41ab.mp4"));
  // A recap always carries its hash, and nothing else rides on the word.
  assert.equal(isHighlight("/highlights/1335913-recap.mp4"), false);
  assert.equal(isHighlight("/highlights/1335913-recap-9f2c41ab-1.mp4"), false);
  assert.equal(isHighlight("/highlights/recap-9f2c41ab.mp4"), false);
});
