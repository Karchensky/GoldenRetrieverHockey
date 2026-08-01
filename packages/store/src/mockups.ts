import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getProduct, listProducts } from "./api.ts";
import { ROOT } from "./matrix.ts";
import type { PrintifyProduct } from "./types.ts";

/**
 * `cli.ts mockups` — what the provider actually rendered, before anything filters it.
 *
 * A GET and two file writes outside the repo's tracked source. It creates
 * nothing on the shop, changes nothing, and cannot: the only API calls are
 * `listProducts` and `getProduct`.
 *
 * **It exists because the catalog is not evidence about the response.**
 * `apps/web/data/products.json` holds 181 mockups and every one of them is
 * `camera_label=front` — but `chooseMockups` in sync.ts had already dropped
 * person shots, dropped every image whose `position` is not a printed face, and
 * then cut what survived to four. Reading the catalog to find out what Printify
 * offers measures our own filter.
 *
 * Three questions, and the answers decide the shape of the work:
 *
 *   1. How many camera angles exist per colourway?
 *   2. Does the provider render every colourway we sell?
 *   3. What is the full `camera_label` vocabulary? The person filter is the
 *      regex /camera_label=[^&]*person/i, which is a guess about a namespace
 *      nobody has enumerated. A garment shot is the only thing allowed on the
 *      page, so the vocabulary has to be read rather than assumed.
 *
 * THE COLOUR OF A MOCKUP IS NOT A MYSTERY, whatever TODO.md says. Each image
 * carries `variant_ids`, and `colors[].variants` in the catalog maps those to a
 * colourway. Verified on the 181 URLs already mirrored: 181 resolved, 0 did not.
 * The variant id is also the third path segment of the URL, which this uses as
 * an independent cross-check — two sources that agree, or a reported problem.
 */

/** Every product on the shop, verbatim, for eyeballing. Gitignored. */
const DUMP = join(ROOT, "dist/print/printify-mockups.json");
/** A few real products, kept byte-exact, for the tests to run against. */
const FIXTURE = join(ROOT, "packages/store/test/fixtures/printify-images.json");

/**
 * The products captured into the fixture, chosen to cover the shapes that break.
 *
 * A six-colour tee is the case the `.slice(0, 4)` cap silently truncated. A
 * back-printed hoodie is the case whose default images are photographs of a
 * blank front. A cap is where the two `size-chart` images turned up. A sticker
 * is the one-colour, one-view floor.
 */
const FIXTURE_IDS = [
  "crossed-shield-tee",
  "championship-roundel-hoodie",
  "rink-board-cap",
  "crossed-shield-sticker",
];

type CatalogShape = {
  products: {
    id: string;
    title: string;
    colors: { name: string; hex: string; variants: number[] }[];
    printify?: { productId?: string };
  }[];
};

/** The label Printify hangs off the mockup URL. `none` where there is no query. */
export function cameraLabel(src: string): string {
  const m = /[?&]camera_label=([^&]*)/.exec(src);
  return m?.[1] ? decodeURIComponent(m[1]) : "none";
}

