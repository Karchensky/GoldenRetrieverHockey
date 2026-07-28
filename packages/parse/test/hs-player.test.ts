import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHsPlayer,
  playerNameOf,
  isRetrieversRow,
  tableKind,
} from "../src/digitalshift/player.ts";
import { cellsOf, rowsOf } from "../src/html.ts";
import { corpusHtml, corpusPages, corpusSnapshots } from "./helpers/corpus.ts";

/**
 * REAL CAPTURED BYTES ONLY — no hand-written page fixtures.
 *
 * The version of this file that these tests replace was 100% authored HTML,
 * and it was green while the parser read every goalie's games-played as his
 * POSITION. It could not have been otherwise: the fixture had a `Pos` column
 * in the season table, and HarborCenter's goalie table does not have one. The
 * fixture also asserted an `<h1 class="sr-only">` name header that appears in
 * ZERO of the 72 captured player partials.
 *
 * So: every assertion below runs against bytes that were actually served.
 * `partial()` fails loudly if the corpus is missing rather than passing
 * vacuously — a test that cannot see the archive must not report success.
 */

/**
 * The LATEST captured `partials/stats/player?player_id=<id>` body, unwrapped.
 *
 * ONE PAGE PER PLAYER, NOT ONE PAGE IN THE CORPUS. This used to assert that
 * the corpus held exactly one capture per player, and that assertion was a
 * claim about the SHAPE OF THE ARCHIVE rather than about the parser. It broke
 * the first time anyone refreshed the live season: a player's page genuinely
 * changes when he plays a game, so a second capture is a second distinct body,
 * and fourteen tests failed for the crime of the archive having grown.
 *
 * That is the worst possible failure mode here — a suite that goes red when
 * new evidence arrives teaches the next session to stop capturing, and finding
 * more of the record is the whole point of this project.
 *
 * What is worth guarding is kept and is the reason this still asserts at all:
 * a corpus that is MISSING must fail loudly, never pass vacuously. Hence
 * `>= 1`. `corpusPages` returns the newest capture of each URL, which is the
 * archive's last word and the one the build reads.
 */
function partial(id: number): string {
  // No trailing %: the id ends the URL, so this cannot match a longer id.
  const pages = corpusPages(`%partials/stats/player?player_id=${id}`);
  assert.ok(
    pages.length >= 1,
    `no captured page for player ${id} — these tests are worthless without the corpus`,
  );
  assert.equal(pages.length, 1, `corpusPages must collapse player ${id} to one page`);
  // DigitalShift partials are a JSON envelope; the HTML is in `.content`.
  return (JSON.parse(pages[0]!.html) as { content: string }).content;
}

/** EVERY captured body for one player, OLDEST FIRST — for duplicate-safety. */
function allSnapshotsOf(id: number): string[] {
  return corpusSnapshots(`%partials/stats/player?player_id=${id}`).map(
    (s) => (JSON.parse(s.html) as { content: string }).content,
  );
}

/**
 * The latest captured partial for each player — one per player, never one per
 * capture.
 *
 * Same reasoning as `partial`. Every count below is per-player ("25 goalie
 * season lines", "72 pages, 68 names"), so returning a re-captured page twice
 * silently doubles them, which is exactly what happened.
 */
function allPartials(): string[] {
  const pages = corpusPages("%partials/stats/player?player_id=%");
  assert.ok(pages.length >= 70, `corpus has only ${pages.length} player pages`);
  return pages.map((p) => (JSON.parse(p.html) as { content: string }).content);
}

/**
 * The page's OWN totals row for a season table, as raw cells.
 *
 * Every season table ends with an aggregate the parser deliberately skips.
 * Comparing the parsed rows' sum against it is the real test of column
 * alignment — if any column had shifted, the two would not agree — and unlike
 * a hardcoded "169" it stays true while a season is being played.
 */
function totalsRow(content: string, kind: "skater" | "goalie"): string[] | null {
  for (const t of content.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const rows = rowsOf(t);
    const head = rows.find((r) => /<th[\s>]/.test(r));
    if (!head) continue;
    const headers = cellsOf(head);
    if (headers[0] !== "Season") continue;
    if (tableKind(headers) !== kind) continue;
    // The aggregate is the last body row and is the one with a blank session.
    const body = rows.filter((r) => !/<th[\s>]/.test(r)).map(cellsOf);
    const agg = body.findLast((c) => (c[0] ?? "").trim() === "");
    if (agg) return agg;
  }
  return null;
}

