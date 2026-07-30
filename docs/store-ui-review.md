# The store as a shopping interface — adversarial review

**Date:** 2026-07-30
**Scope:** `/store`, `/store/[id]`, the basket drawer, `/store/help`, `/store/thanks`.
Product copy, `packages/store/src/matrix.ts` and pricing arithmetic were out of scope
and were not reviewed.

## How this was measured

Everything below was driven with Playwright against the **production static export**
in `apps/web/out` (built 2026-07-30 12:41), served locally on 127.0.0.1. Viewports:
1280×900 (DPR 1), 768×1024 and 360×740 (DPR 2, touch). Contrast ratios are computed
from **rendered screenshot pixels**, not from CSS values, so they include the drawer's
backdrop blur and every translucent layer under the text. Image weights are
`request.sizes().responseBodySize`, i.e. bytes actually on the wire.

> The dev server on :3002 was used first and abandoned. Under `next dev` the
> `/store/[id]` route emits a `<link>` to `_next/static/css/app/store/[id]/page.css`
> that contains none of the `store.module.css` rules — the file is not on disk
> (`apps/web/.next/static/css/app/store/[id]/` is an empty directory). The product
> page renders effectively unstyled: the Add button measures 101×21 with UA default
> padding and `background: rgb(107,107,107)`. **This is a dev-server artifact, not a
> product defect** — the same page in the export is styled correctly — but it makes
> the dev server useless for measuring this route. It is listed here only so nobody
> spends an hour on it again.

Findings are ranked by what costs a sale or locks a shopper out. **CONFIRMED** items
carry a repro and a number. **TASTE** is judgement. **REFUTED** lists what was
suspected and could not be sustained, so it is not re-litigated.

---

# CONFIRMED

## 1. The image zoom is broken at every viewport — you get a scrim and no picture

**What it is.** Clicking any product photograph opens the lightbox, dims part of the
page, locks scrolling, and renders the enlarged image **outside the viewport**. There
is nothing to look at. Escape or a click is the only way out.

**Repro.** `/store/crossed-shield-tee` at 1280×900, click the first photo.

**Measurement.**

| | 1280×900 | 360×740 |
|---|---|---|
| `div[role=dialog]` computed `position` | `fixed` | `fixed` |
| its border box | **1060×2077 at (110, 370)** | **320×2231 at (20, 418)** |
| covers the viewport | **false** | **false** |
| `img.lightboxImg` box | 760×760 at viewport **y = 1029** | 288×288 at viewport **y = 1390** |
| image visible in viewport | **false** | **false** |
| `document.body.style.overflow` | `hidden` | `hidden` |
| thumbnail it came from | 505px | 294px |
| zoom gain | 1.5× | **0.98× — smaller than the thumbnail** |

Screenshot evidence: the page headline above the overlay is *undimmed*, the scrim
starts 370px down, and no enlarged garment appears anywhere on screen.

**Cause.** `position: fixed` is resolving against an ancestor, not the viewport. The
ancestor is `div.store_detail` — the element carrying `data-reveal` — whose computed
`transform` is `matrix(1, 0, 0, 1, 0, 0)` because of `animation: rise`
(`apps/web/app/globals.css:837-838`). A non-`none` transform makes an element the
containing block for its `position: fixed` descendants. The comment at
`globals.css:657` already notes that `[data-reveal]` animates transform and creates a
stacking context; the containment consequence was not followed through.

**What it costs.** This is the only way to inspect a print before spending $20–$74,
and `Gallery.tsx:9-12` states that as its whole reason for existing. It has never
worked in the export. It also silently invalidates the product page's largest asset
budget — a 1200px source shipped for a zoom nobody can see.

**Fix.** `apps/web/components/store/Gallery.tsx:76` — render the lightbox through
`createPortal(…, document.body)`. That is exactly why the basket drawer is unaffected:
it is mounted from `apps/web/app/layout.tsx:51`, outside the animated subtree, and
measures a correct 420×900 anchored to the viewport's right edge. Removing
`data-reveal` from `apps/web/app/store/[id]/page.tsx:61` would also work but costs the
reveal animation.

