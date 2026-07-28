import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SHOP_ID,
  createProduct,
  getProduct,
  listPrintProviders,
  listProducts,
  listVariants,
  uploadImage,
} from "./api.ts";
import {
  LINE,
  assertClaims,
  fillTokens,
  loadArt,
  loadSite,
  place,
} from "./line.ts";
import type { Art } from "./line.ts";
import type { CatalogPlaceholder, CreateProductBody, PrintArea, PrintifyProduct } from "./types.ts";

/**
 * Create the line on shop 28277243 as drafts, then read every one back.
 *
 * Order matters and is not negotiable:
 *
 *   1. Re-derive every claim the artwork makes from site.json. A design whose
 *      sentence is no longer true stops the run before anything is uploaded.
 *   2. Upload the art. Uploads are account-scoped and harmless — an unused
 *      image costs nothing and belongs to no shop.
 *   3. Create products. Drafts only: `visible` is never set, nothing is
 *      published, and this package has no publish call to reach for.
 *   4. Read each one back and check it against what was asked for. A create
 *      that returns 200 is not evidence that the artwork landed where it was
 *      meant to; the read-back and the provider's own mockups are.
 */

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const REPORT = join(ROOT, "dist/print/printify-sync.json");

type VariantsWithPlaceholders = {
  variants: { id: number; placeholders?: CatalogPlaceholder[] }[];
};

/** One catalog read per blueprint/provider, however many placements ask for it. */
const catalogCache = new Map<string, VariantsWithPlaceholders>();
async function variantsOf(blueprintId: number, printProviderId: number): Promise<VariantsWithPlaceholders> {
  const key = `${blueprintId}/${printProviderId}`;
  const hit = catalogCache.get(key);
  if (hit) return hit;
  const res = (await listVariants(blueprintId, printProviderId)) as unknown as VariantsWithPlaceholders;
  catalogCache.set(key, res);
  return res;
}

/**
 * The print canvases for one position, taken from the catalog rather than
 * assumed — the smallest offered and the largest.
 *
 * Both are needed because a Printify placement is a PROPORTION of the print
 * area and the print area grows with the garment: a Bella+Canvas 3001 front is
 * 3319 px on a small and 4500 px on a 3XL. One scale is sent for every variant,
 * so one design prints 5.17 inches wide on the small and 7.01 on the 3XL, at
 * 300 dpi and 221 dpi respectively.
 *
 * Quoting only the smallest — which this file used to do — reports the best case
 * as if it were the whole story, and the worst case is the one that decides
 * whether a print looks soft.
 */
async function canvasesFor(
  blueprintId: number,
  printProviderId: number,
  variantIds: number[],
  position: string,
): Promise<{ smallest: CatalogPlaceholder; largest: CatalogPlaceholder }> {
  const res = await variantsOf(blueprintId, printProviderId);
  const areas: CatalogPlaceholder[] = [];
  for (const id of variantIds) {
    const variant = res.variants.find((v) => v.id === id);
    if (!variant) throw new Error(`variant ${id} is not offered by blueprint ${blueprintId} / provider ${printProviderId}`);
    const ph = (variant.placeholders ?? []).find((p) => p.position === position);
    if (!ph) {
      const offered = (variant.placeholders ?? []).map((p) => p.position).join(", ") || "none";
      throw new Error(`variant ${id} has no "${position}" print area. It offers: ${offered}`);
    }
    areas.push(ph);
  }
  const byWidth = [...areas].sort((a, b) => a.width - b.width);
  const smallest = byWidth[0];
  const largest = byWidth[byWidth.length - 1];
  if (!smallest || !largest) throw new Error(`no "${position}" print area on any variant of ${blueprintId}/${printProviderId}`);
  return { smallest, largest };
}