const MUFF = 2406820; // goalie, #1
const KARCHENSKY = 2350393; // skater, known-good career
const ARNOLD = 2406891; // the only player with BOTH a skater and a goalie table

test("the two real season tables differ by exactly the Pos column", () => {
  // Arnold's page carries both shapes, so both come from one captured body.
  const content = partial(ARNOLD);
  const headers: string[][] = [];
  for (const t of content.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const head = rowsOf(t).find((r) => /<th[\s>]/.test(r));
    if (!head) continue;
    const h = cellsOf(head);
    if (h[0] === "Season") headers.push(h);
  }
  const skater = headers.find((h) => h.includes("Pos"))!;
  const goalie = headers.find((h) => !h.includes("Pos"))!;
  assert.ok(skater && goalie, "the real page carries both table shapes");

  // This IS the bug: the goalie table has no position column at all, so the
  // fixed prefix is one narrower and `Pos` positionally lands on GP.
  assert.equal(skater[3], "Pos");
  assert.equal(goalie[3], "GP", "index 3 of a goalie row is GAMES PLAYED");
  assert.ok(!goalie.includes("Pos"));
  assert.ok(goalie.includes("GAA") && goalie.includes("Sv%"));

  assert.equal(tableKind(skater), "skater");
  assert.equal(tableKind(goalie), "goalie");
});

test("Corey Muff reads as a goaltender, not as his games played", () => {
  const p = parseHsPlayer(partial(MUFF), MUFF);
  assert.equal(p.name, "Corey Muff");
  assert.ok(p.career.length > 0);
  for (const r of p.career) {
    assert.equal(r.kind, "goalie");
    assert.equal(r.position, "G");
    assert.doesNotMatch(
      r.position,
      /^\d+$/,
      "a position is never a number — that was his GP bleeding through",
    );
  }
});

test("Corey Muff's GP is read, not dropped", () => {
  const content = partial(MUFF);
  const p = parseHsPlayer(content, MUFF);
  assert.ok(p.career.length >= 11, `only ${p.career.length} sessions`);
  for (const r of p.career) {
    assert.notEqual(r.stats.GP, undefined, `${r.session} lost its GP`);
    assert.match(r.stats.GP!, /^\d+$/);
  }
  // Newest first, and the newest is the session being played.
  assert.match(p.career[0]!.session, /^(Summer|Fall\/Winter) \d{4}/);

  // CROSS-CHECK AGAINST THE PAGE'S OWN TOTALS ROW, which the parser skips.
  // If any column had shifted, the parsed rows would not sum to it.
  //
  // Read from the page rather than written down here. It used to read
  // `assert.equal(sum("GP"), 169)`, and 169 was true on the day it was
  // written and false the first time the team played another game — which is
  // a fact about a season in progress, not about this parser. The invariant
  // is that the parts equal the whole, and that is true every week.
  const agg = totalsRow(content, "goalie");
  assert.ok(agg, "the page carries a goalie totals row to check against");
  // The aggregate omits Team and Division, so it is two cells narrower than
  // the header: its index 1 is GP, where the header's index 3 is.
  const total = (i: number) => Number(agg![i]);
  const sum = (k: string) =>
    p.career.reduce((s, r) => s + Number(r.stats[k] ?? 0), 0);
  assert.equal(sum("GP"), total(1), "games played");
  assert.equal(sum("W"), total(2), "wins");
  assert.equal(sum("L"), total(3), "losses");
  assert.equal(sum("SA"), total(6), "shots against");
  assert.equal(sum("GA"), total(7), "goals against");
});