---

## 2. "Remove" in the basket is invisible — 1.02:1

**What it is.** The only control that takes a line out of the basket is drawn in
`var(--line)`, which is the drawer's own background colour.

**Measurement.** Rendered pixels inside the 37×10 button box: darkest pixel
`rgb(25,28,35)`, modal background `rgb(27,31,38)`. **Contrast 1.02:1.** WCAG AA needs
4.5:1 for text this size. The single lightest pixel anywhere in the control is
`rgb(27,31,38)` — the background. Box is **37 × 10 px** (8.5px font, `padding: 0`).

**What it costs.** A shopper who picked the wrong size can only recover by finding a
control they cannot see. The `−` button does eventually remove a line at zero, so this
is not a hard lock-out — but nothing in the interface says so.

**Fix.** `apps/web/components/store/cart.module.css:202` — `color: var(--line)` →
`var(--dim)`. `--dim` measures 4.42–4.93:1 elsewhere in the same drawer. Add padding
so the target is not 10px tall.

---

## 3. The disabled Checkout button is invisible — 1.08:1

**What it is.** When the basket violates the sticker rule, the Checkout button does
not read as disabled. It disappears.

**Repro.** `/store/heritage-seal-sticker` → Add 3 → press `−` twice.

**Measurement.** `.checkout:disabled` sets `background: none; color: var(--line);
border-color: var(--line)` (`cart.module.css:273-278`). Rendered pixels over the whole
375×46 button: modal background `rgb(18,21,28)`, **lightest pixel in the entire
control `rgb(26,29,36)` → 1.08:1**. Both the label and the border are below the
threshold of visibility.

**What it costs.** At the exact moment the shop refuses the basket, the shopper sees a
rule they have broken and no button at all. The problem message itself measures a fine
4.92:1, so the copy lands and the control does not — the worst possible split.

**Fix.** `cart.module.css:273-278` — hold the border and label at `var(--dim)` (or
`--line` lifted well above the ground). Disabled must read as *disabled*, not *absent*.

---

## 4. The photograph disagrees with the selected colour, and the swatches never change it

**What it is.** On load, `/store/crossed-shield-tee` reads **"COLOUR: White"** with the
White swatch ringed as selected, beside a photograph of a **black** tee. Clicking any
other swatch changes the label and leaves every photograph exactly where it was.

**Measurement.**
- Clicking Navy, then Black: all four `<img src>` values unchanged (`changed: false`).
  The label updates; the pictures do not.
- Across the catalogue: for the 40 products with more than one colourway, the mean
  garment pixel of the hero mockup (studio white and the gold mark excluded) is nearest
  to a colour **other than `colors[0]`** in **36 of 40** cases. Examples —
  `crossed-shield-tee` photo avg `(49,47,44)`, nearest catalogue colour Navy, default
  selected White. `nose-to-nose-hoodie` avg `(28,44,59)`, nearest Navy at distance 3,
  default White. Four match: `championship-roundel-hoodie`,
  `majestic-stick-carry-hoodie`, `rink-board-cap`, and one other.

**What it costs.** Wrong-colour expectation is the largest single driver of apparel
returns, and `/store/help` explicitly refuses returns for "a correctly-made item that
you have changed your mind about". The interface sets an expectation the policy will
not honour.

**Fix.** `ProductCard.tsx:9-16` correctly notes that Printify's response does not say
which colourway a mockup shows — that is a genuine data constraint. But the current
answer to it is to default to a colour the picture contradicts. Cheapest honest fixes,
in order: (a) order `colors` in the sync so `colors[0]` is the colourway the hero
mockup actually shows; (b) print "shown in <colour>" under the gallery
(`app/store/[id]/page.tsx:62-68`); (c) require a colour choice rather than defaulting.

---

## 5. The Add button is 602px below the fold on desktop and 3.8 screens down on a phone

