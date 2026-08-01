import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANGLES, photographsOf } from "../src/gallery.ts";
import type { Mockup } from "../src/gallery.ts";
import { ROOT } from "../src/matrix.ts";

/**
 * THE SHIPPED CATALOGUE, checked against the files on disk.
 *
 * gallery.test.ts proves the choosing function is right. This proves the thing
 * it produced is right — `apps/web/data/products.json` as the storefront will
 * actually read it, and `apps/web/public/store/` as the browser will actually
 * fetch it. The two can disagree: a catalogue naming a mockup nobody mirrored is
 * a broken image on a live product page, and that has happened here before —
 * eleven of them, when a filter ran after the catalogue was written.
 *
 * **These are assertions about a build artifact, so they skip when it is
 * absent** rather than failing a clean checkout that has not synced.
 */

const CATALOG = join(ROOT, "apps/web/data/products.json");
const MIRROR = join(ROOT, "apps/web/public/store");

type Product = {
  id: string;
  itemId: string;
  title: string;
  colors: { name: string; hex: string; variants: number[] }[];
  mockups: Mockup[];
  heroIndex?: number;
};

const catalogue: { products: Product[] } | null = existsSync(CATALOG)
  ? JSON.parse(readFileSync(CATALOG, "utf8"))
  : null;

const products = catalogue?.products ?? [];
const skip = products.length ? false : "no catalogue — run `npm run store:sync`";

test("every colourway on sale has at least one photograph", { skip }, () => {
  for (const p of products) {
    const shown = new Set(p.mockups.map((m) => m.color));
    for (const c of p.colors) {
      assert.ok(shown.has(c.name), `${p.id}: ${c.name} is on sale with no photograph`);
    }
  }
});

test("choosing a colour never changes how many photographs are shown", { skip }, () => {
  for (const p of products) {
    const per = new Map<string, number>();
    for (const m of p.mockups) per.set(m.color, (per.get(m.color) ?? 0) + 1);
    assert.equal(
      new Set(per.values()).size,
      1,
      `${p.id}: uneven — ${[...per].map(([k, v]) => `${k}:${v}`).join(" ")}`,
    );
  }
});

test("no photograph of a person, no size chart, no staged prop scene", { skip }, () => {
  for (const p of products) {
    for (const m of p.mockups) {
      assert.ok(
        !/person|lifestyle|duo/i.test(m.camera),
        `${p.id}: "${m.camera}" is a photograph of a person`,
      );
      assert.notEqual(m.camera, "size-chart", `${p.id}: a size chart is on the page`);
      assert.ok(!m.camera.startsWith("context"), `${p.id}: "${m.camera}" is a staged scene`);
      assert.ok(
        ANGLES[p.itemId]?.includes(m.camera),
        `${p.id}: "${m.camera}" is not in the angle set for ${p.itemId}`,
      );
    }
  }
});

test("every catalogued photograph has been mirrored, at every size", { skip }, () => {
  if (!existsSync(MIRROR)) return; // mockups not mirrored in this checkout
  const missing: string[] = [];
  for (const p of products) {
    p.mockups.forEach((_, index) => {
      for (const name of [
        `${p.id}-${index}.webp`,
        `${p.id}-${index}-400.webp`,
        `${p.id}-${index}-800.webp`,
      ]) {
        if (!existsSync(join(MIRROR, name))) missing.push(name);
      }
    });
  }
  assert.deepEqual(missing.slice(0, 10), [], `${missing.length} mirrored file(s) missing`);
});

test("the photographs of one colourway are contiguous", { skip }, () => {
  // The index into `mockups` is the filename on disk. Grouping is what lets the
  // page take "the photographs of Navy" as a run rather than a scan.
  for (const p of products) {
    const runs: string[] = [];
    for (const m of p.mockups) if (runs[runs.length - 1] !== m.color) runs.push(m.color);
    assert.equal(new Set(runs).size, runs.length, `${p.id}: a colourway appears in two runs`);
  }
});

