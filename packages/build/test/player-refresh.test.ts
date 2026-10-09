import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobStore } from "../../capture/src/store/blobs.ts";
import { CaptureLog } from "../../capture/src/store/log.ts";
import type { SiteData } from "../src/types.ts";

const generator = fileURLToPath(new URL("../src/generate.ts", import.meta.url));

test("player refreshes use the latest capture through preseason, play, and corrections", async (t) => {
  const temporaryRoot = resolve(tmpdir());
  const sandbox = await mkdtemp(join(temporaryRoot, "retrievers-player-refresh-"));
  try {
    const dataDir = join(sandbox, "data");
    const outputDir = join(sandbox, "generated");
    const derivedDir = join(dataDir, "derived");
    await mkdir(derivedDir, { recursive: true });
    await writeFile(join(derivedDir, "roster-book.json"), JSON.stringify({ count: 0, entries: [] }));
    await writeFile(join(derivedDir, "statistics-workbook.json"), JSON.stringify({ count: 0, lines: [] }));
    await writeFile(join(derivedDir, "roster-emails.json"), JSON.stringify({ count: 0, files: [] }));
    const store = new BlobStore(join(dataDir, "blobs"));
    const log = new CaptureLog(join(dataDir, "captures.jsonl"));
    const url = "https://web.api.digitalshift.ca/partials/stats/player?player_id=9100001";
    // Small tables test the build's snapshot selection. Parser fidelity is
    // covered separately against the actual captured HarborCenter pages.
    const row = (season: string, gp: number, goals: number) =>
      `<tr><td>${season}</td><td>The Golden Retrievers</td><td>Silver</td><td>F</td><td>${gp}</td><td>${goals}</td><td>0</td><td>${goals}</td><td>0</td></tr>`;
    const summer = row("Summer 2026", 10, 6);
    const page = (winter: string) => `<h1 class="sr-only">Morgan Example</h1>
      <table><tr><th>Season</th><th>Team</th><th>Division</th><th>Pos</th><th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th></tr>
      ${winter}${summer}</table>`;
    const capture = async (content: string, fetchedAt: string) => {
      const { hash } = await store.put(Buffer.from(JSON.stringify({ content })));
      await log.append({
        id: randomUUID(), url, finalUrl: url, status: 200, contentHash: hash,
        contentType: "application/json", fetchedAt, source: "harborcenter-hockeyshift",
        via: "live", waybackTs: null, authenticated: false, discoveredFrom: null, error: null,
      });
    };
    await capture(page(""), "2026-08-20T12:00:00.000Z");
    const cases = [
      { name: "new season with zero games", day: "01", gp: 0, goals: 0 },
      { name: "first game appears only in the newest capture", day: "08", gp: 1, goals: 2 },
      { name: "a later correction lowers the total", day: "09", gp: 1, goals: 1 },
      { name: "the newest capture can return to previously seen bytes", day: "10", gp: 1, goals: 2 },
    ];
    for (const c of cases) {
      await t.test(c.name, async () => {
        await capture(page(row("Fall/Winter 2026-27", c.gp, c.goals)), `2026-10-${c.day}T12:00:00.000Z`);
        // A late import of an old capture must not win by log position.
        await capture(page(""), "2026-08-21T12:00:00.000Z");
        const run = spawnSync(process.execPath, [generator], {
          cwd: sandbox, env: { ...process.env, GR_DATA_DIR: dataDir, GR_SITE_DATA: outputDir },
          encoding: "utf8", timeout: 30_000,
        });
        assert.ifError(run.error);
        assert.equal(run.status, 0, `isolated generation failed:\n${run.stdout}\n${run.stderr}`);
        const built = JSON.parse(await readFile(join(outputDir, "site.json"), "utf8")) as SiteData;
        assert.equal(built.players.length, 1);
        const player = built.players[0]!;
        assert.deepEqual(player.seasons.map((s) => [s.session, s.gp, s.g, s.a, s.pts]), [
          ["2026 - Summer", 10, 6, 0, 6], ["2026 - Winter", c.gp, c.goals, 0, c.goals],
        ]);
        assert.equal(player.career.gp, 10 + c.gp, "earlier snapshots must not add games");
        assert.equal(player.career.g, 6 + c.goals, "earlier snapshots must not add goals");
        assert.equal(built.totals.playerSeasons, 2, "the previous season survives exactly once");
      });
    }
  } finally {
    const target = resolve(sandbox);
    assert.equal(dirname(target), temporaryRoot);
    assert.ok(basename(target).startsWith("retrievers-player-refresh-"));
    await rm(target, { recursive: true, force: true });
  }
});