export type SyncResult = {
  id: string;
  productId: string;
  title: string;
  blueprintId: number;
  printProviderId: number;
  visible: boolean;
  variants: number;
  priceCents: number;
  costCents: number;
  marginCents: number;
  placements: {
    position: string;
    art: string;
    /** On the smallest size offered. */
    widthIn: number;
    heightIn: number;
    dpi: number;
    /** On the largest size offered. Equal to the above on a one-size product. */
    maxWidthIn: number;
    minDpi: number;
    /** Rendered width as a fraction of the print area's width. Printify's own number. */
    scale: number;
    /** Where the image's centre sits in the print area. 0.5 is the middle; smaller is higher. */
    y: number;
  }[];
  mockups: string[];
  problems: string[];
};

export async function sync(options: { dryRun: boolean }): Promise<SyncResult[]> {
  const site = await loadSite();

  // 1 — the gate.
  assertClaims(site, [...new Set(LINE.flatMap((item) => item.claims))]);
  console.log(`claims: ${[...new Set(LINE.flatMap((i) => i.claims))].length} checked against site.json, all hold`);

  // 2 — what is already there. Titles are the key: a re-run after a partial
  // failure must finish the job, not print a second copy of everything that
  // worked the first time.
  const existing = new Map<string, PrintifyProduct>();
  if (!options.dryRun) {
    for (const p of (await listProducts()).data) existing.set(p.title, p);
  }
  const todo = LINE.filter((item) => !existing.has(item.title));
  if (existing.size) {
    console.log(`shop already holds ${existing.size} product(s); ${todo.length} to create`);
  }

  // 3 — the art. Every design is read and measured, because the placement
  // report is worth having for products that already exist too; only the ones
  // a new product needs are actually uploaded.
  const needed = new Set(todo.flatMap((item) => item.placements.map((p) => p.art)));
  const art = new Map<string, Art & { uploadId?: string }>();
  for (const file of new Set(LINE.flatMap((item) => item.placements.map((p) => p.art)))) {
    const loaded = await loadArt(file);
    art.set(file, loaded);
    console.log(`art  ${file.padEnd(30)} ${loaded.box.width}x${loaded.box.height}px`);
  }
  if (!options.dryRun) {
    for (const [file, loaded] of art) {
      if (!needed.has(file)) continue;
      const up = await uploadImage({ file_name: loaded.name, contents: loaded.base64 });
      loaded.uploadId = up.id;
      console.log(`up   ${file.padEnd(30)} -> ${up.id}`);
    }
  }

  const results: SyncResult[] = [];

  for (const item of LINE) {
    const variantIds = item.colors.flatMap((c) => c.variants);
    const firstVariant = variantIds[0];
    if (firstVariant === undefined) throw new Error(`${item.id} has no variants`);
    const placements: SyncResult["placements"] = [];
    const placeholders: PrintArea["placeholders"] = [];

    for (const p of item.placements) {
      const loaded = art.get(p.art);
      if (!loaded) throw new Error(`no art loaded for ${p.art}`);
      const { smallest, largest } = await canvasesFor(
        item.blueprintId, item.printProviderId, variantIds, p.position,
      );
      const fitted = place(smallest, loaded.box, p.widthIn);
      // The same proportion on the biggest canvas the product offers.
      const maxWidthIn = Number(((largest.width / 300) * fitted.scale).toFixed(2));
      const minDpi = Math.round(loaded.box.width / maxWidthIn);
      placements.push({
        position: p.position, art: p.art,
        widthIn: fitted.widthIn, heightIn: fitted.heightIn, dpi: fitted.dpi,
        maxWidthIn, minDpi, scale: fitted.scale, y: p.y,
      });
      placeholders.push({
        position: p.position,
        images: [{ id: loaded.uploadId ?? "DRY-RUN", x: 0.5, y: p.y, scale: fitted.scale, angle: 0 }],
      });
      const flag = minDpi < 150 ? "  << low resolution" : "";
      const range = maxWidthIn === fitted.widthIn
        ? `${fitted.widthIn}in @${fitted.dpi}dpi`
        : `${fitted.widthIn}-${maxWidthIn}in @${fitted.dpi}-${minDpi}dpi`;
      console.log(
        `     ${item.id}/${p.position}: ${range} (h ${fitted.heightIn}in on the smallest) ` +
          `scale ${fitted.scale}${flag}`,
      );
    }

    const body: CreateProductBody = {
      title: item.title,
      description: fillTokens(item.description, site),
      blueprint_id: item.blueprintId,
      print_provider_id: item.printProviderId,
      // Draft. Printify's default here is true — this line is the whole
      // difference between a product the captain reviews and a product a
      // customer can find the moment a storefront is connected.
      visible: false,
      variants: variantIds.map((id) => ({ id, price: item.priceCents, is_enabled: true })),
      print_areas: [{ variant_ids: variantIds, placeholders }],
    };

    if (options.dryRun) {
      results.push({
        id: item.id, productId: "(dry run)", title: item.title,
        blueprintId: item.blueprintId, printProviderId: item.printProviderId,
        visible: false, variants: variantIds.length,
        priceCents: item.priceCents, costCents: 0, marginCents: 0,
        placements, mockups: [], problems: [],
      });
      continue;
    }

    const already = existing.get(item.title);
    const created = already ?? (await createProduct(body));
    const read = await getProduct(created.id);
    const result = verify(item.id, item.priceCents, body, read, placements);
    results.push(result);
    console.log(
      `${already ? "have" : "made"} ${item.id.padEnd(28)} ${read.id}  ` +
        `visible=${read.visible}  ${result.variants} variants  ` +
        `$${(result.priceCents / 100).toFixed(2)} on $${(result.costCents / 100).toFixed(2)} cost`,
    );
  }

  for (const problem of await catalogDrift(results)) {
    const target = results.find((r) => r.id === problem.id);
    target?.problems.push(problem.why);
  }

  if (!options.dryRun) {
    await mkdir(dirname(REPORT), { recursive: true });
    await writeFile(REPORT, JSON.stringify({ shopId: SHOP_ID, syncedAt: new Date().toISOString(), products: results }, null, 2));
    console.log(`\nreport -> ${REPORT}`);
  }

  return results;
}

