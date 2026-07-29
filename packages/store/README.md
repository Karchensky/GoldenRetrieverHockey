# @gr/store — Printify

Creates and verifies the store's products on **shop 28277243** as drafts, and
reports what they cost and earn. It has been run against the live API and the
23 products in `apps/web/data/products.json` were made by it. The shop is named
"Golden Retrievers" in the dashboard now; the id is what matters and the id has
not changed.

**Nothing on the site renders any of this.** `/store` is a placeholder — the
captain's instruction was that the line would be listed all at once when it is
finished. `products.json` stays because it is not page copy: it is the record of
what the shop actually holds, regenerated from the read-back on every sync.

**Selling happens on a Printify Pop-Up store, which is a different shop id and
is not managed from here.** The 23 drafts on 28277243 are the workbench — this
is where the line is composed, priced, measured and verified, and the Pop-Up is
a copy made in the dashboard. `api.ts` will refuse the Pop-Up's id along with
every other, and that is correct.

**`STORE.md` at the repo root is the manual** — where to change a brand, where
cost and margin live, how shipping works and what is controllable, how to add a
product, and what is left before anyone can buy. It is local and gitignored,
because it carries costs, margins and take-home per sale. This file is the
implementation notes underneath it, and it is public.

```sh
npm run store:report                        # cost, margin, postage, take-home. LIVE
npm run store:catalogue "hoodie"            # what else it could be
npm run store:catalogue 2002                # who makes it, and what they charge to post
npm run store:line                          # the matrix as products; fetches nothing

node packages/store/src/cli.ts shops        # start here on a new token; smallest request
node packages/store/src/cli.ts cost 12 410  # real per-variant cost: creates a draft, reads it, deletes it
node packages/store/src/cli.ts marks        # every logo on disk, and which are wired in
node packages/store/src/cli.ts claims       # re-derive every printed claim from site.json
node packages/store/src/cli.ts audit        # every product on 28277243, and only that shop
node packages/store/src/cli.ts logos        # render the vector masters for print
node packages/store/src/cli.ts sync --dry-run
node packages/store/src/cli.ts sync         # upload art, create drafts, read them back
```

Token: `PRINTIFY_API_TOKEN`, or `.secrets/printify_token.txt`. It is a
credential — never committed, never logged, never printed.

## The line is composed, not listed

`src/matrix.ts` holds three lists — `MARKS`, `ITEMS`, `MATRIX` — and
`buildLine()` turns them into products. One line in `MATRIX` is one product; its
id, title, colourways, description, placement and buying rules are all derived,
so a tee cannot be $36 in one place and $32 in another and the same paragraph
cannot be spelled two ways.

An item may carry a `sale` — `minQuantity`, `addOnOnly`, and the sentence saying
why. It travels with the price rather than living in checkout because it **is**
part of the price: the sticker is $6 and sold in threes, and neither half of that
is true without the other.

`buildLine()` refuses rather than guesses, and every refusal names both halves of
the pairing:

```
arched-varsity on sticker: the sticker is offered on light bodies and this mark
can only sit on dark. The wordmark is white with a gold keyline and the white is
the whole weight of it — on a light body it hollows out into an outline. Dark
bodies only. Add a dark colourway to the item, or drop the line.
```

It also catches an unknown mark or item, a duplicate line, a colourway whose
variant-id count does not match the item's sizes, and a placement position the
garment does not offer. That last one found a real error the day it was written:
this package had believed Bella+Canvas 3001 through Monster Digital took sleeve
prints. All 299 of its variants offer front, back and neck only. (Through
Printful, which prints the tee now, it takes ten positions including both sleeves
and four embroidery areas — the declaration is per provider and the report
re-checks it against the catalog every run.)

`productLine()` is a function and not a constant so those messages arrive
through the CLI's own error handler rather than as a module-loader stack.

## What the report reads, and what does not exist to read

`store:report` is live and read-only. Per product it prints blueprint id with
brand and model, provider id with name and country, cost and take-home per cost
tier, postage per method and region, printed size and dpi, and what one US sale
leaves under the policy the store actually ships on — **free US postage, priced
in**. Then a total, then what is worth a decision, then how every figure was made.

Two things it will not do, both added on 2026-07-28.

**It quotes retail from the matrix, never from the shop.** `matrix.ts` is where
the price is decided and `sync` is what pushes it, so a figure sitting on a
product is the last one uploaded rather than the current one. Reading the shop's
price made a repricing look like it had not happened until it had been uploaded.
The disagreement is still reported; it just no longer decides the arithmetic.

