import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * One folder of credentials, two places that need them, and a wall between
 * TEST and LIVE.
 *
 * THE PROBLEM THIS EXISTS TO END. The same secrets were being typed by hand
 * into three places, because three runtimes want them and none of them share:
 *
 *   .secrets/*.txt            the Node CLI — store:sync, sweep, report
 *   .dev.vars                 `wrangler dev`, running the Worker locally
 *   `wrangler secret put`     the DEPLOYED Worker on Cloudflare
 *
 * THE PROBLEM THE FIRST VERSION CAUSED. It had one slot per secret, so
 * `stripe_secret.txt` was "whichever key you last saved". On 2026-07-31 that
 * was a LIVE key: `wrangler dev` built a real Stripe session on the captain's
 * own machine, and the test card was declined — correctly, and only because
 * Stripe checks. A file whose meaning depends on what you last pasted into it
 * is not a source of truth, it is a coin toss with money on it.
 *
 * SO: THE MODE IS IN THE FILENAME, AND THE WALL IS ENFORCED HERE.
 *
 *   stripe_secret_test.txt  ->  .dev.vars only.  NEVER uploaded.
 *   stripe_secret_live.txt  ->  Cloudflare only. NEVER written to .dev.vars.
 *
 * `secrets:local` refuses to put a live key anywhere near local dev, and
 * `secrets:deploy` refuses to put a test key on the deployed Worker. Neither
 * refusal has an override flag, because the only reason to want one is the
 * mistake itself.
 *
 *   npm run secrets:status    what exists, what mode it is, where it goes
 *   npm run secrets:local     write .dev.vars from the TEST key
 *   npm run secrets:deploy    upload the LIVE key to Cloudflare
 *
 * IT NEVER PRINTS A VALUE. Every line names a file, a shape and a length. The
 * deploy path pipes secrets to wrangler on stdin rather than passing them as
 * arguments, which would put them in the process table.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SECRETS = join(ROOT, ".secrets");

const TEST = "test";
const LIVE = "live";

/**
 * One entry per Worker environment variable.
 *
 * `files` is keyed by mode. A secret with the same value in both modes — the
 * Printify token, the webhook secret — names the same file twice, which is the
 * honest way to say "this one does not have a test twin".
 */
const SLOTS = [
  {
    env: "STRIPE_SECRET_KEY",
    required: true,
    files: { [TEST]: "stripe_secret_test.txt", [LIVE]: "stripe_secret_live.txt" },
    shape: { [TEST]: /^sk_test_[A-Za-z0-9]{20,}$/, [LIVE]: /^sk_live_[A-Za-z0-9]{20,}$/ },
    where: {
      [TEST]: "Stripe → Developers → API keys, with TEST MODE ON. Reveal the secret key.",
      [LIVE]: "Stripe → Developers → API keys, with TEST MODE OFF. Shown ONCE — paste it straight into the file.",
    },
  },
  {
    env: "PRINTIFY_API_TOKEN",
    required: true,
    files: { [TEST]: "printify_token.txt", [LIVE]: "printify_token.txt" },
    shape: { [TEST]: /^eyJ[A-Za-z0-9_-]+\./, [LIVE]: /^eyJ[A-Za-z0-9_-]+\./ },
    where: {
      [TEST]: "Printify → My profile → Connections → Personal access tokens.",
      [LIVE]: "Printify → My profile → Connections → Personal access tokens.",
    },
    note: "Printify has no test mode. The same token is used both places.",
  },
  {
    env: "STRIPE_WEBHOOK_SECRET",
    required: false,
    files: { [TEST]: "stripe_webhook_secret.txt", [LIVE]: "stripe_webhook_secret.txt" },
    shape: { [TEST]: /^whsec_[A-Za-z0-9]{20,}$/, [LIVE]: /^whsec_[A-Za-z0-9]{20,}$/ },
    where: {
      [TEST]: "Stripe → Developers → Webhooks → your endpoint → signing secret.",
      [LIVE]: "Stripe → Developers → Webhooks → your endpoint → signing secret.",
    },
    note: "Does not exist until the endpoint does — MANUAL.md §1 step 14. Checkout works without it; fulfilment does not.",
  },
];

