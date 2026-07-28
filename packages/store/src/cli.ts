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
    logos                    Render the vector masters and take their ground off.
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
       * The two marks the line puts on a garment, and how each one's ground
       * comes off.
       *
       * Both are `logo_one` and both come off the VECTOR masters, not the flat
       * PNG beside them. That is the whole point of this command now: the flat
       * is 948px of artwork, which is 158 dpi at a six-inch print and 95 at ten,
       * and it is why the crest used to be sold at six inches. The vector
       * renders at whatever is asked for — 6000px here, 4526px of artwork after
       * the trim, which is 453 dpi at ten inches.
       *
       * `reach` is not a style choice — see artwork.ts. The full-colour crest
       * must be flood-filled from the border or the fill eats the banner text
       * and the dog's muzzle. The one-ink crest must be keyed everywhere or the
       * banner lettering and the eyes stay cream and print as slugs on a black
       * shirt; on that mark cream is not ink, it is the garment showing through.
       *
       * The output names say what the mark IS.
       *
       * NO WEB FILE COMES OUT OF THIS ANY MORE, and that is not an oversight.
       * `prepareLogo` still writes one — press PNG and web WebP off one source
       * in one pass, so the mark on the page and the mark on the parcel cannot
       * drift — but /store is a placeholder as of 2026-07-28 and renders no
       * mark, so a WebP in apps/web/public/store would be a file shipped in the
       * static export that nothing points at. Add
       * `web: { path: "apps/web/public/store/<name>.webp", width: 900 }` back to
       * each job on the day the real store is listed.
       */
      const jobs: {
        source: string;
        as: string;
        reach: Reach | "trim";
        why: string;
      }[] = [
        {
          source: "vector/logo-one-transparent-600dpi.png",
          as: "crest.png",
          reach: "trim",
          why: "full colour, ground already off — light garments",
        },
        {
          source: "vector/logo-one-one-color-gold.svg",
          as: "crest-gold.png",
          reach: "everywhere",
          why: "one ink, cream keyed to garment — dark garments",
        },
      ];

      // 6000px square, which is the size of the captain's own 600 dpi export and
      // trims to 4526 x 5094 of artwork. Larger is free to render and not free
      // to upload: the file goes to Printify base64-encoded.
      const RENDER_WIDTH = 6000;

      for (const job of jobs) {
        const r = await prepareLogo(`docs/logos/${job.source}`, "dist/print/logos", {
          reach: job.reach,
          as: job.as,
          render: { width: RENDER_WIDTH },
        });
        console.log(
          `${job.as.padEnd(16)} ${`${r.width}x${r.height}`.padEnd(12)} ` +
            `${(r.backgroundFraction * 100).toFixed(1).padStart(5)}% ground   ${job.why}\n` +
            `${" ".repeat(16)} from  ${job.source}\n` +
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