**It refuses to quote a cost that belongs to a different garment.** Products are
matched by TITLE, and a title is derived from the mark and the item — so changing
the hoodie from Gildan to Independent Trading in `matrix.ts` leaves the old
Gildan draft still answering to "Golden Retrievers Crest — Hoodie". Every cost
would be the Gildan's, quoted confidently against the Independent's price, and it
would look right and be wrong by ten dollars a unit. The row is flagged
`GARMENT`, the cost tiers are suppressed, and the report prints the `cli.ts cost`
line that gets the real number.

Six things about Printify's API that the report had to be built around, all
checked live on 2026-07-28:

- **There is no cost in the catalog.** `/v1/catalog/.../variants.json` returns
  options and print areas and no price, and the v2 catalog tree 404s apart from
  shipping. A variant's `cost` appears for the first time on a product that
  exists. This is why `store:catalogue` can compare providers on postage, print
  area and origin but not on cost, and says so — and why `src/cost.ts` exists:
  it creates one draft, reads the cost off it, and deletes it in a `finally`.
  That is not a workaround, it is the only route there is.
- **A product may hold at most 100 enabled variants.** 120 returns
  `400 code 8251: Too many variants enabled. Maximum allowed: 100`. Undocumented,
  and nothing in the catalog response predicts it; `cost.ts` caps at 100 and
  prints the cap beside the answer.
- **Postage does not merge across product types.** `POST /shops/{id}/orders/
  shipping.json` prices a tee at $4.75, a cap at $4.89, and the two together at
  **$9.64** — both from Printful, two first-item rates. Two tees quote $7.15 and
  three stickers $4.77, so quantity of ONE thing does merge. This file used to
  claim the opposite, on the strength of Printify's own wording about grouping
  "by product type and provider"; the basket call settles it. It is the reason
  every retail price in `matrix.ts` carries a whole first-item rate.
- **v1 shipping profiles are unlabelled and overlapping.** Blueprint 12 through
  Monster Digital returns three separate US profiles at $4.29, $4.75 and $7.99
  over the same variants with nothing to say which is which, and one blanket
  10-day handling time. **v2 names the method** — standard, priority, express,
  economy — and gives a handling range per method. The report uses v2; the
  catalogue browser uses v1 because 7 KB per provider beats 6 MB when eighteen
  of them are being compared.
- **The v2 rate endpoint has no filter.** `?country=`, `?filter[country]=` and
  `?variant_ids=` all return the whole set; standard shipping for a tee is
  18,538 rows. It is cached per blueprint/provider and reduced locally. Caching
  by variant list instead — which the first version did — misses on the second
  tee and downloads the same 6 MB twice.
- **`POST /shops/{id}/orders/shipping.json` prices a real basket** and creates
  nothing. It returned standard $4.75 for a US tee, matching the catalog. That
  is the call checkout will make.

## The 300 dpi floor is a refusal, not a warning

`sync` measures every placement in the whole line before it uploads a byte, and
throws with every offender named:

```
Refusing to upload art that prints under 300 dpi at its largest size:
  tiny-tee/front: 30 dpi at 10in, its largest size — logos/tiny-probe.png is
  300px wide and would need 3000px
Render the mark larger, or print it smaller. Do not ship it soft.
```

It used to print that as a line of commentary inside the create loop, which
meant a soft design was flagged and then uploaded anyway, and every product
earlier in the line was already on the shop by the time anyone read it. It is
now a pre-flight, the same shape as the claims gate above it. Proven by pointing
a mark at a 300 px file: it stops before the first upload.

## The one guard that matters

The token can see two shops:

```
28277243  GoldenRetrieverHockey  (custom_integration)   this project
13449786  another shop                (etsy)                 a different business
```

The other shop has nothing to do with a hockey team.
**No function in `api.ts` takes a shop id.** There is no argument to get wrong
and no config to mistype: `SHOP_ID` is a constant, and every request also
asserts its own URL before a socket is opened. Forging a path at another shop
throws with the reason, not a number.

The assertion was walking every path's FIRST `/shops/{id}` and stopping there,
which is the id the constant had just written — so a second shop segment further
along was never read. Found and closed on 2026-07-28: a product id of
`x.json?redirect=/shops/13449786/products` used to pass and now throws.

There is deliberately **no `publishProduct()`**. Publishing is one click in a
dashboard the captain can see, and nothing in this package can make the shop go
live.

## What the sync will not do

`sync` re-derives every factual claim its artwork makes from
`apps/web/data/site.json` before it uploads anything, and stops if one no longer
holds. The claims and their checks are in `src/line.ts`.