/** Files that are not Worker secrets, so nobody wonders why they are ignored. */
const NOT_SECRETS = {
  "printify_token.txt": null, // handled above
  "ngin_session.txt": "capture credential — SportsEngine session cookie, read by the capture CLI",
  "harborcenter-request.txt": "capture credential — a saved request the HarborCenter capture replays",
  "stripe_publishable.txt": "NOT USED BY ANYTHING. The checkout is server-side; the browser never talks to Stripe.",
  "stripe_backup.txt": "not an API key — looks like a Stripe account recovery code. Nothing reads it.",
  "wrangler.jsonc": "a stray copy of the KV binding. The real one is in wrangler.jsonc at the repo root.",
  "README.md": "notes",
};

/** Reads a slot's file for a mode. Returns null when absent or empty. */
async function read(slot, mode) {
  try {
    const value = (await readFile(join(SECRETS, slot.files[mode]), "utf8")).trim();
    return value.length ? value : null;
  } catch {
    return null;
  }
}

/** Describes a value without revealing it. */
function describe(value) {
  if (/^sk_test_/.test(value)) return "Stripe secret key, TEST";
  if (/^sk_live_/.test(value)) return "Stripe secret key, LIVE";
  if (/^pk_test_/.test(value)) return "Stripe PUBLISHABLE key, TEST";
  if (/^pk_live_/.test(value)) return "Stripe PUBLISHABLE key, LIVE";
  if (/^rk_/.test(value)) return "Stripe restricted key";
  if (/^whsec_/.test(value)) return "Stripe webhook signing secret";
  if (/^eyJ[A-Za-z0-9_-]+\./.test(value)) return "JWT";
  return "unrecognised";
}

/**
 * Gathers every slot for a mode and refuses on anything that does not belong.
 *
 * The wall is here. A value that fails its mode's shape stops the run: there is
 * no partial write, so `.dev.vars` and Cloudflare are never left half-updated.
 */
async function collect(mode) {
  const found = [];
  const problems = [];

  for (const slot of SLOTS) {
    const file = slot.files[mode];
    const value = await read(slot, mode);

    if (!value) {
      if (slot.required) {
        problems.push(
          `${slot.env}\n` +
            `      MISSING — expected .secrets/${file}\n` +
            `      Get it: ${slot.where[mode]}`,
        );
      } else {
        console.log(`  ○ ${slot.env.padEnd(23)} not set`);
        if (slot.note) console.log(`      ${slot.note}`);
      }
      continue;
    }

    if (!slot.shape[mode].test(value)) {
      const other = mode === TEST ? LIVE : TEST;
      const isWrongMode = slot.shape[other] && slot.shape[other].test(value);
      problems.push(
        `${slot.env}\n` +
          `      .secrets/${file} holds a ${describe(value)}\n` +
          `      ${mode.toUpperCase()} needs ${mode === TEST ? "sk_test_…" : "sk_live_…"}` +
          (isWrongMode
            ? `\n      That is the ${other.toUpperCase()} key. It belongs in .secrets/${slot.files[other]}.`
            : `\n      Get it: ${slot.where[mode]}`),
      );
      continue;
    }

    found.push({ env: slot.env, value, file });
    console.log(`  ✓ ${slot.env.padEnd(23)} .secrets/${file.padEnd(26)} ${describe(value)}, ${value.length} chars`);
  }

  if (problems.length) {
    console.error(`\n  ✗ ${problems.join("\n\n  ✗ ")}`);
    console.error(`\nNothing was written. Fix the above and run it again.`);
    process.exit(1);
  }

  return found;
}

