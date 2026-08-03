import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readGarmentSpec } from "../src/garments.ts";
import { ITEMS } from "../src/matrix.ts";

/**
 * THE FABRIC PARSER, against REAL Printify responses.
 *
 * `fixtures/blueprint-descriptions.json` is what `GET /catalog/blueprints/{id}`
 * actually returned on 2026-08-03, captured whole and untouched. Nothing here is
 * written by hand, and that is the entire point: this parser had no test, and
 * the invented-fixture version of this file would have passed every assertion
 * while the real one produced the claim below.
 *
 * **WHAT IT GOT WRONG, and why each assertion exists.**
 *
 * Lane Seven LS14004 (bp446), the crewneck this shop sells, is described by
 * Printify as `.:80% cotton, 20% recycled polyester` and, five bullets later,
 * `.:100% cotton face`. The parser matched the *face* and reported the garment
 * as **100% cotton**. That figure:
 *
 *   - chose this blueprint over the Gildan 18000, on the captain's rule of best
 *     material first;
 *   - was written into `matrix.ts` as "the only all-cotton crewneck measured";
 *   - and was PRINTED ON SEVEN LIVE PRODUCT LISTINGS as a fact about a garment
 *     somebody was paying $40 for.
 *
 * In the same run it was silent about Bella+Canvas 3501 — "100% Airlume combed
 * and ring-spun cotton" — because it had no word for Airlume. Wrong about the
 * blend garment, silent about the cotton one, in opposite directions.
 */

type Fixture = { brand?: string; model?: string; title?: string; description?: string };
const FIXTURES = JSON.parse(
  readFileSync(new URL("./fixtures/blueprint-descriptions.json", import.meta.url), "utf8"),
) as Record<string, Fixture>;

const desc = (bp: number): string => {
  const f = FIXTURES[String(bp)];
  assert.ok(f?.description, `fixture for blueprint ${bp} is missing — re-capture it, do not invent one`);
  return f.description;
};

/* ------------------------------------------------------------------ */
/* The one that reached a customer                                     */
/* ------------------------------------------------------------------ */

test("bp446 Lane Seven LS14004 is 80/20, not the '100% cotton face' it advertises", () => {
  const raw = desc(446);
  // The fixture really does contain both claims — if Printify ever rewrites the
  // description this test stops testing what it was written for, and says so.
  assert.match(raw, /80%\s*cotton,\s*20%\s*recycled polyester/i, "fixture no longer carries the fibre line");
  assert.match(raw, /100%\s*cotton face/i, "fixture no longer carries the trap");

  const { blend } = readGarmentSpec(raw);
  assert.notEqual(blend, "100% cotton", "read the cotton FACE as the whole garment — this shipped to customers");
  assert.match(String(blend), /^80\/20 cotton-poly/, `expected 80/20, got ${blend}`);
});

test("bp723 ITC SS3000 states its content and its face in ONE bullet, and the content wins", () => {
  // The first fix for bp446 threw away any bullet mentioning a cotton face.
  // That silenced this one, whose single bullet reads
  // "80% cotton, 20% polyester fleece with 100% cotton face" — the real content
  // and the construction together. Rejecting the bullet loses both; the phrase
  // has to come out and the bullet stay.
  const raw = desc(723);
  assert.match(raw, /80%\s*cotton,\s*20%\s*polyester fleece with 100%\s*cotton face/i, "fixture wording changed");
  const { blend } = readGarmentSpec(raw);
  assert.match(String(blend), /^80\/20 cotton-poly/, `expected 80/20, got ${blend}`);
});

test("bp41 Bella+Canvas 3501 is recognised as all cotton despite the word Airlume", () => {
  const raw = desc(41);
  assert.match(raw, /100%\s*Airlume/i, "fixture no longer carries the Airlume wording");
  const { blend } = readGarmentSpec(raw);
  assert.ok(blend, "returned null for a garment described as 100% cotton");
  assert.match(String(blend), /100% cotton/, `expected an all-cotton reading, got ${blend}`);
});

