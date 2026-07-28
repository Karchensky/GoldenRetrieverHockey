# @gr/store — Printify

Creates and verifies the store's products on **shop 28277243** as drafts. It has
been run against the live API and the eight products in
`apps/web/data/products.json` were made by it. The shop is named "Golden
Retrievers" in the dashboard now; the id is what matters and the id has not
changed.

**Nothing on the site renders any of this.** `/store` is a placeholder as of
2026-07-28 — the captain's instruction was that none of it was a product yet and
the line would be listed all at once when it is finished. `products.json` stayed
because it is not page copy: it is the record `sync` checks the live shop
against, and deleting it would leave the sync with no witness.

For the captain's side of this — opening the Pop-Up store, publishing, and what
to look at first — see [`docs/store/POP-UP.md`](../../docs/store/POP-UP.md).

```sh
node packages/store/src/cli.ts shops        # start here; smallest possible request
node packages/store/src/cli.ts claims       # re-derive every printed claim from site.json
node packages/store/src/cli.ts audit        # every product on 28277243, and only that shop
node packages/store/src/cli.ts logos        # render the vector masters for print
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
quoting the best case. The floor is **300 dpi at the printed size, on the largest
size offered**; the worst in the line is 453.

**The canvases are not all the same SHAPE either**, and that is a third number.
A black mug is 2475 × 1155 in 11 oz and 2448 × 1266 in 15 oz, so the wider canvas
is the shorter one and a scale computed against the 15 oz — which is the smaller
one, the one `place()` is handed — overflows the 11 oz. It cost nothing with a
landscape wordmark on it and would have cropped a portrait crest, so
`canvasesFor()` now returns the tightest height-over-width of every variant and
`place()` clamps against that instead of against whichever canvas it was given.

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

**One mark, off the vector masters.** On 2026-07-28 the captain cut the line to
`logo_one` and nothing else: *"remove all items other than the ones with the
logo_one in some capacity; i believe most of these items are lower DPI than we
require."* He was right about the dpi. The monogram, the skate-blade wordmark and
the pixel retriever were 1254px flats carrying ~900px of artwork, which reaches
300 dpi only by shrinking the print — the wordmark to 5.17 inches, the retriever
to 2.85. Their source files are off disk. Do not restore them.

`cli.ts logos` renders `docs/logos/vector/` at 6000px and writes two press files
to `dist/print/logos/`. Both trim to **4526 × 5094** of artwork, which is 453 dpi
at a ten-inch print. The flat `logo_one.png` beside them holds 948px and would be
95 dpi at the same size; it is not used by anything any more.

| Press file | Source | Ground comes off by |
| --- | --- | --- |
| `crest.png` | `vector/logo-one-transparent-600dpi.png` | `reach: "trim"` — already transparent |
| `crest-gold.png` | `vector/logo-one-one-color-gold.svg` | `reach: "everywhere"` |

`reach` is not a preference and getting it wrong destroys the artwork:

- **`reach: "border"`** — a flood fill inward from the edge, for the FULL-COLOUR
  crest on a cream ground. It contains large cream areas that are *part of the
  artwork* — the RETRIEVERS banner, the dog's muzzle, the tape on the stick
  blades. A global colour key punches holes through all of them. Not used today
  only because the captain's transparent export has already done this in vector.
- **`reach: "everywhere"`** — a straight colour key, for the ONE-INK crest. That
  file has exactly two colours and *nothing drawn is cream*: every cream region
  is either the ground or negative space cut into the gold, and on a dark garment
  that negative space is meant to be the garment. A border fill leaves the banner
  lettering and the eyes opaque, and DTG lays a white underbase under every
  non-transparent pixel, so they would print as cream slugs on black.
- **`reach: "trim"`** — nothing removed, for a source that already carries alpha.
  It still trims: Printify places an image by its file box and the vector exports
  are square canvases with the artwork inset, so uploading one untrimmed puts a
  wide transparent border inside the print area and silently shrinks the print.

**Deleting the cream *paths* is not the same as keying the cream *pixels*, and it
was measured.** Stripping every `fill="#faf4ea"` path out of the one-colour SVG
and rendering the rest leaves a gold blob with no face and an empty banner: those
paths are drawn ON TOP of the gold and they are the drawing.

Two things the one-colour gold master does that are worth knowing before it goes
on a garment. The banner reads **RETRIEVERS** only — "GOLDEN" is gold-on-black in
the full-colour crest and becomes gold-on-gold here, so it disappears. And the
dog's head reduces to a mask rather than a portrait. Both are properties of the
captain's own file, reproduced faithfully; if he wants "GOLDEN" back it has to be
knocked out in the master, not here.

`prepareLogo` still writes a web-sized WebP alongside the press file, off the
same source in the same pass, so the mark on a page and the mark on a parcel
cannot drift. `cli.ts logos` does not ask for one today: `/store` is a
placeholder and renders no mark, so the file would ship in the static export with
nothing pointing at it. Restore the `web:` line on each job when the real store
is listed.

`npm run store:print` harvests nothing, and that is expected. Every mark in the
line is a file rather than a drawing, so there is no `[data-art]` left in the
built store for it to lift. The press files come from `cli.ts logos`.