**What it is.** The product page puts the entire gallery and six paragraphs of fabric
copy in front of the picker.

**Measurement.** Document offsets, production export:

| element | 1280×900 | 360×740 | 768×1024 |
|---|---|---|---|
| `h1` | 382 | — | — |
| price heading | 796 | — | — |
| first photograph | 809 | — | — |
| colour swatches | **1385** | — | — |
| size buttons | **1447** | — | — |
| **Add button** | **1502** (602px below the fold) | **2836 = 3.83 screens** | **4130 = 4.03 screens** |

Page height: 2884 (1280), 2935 (360), 4219 (768). `.stage` renders every mockup stacked
at full column width — four photographs at 505×505 on desktop, 294×294 on a phone, one
below the other.

**What it costs.** Nothing purchasable is on screen when the page loads at any width.
On a phone the shopper scrolls past four 1:1 photographs and six paragraphs before
they can pick a size.

**Fix.** `app/store/[id]/page.tsx:70-77` — move `<Buy>` directly under
`.detailPrice`, above the copy. And `store.module.css:469` — make `.stage` one-up with
a thumbnail strip instead of a vertical stack.

---

## 6. 35 of 59 products are behind a horizontal scroll with a 0-pixel affordance

**What it is.** Each category is a horizontally-scrolling row three cards wide. At
1280 the fourth card is not merely cropped — **none of it is on screen**, and no
scrollbar occupies any space.

**Measurement** (1280, `section#tee`): container clientWidth **1060**, card width
**344**, card left offsets `0, 358, 716, **1074**`. Card 4's visible width is
**0 px** (it begins 14px past the right edge). `offsetHeight − clientHeight = 0` —
`scrollbar-width: thin` reserves nothing; it is an overlay scrollbar that paints only
while scrolling. Zero arrow buttons in the section. No item count anywhere.

Visible / total per row at 1280:
`tee 3/8 · longsleeve 3/8 · crewneck 3/7 · hoodie 3/7 · youth 3/8 · cap 2/2 ·
beanie 1/1 · mug 3/8 · sticker 3/10` — **24 of 59 visible, 35 hidden**.

The comment at `store.module.css:68-72` asserts "the fourth is the affordance — you
can see its edge, which is what tells anybody there is more." Measured: 0 px. Below
600px the rule changes to `grid-auto-columns: 78%` and a partial card *is* visible —
so the affordance works on a phone and fails on every desktop.

**What it costs.** 59% of the catalogue is undiscoverable at the width most desktop
shoppers use.

**Fix.** `store.module.css:77` — `grid-auto-columns: calc((100% - 28px) / 3)` →
something under a third (e.g. `/ 3.35`) so a slice of card 4 shows, matching what the
comment already claims. Prev/next buttons per row would also fix the keyboard-free
pointer case.

---

## 7. There is no way to see everything carrying one crest

**What it is.** The catalogue is 10 marks × 9 items. The interface exposes only the
item axis.

**Measurement.** `lib/store.ts:84` groups solely by `itemId`. `/store` has **0
`<select>`, 0 search inputs, no "filter/sort/refine" string** — its only navigation is
9 anchors to the same 9 rows. The product page's complete link inventory is
**three links**: "Store", "Shipping & returns", "← Back to the store". No related
products, no other-items-in-this-mark, no other-marks-in-this-item.

**What it costs.** A shopper who came for the Crossed Shield crest and wants the hoodie
must memorise the crest name and hand-scan a 7-card horizontal row where 4 cards are
off screen (finding 6). The catalogue's most valuable merchandising axis is
unnavigable, and the cross-sell surface on a 59-product shop is empty.

**Fix.** Add a "The Crossed Shield on everything else" block at
`app/store/[id]/page.tsx:80`, filtering `products` by `markId` — the data is already
there. A mark filter on `/store` is the fuller answer. (The removed "The rest of them"
list noted in the comment at `[id]/page.tsx:80-83` was the *item* axis, which the
shopper had indeed just come from; the *mark* axis is a different question and has
never been answerable.)