test("Corey Muff's career line is internally consistent", () => {
  const content = partial(MUFF);
  const p = parseHsPlayer(content, MUFF);
  const sum = (k: string) =>
    p.career.reduce((s, r) => s + Number(r.stats[k] ?? 0), 0);

  // A FINISHED session, deliberately. His one goal is real and Fall/Winter
  // 2022-23 ended years ago, so this row can never move again — unlike the
  // career totals, which do every time he plays.
  const scored = p.career.find((r) => r.session === "Fall/Winter 2022-23")!;
  assert.equal(scored.stats.G, "1");
  assert.equal(scored.stats.A, "0");
  assert.equal(scored.stats.Pts, "1", "1 goal cannot be 0 points");

  // The identity that must hold in every session, played or finished.
  assert.equal(sum("Pts"), sum("G") + sum("A"));
  // G and A are the LAST two cells of the aggregate. Indices 14 and 15, not
  // the header's 16 and 17: the aggregate omits Team and Division.
  const agg = totalsRow(content, "goalie")!;
  assert.equal(agg.length, 16, "16 cells against 18 headers — Team and Division are dropped");
  assert.equal(sum("G"), Number(agg[14]), "goals, against the page's own total");
  assert.equal(sum("A"), Number(agg[15]), "assists, against the page's own total");
});

test("goalie stats are preserved exactly as recorded, garbage included", () => {
  // The source says SA is a copy of GA and Sv is 0 even in wins. That is
  // wrong, and it is what was served. Reading it correctly is the job;
  // repairing it is not.
  let lines = 0;
  let wins = 0;
  for (const content of allPartials()) {
    for (const r of parseHsPlayer(content).career) {
      if (r.kind !== "goalie") continue;
      lines++;
      assert.equal(r.stats.SA, r.stats.GA, "shots against IS goals against");
      assert.equal(r.stats.Sv, "0");
      assert.equal(r.stats["Sv%"], ".000");
      if (Number(r.stats.W) > 0) wins++;
    }
  }
  // AT LEAST, not EXACTLY. These grow: a goalie playing a new session adds a
  // line, and the corpus is meant to grow. What is being tested is that every
  // line, however many there are, carries the source's own garbage unrepaired.
  assert.ok(lines >= 25, `${lines} goalie season lines — was 25 and must not shrink`);
  assert.ok(wins >= 23, `${wins} lines with wins — was 23 and must not shrink`);

  // A FINISHED session of Muff's, which can never move again. Summer 2026 was
  // here and its every figure changed the first time he played another game.
  const muff = parseHsPlayer(partial(MUFF), MUFF).career.find(
    (r) => r.session === "Summer 2021",
  )!;
  assert.equal(muff.stats.GP, "12");
  assert.equal(muff.stats.SA, "57");
  assert.equal(muff.stats.GA, "57");
  assert.equal(muff.stats.GAA, "4.75");
  assert.equal(muff.stats.MP, "504:00");
  assert.equal(muff.stats.SO, "0");
  assert.equal(muff.stats.W, "6");
  assert.equal(muff.stats.OTL, "0");
});

