# Working in this repository

A static archive of a Buffalo men's-league hockey club and a print-on-demand
store, on one domain. Node 24 native type-stripping — `.ts` runs directly, so no
enums, no parameter properties, no decorators.

**Read `MANUAL.md` first.** Gitignored, the owner's own copy, and the whole
picture: how both systems work, the repo room by room, the commands, the money
and tax flow. `TODO.md` is the parking list. Neither ships.

## Verify, do not remember

Measure any figure, supplier, rate or dashboard path before repeating it from a
comment, a document or a previous session.

Check generated output before showing it to the user.

Look up third-party dashboard paths — Printify and Stripe move menus.

## Things that break silently

**`matrix.ts` → `npm run store:sync` → Printify + `products.json` →
`build:site` → the site.** Editing `matrix.ts` alone changes nothing anybody can
see. Run `cli.ts reconcile` on both sides of a sync — a rename orphans the old
drafts.

**Never run `build:site` while `next dev` or `wrangler dev` is running.** Dev
serves 500s that look like a code error; wrangler holds `apps/web/out` open and
the build fails `EBUSY`. Dev port is **3002**.

**`git push` IS the deploy** — Cloudflare rebuilds in ~90s. A local
`npm run deploy` without a push is reverted by the next daily Action.

**Colourway variants are positional.** `way.variants[sizes.indexOf(size)]` — a
colourway is a complete size run or it is not offered. A gap sells the wrong
garment.

**`packages/build/src/generate.ts` contains NUL bytes and ripgrep skips it
silently.** Search it with node reading the file directly.

**`/api/checkout` does not exist under `npm run dev`.** Use `npx wrangler dev`.
When the till fails the reason is in that terminal, not the browser.

## Safety

Never read, print or commit anything under `.secrets/`. Report a credential's
shape and length, never its value.

Do not `git add -A` without reading `git status`. If something unexpected is
modified, ask before staging it.

**The repository is public.** No credentials, personal data, costs or margins in
tracked files. Discount codes live in `.secrets/`, never in source.

**The Printify token can see a second, unrelated shop.** No function takes a
shop id; `SHOP_ID` is a constant and `assertShopPath()` checks every
`/shops/{id}` before a socket opens. The guard is duplicated in the Worker
deliberately. Never add a shop-id parameter.

Nothing here may publish a product. There is no `publishProduct()`, and
`visible` is a required field so no caller can make one live by omission.

## Before claiming something works

Run it — `npm test` (473), `npm run typecheck`, and for anything touching the
shop a live check that proves it. Say what was verified and what was not.