---

## 8. Nothing about the basket is announced, and the drawer is not a dialog

**Measurement.**
- `[aria-live], [role=status], [role=alert]` on every store page, before and after
  adding to the basket: **0**.
- `<aside aria-label="Basket">` (`Cart.tsx:232`): `role = null`, `aria-modal = null`.
- After clicking Add, `document.activeElement` is **still the Add button**.
- Tab presses from there to reach the drawer: **5** — "Shipping & returns" →
  "← Back to the store" → a Next portal element → the full-screen scrim button →
  the drawer's Close.
- Shift+Tab from inside the drawer walks straight out and focuses controls *underneath*
  the scrim (the Add button, the 3XL size button). **No focus trap.**
- Escape closes the drawer and leaves focus wherever tabbing put it. It is never
  returned to the control that opened it.

**What it costs.** A screen-reader user gets no confirmation that anything was added.
A keyboard user has to tab through the remainder of the page, behind an overlay, to
reach their own basket.

**Fix.** `Cart.tsx:232` — `role="dialog" aria-modal="true"`; move focus to the drawer
heading on open; capture and restore `document.activeElement`; trap Tab inside the
`<aside>`. Escape already works and should stay.

Related, same file: `Gallery.tsx:12-16` claims "focus returns to the thumbnail that
opened it". There is no code that does this — it is accidentally true only until the
user presses Tab once. Measured: after tabbing inside the lightbox, Escape left focus
on a colour swatch.

---

## 9. A stale basket is silently pruned and the evidence overwritten

**Repro.** Seed `localStorage["gr-basket-v1"]` with five lines: a valid tee ×2; a
retired product id; a colour the product does not come in; a size it does not come in;
and one line at quantity 999. Reload `/store`.

**Measurement.** Two lines survive. The three invalid lines are dropped with **no
message** (`notice: false` — no "removed" or "no longer" string anywhere in the
drawer). Quantity 999 is silently clamped to 10. The pruned array is then written back
to storage, so the evidence is gone:
`[{"productId":"crossed-shield-tee","color":"White","size":"M","quantity":2},
{"productId":"crossed-shield-tee","color":"Black","size":"M","quantity":10}]`.

`Cart.tsx:45-54` argues, correctly, that discarding unknown lines here beats an error
at checkout. The defect is that it says nothing at all.

**What it costs.** A returning shopper's basket goes from five things to two with no
explanation. That reads as a shop that lost their order.

**Fix.** `Cart.tsx:55-77` — have `load()` return `{ lines, dropped }` and render one
line at the top of the drawer: "Three things you'd saved are no longer in the shop."

---

## 10. 1.6 MB of images before the shopper sees a single product

**Measurement** (production export, real `responseBodySize`):

| | 1280×900, DPR 1 | 360×740, DPR 2 |
|---|---|---|
| on load, before any scroll | **38 files / 1,721,288 B (1.68 MB)** | **35 files / 1,657,008 B (1.62 MB)** |
| after scrolling the page | 57 files / 2.62 MB | 52 files / 2.46 MB |
| after scrolling every row | 59 files / **2.71 MB** | 57 files / **2.66 MB** |

Every card ships the same 1200×1200 source. Rendered: **314 CSS px** at 1280 (DPR 1)
and **220 CSS px at 360 with DPR 2 = 440 device px**. No `srcset`, no `sizes`
(`ProductCard.tsx:28-36`). At 360 that is 1200px shipped for 440px needed —
**7.4× the pixels**.

**What it costs.** The shop's first impression on a cellular connection is 1.6 MB
before anything is on screen, and the first product is not on screen at all
(y = 781 of a 740px viewport).

**Fix.** Emit 400/800px derivatives in `scripts/mirror-mockups.mjs` and add
`srcset`/`sizes` at `ProductCard.tsx:28`. Keep the 1200px original for the lightbox
once finding 1 is fixed.

---

## 11. The sticker card and heading quote a price that cannot be bought

