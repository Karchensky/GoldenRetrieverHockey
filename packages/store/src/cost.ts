import { createProduct, deleteProduct, getBlueprint, getProduct, listAllPrintProviders, listVariants, uploadImage } from "./api.ts";
import { loadArt } from "./line.ts";
import { MARKS } from "./matrix.ts";
import type { CatalogPlaceholder } from "./types.ts";

/**
 * `cli.ts cost <blueprintId> <printProviderId>` — what a garment this shop has
 * never sold would actually cost.
 *
 * **Printify publishes no cost anywhere in the catalog API.** Checked repeatedly
 * and again on 2026-07-28: the variants endpoint returns options and print areas
 * and no price, and the whole v2 catalog tree 404s apart from shipping. A
 * variant's `cost` field exists for the first time on a product that EXISTS.
 *
 * So the only way to compare two brands or two makers on money is to make the
 * product, read the number off it, and throw it away. That is what this does,
 * and it is why the command exists rather than being a note telling somebody to
 * do it by hand:
 *
 *   1. upload the crest once (uploads are account-scoped and cost nothing),
 *   2. create ONE draft with every variant enabled, `visible: false`,
 *   3. read the costs back and group them,
 *   4. **delete it in a `finally`,** so a crash between 2 and 3 still cleans up.
 *
 * It leaves nothing behind. `cli.ts audit` after a run is the proof.
 *
 * The price it creates the probe at is deliberately absurd — Printify refuses a
 * variant priced at or under its cost, and this has to survive a $55 hoodie.
 */

/** High enough that no blueprint on the platform costs more. Never sold. */
const PROBE_PRICE_CENTS = 19_999;

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

type ProbeVariant = { id: number; title: string; options: Record<string, string>; placeholders?: CatalogPlaceholder[] };

/**
 * **Printify's own ceiling, not a nicety.** 120 was tried on 2026-07-28 and the
 * API answered `400 code 8251: Too many variants enabled. Maximum allowed: 100`.
 * It is not in the docs and nothing in the catalog response predicts it.
 *
 * It is the right number anyway: a Bella+Canvas 3001 through Printify Choice has
 * 995 variants and their costs repeat by colour and size long before the
 * hundredth. The cap is printed with the answer so a truncated one is never
 * mistaken for a complete one.
 */
const MAX_VARIANTS = 100;

export async function cost(blueprintIdArg: string | undefined, providerIdArg: string | undefined): Promise<number> {
  const blueprintId = Number(blueprintIdArg);
  const printProviderId = Number(providerIdArg);
  if (!Number.isInteger(blueprintId) || !Number.isInteger(printProviderId)) {
    console.error("cost <blueprintId> <printProviderId>");
    console.error("");
    console.error("Creates one DRAFT on shop 28277243, reads its per-variant cost, and deletes it.");
    console.error("There is no other way: Printify quotes no cost in the catalog API.");
    console.error("Find the two ids with `cli.ts catalogue <query>` and `cli.ts catalogue <blueprintId>`.");
    return 2;
  }

  const blueprint = await getBlueprint(blueprintId);
  const provider = (await listAllPrintProviders()).find((p) => p.id === printProviderId);
  const catalog = (await listVariants(blueprintId, printProviderId)) as unknown as { variants: ProbeVariant[] };

  const all = catalog.variants;
  const chosen = all.slice(0, MAX_VARIANTS);
  const first = chosen[0];
  if (!first) {
    console.error(`Blueprint ${blueprintId} through provider ${printProviderId} has no variants.`);
    return 1;
  }
  const position = (first.placeholders ?? [])[0]?.position;
  if (!position) {
    console.error(`Blueprint ${blueprintId} through provider ${printProviderId} reports no print areas.`);
    return 1;
  }

  // Any real mark will do — the product is deleted before anything is printed.
  const mark = MARKS[0];
  if (!mark) throw new Error("MARKS is empty; nothing to upload as probe artwork.");
  const art = await loadArt(mark.press);
  const uploaded = await uploadImage({ file_name: `cost-probe-${art.name}`, contents: art.base64 });

  console.log(`${`${blueprint.brand} ${blueprint.model}`.trim()} — ${blueprint.title}`);
  console.log(
    `blueprint ${blueprintId} · ${provider?.title ?? "unknown provider"} ${printProviderId}` +
      `${provider?.location?.country ? `, ships from ${provider.location.country}` : ""}`,
  );
  console.log(
    `probing ${chosen.length} of ${all.length} variants on "${position}"` +
      `${chosen.length < all.length ? "  (capped — costs repeat by colour and size)" : ""}\n`,
  );

  let productId: string | null = null;
  try {
    const created = await createProduct({
      title: `COST PROBE ${blueprintId}/${printProviderId} — delete me`,
      description: "Temporary. Created to read cost, deleted in the same command.",
      blueprint_id: blueprintId,
      print_provider_id: printProviderId,
      visible: false,
      variants: chosen.map((v) => ({ id: v.id, price: PROBE_PRICE_CENTS, is_enabled: true })),
      print_areas: [{
        variant_ids: chosen.map((v) => v.id),
        placeholders: [{ position, images: [{ id: uploaded.id, x: 0.5, y: 0.5, scale: 0.5, angle: 0 }] }],
      }],
    });
    productId = created.id;

    const read = await getProduct(created.id);
    const source = new Map(chosen.map((v) => [v.id, v]));
    const tiers = new Map<number, { colours: Set<string>; sizes: Set<string>; n: number }>();
    for (const v of read.variants) {
      if (!v.is_enabled) continue;
      const tier = tiers.get(v.cost) ?? { colours: new Set<string>(), sizes: new Set<string>(), n: 0 };
      tier.n++;
      const opts = source.get(v.id)?.options ?? {};
      if (opts.color) tier.colours.add(opts.color);
      if (opts.size) tier.sizes.add(opts.size);
      tiers.set(v.cost, tier);
    }

    console.log(`  ${"cost".padEnd(9)}${"variants".padStart(8)}   what it covers`);
    for (const [c, t] of [...tiers.entries()].sort((a, b) => a[0] - b[0])) {
      const covers = [
        t.sizes.size ? [...t.sizes].join("/") : "",
        t.colours.size ? `${t.colours.size <= 6 ? [...t.colours].join(", ") : `${t.colours.size} colours`}` : "",
      ].filter(Boolean).join(" · ");
      console.log(`  ${usd(c).padEnd(9)}${String(t.n).padStart(8)}   ${covers}`);
    }

    const areas = (first.placeholders ?? [])
      .map((p) => `${p.position} ${(p.width / 300).toFixed(1)}x${(p.height / 300).toFixed(1)}in`)
      .join(" · ");
    console.log(`\n  print areas  ${areas}`);
    console.log(`  colourways   ${new Set(all.map((v) => v.options.color).filter(Boolean)).size}`);
    console.log(`  sizes        ${[...new Set(all.map((v) => v.options.size).filter(Boolean))].join(", ") || "one"}`);
    console.log(`\nPostage is not here. "cli.ts catalogue ${blueprintId}" has it, per provider.`);
    return 0;
  } finally {
    if (productId) {
      await deleteProduct(productId);
      console.log(`\nprobe ${productId} deleted. Nothing was left on shop 28277243.`);
    }
  }
}