This is not defensive decoration, and it has now caught three things. The catalog
shipped a tee reading **SAVES 0 / EVERY GOALTENDER SEASON**, and it is false —
Brent Seymour's 2012 and 2013 lines record 775, 180 and 118 saves, recovered
after the shirt was written. Then on 2026-07-26 it stopped a run outright: the
captain's stats workbook had been ingested with a **Winter 2011** season on it,
which makes **EST. 2012** false, and three garments were about to carry it.

`CLAIMS` is empty today and that is the correct state. The line prints one mark
and a place — no count, no year, no name in type — so there is nothing left to
check. Where copy states the founding year it carries a `{{firstYear}}` token
resolved from `site.json` at upload time, and a derived number cannot go stale.
The gate stays wired for the next garment that states something.

It also compares `apps/web/data/products.json` against what is on the shop —
product ids, prices, and the printed size, resolution, scale and height of every
design — and fails on any disagreement. The drawing on the site and the file the
printer receives cannot drift apart without the sync saying so.

**`sync` only creates.** It will not update a product that already exists, so a
description or price edited in `matrix.ts` after the fact has to be pushed with
`updateProduct()`. Matching is on title, and titles are now DERIVED
(`{mark.title} — {item.title}`): renaming a mark or an item renames every product
carrying it, and `sync` would create new drafts beside the old ones rather than
updating them. `store:report` lists anything on the shop the matrix no longer
knows about, which is how that gets noticed.

All 23 drafts on the shop were created from the composed line, so their
descriptions on Printify are the text `matrix.ts` composes. Edit a description
after the fact and they diverge: `sync` will not overwrite it and the report does
not compare them.

**Title matching is also why a garment change needs a deletion.** Change the
blueprint or the provider and the title does not move, so `sync` finds the old
draft and leaves it alone — a Gildan hoodie answering to a name that now means an
Independent Trading one. `store:report` catches exactly this and flags it
`GARMENT`; the fix is to delete the draft in the dashboard and sync again, not to
push an update, because a product's blueprint cannot be changed after creation.

## The geometry, now that it is known

The blocker on this package used to be `print_areas[].placeholders[].images[]`,
whose coordinate space the docs do not pin down. Resolved against a real product
and read back:

- **`x`, `y`** are fractions of the print area, origin top-left. `0.5, 0.5` is
  centred. Smaller `y` is higher up the garment.
- **`scale`** is the rendered image **width** as a fraction of the print area
  width. The height follows from the image's own aspect, which is why a portrait
  image in a landscape print area — every hoodie front — is limited by height and
  `place()` in `line.ts` solves for that rather than letting it run off the edge.
- **`angle`** is degrees clockwise. Everything in this line is 0.

Because these are proportions, one placement is legal for every garment size even
though the catalog reports a bigger canvas for a 3XL than for an S. **The print
grows with the shirt, and that is not free.** One `print_areas` entry with one
scale covers every variant of a tee, so a design sent at 7.38 inches on a small
arrives at 10.11 inches on a 3XL and its resolution falls by the same third.
`sync` therefore measures the smallest canvas and the largest, and reports
`widthIn`/`dpi` alongside `maxWidthIn`/`minDpi`. Quoting only the first is
quoting the best case. The floor is **300 dpi at the printed size, on the largest
size offered**; the worst in the line is **448** — the tee, 10.11 inches wide on
a 3XL off a 4526 px master.

**The canvases are not all the same SHAPE either**, and that is a third number.
A black mug is 2475 × 1155 in 11 oz and 2448 × 1266 in 15 oz, so the wider canvas
is the shorter one and a scale computed against the 15 oz — which is the smaller
one, the one `place()` is handed — overflows the 11 oz. It cost nothing with a
landscape wordmark on it and would have cropped a portrait crest, so
`canvasesFor()` now returns the tightest height-over-width of every variant and
`place()` clamps against that instead of against whichever canvas it was given.

Legal `position` strings come from the catalog, not the docs, and **they are per
provider as well as per garment**: each variant's `placeholders[].position`.
Bella+Canvas 3001 through Monster Digital accepted `front`, `back` and `neck` and
not the sleeves, which this file claimed until `store:report` compared the
declaration in `matrix.ts` against the catalog and disagreed. The same shirt
through Printful offers ten, four of them embroidery. Each item in `matrix.ts`
declares its positions so a typo fails offline, and the report re-checks the
declaration against the live catalog every run — in both directions, so a
provider change that quietly adds positions is reported too.

## Two things found the hard way

**Printify creates products VISIBLE by default.** Omitting `visible` does not
give you a draft; it gives you a product that appears in the storefront the
moment a sales channel is connected. `CreateProductBody.visible` is a required
field here so that no future caller can make a live product by forgetting a line.