test("goalie game rows keep DEC and are not read as a position", () => {
  const p = parseHsPlayer(partial(MUFF), MUFF);
  assert.ok(p.games.length > 0);

  // THE BUG THIS GUARDS: reading `Pos` positionally on a goalie row takes the
  // DECISION column as the position, so every goalie game reads position "W",
  // "L" or "T" and the decision vanishes. Asserted over EVERY game rather than
  // over game zero, whose date and decision change every week the team plays.
  const DECISIONS = new Set(["", "W", "L", "T", "OTL", "SOW", "SOL"]);
  for (const x of p.games) {
    assert.equal(x.kind, "goalie");
    assert.equal(x.position, "G", "not the decision column bleeding through");
    assert.ok(DECISIONS.has(x.stats.DEC!), `unknown decision ${JSON.stringify(x.stats.DEC)}`);
    assert.match(x.stats.MP!, /^\d+:\d\d$/, "minutes played is in the MP column");
    assert.match(x.date, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    assert.equal(x.stats.SA, x.stats.GA);
  }
});

test("the DEC column carries every decision the corpus records", () => {
  // Measured, not assumed: the shootout decisions are real and a first pass
  // at this test guessed W/L/T/OTL and was wrong.
  const seen = new Map<string, number>();
  for (const content of allPartials()) {
    for (const g of parseHsPlayer(content).games) {
      if (g.kind !== "goalie") continue;
      seen.set(g.stats.DEC!, (seen.get(g.stats.DEC!) ?? 0) + 1);
    }
  }
  // The VOCABULARY is the finding, and it is fixed. The counts are not: every
  // one of them goes up when a goalie plays, and pinning them made this test
  // a tripwire on the archive growing rather than on the parser changing.
  assert.deepEqual(
    [...seen.keys()].sort(),
    ["", "L", "OTL", "SOL", "SOW", "T", "W"],
    "every goalie decision the archive records, and no others",
  );
  // Each is genuinely present, including the blank — §2.4's whole point.
  for (const [dec, n] of seen) assert.ok(n > 0, `${JSON.stringify(dec)} appears`);
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  assert.ok(total >= 271, `${total} goalie games — was 271 and must not shrink`);
});

test("a blank cell stays blank — it is not zero and it is not dropped", () => {
  // §2.4, against real bytes: two captured goalie games have an EMPTY DEC.
  // Dropping the empty cell would shift every column behind it; coercing it
  // would invent a decision that was never recorded.
  const blank = allPartials()
    .flatMap((c) => parseHsPlayer(c).games)
    .filter((g) => g.kind === "goalie" && g.stats.DEC === "");
  assert.ok(blank.length >= 2, `${blank.length} blank decisions — was 2 and must not shrink`);
  for (const g of blank) {
    assert.equal(g.stats.DEC, "");
    assert.notEqual(g.stats.DEC, "0");
    // The columns behind the gap are still aligned.
    assert.equal(g.stats.SA, g.stats.GA);
    assert.match(g.stats.MP!, /^\d+:\d\d$/, "minutes played did not shift");
  }
});

test("the skater path is unchanged", () => {
  const p = parseHsPlayer(partial(KARCHENSKY), KARCHENSKY);
  assert.equal(p.name, "Bryan Karchensky");

  // A FINISHED session. Summer 2026 was here, and every figure in it moved
  // the week the team played two more games — GP 5 -> 7, Pts 4 -> 10. A test
  // of the skater column layout must not be a test of the current standings.
  //
  // MATCHED ON SESSION *AND* TEAM. He played Fall/Winter 2021-22 twice, for
  // the Retrievers and for Classic Cue's Billiards, and a session-only `find`
  // returns whichever the page lists first — which is how the first draft of
  // this line asserted the Retrievers and got Classic Cue's. Men on two teams
  // in one session is normal here, not an anomaly to code around.
  const s = p.career.find(
    (r) => r.session === "Fall/Winter 2021-22" && r.team === "Golden Retrievers",
  )!;
  assert.ok(s, "the Retrievers row for a session he played twice");
  assert.equal(s.kind, "skater");
  assert.equal(s.teamId, 134248, "team id comes from the href, not the text");
  assert.equal(s.division, "Silver");
  assert.equal(s.position, "F");
  assert.equal(s.stats.GP, "22");
  assert.equal(s.stats.Pts, "57");
  assert.equal(s.stats.GWG, "2", "the 13th column must not be lost");

  // The current session is still read, and still reads as a skater row.
  const now = p.career[0]!;
  assert.equal(now.kind, "skater");
  assert.equal(now.position, "F");
  assert.match(now.stats.GP!, /^\d+$/);

  const g = p.games[0]!;
  assert.equal(g.kind, "skater");
  assert.equal(g.position, "F");
  assert.match(g.game, / vs /, "the game log names both teams");
});

test("responsive duplicate tables do NOT double the career", () => {
  // The SPA renders each table twice (desktop + mobile). Without dedupe every
  // career doubles and every downstream total is exactly 2x wrong.
  const p = parseHsPlayer(partial(KARCHENSKY), KARCHENSKY);
  const keys = p.career.map((r) => `${r.session}|${r.team}|${r.kind}`);
  assert.equal(new Set(keys).size, keys.length, "no session counted twice");
  const gk = p.games.map((r) => `${r.date}|${r.game}|${r.kind}`);
  assert.equal(new Set(gk).size, gk.length, "no game counted twice");
});

test("one session can be BOTH a skater row and a goalie row", () => {
  // Devin Arnold, Summer 2024, Mooseheads: he skated one game and tended goal
  // in ten. Two rows, two tables, same session and team. Deduping on
  // session|team alone silently deletes the goalie row.
  const p = parseHsPlayer(partial(ARNOLD), ARNOLD);
  const both = p.career.filter(
    (r) => r.session === "Summer 2024" && r.team === "Mooseheads",
  );
  assert.equal(both.length, 2, "both rows survive");
  const sk = both.find((r) => r.kind === "skater")!;
  const go = both.find((r) => r.kind === "goalie")!;
  assert.equal(sk.stats.GP, "1");
  assert.equal(go.stats.GP, "10");
  assert.equal(go.stats.W, "2");
  // The skater table records "G" for this row, in the source's own hand —
  // which is why goalie-table rows are labelled "G" too.
  assert.equal(sk.position, "G");
});

test("the totals row is not ingested as a session", () => {
  // Every season table ends with an aggregate row (blank session, 16 cells vs
  // 18 headers). Ingesting it invents a phantom session AND double-counts.
  const content = partial(MUFF);
  const p = parseHsPlayer(content, MUFF);
  assert.ok(p.career.length >= 11);
  // The aggregate's own GP, read off the page — the exact value a phantom
  // session would carry, whatever it happens to be this week.
  const aggGp = totalsRow(content, "goalie")![1];
  assert.ok(!p.career.some((r) => r.stats.GP === aggGp), "no phantom session");
  assert.ok(p.career.every((r) => r.session && r.team));
});

test("both live team-name variants are recognised as the Retrievers", () => {
  const p = parseHsPlayer(partial(MUFF), MUFF);
  const gr = p.career.filter(isRetrieversRow);
  assert.equal(gr.length, p.career.length, "every one of his sessions is a Retrievers session");
  assert.ok(gr.length >= 11);
  assert.ok(gr.some((r) => r.team === "The Golden Retrievers"));
  assert.ok(gr.some((r) => r.team === "Golden Retrievers"));
  // ...and another team is not.
  const a = parseHsPlayer(partial(ARNOLD), ARNOLD);
  assert.ok(!a.career.filter(isRetrieversRow).some((r) => r.team === "Burners"));
});

test("every captured player page yields a name", () => {
  // The build drops any page whose name is null, so this is load-bearing.
  const names = allPartials().map((c) => playerNameOf(c));
  assert.ok(names.length >= 72, `${names.length} player pages — was 72`);
  assert.ok(!names.includes(null), "a nameless page is dropped by the build");

  // NOT distinct: at 72 pages there were 68 names. Three men each hold more
  // than one DigitalShift id (Ryan Neidrauer has three), and every id is its
  // own page. Recorded here because it is true, not because it is tidy.
  assert.ok(names.length - new Set(names).size >= 4, "the duplicate ids are still duplicates");
});

test("a re-captured player is one career, not two", () => {
  // THE PROPERTY THIS FILE PREVIOUSLY ASSUMED RATHER THAN TESTED.
  //
  // Refreshing the live season captures a player's page a second time, and
  // because he has played since, the body genuinely differs — so the corpus
  // now holds two distinct blobs for the same URL. The danger is that both get
  // read and his career comes out doubled, which is the exact shape of the
  // 1,064-phantom-goals bug: plausible numbers, twice as large as the truth.
  //
  // The old assertion here was "the corpus holds exactly one page per player",
  // which forbade the situation instead of testing it, and went red the moment
  // it arose. This tests the thing that actually matters, against the two real
  // snapshots that now exist.
  const repeats = [MUFF, KARCHENSKY, ARNOLD].filter((id) => allSnapshotsOf(id).length > 1);
  assert.ok(
    repeats.length > 0,
    "no player has been captured twice yet — re-run the sync and this test gains its teeth",
  );

  for (const id of repeats) {
    const snapshots = allSnapshotsOf(id);

    // 1. Each snapshot on its own is internally deduped: the SPA renders every
    //    table twice (desktop + mobile) and both copies are in the bytes.
    //
    //    Measured, so the claim is not larger than the check: `parseHsPlayer`
    //    dedupes career rows on session|team|kind and keeps the FIRST, so it
    //    cannot emit a doubled career even if two whole bodies were handed to
    //    it at once — verified by concatenating these two snapshots, which
    //    yields 19 rows, not 38. What concatenation DOES do is silently keep
    //    the older figures (Summer 2026 GP 5, not 7), which is why the real
    //    protection is choosing exactly one body, and why the next test
    //    exists.
    for (const [i, content] of snapshots.entries()) {
      const p = parseHsPlayer(content, id);
      const keys = p.career.map((r) => `${r.session}|${r.team}|${r.kind}`);
      assert.equal(
        new Set(keys).size,
        keys.length,
        `player ${id} snapshot ${i}: a session is counted twice`,
      );
      const games = p.games.map((r) => `${r.date}|${r.game}|${r.kind}`);
      assert.equal(new Set(games).size, games.length, `player ${id} snapshot ${i}: a game is counted twice`);
    }

    // 2. The snapshots agree on identity and on the SHAPE of the career. A
    //    later capture must not add a row for a session that already existed —
    //    that is what doubling would look like from the outside.
    const parsed = snapshots.map((c) => parseHsPlayer(c, id));
    const names = new Set(parsed.map((p) => p.name));
    assert.equal(names.size, 1, `player ${id} is one man across every capture`);
    const sessionSets = parsed.map((p) => new Set(p.career.map((r) => `${r.session}|${r.kind}`)));
    for (const s of sessionSets) {
      assert.equal(s.size, sessionSets[0]!.size, `player ${id}: the session list changed size`);
    }

    // 3. EVERY FINISHED session reads identically no matter which capture it
    //    came from. A settled season is where summing two snapshots rather
    //    than superseding one would show first, and this checks all of them
    //    rather than a session guessed in advance.
    //
    //    Keyed on session|team|kind, never on session alone: a man can play
    //    two teams in one session, and both rows are real.
    const live = parsed[0]!.career[0]!.session;
    const settledOf = (p: (typeof parsed)[number]) =>
      new Map(
        p.career
          .filter((r) => r.session !== live)
          .map((r) => [`${r.session}|${r.team}|${r.kind}`, JSON.stringify(r.stats)] as const),
      );
    const baseline = settledOf(parsed[0]!);
    for (const p of parsed.slice(1)) {
      const later = settledOf(p);
      assert.equal(later.size, baseline.size, `player ${id}: the settled season count changed`);
      for (const [key, stats] of baseline) {
        assert.equal(later.get(key), stats, `player ${id}: ${key} differs between captures`);
      }
    }

    // 4. The LIVE session only ever grows. `allSnapshotsOf` is ordered oldest
    //    first, so a later capture reporting fewer games played means the
    //    newer body was misread — or an older one is being preferred.
    const gps = parsed.map((p) =>
      p.career
        .filter((r) => r.session === live)
        .reduce((s, r) => s + Number(r.stats.GP ?? 0), 0),
    );
    for (let i = 1; i < gps.length; i++) {
      assert.ok(gps[i]! >= gps[i - 1]!, `player ${id}: ${live} GP went ${gps[i - 1]} -> ${gps[i]}`);
    }
  }
});

test("the build reads the archive's LAST word, not every word", () => {
  // `partial()` goes through corpusPages, which collapses a URL to its newest
  // capture. That is the same rule the build layer applies, and it is what
  // keeps a re-captured page from being counted twice downstream.
  const twice = [MUFF, KARCHENSKY, ARNOLD].find((id) => allSnapshotsOf(id).length > 1);
  if (twice === undefined) return; // nothing captured twice yet
  const chosen = parseHsPlayer(partial(twice), twice);
  const every = allSnapshotsOf(twice).map((c) => parseHsPlayer(c, twice));
  const live = chosen.career[0]!.session;
  const gpIn = (p: (typeof every)[number]) =>
    p.career.filter((r) => r.session === live).reduce((s, r) => s + Number(r.stats.GP ?? 0), 0);

  const chosenGp = gpIn(chosen);
  const perSnapshot = every.map(gpIn);
  assert.equal(chosenGp, Math.max(...perSnapshot), "the chosen page is the most recent, not the first");
  assert.notEqual(
    chosenGp,
    perSnapshot.reduce((a, b) => a + b, 0),
    "and it is one page's figure, never the sum of both",
  );
});

test("parseHsPlayer on an empty partial yields empty, not a throw", () => {
  const p = parseHsPlayer("<div>no tables</div>");
  assert.deepEqual(p.career, []);
  assert.deepEqual(p.games, []);
});
