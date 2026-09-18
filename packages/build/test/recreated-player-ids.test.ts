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

test("recreated player and team IDs preserve one career without counting both source routes twice", async () => {
  const temporaryRoot = resolve(tmpdir());
  const sandbox = await mkdtemp(join(temporaryRoot, "retrievers-recreated-ids-"));
  try {
    const dataDir = join(sandbox, "data");
    const outputDir = join(sandbox, "generated");
    const derivedDir = join(dataDir, "derived");
    await mkdir(derivedDir, { recursive: true });
    // Explicit empty records keep the real generator independent of the
    // production corpus and of any private source files in the working tree.
    await writeFile(join(derivedDir, "roster-book.json"), JSON.stringify({ count: 0, entries: [] }));
    await writeFile(join(derivedDir, "statistics-workbook.json"), JSON.stringify({ count: 0, lines: [] }));
    await writeFile(join(derivedDir, "roster-emails.json"), JSON.stringify({ count: 0, files: [] }));

    const store = new BlobStore(join(dataDir, "blobs"));
    const log = new CaptureLog(join(dataDir, "captures.jsonl"));
    const capture = async (route: string, content: string) => {
      const url = `https://web.api.digitalshift.ca/partials/stats/${route}`;
      const { hash } = await store.put(Buffer.from(JSON.stringify({ content })));
      await log.append({
        id: randomUUID(), url, finalUrl: url, status: 200, contentHash: hash,
        contentType: "application/json", fetchedAt: "2026-10-16T12:00:00.000Z",
        source: "harborcenter-hockeyshift", via: "live", waybackTs: null,
        authenticated: false, discoveredFrom: null, error: null,
      });
    };

    // These small tables exercise identity and cross-route deduplication in
    // the actual build. Parser fidelity has separate captured-corpus tests.
    const seasons = [
      { label: "Summer 2026", teamId: 8100001, playerId: 9100001, gp: 5, g: 3, a: 4 },
      { label: "Fall/Winter 2026-27", teamId: 8200001, playerId: 9200001, gp: 2, g: 1, a: 2 },
    ];
    for (const season of seasons) {
      const stats = `<td>${season.gp}</td><td>${season.g}</td><td>${season.a}</td><td>${season.g + season.a}</td><td>0</td>`;
      await capture(`team?team_id=${season.teamId}`,
        `<h1 class="sr-only">The Golden Retrievers, ${season.label}, Silver</h1>`);
      // The old and recreated player pages each know only their own season.
      await capture(`player?player_id=${season.playerId}`, `
        <h1 class="sr-only">Morgan Example</h1>
        <table><tr><th>Season</th><th>Team</th><th>Division</th><th>Pos</th><th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th></tr>
          <tr><td>${season.label}</td><td><a href="stats#/1367/team/${season.teamId}">The Golden Retrievers</a></td><td>Silver</td><td>F</td>${stats}</tr>
        </table>`);
      await capture(`team/stats?team_id=${season.teamId}`, `
        <h3>Player Stats - Regular Season</h3>
        <table><tr><th>#</th><th>Name</th><th>Pos</th><th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th></tr>
          <tr><td>21</td><td><a href="stats#/player/${season.playerId}">Morgan Example</a></td><td>F</td>${stats}</tr>
        </table>`);
    }

    const run = spawnSync(process.execPath, [generator], {
      cwd: sandbox,
      env: { ...process.env, GR_DATA_DIR: dataDir, GR_SITE_DATA: outputDir },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.ifError(run.error);
    assert.equal(run.status, 0, `isolated generation failed:\n${run.stdout}\n${run.stderr}`);
    const built = JSON.parse(await readFile(join(outputDir, "site.json"), "utf8")) as SiteData;
    assert.equal(built.players.length, 1, "a recreated ID must not create another player profile");
    const player = built.players[0]!;
    assert.equal(player.name, "Morgan Example");
    assert.deepEqual(player.seasons.map((season) => season.session).sort(), ["2026 - Summer", "2026 - Winter"]);
    assert.deepEqual(player.seasons.map((season) => [season.gp, season.g, season.a, season.pts]), [[5, 3, 4, 7], [2, 1, 2, 3]]);
    assert.ok(player.seasons.every((season) => season.jersey === "21"), "the team roster contributes its jersey without duplicating the career row");
    assert.deepEqual({ gp: player.career.gp, g: player.career.g, a: player.career.a, pts: player.career.pts }, { gp: 7, g: 4, a: 6, pts: 10 });
    assert.equal(built.totals.playerSeasons, 2, "career and team stats describe two season lines, not four");
  } finally {
    const target = resolve(sandbox);
    assert.equal(dirname(target), temporaryRoot);
    assert.ok(basename(target).startsWith("retrievers-recreated-ids-"));
    await rm(target, { recursive: true, force: true });
  }
});