**Measurement.** `heritage-seal-sticker` — card reads **"from $3.50"**, product page
heading reads **"$3.50 – $4.00"**, and the only button reads **"Add 3 — $10.50"**.
`sale.minQuantity` is 3 and `Buy.tsx:41` correctly adds three. Ten of the 59 products
are stickers, so this is a sixth of the catalogue.

**What it costs.** The shopper's anchor price is 3× low until they reach the basket.

**Fix.** `lib/store.ts:142` `priceLabel` and `:148` `fromLabel` should multiply by
`sale.minQuantity` and say so: "$10.50 for 3".

---

## 12. The largest price on the product page is the one that is never the price

**Measurement.** Selecting each size in turn on `/store/crossed-shield-tee`:

```
S    → button "Add — $20.00"   heading "$20.00 – $27.50"
M    → button "Add — $20.00"   heading "$20.00 – $27.50"
L    → button "Add — $20.00"   heading "$20.00 – $27.50"
XL   → button "Add — $20.00"   heading "$20.00 – $27.50"
2XL  → button "Add — $24.00"   heading "$20.00 – $27.50"
3XL  → button "Add — $27.50"   heading "$20.00 – $27.50"
```

The button is right and moves with the selection — that part works well. The
`1.15rem` heading above it never changes and is the first price the eye lands on.

**Fix.** `app/store/[id]/page.tsx:71` — either drop the heading, or lift the price into
`<Buy>` so the big number is the selected number.

---

## 13. Shipping-at-cost is the last line of a 6,617-pixel page

**Measurement** (`/store`, 1280): the paragraph beginning "Shipping is charged at
cost" sits at **y = 6572 of a 6617px document**. The page's single `/store/help` link
is at **y = 6597 — 99.7% of the way down**. There is **no `<footer>` anywhere on the
site** (0 elements), and the contact address `store@goldenretrieverhockey.com` appears
on `/store/help` only.

The product page and the drawer both carry a help link, which is good — a doubt raised
at the picker or the basket has a route out. The grid does not, and the grid is where
the shopper decides whether this shop is real.

**Fix.** Put the shipping-at-cost line in the `/store` hero next to the category nav
(`app/store/page.tsx:50-55`), and add a site footer carrying the help link and the
business identity.

---

## 14. Tap targets below the 44px guideline

Measured identically at 360, 768 and 1280 (all are fixed-pixel rules):

| control | size | file |
|---|---|---|
| colour swatch | **17 × 17** (6 of them, 6px apart) | `store.module.css:210`, `Buy.tsx:56` |
| basket − / + | **24 × 24** | `cart.module.css:159` |
| drawer "Remove" | **37 × 10** | `cart.module.css:191` |
| drawer "Close" | **33 × 10** | `cart.module.css:100` |
| masthead "Basket" | **62 × 16**, 9px type | `cart.module.css:14` |
| category nav links | 20.9 tall | `store.module.css:43` |
| size buttons | 42 × 32 (closest to passing) | `store.module.css:321` |

The colour swatch is the worst: 289 px² against the guideline's 1,936 px² — **15% of
the recommended area** — and it is the control that decides what colour arrives.

**Fix.** Give the swatch a transparent padded hit area (`padding: 12px` with the
coloured disc drawn via `background-clip: content-box`, or a `::before` overlay) so the
visual stays 17px and the target reaches 44px. Same treatment for − / + and Remove.

---

## 15. Checkout failure is a quiet grey sentence nothing announces

**Measurement.** With `/api/checkout` failing, the message renders as
`<p class="failure">` with **`role: null`, `aria-live: null`**, colour `#7d8496` at
12px, focus not moved, and the button reverting to an enabled "Checkout". A
screen-reader user gets nothing; a sighted user sees a small grey line appear above the
button they just pressed. (The failure itself under `next dev` is expected and is not
the finding.)

**Fix.** `Cart.tsx:303` — `role="alert"`.

---

## 16. The basket is not cleared after a completed order

