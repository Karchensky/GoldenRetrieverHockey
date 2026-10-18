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

## The goal highlights

`packages/highlights`, run daily by `.github/workflows/highlights.yml`, clips
our goals from the rink's recordings onto the box scores. **It uses up
something scarce**: each clip is one of the 20 downloads the rink account gets
a month (the platform calls them credits; `clipsCredit` reads what is left).
Run `cli.ts daily` anywhere but the workflow only with `--dry-run`.

**The backup** cuts a clip straight from the recording the job already reads
(`cutClip` in `stream.ts`) and spends nothing. `--source` picks: `auto` (the
daily run: downloads while they last, then the recording), `download`,
`recording`. A game before `SINCE` — only reached with `--since` — is never
downloaded. A cut clip gets the same two checks as a download. `cli.ts compare
--game <id>` puts a game's downloads beside the same clips cut from the
recording, in `tmp/highlights/<id>/`, and spends nothing.

**The recap** (`recap.ts`) is a few minutes of each game: every goal found,
both teams', then shots on goal (the Rink 1 board counts them; each rise is a
shot, about 2 s late), the plays whistles in a zone ended, and the chances no
one counted — rushes and spells of pressure — the best first, up to eight
minutes. Chances, and which whistles were offsides and icings in the neutral
zone (left out), come from where the camera looks (`view.ts`): the blue lines
on the ice say the zone, the camera's turn how deep. Nothing finds the net
itself; its frame is too thin on video. The daily job makes it once a game's
goals are searched, to `apps/web/data/recaps.json` and R2 as
`<game>-recap-<hash>.mp4`. It reads the whole recording, so it costs the job a
quarter of an hour a game and no download. None is made for a game with over a
quarter of its goals unfound. Raising `RECAP_EDITION` makes every recap again,
`REMAKES_PER_RUN` a run. `cli.ts recap --game <id>` makes one locally.

The account, not the ledger, is what stops a download being used twice — the
job reuses any clip of its own at the same start and length. Never set a ledger
clip to `queued` by hand unless it should use another download; the recovery
steps are in the workflow's header.

**The Actions logs are public.** Never print the recording's address, a token or
a clip's download link — not in a log line, not in an error message.

Clip names carry their own hash (`<game>-<goal>-<hash>.mp4`) because the Worker
lets browsers cache them for a year. Never upload over an existing name.

The scoreboard reader knows two boards, `layouts/*.json`. A recording on a
board it does not know is reported, never guessed at, and costs nothing.

**Measure the search on many games, not one.** `cli.ts survey --since <date>
[--clips]` runs it over every game in a range, reads only, and reports each
goal found or why not. Tuned on two October games it found 4 of summer 2026's
104 goals. What the summer taught it: the board sits a few pixels differently
per recording (`calibrate`), its period label can be anything (periods come
from the clock, `choosePeriods`), and on Rink 2 the graphic's SCORE is kept by
hand and was stuck at 0–0, wrong, or a goal behind on most summer nights. A
goal whose score change the graphic never shows is refused, which is right.
The summer tile also drew its digits thinner and showed scores past 4: a digit
can carry several templates (`c0`, `c0b`), learnt from summer frames and kept
only when no glyph that read before reads differently.
Set `GRH_SEGMENT_CACHE=<dir>` to keep the segments read, so a second run is
quick.

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

Run it — `npm test` (636, 26 skipped), `npm run typecheck`, and for anything touching the
shop a live check that proves it. Say what was verified and what was not.

**One successful probe does not mean a deploy has landed.** A new URL was
measured 200, then 404, then 200 over about a minute on 2026-08-07 — edges pick
up a build at different times. Check the URL twice, a little apart, and read the
body rather than the status code.
