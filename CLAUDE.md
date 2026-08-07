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

**The store is LIVE and takes real money** (since 1 August 2026). Orders are
held on Printify for manual approval, which is the only safety net between a
bug and a customer. Test against `npx wrangler dev` with the test key, never by
trying something on the live site.

## Things that break silently

**`matrix.ts` → `npm run store:sync` → Printify + `products.json` →
`build:site` → the site.** Editing `matrix.ts` alone changes nothing anybody can
see. Run `cli.ts reconcile` on both sides of a sync — a rename orphans the old
drafts.

**Never run `build:site` while `next dev` or `wrangler dev` is running.** Dev
serves 500s that look like a code error; wrangler holds `apps/web/out` open and
the build fails `EBUSY`. `npm run dev` sets no port, so Next takes the first
free one from 3000 — another project on this machine holds 3000–3001, so it
usually lands on **3002**.

**`git push` IS the deploy** — Cloudflare rebuilds in ~90s. A local
`npm run deploy` without a push is reverted by the next daily Action.

**Colourway variants are positional.** `way.variants[sizes.indexOf(size)]` — a
colourway is a complete size run or it is not offered. A gap sells the wrong
garment.

**What Google is told is DERIVED — keep it that way.** The sitemap, the JSON-LD
on every page and `/feed/products.xml` all read `products.json` and `site.json`
at build time, so a new product, player, game or season appears in all of them
with no extra step. **Never hand-maintain a list of URLs or products** — that
list is what goes stale. If a change makes you want to, the derivation is what
needs fixing.

Two things that do NOT derive, and both are caught by `npm test`:

- **A new garment type throws.** Google demands a product category, age group
  and size system per item; `GOOGLE` in `packages/store/src/feed.ts` is keyed on
  `itemId` and an unmapped one refuses rather than guessing. Filing hoodies as
  homeware is what that prevents.
- **The social card is a committed file.** `og:image` points at
  `/store/<id>-card.jpg`, written by `npm run store:mockups`, not by the site
  build. Add a product without re-running mockups and its link preview 404s
  while the page renders fine.

**Anything sold with a minimum gets no feed row AND no product markup.**
`excludedBecause` governs both halves. It governed only the feed once, and ten
sticker pages shipped a $3.50 offer above a page selling three for $10.50.

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

Run it — `npm test` (524), `npm run typecheck`, and for anything touching the
shop a live check that proves it. Say what was verified and what was not.

**One successful probe does not mean a deploy has landed.** A new URL was
measured 200, then 404, then 200 over about a minute on 2026-08-07 — edges pick
up a build at different times. Check the URL twice, a little apart, and read the
body rather than the status code.