**The catalog advertises providers that will not accept the product.** Kiss-Cut
Stickers (blueprint 400) lists SPOKE Custom Products (provider 1), which rejects
creation with `Decorator 1 not available for this blueprint 400`. Printify Choice
(provider 99) works. There is nothing in the catalog response that predicts this;
it was found by probing, and it is the only one anyone has found because probing
means creating a product on the live shop.

`REJECTS_CREATION` in `matrix.ts` records it with Printify's own words, and
`store:catalogue` marks any provider in that list. **It has one entry, and that
is a floor rather than a count** — a provider absent from it has not been
cleared, only never tried.

## The artwork, and where it comes from

**Nine marks, all off the THREE-COLOUR production masters** in
`docs/logos/vector/production-3color-svg/`. `logo_one` and its one-ink gold twin
are retired and their source files are gone from the working tree.

**The three-colour file, not the detailed master and not the dpi exports.**
`tools/build_vector_assets.py` builds three things per concept: a detailed SVG
that keeps the traced tonal shading (238–1,730 fills), a three-colour SVG
restricted to `#0B0B0D` / `#FFFFFF` / `#D9A333`, and 300/600 dpi PNGs **rendered
from the detailed one**. Three flat inks is what a garment actually is — DTG
holds a hard edge and muddies a gradient, embroidery is thread and has no
gradient at all, vinyl is cut — and it is what a vendor asks for. Rendered at
6000 px the three-colour files trim to **5,400–5,700 px** of artwork, which beats
the 4,526 px the retired crest carried.

`cli.ts logos` is a loop over `MARKS` — there is no job list in the CLI. Each
mark carries its source, press name, `reach` and render width, so adding a logo
is one entry rather than an edit in two files that can disagree.

`renderWidth` is a WIDTH, not a long edge. Eight marks render at 6000; the
octagon patch is portrait 3:2 and renders at 5000, because 6000 there would
produce an 8,800 px-tall file for no gain.

`cli.ts marks` lists every image under `docs/logos/`, at any depth, and shows
which are wired in. Nine are.

### `reach` is not a preference, and every mark here is `"trim"`

- **`reach: "trim"`** — nothing removed, for a source that already carries alpha.
  All nine. It still trims: Printify places an image by its file BOX and the
  rasteriser leaves the mark inset in a rectangular canvas, so uploading one
  untrimmed puts a wide transparent border inside the print area and silently
  shrinks the print.
- **`reach: "everywhere"`** — a straight colour key, for a mark whose ground
  colour appears nowhere in the drawing. **Do not reach for this here.** Every
  one of the nine is OUTLINED in black; keying black would dissolve the drawing
  rather than free the garment.
- **`reach: "border"`** — a flood fill inward from the edge, for a flat with a
  paper ground that also uses that colour *as artwork*. Nothing in the line
  needs it. Kept because the next hand-supplied flat will.

### What a black field does on a dark body

All nine marks are drawn on a black field, so on a dark garment that field stops
being ink and becomes the garment. Whether that reads as a design or a wreck is
decided by the **edge**, and it is why `Mark.grounds` exists:

- a mark ringed, bordered or barred in **gold** keeps its whole silhouette — the
  seal, the medallion, the shield, the board, the capsule, the roundel;
- a mark whose outer shape **is** the black loses it. `faceoff` is a bare disc
  with no border: on black the two dogs float either side of a gold line that no
  longer means anything;
- a mark drawn inside a filled black **rectangle** prints as a slab.
  `octagon-patch` is one — 88.7% of its bounding box is inked against 55–83% for
  the rest — and the provider's mockup on a black hoodie back showed exactly
  that. Both are light-only;
- the mirror case is a mark carried by **white**. `arched-varsity` is 26% white
  ink against 9–18% elsewhere, and on a light body the letterforms hollow out
  into their own outlines. Dark-only.

**Look at the mockups before believing any of this.** `createProduct` returns
provider mockups on `images[]`, and reading them back is what moved three
products out of the line: a dense badge stitched at 1.88in on a cap panel and
1.64in on a beanie cuff loses its lettering entirely, which no measurement of the
file would have told you.

`prepareLogo` still writes a web-sized WebP alongside the press file, off the
same source in the same pass, so the mark on a page and the mark on a parcel
cannot drift. `cli.ts logos` does not ask for one today: `/store` is a
placeholder and renders no mark, so the file would ship in the static export with
nothing pointing at it. Restore the `web:` line on each job when the real store
is listed.

`npm run store:print` harvests nothing, and that is expected. Every mark in the
line is a file rather than a drawing, so there is no `[data-art]` left in the
built store for it to lift. The press files come from `cli.ts logos`.