**Repro.** Add one tee, then navigate to `/store/thanks?session_id=cs_test_123`.

**Measurement.** Before: `gr-basket-v1` = one line, masthead "Basket 1". After the
thank-you page: **identical**. Back on `/store`: still "Basket 1".
`app/store/thanks/page.tsx` is a pure server component with no clearing effect.

**What it costs.** A customer who has just paid is shown a basket still holding what
they bought. The next thing they add lands on top of an already-purchased line, and
the count in the masthead is wrong from that point on.

**Fix.** A small client component on `/store/thanks` that calls `clear()` on mount.
This is safe with the existing design — `thanks/page.tsx:16-18` is right that the order
is placed by the webhook, so clearing here cannot lose an order.

---

## 17. Card swatches look interactive and are not; colour names are not exposed in the grid

**Measurement.** `<span class="swatch">` with `cursor: pointer` and
`:hover { transform: scale(1.14) }` (`store.module.css:210-222`), `title` set,
**`aria-label: null`**, no handler. A card's full accessible text ends
"…6 colours" — the colour *names* are unavailable to a screen reader anywhere on
`/store`.

`ProductCard.tsx:9-19` gives a sound reason for not swapping the image on click. That
argument justifies "not clickable"; it does not justify "styled as clickable".

**Fix.** `store.module.css:210` — drop `cursor: pointer` and the hover scale for the
card variant (the `Buy` swatch, which *is* a button, keeps both), and expose the names
via a visually-hidden list or an expanded `.swatchName`.

---

## 18. The drawer chains its scroll to the page behind it

**Measurement.** Drawer open, page at scrollTop 0, wheel over the drawer at (1100, 450):
the page behind moves to **y = 35**. `.drawer` (`cart.module.css:61`) sets
`overflow-y: auto` with no `overscroll-behavior`, and nothing locks `document.body`.
`Gallery.tsx:39` does lock the body for the lightbox; the drawer does not.

**Fix.** `cart.module.css:61` — `overscroll-behavior: contain`, plus a body scroll lock
while `open`.

---

## 19. Marginal contrast failures

Measured from rendered pixels. AA for text under 18.66px bold / 24px regular is 4.5:1.

| element | size | measured |
|---|---|---|
| `.lineOpts` — the "WHITE · M" line in the basket | 10px | **4.42:1 — fails** |
| `/store` category nav links | 9px | **4.44:1 — fails** |
| drawer note | 11px | 4.89:1 — passes |
| drawer "Close" | 9px | 4.93:1 — passes |
| problems list | 12px | 4.92:1 — passes |
| drawer title | 20.8px | 9.49:1 — passes |

Both failures are `--dim` (`#7d8496`) over a *locally lightened* ground — the basket
line's `rgba(56,62,78,.06)` and the store hero's pond render. `globals.css:12-19`
documents that `--dim` was lifted specifically to clear 4.5:1 on the near-black ground;
these two sit on grounds that are not near-black.

**Fix.** Drop the local wash under `.line` (`cart.module.css:137`), or lift these two
one step above `--dim`.

---

## 20. The per-line cap is enforced without explanation

At 10 the `+` button disables (correctly — `MAX_PER_LINE`), and **no message appears**.
`basket.ts:168-171` has the sentence ready ("10 is the most of one thing per order")
but it only fires server-side on an over-cap post, which the UI prevents. Small, but
it is a control that stops working with no reason given.

---

# TASTE

Labelled as judgement, not measurement.

1. **The sale note is 332 characters of postage cost accounting under the Add button**
   (`Buy.tsx:102`). It is the last thing between the shopper and the purchase. The
   binding rule ("sold in threes, and they can be three different designs") is one
   clause of it; the cost breakdown behind the rule is an explanation the shopper did
   not ask for at the moment they are deciding.
2. **No product thumbnail on a basket line.** Every mainstream basket carries one. The
   line currently identifies the item by a title that wraps to two lines in a 420px
   drawer.
3. **The sticker problem message tells you to add two more designs and gives no path
   there.** `Cart.tsx:288-291` renders plain text; 0 links.
