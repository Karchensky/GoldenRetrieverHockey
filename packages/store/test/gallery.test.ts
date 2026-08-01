import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANGLES,
  KNOWN_LABELS,
  cameraLabel,
  chooseGallery,
  heroIndexFor,
  lightness,
  variantInUrl,
} from "../src/gallery.ts";
import type { ProviderImage } from "../src/gallery.ts";
import { ROOT, buildLine } from "../src/matrix.ts";

/**
 * WHICH PHOTOGRAPH, AND OF WHAT COLOUR.
 *
 * **Every assertion here runs against bytes Printify actually returned.** The
 * fixture is written by `cli.ts mockups` straight out of the API and is never
 * hand-edited — recapture it instead. That rule is not fussiness: an invented
 * fixture in this repository once passed thirteen tests out of thirteen and
 * produced 1,064 goals that never happened. A composed `images[]` here would
 * agree with whatever `chooseGallery` did on the day it was written, which is
 * the one thing a test must not do.
 *
 * Four products, chosen for the shapes that break:
 *
 *   crossed-shield-tee           six colourways and 198 renders — the case the
 *                                old `.slice(0, 4)` truncated, losing Navy and
 *                                Heather Navy on seven products
 *   championship-roundel-hoodie  printed on the BACK, so its default view is a
 *                                photograph of a blank white hoodie
 *   rink-board-cap               where the two `size-chart` images turned up
 *   crossed-shield-sticker       one colour, one studio view: the floor
 */