test("pressing any swatch, on any product, shows only that colour", { skip }, () => {
  /* THIS IS THE FEATURE, asserted the way the page does it. `photographsOf` is
     what `mockupsFor` calls when a swatch is pressed, so this walks every
     colourway of every product — 175 selections — and checks the result.
     It is not a browser click; the React state and the DOM swap are not
     exercised here. What is exercised is the mapping the click depends on. */
  let selections = 0;
  for (const p of products) {
    for (const c of p.colors) {
      const indices = photographsOf(p.mockups, c.name);
      selections += 1;
      assert.ok(indices.length, `${p.id}: ${c.name} selected nothing`);
      for (const i of indices) {
        assert.equal(
          p.mockups[i]!.color,
          c.name,
          `${p.id}: choosing ${c.name} showed a photograph of ${p.mockups[i]!.color}`,
        );
      }
      const angles = indices.map((i) => p.mockups[i]!.camera);
      assert.equal(new Set(angles).size, angles.length, `${p.id}/${c.name}: the same angle twice`);
    }
  }
  assert.equal(selections, 175, `expected 175 colourways on the shop, walked ${selections}`);
});

test("an unknown colour falls back to every photograph, never to none", { skip }, () => {
  const p = products[0]!;
  assert.equal(photographsOf(p.mockups, "Vantablack").length, p.mockups.length);
  assert.equal(photographsOf([], "White").length, 0);
});

test("heroIndex points at a real photograph on every product", { skip }, () => {
  for (const p of products) {
    assert.equal(typeof p.heroIndex, "number", `${p.id}: no heroIndex`);
    assert.ok(
      p.heroIndex! >= 0 && p.heroIndex! < p.mockups.length,
      `${p.id}: heroIndex ${p.heroIndex} outside 0..${p.mockups.length - 1}`,
    );
  }
});

test("white is not the default, and never dominates a row", { skip }, () => {
  /* THE ROTATION MUST BE ALLOWED TO REACH WHITE. An earlier version of this
     test asserted no card ever leads with White and failed on `rink-board-tee`
     — rank 5 of a six-colourway row, which is White by construction. A rotation
     that skipped a colour would not be a rotation, and that colour would never
     appear in the grid at all.
     What the grid actually has to avoid is the thing it was built to avoid:
     opening on White by default, and a row that is mostly White. */
  const byItem = new Map<string, typeof products>();
  for (const p of products) byItem.set(p.itemId, [...(byItem.get(p.itemId) ?? []), p]);

  for (const [itemId, row] of byItem) {
    const choosers = row.filter((p) => p.colors.length > 1);
    if (!choosers.length) continue;

    // Rank 0 takes the darkest colourway, so the first card of a row never
    // opens on White. That is the default this whole mechanism replaced.
    const first = choosers[0]!;
    assert.notEqual(
      first.mockups[first.heroIndex ?? 0]!.color,
      "White",
      `${itemId}: the row opens on a White ${first.id}`,
    );

    const white = choosers.filter((p) => p.mockups[p.heroIndex ?? 0]!.color === "White").length;
    assert.ok(
      white * 2 <= choosers.length,
      `${itemId}: ${white} of ${choosers.length} cards lead with White`,
    );
  }
});

test("neighbouring cards in a category lead with different colourways", { skip }, () => {
  const byItem = new Map<string, Product[]>();
  for (const p of products) {
    byItem.set(p.itemId, [...(byItem.get(p.itemId) ?? []), p]);
  }
  for (const [itemId, row] of byItem) {
    // Single-colourway items — the mug, the sticker — have nothing to rotate.
    if (row.every((p) => p.colors.length < 2)) continue;
    for (let i = 1; i < row.length; i += 1) {
      const a = row[i - 1]!;
      const b = row[i]!;
      if (a.colors.length < 2 || b.colors.length < 2) continue;
      assert.notEqual(
        a.mockups[a.heroIndex ?? 0]!.color,
        b.mockups[b.heroIndex ?? 0]!.color,
        `${itemId}: ${a.id} and ${b.id} sit next to each other in the same colour`,
      );
    }
  }
});
