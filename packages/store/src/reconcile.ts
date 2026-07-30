import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteProduct, listProducts } from "./api.ts";
import { ROOT, buildLine } from "./matrix.ts";

/**
 * `cli.ts reconcile [--delete]` — what is on the shop that nothing points at.
 *
 * **This exists because `listProducts()` did not paginate.** It asked for
 * `?limit=50` and returned the first fifty products of a shop that had grown to
 * ninety-five. `sync` builds its "what already exists" map from that call, so
 * once the line passed fifty products every sync stopped recognising the ones
 * past the boundary and **created them again**. Twenty-eight titles ended up
 * doubled. Nothing broke loudly: the drafts are invisible, the storefront kept
 * pointing at whichever copy the last sync recorded, and `audit` — the command
 * whose whole job is to prove the shop is clean — could not see past the same
 * fiftieth row and reported everything fine.
 *
 * The pagination is fixed. This cleans up after it, and stays because the same
 * thing happens for an ordinary reason: **renaming a product orphans the old
 * one.** `sync` matches on title, so "Nose to Nose — Tee" became "Boop — Tee"
 * and the original stayed behind, paid for by nobody and listed by nothing.
 *
 * WHAT IT CONSIDERS ALIVE: the `printify.productId` recorded in
 * `apps/web/data/products.json`. That file is written from the shop's own
 * read-back at the end of a successful sync, and it is what the storefront
 * renders and what the checkout Worker compiles in. A product it does not name
 * cannot be bought, cannot be rendered, and cannot be ordered.
 *
 * IT NEVER DELETES SOMETHING THE CATALOG NAMES, and it refuses to run at all if
 * the catalog is missing or names a product the shop does not have — because
 * then the catalog is the thing that is wrong, and deleting against a wrong map
 * is how a shop loses a product somebody can already see.
 *
 * COST PROBES ARE LEFT ALONE unless `--delete` is given, and are reported
 * separately: `sweep` and `cost` create one, read it and delete it in a
 * `finally`, so a probe on the shop is either mid-flight or a genuine leak, and
 * deleting a mid-flight one races the command that owns it.
 */

const PROBE = /^COST PROBE /;

export async function reconcile(flag?: string): Promise<number> {
  const doDelete = flag === "--delete";

  const catalogPath = join(ROOT, "apps/web/data/products.json");
  let catalog: { products: { id: string; title: string; printify?: { productId?: string } }[] };
  try {
    catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    console.error(`No catalog at ${catalogPath}. Run \`npm run store:sync\` first —`);
    console.error("without it there is no record of which product on the shop is the live one.");
    return 1;
  }

  const named = new Map<string, string>();
  for (const p of catalog.products) {
    if (p.printify?.productId) named.set(p.printify.productId, p.title);
  }

  const live = (await listProducts()).data;
  const onShop = new Map(live.map((p) => [p.id, p]));

  // If the catalog names something the shop does not have, the catalog is the
  // wrong map and nothing here is safe. Stop.
  const phantom = [...named.keys()].filter((id) => !onShop.has(id));
  if (phantom.length) {
    console.error(`The catalog names ${phantom.length} product(s) the shop does not have:`);
    for (const id of phantom) console.error(`  ${id}  ${named.get(id)}`);
    console.error("\nThe storefront is pointing at products that do not exist. Re-run");
    console.error("`npm run store:sync` to rebuild the catalog before deleting anything.");
    return 1;
  }

  const wanted = new Set(buildLine().map((p) => p.title));
  const orphans = live.filter((p) => !named.has(p.id) && !PROBE.test(p.title));
  const probes = live.filter((p) => PROBE.test(p.title));
  const visible = live.filter((p) => p.visible);

  console.log(`shop           ${live.length} products`);
  console.log(`the storefront ${named.size} of them, all present`);
  console.log(`orphaned       ${orphans.length}`);
  console.log(`cost probes    ${probes.length}`);
  console.log(`visible        ${visible.length}${visible.length ? "   <<< every product must be visible=false" : "   (correct)"}`);

  if (orphans.length) {
    console.log("\nORPHANED — on the shop, named by nothing, unbuyable:\n");
    for (const p of orphans) {
      // A title still in the line means a superseded duplicate; one that is not
      // means the product was renamed and this is the old name.
      const why = wanted.has(p.title) ? "superseded copy" : "renamed away";
      console.log(`  ${p.id}  ${why.padEnd(16)}${p.title}`);
    }
  }

  if (probes.length) {
    console.log("\nCOST PROBES — `sweep` or `cost` deletes its own; one here is either");
    console.log("mid-flight or a leak. Check nothing is running before removing it.\n");
    for (const p of probes) console.log(`  ${p.id}  ${p.title}`);
  }

  const doomed = doDelete ? [...orphans, ...probes] : [];
  if (!doDelete) {
    if (orphans.length || probes.length) {
      console.log(`\nNothing was deleted. \`cli.ts reconcile --delete\` removes the ${orphans.length + probes.length} above.`);
      console.log("It cannot touch the products the storefront names — those are excluded by construction.");
    } else {
      console.log("\nNothing to clean up.");
    }
    return 0;
  }

  console.log(`\nDeleting ${doomed.length}…\n`);
  let gone = 0;
  for (const p of doomed) {
    try {
      await deleteProduct(p.id);
      gone += 1;
      console.log(`  deleted  ${p.id}  ${p.title}`);
    } catch (error) {
      console.error(`  FAILED   ${p.id}  ${p.title}\n           ${String(error).slice(0, 160)}`);
    }
  }
  console.log(`\n${gone} of ${doomed.length} deleted. ${live.length - gone} products remain.`);
  return gone === doomed.length ? 0 : 1;
}