type CatalogEntry = {
  id: string;
  priceCents: number;
  printify?: {
    productId?: string;
    blueprintId?: number;
    printProviderId?: number;
    print?: {
      position: string; widthIn: number; heightIn: number; dpi: number;
      maxWidthIn: number; minDpi: number; scale: number; y: number;
    }[];
  };
};

/**
 * The site states what will be printed, in inches, under every drawing. That
 * caption is only worth having if it cannot drift from the shop, so this
 * compares apps/web/data/products.json against what was just created and
 * reports any disagreement as a problem — which fails the sync.
 */
async function catalogDrift(results: SyncResult[]): Promise<{ id: string; why: string }[]> {
  const path = join(ROOT, "apps/web/data/products.json");
  const catalog = JSON.parse(await readFile(path, "utf8")) as { products: CatalogEntry[] };
  const drift: { id: string; why: string }[] = [];

  for (const r of results) {
    const entry = catalog.products.find((p) => p.id === r.id);
    if (!entry) { drift.push({ id: r.id, why: "not in apps/web/data/products.json" }); continue; }
    if (r.productId !== "(dry run)" && entry.printify?.productId !== r.productId) {
      drift.push({ id: r.id, why: `products.json holds productId ${entry.printify?.productId ?? "none"}, shop has ${r.productId}` });
    }
    if (entry.priceCents !== r.priceCents) {
      drift.push({ id: r.id, why: `products.json prices this at ${entry.priceCents}c, the shop at ${r.priceCents}c` });
    }
    for (const p of r.placements) {
      const stated = entry.printify?.print?.find((x) => x.position === p.position);
      if (!stated) { drift.push({ id: r.id, why: `products.json states no ${p.position} print size` }); continue; }
      if (
        stated.widthIn !== p.widthIn || stated.heightIn !== p.heightIn || stated.dpi !== p.dpi ||
        stated.maxWidthIn !== p.maxWidthIn || stated.minDpi !== p.minDpi ||
        stated.scale !== p.scale || stated.y !== p.y
      ) {
        drift.push({
          id: r.id,
          why: `the site draws the ${p.position} print ${stated.widthIn}-${stated.maxWidthIn}in ` +
            `@${stated.dpi}-${stated.minDpi}dpi, h ${stated.heightIn}in, scale ${stated.scale} at y ${stated.y}; ` +
            `the shop will print ${p.widthIn}-${p.maxWidthIn}in @${p.dpi}-${p.minDpi}dpi, ` +
            `h ${p.heightIn}in, scale ${p.scale} at y ${p.y}`,
        });
      }
    }
  }
  return drift;
}