/* ------------------------------------------------------------------ */
/* No blend may claim an impossible total                              */
/* ------------------------------------------------------------------ */

test("no blueprint is reported with percentages adding to more than 100", () => {
  // Under 100 is legitimate — Flexfit 6277 is 63% polyester, 34% cotton and 3%
  // spandex, and the spandex is not this parser's business. Over 100 never is.
  const bad: string[] = [];
  for (const [bp, f] of Object.entries(FIXTURES)) {
    const { blend } = readGarmentSpec(f.description);
    const m = /^(\d+)\/(\d+) cotton-poly/.exec(blend ?? "");
    if (!m) continue;
    const sum = Number(m[1]) + Number(m[2]);
    if (sum > 100) bad.push(`bp${bp} ${f.brand} ${f.model}: "${blend}" sums to ${sum}`);
  }
  assert.deepEqual(
    bad,
    [],
    `A blend has to be a blend. Yupoong 6245CM read "100/65 cotton-poly" off ` +
      `"100% cotton (Green Camo is 65% polyester, 35% cotton)", and Comfort Colors ` +
      `1545 read "80/80" off "80% Cotton 20% Polyester" — a gap that crossed a ` +
      `second percent sign:\n  ${bad.join("\n  ")}`,
  );
});

/* ------------------------------------------------------------------ */
/* Nothing may be read out of a construction detail                    */
/* ------------------------------------------------------------------ */

test("a cotton face, sweatband or lining is never read as the garment's fibre content", () => {
  // Built from the real bp446 wording, with the fibre bullet removed, so the
  // only "100% cotton" left in the text is the one that is not a fibre content.
  const faceOnly = desc(446).replace(/\.:\s*80%\s*cotton[^.]*/i, "");
  const { blend } = readGarmentSpec(faceOnly);
  assert.notEqual(blend, "100% cotton", "a 100% cotton FACE is a construction, not a blend");
});

/* ------------------------------------------------------------------ */
/* Weight                                                              */
/* ------------------------------------------------------------------ */

test("fabric weight is read for every garment this shop sells that states one", () => {
  // The mug, sticker, cap and beanie state no fabric weight; the six garments do.
  const expected: Record<number, number> = { 12: 4.2, 41: 4.2, 446: 8.25, 420: 4.2, 2002: 10 };
  for (const [bp, oz] of Object.entries(expected)) {
    const { weightOz } = readGarmentSpec(desc(Number(bp)));
    assert.equal(weightOz, oz, `blueprint ${bp} weight`);
  }
});

/* ------------------------------------------------------------------ */
/* The specs we PRINT must not contradict the blueprint                */
/* ------------------------------------------------------------------ */

test("no item's printed spec claims 100% cotton for a garment Printify calls a blend", () => {
  const wrong: string[] = [];
  for (const item of ITEMS) {
    const f = FIXTURES[String(item.blueprintId)];
    if (!f?.description) continue;
    const { blend } = readGarmentSpec(f.description);
    // "a 100% cotton face" is a construction and true of a blend — the crewneck
    // says it deliberately. Strip it the same way the parser does, so this only
    // fires on a claim about what the GARMENT is made of.
    const claim = item.spec.replace(/\d+\s*%\s*[a-z\- ]*?(?:face|back|sweatband|lining|twill tape)\b/gi, " ");
    const weClaimAllCotton = /\b100%\s*cotton\b/i.test(claim);
    const itIsABlend = /cotton-poly/.test(blend ?? "");
    if (weClaimAllCotton && itIsABlend) {
      wrong.push(`${item.id}: we print "100% cotton", blueprint ${item.blueprintId} is ${blend}`);
    }
  }
  assert.deepEqual(
    wrong,
    [],
    `A printed fibre claim that the blueprint contradicts is the one thing this ` +
      `file exists to stop:\n  ${wrong.join("\n  ")}`,
  );
});