/** The variant id Printify puts in the mockup URL path, or null if it is not there. */
export function variantInUrl(src: string): number | null {
  try {
    const seg = new URL(src).pathname.split("/");
    // /mockup/{productId}/{variantId}/{sceneId}/{slug}.jpg
    const id = Number(seg[3]);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

export async function mockupProbe(): Promise<number> {
  const catalogPath = join(ROOT, "apps/web/data/products.json");
  let catalog: CatalogShape;
  try {
    catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    console.error(`No catalog at ${catalogPath}. Run \`npm run store:sync\` first.`);
    return 1;
  }

  const byPrintifyId = new Map<string, CatalogShape["products"][number]>();
  for (const p of catalog.products) {
    if (p.printify?.productId) byPrintifyId.set(p.printify.productId, p);
  }

  const live = (await listProducts()).data;

  /* DOES THE LIST CARRY `images` AT ALL?
     `listProducts` is a different endpoint from `getProduct` and Printify is
     free to trim the collection response. If it does, every count below would
     be zero and the conclusion would be "no angles exist" — the exact wrong
     answer, arrived at confidently. So one product is fetched singly and the
     two are compared before anything is counted. */
  const sample = live.find((p) => byPrintifyId.has(p.id));
  if (!sample) {
    console.error("No product on the shop is named by the catalog. Run a sync first.");
    return 1;
  }
  const single = await getProduct(sample.id);
  const listCount = sample.images?.length ?? 0;
  const singleCount = single.images?.length ?? 0;
  console.log(
    `images[] on ${sample.id}: ${listCount} from the list, ${singleCount} from the single fetch`,
  );
  if (listCount !== singleCount) {
    console.log(
      `  the LIST endpoint is trimmed — every figure below comes from per-product fetches instead`,
    );
  }
  console.log();

  // Where the list is trimmed, pay for one fetch each rather than report a
  // number that is an artefact of the endpoint.
  const full: PrintifyProduct[] = [];
  if (listCount !== singleCount) {
    for (const p of live) {
      if (!byPrintifyId.has(p.id)) continue;
      full.push(p.id === single.id ? single : await getProduct(p.id));
    }
  } else {
    full.push(...live.filter((p) => byPrintifyId.has(p.id)));
  }

  const labelCounts = new Map<string, number>();
  const positionCounts = new Map<string, number>();
  const anglesPerColour: number[] = [];
  const problems: string[] = [];
  let uncovered = 0;
  let colourways = 0;

  for (const got of full) {
    const ours = byPrintifyId.get(got.id);
    if (!ours) continue;

    const colourOf = new Map<number, string>();
    for (const c of ours.colors) for (const v of c.variants) colourOf.set(v, c.name);

    /** colourway -> the camera labels rendered for it. */
    const seen = new Map<string, string[]>();

    for (const image of got.images ?? []) {
      const label = cameraLabel(image.src);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      positionCounts.set(image.position, (positionCounts.get(image.position) ?? 0) + 1);

      const names = new Set(
        (image.variant_ids ?? []).map((v) => colourOf.get(v)).filter((n): n is string => Boolean(n)),
      );
      if (names.size > 1) {
        problems.push(`${ours.id}: one render covers ${[...names].join(" and ")} — ${label}`);
      }
      const name = [...names][0];

      // The independent cross-check. Two sources for the same fact, so a
      // disagreement is reported rather than silently resolved in favour of one.
      const fromUrl = variantInUrl(image.src);
      const urlName = fromUrl === null ? undefined : colourOf.get(fromUrl);
      if (name && urlName && name !== urlName) {
        problems.push(`${ours.id}: variant_ids say ${name}, the URL says ${urlName} — ${label}`);
      }
      if (!name && !urlName) {
        problems.push(`${ours.id}: a render maps to no colourway we sell — ${label}`);
        continue;
      }

      const key = name ?? urlName!;
      const bucket = seen.get(key);
      if (bucket) bucket.push(label);
      else seen.set(key, [label]);
    }

    const labels = [...new Set([...seen.values()].flat())].sort();
    console.log(
      `${ours.id.padEnd(30)} ${String(got.images?.length ?? 0).padStart(3)} images  ` +
        `${seen.size}/${ours.colors.length} colourways  ${labels.join(" ")}`,
    );

    for (const c of ours.colors) {
      colourways += 1;
      const angles = seen.get(c.name);
      if (!angles) {
        uncovered += 1;
        problems.push(`${ours.id}: nothing rendered for ${c.name}`);
        continue;
      }
      anglesPerColour.push(angles.length);
      console.log(`${" ".repeat(32)}${c.name.padEnd(22)}${angles.sort().join(" ")}`);
    }
  }

  const angles = [...new Set(anglesPerColour)].sort((a, b) => a - b);
  console.log(`\n${"—".repeat(72)}`);
  console.log(`${full.length} products, ${colourways} colourways, ${uncovered} with nothing rendered`);
  console.log(`angles per colourway: ${angles.length ? `${angles[0]}–${angles[angles.length - 1]}` : "none"}`);

  console.log(`\ncamera_label vocabulary — EVERY label must be classed before it is shown:`);
  for (const [label, n] of [...labelCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${label}`);
  }
  console.log(`\nposition:`);
  for (const [p, n] of [...positionCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${p}`);
  }

  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
    if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
  }

  await mkdir(dirname(DUMP), { recursive: true });
  await writeFile(DUMP, `${JSON.stringify(full, null, 2)}\n`);
  console.log(`\nevery product -> ${DUMP}`);

  /* THE FIXTURE IS CAPTURED, NEVER COMPOSED.
     These records go to disk exactly as the API returned them, and the tests
     read them rather than a hand-written approximation of them. An invented
     fixture in this repository once passed 13 of 13 and produced 1,064 goals
     that never happened.

     **ONLY `images` IS KEPT, AND THAT IS A SAFETY RULE, NOT A SIZE ONE.** The
     full product response carries `variants[].cost` — what Printify charges us
     — along with `user_id` and `shop_id`. THIS REPOSITORY IS PUBLIC and
     CLAUDE.md forbids costs and margins in tracked files; the first version of
     this function would have committed 1,150 cost figures. Nothing in
     `chooseGallery` reads a variant, so nothing is lost. Every image object
     inside is byte-for-byte what the API returned. */
  const wanted = new Set(FIXTURE_IDS);
  const keep = full.filter((p) => wanted.has(byPrintifyId.get(p.id)?.id ?? ""));
  const missing = [...wanted].filter(
    (id) => !keep.some((p) => byPrintifyId.get(p.id)?.id === id),
  );
  if (missing.length) {
    console.log(`\nnot on the shop, so not captured: ${missing.join(", ")}`);
  }
  await mkdir(dirname(FIXTURE), { recursive: true });
  await writeFile(
    FIXTURE,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        note:
          "The `images` arrays exactly as the Printify API returned them, captured by " +
          "`cli.ts mockups`. Nothing else off the response is kept: it carries per-variant " +
          "COST, and this repository is public. Do not hand-edit — recapture instead.",
        products: keep.map((p) => ({
          ourId: byPrintifyId.get(p.id)?.id,
          product: { images: p.images ?? [] },
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`fixture (${keep.length} products, images only) -> ${FIXTURE}`);

  return 0;
}