type Fixture = {
  capturedAt: string;
  products: { ourId: string; product: { images: ProviderImage[] } }[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(join(ROOT, "packages/store/test/fixtures/printify-images.json"), "utf8"),
);

const LINE = new Map(buildLine().map((i) => [i.id, i]));

/** The captured products, joined to the matrix rows that describe them. */
const CASES = fixture.products.map((entry) => {
  const item = LINE.get(entry.ourId);
  assert.ok(item, `fixture holds ${entry.ourId}, which is not in the matrix`);
  const printed = new Set(item.placements.map((p) => p.position));
  const problems: string[] = [];
  return {
    id: entry.ourId,
    item,
    printed,
    images: entry.product.images,
    problems,
    gallery: chooseGallery(entry.product.images, item, printed, problems),
  };
});

const caseFor = (id: string) => {
  const c = CASES.find((x) => x.id === id);
  assert.ok(c, `no fixture for ${id}`);
  return c;
};

/* ------------------------------------------------------------------ */
/* The colour of a photograph                                          */
/* ------------------------------------------------------------------ */

test("every chosen photograph names a colourway the product actually sells", () => {
  for (const c of CASES) {
    const sold = new Set(c.item.colors.map((x) => x.name));
    for (const m of c.gallery) {
      assert.ok(sold.has(m.color), `${c.id}: chose a photograph of "${m.color}", which is not sold`);
    }
  }
});

test("the URL's variant id agrees with variant_ids on every chosen photograph", () => {
  for (const c of CASES) {
    const colourOf = new Map<number, string>();
    for (const col of c.item.colors) for (const v of col.variants) colourOf.set(v, col.name);
    for (const m of c.gallery) {
      const fromUrl = variantInUrl(m.src);
      assert.notEqual(fromUrl, null, `${c.id}: no variant id in ${m.src}`);
      assert.equal(
        colourOf.get(fromUrl!),
        m.color,
        `${c.id}: the URL of a ${m.color} photograph points at a different colourway`,
      );
    }
  }
});

/* ------------------------------------------------------------------ */
/* No people. The captain's rule, and the one this file exists for.    */
/* ------------------------------------------------------------------ */

test("no photograph of a person reaches the page", () => {
  // Not the old /person/ regex — that is the bug. `lifestyle-man`,
  // `lifestyle-woman`, `duo` and `duo-2` are all human beings and none of them
  // contains the word "person".
  const PEOPLE = /person|lifestyle|duo/i;
  for (const c of CASES) {
    for (const m of c.gallery) {
      assert.ok(!PEOPLE.test(m.camera), `${c.id}: "${m.camera}" is a photograph of a person`);
    }
  }
});

test("the fixture really does contain person shots, so the test above can fail", () => {
  // A filter test that runs against input with nothing to filter proves nothing.
  const PEOPLE = /person|lifestyle|duo/i;
  const found = CASES.flatMap((c) => c.images.map((i) => cameraLabel(i.src))).filter((l) => PEOPLE.test(l));
  assert.ok(found.length > 20, `only ${found.length} person renders in the fixture — is it still real?`);
});

test("a size chart is not a photograph of the product", () => {
  for (const c of CASES) {
    for (const m of c.gallery) {
      assert.notEqual(m.camera, "size-chart", `${c.id}: a size chart reached the gallery`);
    }
  }
  // The cap is where the two that shipped came from.
  const cap = caseFor("rink-board-cap");
  assert.ok(
    cap.images.some((i) => cameraLabel(i.src) === "size-chart"),
    "the cap fixture no longer carries a size-chart render",
  );
});

test("only labels named in ANGLES survive, and staged prop scenes are not among them", () => {
  for (const c of CASES) {
    const allowed = ANGLES[c.item.itemId];
    assert.ok(allowed, `${c.id}: no angle set`);
    for (const m of c.gallery) {
      assert.ok(allowed.includes(m.camera), `${c.id}: "${m.camera}" is not in the angle set`);
      assert.ok(!m.camera.startsWith("context"), `${c.id}: "${m.camera}" is a staged scene`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Coverage — the regression that lost Navy                            */
/* ------------------------------------------------------------------ */

test("every colourway gets photographs — the cap that lost Navy is gone", () => {
  const tee = caseFor("crossed-shield-tee");
  assert.equal(tee.item.colors.length, 6, "the tee is no longer the six-colour case");

  const shown = new Set(tee.gallery.map((m) => m.color));
  for (const colour of tee.item.colors) {
    assert.ok(shown.has(colour.name), `crossed-shield-tee has no photograph of ${colour.name}`);
  }
  // Named explicitly: these two are the ones the old `.slice(0, 4)` dropped.
  assert.ok(shown.has("Navy"), "Navy is unphotographed again");
  assert.ok(shown.has("Heather Navy"), "Heather Navy is unphotographed again");
});

test("switching colour cannot change how many photographs are on the page", () => {
  for (const c of CASES) {
    const perColour = new Map<string, number>();
    for (const m of c.gallery) perColour.set(m.color, (perColour.get(m.color) ?? 0) + 1);
    const counts = [...new Set(perColour.values())];
    assert.equal(
      counts.length,
      1,
      `${c.id}: colourways carry different numbers of photographs — ${[...perColour]
        .map(([k, v]) => `${k}:${v}`)
        .join(" ")}`,
    );
  }
});

test("a product shows more than one angle wherever the provider renders one", () => {
  for (const c of CASES) {
    const angles = new Set(c.gallery.map((m) => m.camera));
    const available = ANGLES[c.item.itemId]!.length;
    if (available === 1) continue; // the sticker: one studio view exists, full stop
    assert.ok(angles.size > 1, `${c.id}: only one angle (${[...angles]}) despite ${available} in the set`);
  }
});

test("photographs are grouped by colourway, not interleaved", () => {
  // The index into this array is the filename on disk, so the grouping is what
  // lets the page address "the photographs of Navy" as a contiguous run.
  for (const c of CASES) {
    const seen: string[] = [];
    for (const m of c.gallery) if (seen[seen.length - 1] !== m.color) seen.push(m.color);
    assert.equal(new Set(seen).size, seen.length, `${c.id}: a colourway appears in two separate runs`);
  }
});

/* ------------------------------------------------------------------ */
/* The printed face leads                                              */
/* ------------------------------------------------------------------ */

test("the first photograph of a colourway shows the side that was printed", () => {
  for (const c of CASES) {
    const byColour = new Map<string, typeof c.gallery>();
    for (const m of c.gallery) {
      const b = byColour.get(m.color) ?? [];
      b.push(m);
      byColour.set(m.color, b);
    }
    for (const [colour, shots] of byColour) {
      const first = shots[0]!;
      const image = c.images.find((i) => i.src === first.src)!;
      const facing = c.images.some((i) => c.printed.has(i.position));
      if (!facing) continue; // nothing rendered faces the print; reported as a problem
      assert.ok(
        c.printed.has(image.position),
        `${c.id}/${colour}: leads with "${first.camera}" (${image.position}), ` +
          `but the print is on the ${[...c.printed].join("/")}`,
      );
    }
  }
});

test("a back print leads with the back, not with a blank front", () => {
  /* ALL 59 PRODUCTS PRINT ON THE FRONT TODAY — checked against the matrix, not
     remembered from the comment in sync.ts that still describes the hoodies as
     back prints. So the printed face is the parameter here: real renders of a
     real hoodie, told the artwork is on the back. That is the failure this rule
     exists for, and it costs nothing to keep it covered before the line has a
     back print again rather than after. */
  const hoodie = caseFor("championship-roundel-hoodie");
  assert.deepEqual([...hoodie.printed], ["front"], "a back print exists now — test it for real");

  const problems: string[] = [];
  const asBackPrint = chooseGallery(hoodie.images, hoodie.item, new Set(["back"]), problems);
  assert.ok(asBackPrint.length, "nothing chosen");

  const byColour = new Map<string, typeof asBackPrint>();
  for (const m of asBackPrint) {
    const b = byColour.get(m.color) ?? [];
    b.push(m);
    byColour.set(m.color, b);
  }
  for (const [colour, shots] of byColour) {
    const image = hoodie.images.find((i) => i.src === shots[0]!.src)!;
    assert.equal(
      image.position,
      "back",
      `${colour} leads with a ${image.position} view of a garment printed on the back`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Problems are reported rather than guessed past                      */
/* ------------------------------------------------------------------ */

test("the captured products produce no problems", () => {
  for (const c of CASES) {
    assert.deepEqual(c.problems, [], `${c.id} reported problems`);
  }
});

test("a camera_label nobody has classified is excluded AND reported", () => {
  const tee = caseFor("crossed-shield-tee");
  const invented = tee.images.map((i) => ({
    ...i,
    src: i.src.replace(/camera_label=[^&]*/, "camera_label=tiktok-dance"),
  }));
  const problems: string[] = [];
  const out = chooseGallery(invented, tee.item, tee.printed, problems);
  assert.deepEqual(out, [], "an unclassified label was shown");
  assert.ok(
    problems.some((p) => p.includes("tiktok-dance")),
    `the new label was not reported: ${problems.join(" | ")}`,
  );
  assert.ok(!KNOWN_LABELS.has("tiktok-dance"));
});

test("a render covering two colourways at once is reported, not assigned to one", () => {
  const tee = caseFor("crossed-shield-tee");
  const white = tee.item.colors.find((c) => c.name === "White")!;
  const black = tee.item.colors.find((c) => c.name === "Black")!;
  const smeared = tee.images.map((i) =>
    cameraLabel(i.src) === "front" && i.variant_ids.includes(white.variants[0]!)
      ? { ...i, variant_ids: [white.variants[0]!, black.variants[0]!] }
      : i,
  );
  const problems: string[] = [];
  chooseGallery(smeared, tee.item, tee.printed, problems);
  assert.ok(
    problems.some((p) => p.includes("at once")),
    `no problem raised: ${problems.join(" | ")}`,
  );
});

test("an item with no angle set shows nothing and says so", () => {
  const tee = caseFor("crossed-shield-tee");
  const problems: string[] = [];
  const out = chooseGallery(tee.images, { ...tee.item, itemId: "parka" }, tee.printed, problems);
  assert.deepEqual(out, []);
  assert.ok(problems.some((p) => p.includes("parka")), problems.join(" | "));
});

/* ------------------------------------------------------------------ */
/* The grid's variety                                                  */
/* ------------------------------------------------------------------ */

test("lightness ranks the garment colours the way an eye does", () => {
  assert.ok(lightness("#f4f4f2") > lightness("#b0b2ad"), "White should read lighter than Athletic Heather");
  assert.ok(lightness("#b0b2ad") > lightness("#17191b"), "Athletic Heather should read lighter than Black");
  assert.equal(lightness("#fff"), lightness("#ffffff"), "shorthand hex should parse");
});

test("neighbouring products in a category lead with different colourways", () => {
  const tee = caseFor("crossed-shield-tee");
  const heroes = [0, 1, 2, 3].map((rank) => {
    const index = heroIndexFor(tee.gallery, tee.item.colors, rank);
    return tee.gallery[index]!.color;
  });
  assert.equal(new Set(heroes).size, heroes.length, `four neighbours led with ${heroes.join(", ")}`);
});

test("the hero is stable across runs and never white by default", () => {
  const tee = caseFor("crossed-shield-tee");
  const once = heroIndexFor(tee.gallery, tee.item.colors, 0);
  const twice = heroIndexFor(tee.gallery, tee.item.colors, 0);
  assert.equal(once, twice, "the same catalog produced two different grids");
  // Rank 0 takes the darkest colourway, which is the whole point: Printify and
  // the matrix both put White first, and a grid of twenty white shirts was the
  // thing being fixed.
  assert.notEqual(tee.gallery[once]!.color, "White");
});

test("the hero index always points at a photograph that exists", () => {
  for (const c of CASES) {
    for (const rank of [0, 1, 2, 7, 40]) {
      const index = heroIndexFor(c.gallery, c.item.colors, rank);
      assert.ok(
        index >= 0 && index < c.gallery.length,
        `${c.id}: hero index ${index} is outside a gallery of ${c.gallery.length}`,
      );
    }
  }
});
