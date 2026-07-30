import { test } from "node:test";
import assert from "node:assert/strict";
import { MATRIX, QUOTES, buildLine } from "../src/matrix.ts";
import {
  REJECTED_QUOTES,
  REJECTED_NORMALISED,
  normaliseQuote,
} from "../src/rejected-quotes.ts";

/**
 * THE QUOTES, and the four ways they have actually gone wrong.
 *
 * Every product carries one line from a player. There is no generator behind
 * them and no scoring function — they are written, read, and struck by hand.
 * What is checkable is not whether a line is good. It is whether the rules the
 * captain has stated out loud are still being kept, and every one of these
 * assertions exists because it was broken at least once:
 *
 * 1. **A struck line came back.** Three times. The rejection lived in a chat
 *    message and the next pass rewrote it from scratch. `rejected-quotes.ts`
 *    is now the record; this is the enforcement.
 * 2. **One line ran on four products.** `QUOTES` used to be keyed by MARK, so
 *    every garment carrying the Boop said the same thing. It is keyed by
 *    PRODUCT now, which only helps if nothing is pasted twice.
 * 3. **A line had no name on it.** "all quotes attributable to a player" was
 *    the instruction; one still ended "— the 2013 game recap".
 * 4. **A product had no line at all.** Adding a MATRIX row is one line of code
 *    and it is easy to forget the quote that goes with it, which shipped a
 *    description that just stopped.
 */

/* ------------------------------------------------------------------ */
/* The quoted sentence, without the attribution                        */
/* ------------------------------------------------------------------ */

/**
 * Split "“line” — Name, position" into its two halves.
 *
 * A few carry a lead-in outside the quotation marks ("On a six-skater loss:")
 * and a few carry a tail after the name ("after a nine-point game"), so this
 * takes the FIRST curly-quoted span as the line and everything after the last
 * em dash as the attribution. Both are what a reader sees as the quote and the
 * name, which is what the rules are about.
 */
function split(text: string): { line: string; who: string } {
  const quoted = text.match(/[“"]([^”"]+)[”"]/);
  const dash = text.lastIndexOf("—");
  return {
    line: quoted?.[1] ?? text,
    who: dash === -1 ? "" : text.slice(dash + 1).trim(),
  };
}

const entries = Object.entries(QUOTES);

/* ------------------------------------------------------------------ */
/* 1. Nothing struck may be printed                                    */
/* ------------------------------------------------------------------ */

test("no quote repeats a line the captain rejected", () => {
  const revived: string[] = [];
  for (const [id, text] of entries) {
    const { line } = split(text);
    if (REJECTED_NORMALISED.has(normaliseQuote(line))) revived.push(`${id}: ${line}`);
  }
  assert.deepEqual(
    revived,
    [],
    `A rejected line is back on a product. It was struck once already — write a ` +
      `new one, or delete it from REJECTED_QUOTES deliberately if he has changed ` +
      `his mind:\n  ${revived.join("\n  ")}`,
  );
});

test("the rejection list itself has no duplicates", () => {
  // Two spellings of the same struck line would silently let one through.
  const seen = new Map<string, string>();
  for (const q of REJECTED_QUOTES) {
    const key = normaliseQuote(q);
    const first = seen.get(key);
    assert.equal(first, undefined, `REJECTED_QUOTES lists the same line twice: "${first}" / "${q}"`);
    seen.set(key, q);
  }
});

/* ------------------------------------------------------------------ */
/* 2. One line, one product                                            */
/* ------------------------------------------------------------------ */

test("no line is used on two products", () => {
  const seen = new Map<string, string>();
  for (const [id, text] of entries) {
    const key = normaliseQuote(split(text).line);
    const first = seen.get(key);
    assert.equal(
      first,
      undefined,
      `${id} and ${first} carry the same line. "We can only use a quote one ` +
        `time" — the map is keyed by product for exactly this reason.`,
    );
    seen.set(key, id);
  }
});

/* ------------------------------------------------------------------ */
/* 3. Every line names a player                                        */
/* ------------------------------------------------------------------ */

test("every quote is attributed to a person", () => {
  for (const [id, text] of entries) {
    const { who } = split(text);
    assert.ok(who.length > 0, `${id} has no attribution — every quote names a player.`);
    // A name, not a source. "the 2013 game recap" was the one that shipped.
    assert.ok(
      /^[A-Z][a-z]+ [A-Z]/.test(who),
      `${id} is attributed to "${who}", which is not a player's name.`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 4. Every product has one                                            */
/* ------------------------------------------------------------------ */

test("every product in the line has a quote", () => {
  const missing = buildLine()
    .filter((product) => !QUOTES[product.id])
    .map((product) => product.id);
  assert.deepEqual(
    missing,
    [],
    `These products would ship a description with no quote in it: ${missing.join(", ")}`,
  );
});

test("no quote is keyed to a product that does not exist", () => {
  const ids = new Set(MATRIX.map((entry) => `${entry.mark}-${entry.item}`));
  const orphans = Object.keys(QUOTES).filter((id) => !ids.has(id));
  assert.deepEqual(
    orphans,
    [],
    `Written for products that are no longer in MATRIX — they print nowhere: ${orphans.join(", ")}`,
  );
});
