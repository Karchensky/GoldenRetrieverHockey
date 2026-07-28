# @gr/store — Printify

Creates and verifies the store's products on **shop 28277243** as drafts. It has
been run against the live API and the eleven products in
`apps/web/data/products.json` were made by it. The shop is named "Golden
Retrievers" in the dashboard now; the id is what matters and the id has not
changed.

For the captain's side of this — opening the Pop-Up store, publishing, and what
to look at first — see [`docs/store/POP-UP.md`](../../docs/store/POP-UP.md).

```sh
node packages/store/src/cli.ts shops        # start here; smallest possible request
node packages/store/src/cli.ts claims       # re-derive every printed claim from site.json
node packages/store/src/cli.ts audit        # every product on 28277243, and only that shop
node packages/store/src/cli.ts logos        # take the ground off the marks in docs/logos/
node packages/store/src/cli.ts sync --dry-run
node packages/store/src/cli.ts sync         # upload art, create drafts, read them back
```

Token: `PRINTIFY_API_TOKEN`, or `.secrets/printify_token.txt`. It is a
credential — never committed, never logged, never printed.

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

`CLAIMS` is empty today and that is the correct state. The line prints a mark and
a place — no count, no year, no name in type — so there is nothing left to check.
Where copy states the founding year it carries a `{{firstYear}}` token resolved
from `site.json` at upload time, and a derived number cannot go stale. The gate
stays wired for the next garment that states something.

It also compares `apps/web/data/products.json` against what is on the shop —
product ids, prices, and the printed size, resolution, scale and height of every
design — and fails on any disagreement. The drawing on the site and the file the
printer receives cannot drift apart without the sync saying so.

**`sync` only creates.** It will not update a product that already exists, so a
description or price edited in `line.ts` after the fact has to be pushed with
`updateProduct()`. Matching is on title: rename a product and you get a new one.

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
scale covers all 318 variants of a tee, so a design sent at 5.17 inches on a
small arrives at 7.01 inches on a 3XL and its resolution falls by the same third.
`sync` therefore measures the smallest canvas and the largest, and reports
`widthIn`/`dpi` alongside `maxWidthIn`/`minDpi`. Quoting only the first is
quoting the best case.

Legal `position` strings come from the catalog, not the docs: each variant's
`placeholders[].position`. Bella+Canvas 3001 and Gildan 18500 through Monster
Digital accept `front`, `back`, `left_sleeve`, `right_sleeve`, `neck`.

## Two things found the hard way

**Printify creates products VISIBLE by default.** Omitting `visible` does not
give you a draft; it gives you a product that appears in the storefront the
moment a sales channel is connected. `CreateProductBody.visible` is a required
field here so that no future caller can make a live product by forgetting a line.

**The catalog advertises providers that will not accept the product.** Kiss-Cut
Stickers (blueprint 400) lists SPOKE Custom Products (provider 1), which rejects
creation with `Decorator 1 not available for this blueprint 400`. Printify Choice
(provider 99) works. There is nothing in the catalog response that predicts this;
it was found by probing.

## The artwork, and where it comes from

Two sources, and they stay separate on purpose.

**Generated designs** are drawn by
`apps/web/components/store/ProductFigure.tsx`, harvested out of the built store
by `scripts/build-print-files.mjs`, and land in `dist/print/`. The site is the
single source of that art and the files cannot drift from what the store shows.
`loadArt()` trims each one before upload — the harvest letterboxes a design into
the garment's print area, so `wordmark` is a 2520 × 3360 file whose art is
2366 × 1778, and uploading it untrimmed puts a wide transparent border inside the
print area and silently halves the print.

**The team logos** run the other way: they arrive as flattened PNGs in
`docs/logos/`, and `src/artwork.ts` produces the press file and the web file
from that one source in a single pass, so the mark on the page and the mark on
the parcel are the same picture.

There are two grounds in that folder and they need **opposite** treatments.
`cli.ts logos` names which each mark gets, and the choice is not a preference:

- **`reach: "border"`** — a flood fill inward from the edge, for `logo_one` and
  `logo_two`. Both contain large cream areas that are *part of the artwork* —
  the RETRIEVERS banner, the dog's muzzle, the tape on the stick blades, the
  dog's whole head in the monogram. A global colour key punches holes through
  all of them.
- **`reach: "everywhere"`** — a straight colour key, for `concept-04` and
  `concept-11`. Their ground is black and nothing drawn is black, so every black
  region is ground: the counters of the O and the D, the slots in the skate
  blade, the gap between the dog's legs. A border fill leaves all of those
  opaque, which was measured before this option existed. On a dark garment DTG
  lays a white underbase under every non-transparent pixel, so they would have
  printed as glossy black patches on matte black cotton.
- **`reach: "keep"`** — no removal at all, for the pixel retriever's sticker.
  Vinyl is white and that mark has no light colourway, so it brings its own
  ground. `loadArt()` skips its trim for exactly this file: trimming an opaque
  image eats the artwork rather than the margin.

`npm run store:print` now harvests nothing, and that is expected. Every mark in
the line is a file rather than a drawing, so there is no `[data-art]` left in the
built store for it to lift. The press files come from `cli.ts logos`.
