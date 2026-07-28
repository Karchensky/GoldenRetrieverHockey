import {
  listBlueprints,
  listPrintProviders,
  listShops,
  listVariants,
  searchBlueprints,
} from "./api.ts";
import { prepareLogo } from "./artwork.ts";
import type { Reach } from "./artwork.ts";
import { CLAIMS, loadSite } from "./line.ts";
import { auditShop, sync } from "./sync.ts";

/**
 * The lookup helper.
 *
 * Its entire job is to print numbers a human can read and paste into
 * apps/web/data/products.json. It writes nothing, creates nothing, and cannot:
 * every call it makes is a GET against the public catalog.
 *
 * ⚠ NOT EXECUTED. There is no token in this repo, so this has never been run.
 * The endpoints it calls were transcribed from Printify's docs on 2026-07-15
 * and are documented rather than tested. First real run should be `shops`,
 * which is the smallest possible request and tells you whether auth works at
 * all before you go near the catalog.
 *
 *   node packages/store/src/cli.ts shops
 *   node packages/store/src/cli.ts blueprints "heavy cotton tee"
 *   node packages/store/src/cli.ts providers 6
 *   node packages/store/src/cli.ts variants 6 99
 */

const USAGE = `
@gr/store — Printify

  Read-only
    shops                    Shops this token can see. Start here.
    blueprints [query]       Garment models, optionally filtered by substring.
    providers <blueprintId>  Print providers who make that blueprint.
    variants <bpId> <ppId>   Colour/size variants, with their ids.
    claims                   Re-derive every claim the artwork makes, from site.json.
    audit                    Every product on shop 28277243, and nothing else.

  Writes, to shop 28277243 only
    logos                    Strip the paper off docs/logos/*.png for print.
    sync --dry-run           Show placement and resolution. Sends nothing.
    sync                     Upload art, create the line as DRAFTS, read it back.

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

    case "logos": {
      /**
       * Every mark the line puts on a garment, and how its ground comes off.
       *
       * `reach` is not a style choice — see artwork.ts. The cream-ground logos
       * must be flood-filled from the border or the fill eats the banner text
       * and the dog's muzzle; the black-ground concepts must be keyed
       * everywhere or the letter counters and the gap between the dog's legs
       * stay opaque and print as black slugs.
       *
       * The output names say what the mark IS. The source names say where it
       * came from, and two of these are exploration art the captain has not
       * signed off — that provenance is in docs/store/POP-UP.md, not buried in
       * a filename the printer sees.
       */
      const jobs: {
        source: string;
        as: string;
        reach: Reach | "keep";
        web?: string;
        why: string;
      }[] = [
        { source: "logo_one.png", as: "crest.png", reach: "border", web: "crest.webp", why: "cream ground, black outline" },
        { source: "logo_two.png", as: "monogram.png", reach: "border", web: "monogram.webp", why: "cream ground, black R" },
        { source: "concept-04-skate-blade-wordmark.png", as: "wordmark.png", reach: "everywhere", web: "wordmark.webp", why: "black ground, no black ink" },
        { source: "concept-11-pixel-retriever.png", as: "retriever.png", reach: "everywhere", web: "retriever.webp", why: "black ground, no black ink" },
        // The sticker is white vinyl and this mark was drawn for black. It
        // brings its own ground; nothing is removed.
        { source: "concept-11-pixel-retriever.png", as: "retriever-plate.png", reach: "keep", why: "kept whole, for white vinyl" },
      ];

      for (const job of jobs) {
        const r = await prepareLogo(`docs/logos/${job.source}`, "dist/print/logos", {
          reach: job.reach,
          as: job.as,
          ...(job.web ? { web: { path: `apps/web/public/store/${job.web}`, width: 900 } } : {}),
        });
        console.log(
          `${job.as.padEnd(20)} ${`${r.width}x${r.height}`.padEnd(12)} ` +
            `${(r.backgroundFraction * 100).toFixed(1).padStart(5)}% ground   ${job.why}\n` +
            `${" ".repeat(20)} from  ${job.source}\n` +
            `${" ".repeat(20)} press ${r.out}${r.web ? `\n${" ".repeat(20)} web   ${r.web}` : ""}`,
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