4. **The gallery is a vertical stack rather than one-up with thumbnails.** Related to
   finding 5, but the stack is a defensible choice on its own — it is the interaction
   between the stack and the buy block's position that is measured.
5. **"In the basket" reverts after 1800 ms and is covered by the drawer anyway** — at
   1280 the drawer paints over the Add button, so the state change is unseen. The
   drawer opening *is* the feedback; the label is redundant.
6. **`/store` shows no product in the first screen** — first `<article>` at y = 880 of
   a 900px viewport, y = 781 of a 740px phone viewport. Whether the hero earns that is
   a design call, not a defect.

---

# REFUTED

Suspected, tested, and killed. Recorded so they are not raised again.

- **localStorage disabled or throwing.** Overrode `window.localStorage` with a throwing
  getter: zero page errors, the drawer opens, adding works, the basket lives in memory.
  `Cart.tsx:74` and `:96` both catch. Handled correctly.
- **Keyboard cannot reach the cards hidden in a horizontal row.** It can. Tabbing walks
  all 8 tees and the browser scrolls the container (`scrollLeft` 0 → 716 → 1432 → 1790).
  Finding 6 is a *pointer* discoverability defect, not an accessibility lock-out.
- **No focus rings on the drawer controls.** There are.
  `globals.css:94` — `button:focus-visible { outline: 2px solid var(--paint-b) }` —
  applies. The first measurement showed `outline: none` because programmatic `.focus()`
  after a pointer click does not set `:focus-visible`; real Tab presses produce
  `outline: solid 2px rgb(91,155,213)` and `:focus-visible` matches.
- **Horizontal overflow on mobile.** None. `documentElement.scrollWidth === innerWidth`
  on `/store` and `/store/[id]` at both 360 and 768. The drawer is exactly 360 wide at
  360 (`width: min(420px, 100vw)`).
- **Layout shift from images.** None. `width`/`height` attributes are present on every
  `<img>` and `.cardImg` sets `aspect-ratio: 1/1`.
- **The drawer suffers the same `position: fixed` trap as the lightbox.** It does not.
  It is mounted from `layout.tsx:51`, outside the `data-reveal` subtree; measured
  420×900 at x=860, right edge exactly at `innerWidth`.
- **The mug's colour picker shows "11 oz".** Measurement artifact — the selector picked
  the size row. Mugs have one colourway, so `Buy.tsx:48` correctly hides the colour row
  and "11 oz" is the size. Working as intended.
- **Quantity bounds.** All correct: duplicate lines merge, adds clamp to
  `MAX_PER_LINE = 10`, `−` at 1 removes the line and shows the empty state, and the
  stale loader clamps 999 → 10.
- **The sticker minimum is enforced awkwardly on first add.** It is not. `Buy.tsx:41`
  adds `minQuantity` in one click, so the first add produces a valid basket with no
  scolding. This is the best-designed rule in the store; the only defect around it is
  the invisible disabled button (finding 3).
- **Trust: the shopper cannot find who they are buying from or the returns position.**
  Reachable from the product page and the basket drawer, which are the two places a
  doubt actually arises. Only the grid is missing it (finding 13).
- **Shipping cost is hidden.** The drawer states "Shipping and tax are calculated at
  checkout", the product page states "shipping at cost", and `/store/help` gives real
  figures ($4.75 for one tee, $7.15 for two). This is honest and adequate for
  print-on-demand; it is only *placed* badly on the grid.

---

# The short list

If only four things get fixed:

1. **The lightbox** (finding 1) — a headline feature that has never worked, one
   `createPortal` away.
2. **The two invisible controls** (findings 2 and 3) — 1.02:1 and 1.08:1, both a
   one-line CSS change.
3. **The colour/photograph disagreement** (finding 4) — 36 of 40 products, and the
   returns policy will not cover the consequence.
4. **The buy block's position** (finding 5) — 602px below the fold on desktop, 3.8
   screens on a phone.