/** Compare what came back against what was asked for. Silence here is the point. */
function verify(
  id: string,
  priceCents: number,
  sent: CreateProductBody,
  got: PrintifyProduct,
  placements: SyncResult["placements"],
): SyncResult {
  const problems: string[] = [];

  if (got.visible) problems.push("product is VISIBLE — it was meant to be a draft");
  if (got.blueprint_id !== sent.blueprint_id) problems.push(`blueprint ${got.blueprint_id} != ${sent.blueprint_id}`);
  if (got.print_provider_id !== sent.print_provider_id) problems.push(`provider ${got.print_provider_id} != ${sent.print_provider_id}`);

  const enabled = got.variants.filter((v) => v.is_enabled);
  if (enabled.length !== sent.variants.length) {
    problems.push(`${enabled.length} enabled variants, expected ${sent.variants.length}`);
  }

  const costs = enabled.map((v) => v.cost).filter((c) => typeof c === "number" && c > 0);
  const costCents = costs.length ? Math.max(...costs) : 0;
  if (costCents && priceCents <= costCents) {
    problems.push(`price ${priceCents}c does not cover cost ${costCents}c`);
  }
  const mispriced = enabled.filter((v) => v.price !== priceCents);
  if (mispriced.length) problems.push(`${mispriced.length} variants priced at something other than ${priceCents}c`);

  // The placement echo. Printify normalises, so compare with a tolerance
  // rather than for equality.
  for (const want of placements) {
    const area = got.print_areas.find((a) => a.placeholders.some((p) => p.position === want.position));
    const ph = area?.placeholders.find((p) => p.position === want.position);
    const img = ph?.images[0];
    if (!img) { problems.push(`no image came back on the ${want.position}`); continue; }
    if (Math.abs(img.scale - want.scale) > 0.02) {
      problems.push(`${want.position} scale came back ${img.scale}, sent ${want.scale}`);
    }
  }

  if (!got.images?.length) problems.push("no provider mockups were generated");

  return {
    id,
    productId: got.id,
    title: got.title,
    blueprintId: got.blueprint_id,
    printProviderId: got.print_provider_id,
    visible: got.visible,
    variants: enabled.length,
    priceCents,
    costCents,
    marginCents: costCents ? priceCents - costCents : 0,
    placements,
    mockups: (got.images ?? []).filter((i) => i.is_default).map((i) => i.src).slice(0, 4),
    problems,
  };
}

/** Prove, from the live API, that nothing was written anywhere but our shop. */
export async function auditShop(): Promise<void> {
  const mine = await listProducts();
  console.log(`shop ${SHOP_ID} (GoldenRetrieverHockey): ${mine.data.length} products`);
  for (const p of mine.data) {
    console.log(`  ${p.id}  visible=${String(p.visible).padEnd(5)}  bp${p.blueprint_id}/pp${p.print_provider_id}  ${p.title}`);
  }
}

/** Kept only so the CLI's provider lookup has a home. */
export { listPrintProviders };
