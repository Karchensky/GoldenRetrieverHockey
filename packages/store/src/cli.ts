import {
  listBlueprints,
  listPrintProviders,
  listShops,
  listVariants,
  searchBlueprints,
} from "./api.ts";
import { prepareLogo } from "./artwork.ts";
import { catalogue } from "./catalogue.ts";
import { cost } from "./cost.ts";
import { sweep } from "./sweep.ts";
import { reconcile } from "./reconcile.ts";
import { CLAIMS, fillTokens, loadSite, productLine } from "./line.ts";
import { ITEMS, LOGO_DIR, MARKS, MATRIX, marksOnDisk } from "./matrix.ts";
import { report } from "./report.ts";
import { auditShop, sync } from "./sync.ts";

/**
 * The store's command line.
 *
 * Everything above `logos` is a GET and writes nothing. Everything below it
 * touches shop 28277243 and only that shop — see api.ts, where the id is a
 * constant and every path asserts itself before a socket opens.
 *
 * Run against the live API since 2026-07-28. `shops` is still the right first
 * call on a new token: smallest possible request, and it tells you whether auth
 * works before you go near the catalog.
 */

const USAGE = `
@gr/store — Printify

  Deciding what to sell
    report                   Cost, margin, postage and take-home for every product. LIVE.
    catalogue <query|bpId>   What else a garment could be, and who makes it.
    cost <bpId> <ppId>       What a garment this shop has never sold would cost.
                             Creates one draft, reads its cost, DELETES it.
    sweep [itemId]           That same probe against EVERY maker of every garment
                             this line sells, ranked on landed cost. LIVE, slow.
    marks                    Every logo on disk, and which are wired into the line.
    line                     The matrix, as products, without calling anything.

  Looking things up
    shops                    Shops this token can see. Start here on a new token.
    blueprints [query]       Garment models, optionally filtered by substring.
    providers <blueprintId>  Print providers who make that blueprint.
    variants <bpId> <ppId>   Colour/size variants, with their ids.
    claims                   Re-derive every claim the artwork makes, from site.json.
    audit                    Every product on shop 28277243, and nothing else.
    reconcile [--delete]     Products on the shop that the storefront does not
                             name — superseded copies, renamed-away drafts, leaked
                             probes. Reports; only deletes with the flag.

  Writes, to shop 28277243 only
    logos                    Render every mark in MARKS and take its ground off.
    sync --dry-run           Show placement and resolution. Sends nothing.
    sync                     Upload art, create the line as DRAFTS, read it back.

The line is composed in src/matrix.ts: a list of marks, a list of items, and the
matrix of which goes on which. Add a line there to add a product.
docs/HANDBOOK.md is the reference. MANUAL.md at the repo root is the captain's
copy — local only, and not in the repository.

Token: PRINTIFY_API_TOKEN, or .secrets/printify_token.txt

Nothing here can publish. Drafts are visible in the Printify dashboard and
nowhere else until someone clicks Publish there.
`.trim();

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];

  switch (cmd) {
    case "shops": {
      const shops = await listShops();
      if (!shops.length) {
        console.log("No shops on this account.");
        return 0;
      }
      for (const s of shops) console.log(`${String(s.id).padStart(8)}  ${s.title}  (${s.sales_channel})`);
      return 0;
    }

    case "blueprints": {
      const all = await listBlueprints();
      const hits = searchBlueprints(all, argv[1] ?? "");
      if (!hits.length) {
        console.log(`No blueprint matches ${JSON.stringify(argv[1] ?? "")} of ${all.length} on file.`);
        return 1;
      }
      for (const b of hits) {
        console.log(`${String(b.id).padStart(6)}  ${b.brand} ${b.model} — ${b.title}`);
      }
      console.log(`\n${hits.length} of ${all.length}.`);
      return 0;
    }

    case "providers": {
      const id = Number(argv[1]);
      if (!Number.isInteger(id)) {
        console.error("providers <blueprintId>");
        return 2;
      }
      for (const p of await listPrintProviders(id)) {
        console.log(`${String(p.id).padStart(6)}  ${p.title}`);
      }
      return 0;
    }

    case "variants": {
      const bp = Number(argv[1]);
      const pp = Number(argv[2]);
      if (!Number.isInteger(bp) || !Number.isInteger(pp)) {
        console.error("variants <blueprintId> <printProviderId>");
        return 2;
      }
      const res = await listVariants(bp, pp);
      console.log(`${res.title}\n`);
      for (const v of res.variants) {
        const opts = Object.entries(v.options).map(([k, val]) => `${k}=${val}`).join(" ");
        console.log(`${String(v.id).padStart(8)}  ${v.title.padEnd(28)} ${opts}`);
      }
      console.log(`\n${res.variants.length} variants.`);
      return 0;
    }

    case "claims": {
      const site = await loadSite();
      if (!CLAIMS.length) {
        console.log(
          "Nothing in the line states a fact about the archive — no count, no year, " +
            "no name.\nThere is nothing to check. See the note above CLAIMS in line.ts " +
            "for what was\nretired and why.",
        );
        return 0;
      }
      let bad = 0;
      for (const claim of CLAIMS) {
        const why = claim.check(site);
        if (why) bad++;
        console.log(`${why ? "FAIL" : "ok  "}  ${claim.id.padEnd(16)} ${why ?? claim.says}`);
      }
      return bad ? 1 : 0;
    }

    case "audit": {
      await auditShop();
      return 0;
    }

    case "report":
      return report();

    case "catalogue":
    case "catalog":
      return catalogue(argv[1]);

    case "cost":
      return cost(argv[1], argv[2]);

    case "sweep":
      return sweep(argv[1]);

    case "reconcile":
      return reconcile(argv[1]);

    case "marks": {
      const onDisk = await marksOnDisk();
      console.log("Every logo on disk. A mark has to be in MARKS in matrix.ts to be printable.\n");
      for (const f of onDisk) {
        console.log(`  ${f.markId ? `[${f.markId}]`.padEnd(14) : "".padEnd(14)}${f.path}`);
      }
      console.log("\nWired into the line:\n");
      for (const mark of MARKS) {
        const used = MATRIX.filter((m) => m.mark === mark.id).map((m) => m.item);
        console.log(
          `  ${mark.id.padEnd(12)} ${mark.grounds.join("/").padEnd(6)} ${mark.press.padEnd(22)}` +
            `on ${used.length ? used.join(", ") : "nothing"}`,
        );
        console.log(`  ${" ".repeat(12)} from ${mark.source}`);
        console.log(`  ${" ".repeat(12)} press file written to ${LOGO_DIR} by \`cli.ts logos\``);
      }
      const unused = onDisk.filter((f) => !f.markId).length;
      console.log(
        `\n${MARKS.length} wired, ${unused} on disk and not wired. ` +
          `Nothing prints until it is in MARKS and in MATRIX.`,
      );
      return 0;
    }

    case "line": {
      const LINE = productLine();
      const site = await loadSite();
      for (const item of LINE) {
        console.log(
          `${item.id.padEnd(20)} ${`$${(item.priceCents / 100).toFixed(2)}`.padStart(7)}  ` +
            `bp${item.blueprintId}/pp${item.printProviderId}  ` +
            `${item.colors.length} colour${item.colors.length === 1 ? " " : "s"} x ${item.sizes.length} size${item.sizes.length === 1 ? " " : "s"} = ` +
            `${item.colors.reduce((n, c) => n + c.variants.length, 0)} variants  ${item.title}`,
        );
        console.log(`${" ".repeat(20)} ${item.placements.map((p) => `${p.position} ${p.art} ${p.widthIn}in y${p.y}`).join(", ")}`);
        if (item.sale) {
          const rule = [
            item.sale.minQuantity && item.sale.minQuantity > 1 ? `sold in ${item.sale.minQuantity}s` : "",
            item.sale.addOnOnly ? "never on its own" : "",
          ].filter(Boolean).join(", ");
          console.log(`${" ".repeat(20)} ${rule} — ${item.sale.why}`);
        }
      }
      console.log(
        `\n${LINE.length} products from ${MARKS.length} marks and ${ITEMS.length} items. ` +
          `Composed in matrix.ts; nothing was fetched.`,
      );
      // Prove the token substitution still resolves, since a description that
      // ships an unresolved {{token}} is a printed defect.
      const unresolved = LINE.filter((i) => /\{\{\w+\}\}/.test(fillTokens(i.description, site)));
      if (unresolved.length) {
        console.error(`\nUNRESOLVED TOKENS in: ${unresolved.map((i) => i.id).join(", ")}`);
        return 1;
      }
      return 0;
    }

    case "logos": {
      /**
       * Render every mark in MARKS and take its ground off.
       *
       * **There is no job list here any more.** It used to be two hardcoded
       * entries beside two hardcoded products, which meant adding a mark took
       * an edit in two files and forgetting one produced a product pointing at
       * a press file nothing wrote. MARKS carries the source, the press name,
       * the reach and the render width, and this command is a loop over it.
       *
       * `reach` is not a style choice — see artwork.ts. The full-colour crest
       * must be flood-filled from the border or the fill eats the banner text
       * and the dog's muzzle. The one-ink crest must be keyed everywhere or the
       * banner lettering and the eyes stay cream and print as slugs on a black
       * shirt; on that mark cream is not ink, it is the garment showing through.
       *
       * The render width is per mark. 6000px is the size of the captain's own
       * 600 dpi export and trims to 4526 x 5094 of artwork. Larger is free to
       * render and not free to upload: the file goes to Printify base64-encoded.
       *
       * NO WEB FILE COMES OUT OF THIS, and that is not an oversight.
       * `prepareLogo` still writes one — press PNG and web WebP off one source
       * in one pass, so the mark on the page and the mark on the parcel cannot
       * drift — but /store is a placeholder as of 2026-07-28 and renders no
       * mark, so a WebP in apps/web/public/store would be a file shipped in the
       * static export that nothing points at. Add
       * `web: { path: "apps/web/public/store/<name>.webp", width: 900 }` on the
       * day the real store is listed.
       */
      for (const mark of MARKS) {
        const as = mark.press.replace(/^logos\//, "");
        const r = await prepareLogo(mark.source, "dist/print/logos", {
          reach: mark.reach,
          as,
          render: { width: mark.renderWidth },
        });
        console.log(
          `${as.padEnd(16)} ${`${r.width}x${r.height}`.padEnd(12)} ` +
            `${(r.backgroundFraction * 100).toFixed(1).padStart(5)}% ground   ` +
            `${mark.reach} · ${mark.grounds.join("/")} bodies\n` +
            `${" ".repeat(16)} from  ${mark.source}\n` +
            `${" ".repeat(16)} press ${r.out}`,
        );
      }
      return 0;
    }

    case "sync": {
      const dryRun = argv.includes("--dry-run");
      const results = await sync({ dryRun });
      const problems = results.flatMap((r) => r.problems.map((p) => `${r.id}: ${p}`));
      if (problems.length) {
        console.error(`\n${problems.length} problem(s):`);
        for (const p of problems) console.error(`  ${p}`);
        return 1;
      }
      console.log(`\n${results.length} products${dryRun ? " (dry run — nothing sent)" : " created as drafts, all verified"}.`);
      return 0;
    }

    default:
      console.log(USAGE);
      return cmd ? 2 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err: unknown) => {
    // The token must never reach the log, so print the message and not the
    // request that carried it.
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