/** `.dev.vars`, for `wrangler dev`. TEST ONLY — enforced above. */
async function local() {
  console.log("\nLOCAL — writing .dev.vars for `wrangler dev`, from the TEST key.\n");
  const found = await collect(TEST);

  const body =
    "# GENERATED by `npm run secrets:local` from .secrets/ — do not edit.\n" +
    "# TEST CREDENTIALS ONLY. A live key cannot reach this file: secrets.mjs\n" +
    "# refuses to write one. Re-run after changing anything in .secrets/.\n\n" +
    found.map((f) => `${f.env}=${f.value}`).join("\n") +
    "\n";

  await writeFile(join(ROOT, ".dev.vars"), body);
  console.log(`\nWrote .dev.vars with ${found.length} secret(s), all test-mode.`);
  console.log("Restart `wrangler dev` to pick them up. Pay with 4242 4242 4242 4242.");
}

/** The deployed Worker. LIVE ONLY. Values go over stdin, never in an argument. */
async function deploy() {
  console.log("\nDEPLOY — uploading to the Cloudflare Worker, from the LIVE key.\n");
  const found = await collect(LIVE);

  console.log("\nUploading…\n");
  for (const entry of found) {
    const code = await new Promise((resolve) => {
      const child = spawn("npx", ["wrangler", "secret", "put", entry.env], {
        cwd: ROOT,
        stdio: ["pipe", "inherit", "inherit"],
        shell: process.platform === "win32",
      });
      child.stdin.end(entry.value);
      child.on("close", resolve);
    });
    if (code !== 0) {
      console.error(`\n${entry.env} failed (exit ${code}). Stopping — the rest were not uploaded.`);
      process.exit(1);
    }
  }

  console.log(`\n${found.length} secret(s) uploaded. \`npx wrangler secret list\` shows the names, never the values.`);
  console.log("Setting a secret redeploys the Worker on its own. No `npm run deploy` needed.");
}

/** What exists, what it is, and where it is allowed to go. Changes nothing. */
async function status() {
  console.log("\n.secrets/ — what is here and where it goes\n");

  for (const mode of [TEST, LIVE]) {
    const target = mode === TEST ? ".dev.vars  (wrangler dev)" : "Cloudflare (deployed Worker)";
    console.log(`  ${mode.toUpperCase().padEnd(5)} → ${target}`);

    for (const slot of SLOTS) {
      const file = slot.files[mode];
      const value = await read(slot, mode);
      const req = slot.required ? "required" : "optional";

      if (!value) {
        console.log(`    ${slot.env.padEnd(23)} MISSING   .secrets/${file}  (${req})`);
      } else if (!slot.shape[mode].test(value)) {
        console.log(`    ${slot.env.padEnd(23)} WRONG     .secrets/${file} holds a ${describe(value)}`);
      } else {
        console.log(`    ${slot.env.padEnd(23)} ok        .secrets/${file}  ${describe(value)}, ${value.length} chars`);
      }
    }
    console.log("");
  }

  console.log("  Everything else in .secrets/, and why it is not a Worker secret:\n");
  for (const [file, why] of Object.entries(NOT_SECRETS)) {
    if (!why) continue;
    let exists = true;
    try {
      await readFile(join(SECRETS, file), "utf8");
    } catch {
      exists = false;
    }
    if (exists) console.log(`    ${file.padEnd(28)} ${why}`);
  }

  // The one file that must not exist any more.
  try {
    const legacy = (await readFile(join(SECRETS, "stripe_secret.txt"), "utf8")).trim();
    console.log(`\n  ⚠ .secrets/stripe_secret.txt still exists and holds a ${describe(legacy)}.`);
    console.log(`    That ambiguous name is what caused a live session in local dev on 31 July.`);
    console.log(`    Rename it to stripe_secret_${/^sk_live_/.test(legacy) ? "live" : "test"}.txt and delete the original.`);
  } catch {
    /* good — it is gone */
  }

  console.log("");
}

const mode = process.argv[2];
if (mode === "local") await local();
else if (mode === "deploy") await deploy();
else if (mode === "status") await status();
else {
  console.error("secrets.mjs status | local | deploy");
  console.error("  status  what exists, what mode it is, and where it is allowed to go");
  console.error("  local   write .dev.vars from the TEST key   (for `wrangler dev`)");
  console.error("  deploy  upload the LIVE key to the deployed Worker");
  process.exit(2);
}
