# Working in this repository

A static archive of a Buffalo men's-league hockey club and a print-on-demand
store, on one domain. Node 24 native type-stripping — `.ts` runs directly, so no
enums, no parameter properties, no decorators.

**Read `MANUAL.md` first.** It is gitignored, it is the owner's own copy, and it
holds the whole picture: how the two systems work, the repo room by room, the
commands, the money and tax flow, and every hard-won fact about Printify and
Stripe. `TODO.md` is the parking list. Neither ships.

---

## Verify, do not remember

**This repository has been wrong about itself more than once, confidently.** A
decision recorded in prose is a decision nobody has checked. Before repeating
any figure, supplier choice, rate or dashboard path from a comment, a document
or a previous session — measure it.

Real examples, all shipped before being caught:

- A discount ceiling of "26%" that no longer held; the measured figure was 35%.
- A supplier ranked cheapest that had never returned a price at all.
- Two garments flagged as "cheaper elsewhere" where the saving was exactly zero.
- Size labels that hid two sizes because a `Set` came back unsorted.
- A fabric blend read off a sentence describing a *different colourway*.

**Check generated output before showing it to the user.** Every one of those was
in a page presented as measured fact.

**Third-party dashboard paths change — look them up, never guess.** Printify and
Stripe both moved menus during a single session. Wrong directions cost the
owner's time and his trust.

---

## Things that break silently

**Four things must agree, and only a sync makes them agree.**

```
matrix.ts → npm run store:sync → Printify + products.json → build:site → the site
```

Editing `matrix.ts` changes nothing anybody can see. This served quotes the
owner had struck for days, with every test green. Run `cli.ts reconcile` on
**both** sides of a sync — a rename orphans the old drafts.

**Never run `build:site` while `next dev` or `wrangler dev` is running.** Dev
serves 500s that look exactly like a code error; wrangler holds `apps/web/out`
open and the build fails `EBUSY`. Dev port here is **3002**.

**`git push` IS the deploy.** Cloudflare rebuilds on every push to `main` in
about 90 seconds. A local `npm run deploy` without a push is reverted by the
next daily refresh Action, silently, by morning.

**Colourway variants are positional.** `way.variants[sizes.indexOf(size)]` — a
colourway is a complete size run or it is not offered. A gap shifts every larger
size down one and sells the wrong garment.

**`packages/build/src/generate.ts` contains NUL bytes and ripgrep skips it
silently.** An empty Grep result for that file means nothing. Search it with
node reading the file directly.

**`/api/checkout` does not exist under `npm run dev`.** The site is a static
export. Use `npx wrangler dev`. When the till fails, the reason is in that
terminal — the browser only ever shows one sentence.

---

## Safety

**Never read, print, or commit anything under `.secrets/`.** Report a
credential's shape and length, never its value.

**Do not `git add -A` without reading `git status` first.** A change nobody
explained was committed to a public repository that way. If something unexpected
is modified, ask before staging it.

**The repository is public.** No credentials, no personal data, no costs or
margins in tracked files. Discount codes belong in `.secrets/`, never in source
— one was hardcoded in a tracked script and had to be rotated.

**The Printify token can see a second, unrelated shop.** No function takes a
shop id; `SHOP_ID` is a constant and `assertShopPath()` checks every
`/shops/{id}` in a path before a socket opens. The guard is deliberately
duplicated in the Worker rather than imported. Never add a shop-id parameter.

**Nothing here may publish a product.** There is no `publishProduct()`, and
Printify products are created visible by default — `visible` is a required
field so no caller can make one live by forgetting a line.

---

## Before claiming something works

Run it. `npm test` (473), `npm run typecheck`, and for anything touching the
shop, the live check that proves it — a real request, a real read-back, a real
screenshot. Say plainly what was verified and what was not.
