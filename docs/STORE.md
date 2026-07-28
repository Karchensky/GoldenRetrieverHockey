# The store

Print-on-demand through Printify, sold on `goldenretrieverhockey.com`.

**Where the decisions live.** Printify's dashboard owns the catalogue: which
garment, which print provider, what it costs. It is free, live, and better than
anything we would write, so nothing here replaces it. The repo owns two things
Printify cannot do — which logo goes on which item, and selling it on our own
domain.

| Decision | Where |
| --- | --- |
| Which garment, which brand, which print provider | Printify dashboard |
| What a variant costs you | Printify dashboard · `npm run store:report` |
| Retail price, which logo, which colourways, print size | `packages/store/src/matrix.ts` |
| What the customer pays for postage | our checkout — **not built yet** |
| Whether the shop is public | Printify dashboard, one click. Nothing in this repo can publish |

Shop **28277243** only. `13449786` is a live Etsy storefront for an unrelated
business; `packages/store/src/api.ts` refuses to address it and takes no shop id
from any caller.

---

## 1. The line today

Eight products, two logos, six items. All `visible=false` — drafts in the
dashboard, invisible everywhere else. `/store` on the site is a placeholder.

From `npm run store:report`, 2026-07-28. **That command is the source of truth;
this table is a snapshot.**

| Product | Retail | Your cost | Margin | US post | |
| --- | ---: | --- | ---: | ---: | --- |
| `crest-tee` | $28.00 | $11.54 – $16.44 | 41 – 59% | $4.75 | |
| `crest-hoodie` | $58.00 | $23.11 – $26.58 | 54 – 60% | $8.49 | |
| `crest-sticker` | $6.00 | $1.58 – $2.00 | 67 – 74% | $4.59 | **POST** |
| `crest-gold-tee` | $28.00 | $11.54 – $16.44 | 41 – 59% | $4.75 | |
| `crest-gold-hoodie` | $58.00 | $23.11 – $26.58 | 54 – 60% | $8.49 | |
| `crest-gold-cap` | $30.00 | $19.89 | 34% | $4.89 | **THIN** |
| `crest-gold-beanie` | $26.00 | $14.96 | 43% | $4.89 | |
| `crest-gold-mug` | $18.00 | $9.66 – $10.31 | 43 – 46% | $8.99 | **POST** |

One of each, US, worst-case size, postage charged on top: customer pays
**$301.84**, Printify takes **$183.04**, Stripe takes **$11.16**, you keep
**$107.64** — 42.7% of retail.

**THIN** — under 40% gross on the dearest variant. **POST** — US postage over
25% of the retail price.

Cost moves with size, not just with garment. A 3XL tee costs $16.44 against
$11.54 for a small: same shirt, same price to the customer, 17 points of margin
gone. The report breaks every product into cost tiers for that reason.

---

## 2. Where do I change the brand of a shirt?

Brand is the **blueprint**. Cost is the **print provider**. They are two
different choices and only the second one usually moves the money.

### Compare before you open the dashboard

```bash
npm run store:catalogue "hooded sweatshirt"   # every hoodie blueprint, with ids
npm run store:catalogue 77                    # blueprint 77's 18 print providers
```

The provider table gives, per provider: where they ship from, how many variants
they carry, the first-item postage to the US and the EU, and the print areas.
It marks the ones this line already uses and any known to reject creation.

It does **not** give item cost, and it cannot: Printify publishes no cost
anywhere in the catalog API. A variant's `cost` field appears for the first time
on a product that already exists, which is why `store:report` can quote cost for
these eight and nothing can quote it for a provider this shop has never used.
Checked 2026-07-28 — the v1 catalog carries no price field and the whole v2
catalog tree 404s apart from shipping.

### Then in Printify

| Want | Screen | Effect |
| --- | --- | --- |
| A different **garment** (Gildan → Bella+Canvas) | Catalog → the garment → Start designing | A different blueprint id: a new product. The old one is untouched |
| A different **maker** of the same garment | Open the product → the print provider selector in the editor → Change print provider | Cost and postage change; variant ids change; colours offered may change |
| See what each maker charges | The provider-choice screen, which lists them with their prices | This is the only place per-provider cost is shown before a product exists |

`printify.com/app/catalog` and `printify.com/app/products`. Printify moves its
UI; the screen names are what to look for.

**Changing a provider on a live product changes its variant ids.** Anything in
`matrix.ts` pointing at the old ids is now wrong. After any provider change:
`npm run store:catalogue <blueprintId>` for the new provider id, then
`node packages/store/src/cli.ts variants <blueprintId> <providerId>` for the new
variant ids, then update the item in `matrix.ts`, then `npm run store:report`.

---

## 3. Where do I see what an item costs me and what I make?

**In the terminal** — everything, in one screen, live:

```bash
npm run store:report
```

Per product: blueprint id with brand and model, provider id with name and
country, cost/profit/margin per cost tier, postage per method and region,
printed size and dpi, and what a single sale leaves you after Stripe. Then a
total, then the products worth a decision, then a note on how every number was
made. It writes nothing and creates nothing.

**In Printify** — open a product, go to its pricing screen. It shows cost,
retail and profit per variant, with a margin control that sets retail from a
target percentage.

**Do not set retail there.** Retail lives in `matrix.ts` and `sync` pushes it.
A price edited in the dashboard and not in the repo drifts, and
`store:report` will say so — it compares the two and flags the disagreement.

### The one-sale arithmetic

Stripe takes 2.9% + 30¢ of the **whole** charge, postage included.

| | Customer pays | You keep |
| --- | --- | --- |
| Postage on top | retail + postage | retail − cost − Stripe |
| Free shipping | retail | retail − cost − postage − Stripe |

Break-even retail with free shipping is `(cost + postage + 0.30) / 0.971`. The
report prints it per product. Two are already under water there: a $6.00 sticker
needs $7.10 and an $18.00 mug needs $20.19.

---

## 4. How does shipping work, and what can I control?

**Printify's rates are the print provider's and you cannot set them.** There is
no API to change them and no dashboard field for it. They are a cost, like the
garment.

You control four things.

**1 — Which provider.** The rate is per provider, so choosing one chooses a
rate. The same beanie is posted to the EU for $4.59 by Printful and not at all
by Printify Choice.

**2 — Which method you buy.** Every order you submit names one, as
`shipping_method`. Verified live on 2026-07-28:

| Id | Method | US tee, first item | Handling | |
| --- | --- | ---: | --- | --- |
| 1 | standard | $4.75 | 2–5 days | the default |
| 2 | priority | not in the catalog rates | | the order calculator quotes $13.99 |
| 3 | express | $7.99 | 2–3 days | **not available on these products** |
| 4 | economy | $4.29 | 4–8 days | |

Economy is 46¢ cheaper than standard on a tee and three days slower. Across
eight products that is real money and nobody has decided it yet.

Two of those rows need care. **Printify Express is a separate programme** — a
product is `is_printify_express_eligible` and then has to be *enabled*. Both
tees are eligible; nothing on this shop is enabled. That is why the catalog
quotes express at $7.99 and the live order calculator, asked about the same
tee, answered `{"standard":475,"express":1399,"priority":1399}`: $13.99 is
ordinary carrier express, not the Printify programme. Enabling it is a decision
nobody has made.

**3 — Whether it merges.** Printify groups postage by product type **and**
provider. Two items from the same provider pay one first-item rate plus an
additional-item rate; two items from different providers pay two first-item
rates. This line is deliberately on two providers. A third would cost the
customer a whole extra first item on any mixed basket.

**4 — What the customer pays.** This is entirely ours and it is decided **in our
checkout, not in Printify**. Three options:

| | Customer sees | Risk |
| --- | --- | --- |
| **Pass through** | Postage added at checkout, at Printify's rate | Honest, and a $4.59 postage line on a $6.00 sticker looks absurd |
| **Flat rate** | One figure — say $5 US — whatever is in the basket | Simple. You lose on a single mug ($8.99) and win on a basket of tees |
| **Absorb** | "Free shipping", postage built into retail | Best conversion. Needs every price above its break-even, and two are not |

Nothing is decided. A sensible shape given these numbers: free US shipping over
a threshold, flat rate below it, and no international sales at launch — EU
postage on a tee is $13.49 and on a mug is $19.49, which is more than the mug.

**The rate for a real basket** comes from
`POST /v1/shops/28277243/orders/shipping.json` with the line items and the
address. It creates nothing. Verified 2026-07-28: standard $4.75 for a US tee,
matching the catalog exactly. That is the call our checkout makes — the catalog
rates in `store:report` are for deciding prices, not for quoting a customer.

---

## 5. How do I add a product, or change which logo is on what?

Everything is in **`packages/store/src/matrix.ts`**. Three lists:

- **`MARKS`** — the logos. Each carries its source file, the press file it
  renders to, how its background comes off, and **the grounds it may sit on**.
- **`ITEMS`** — the things to print on. Each carries blueprint, provider, price,
  sizes, print positions, default placement, and colourways **tagged light or
  dark**.
- **`MATRIX`** — one line per product: which mark, on which item.

Ids and titles are derived: `crest` + `tee` → id `crest-tee`, title
`Golden Retrievers Crest — Tee`. Descriptions are composed from the mark's
blurb, the item's spec, the colour list and the ground note. Nothing is typed
twice.

### Worked example — sell the gold crest on a sticker

Add one line:

```ts
export const MATRIX: MatrixEntry[] = [
  { mark: "crest", item: "tee" },
  { mark: "crest", item: "sticker" },
  { mark: "crest-gold", item: "sticker" },   // <- new
  ...
```

```
$ node packages/store/src/cli.ts line
crest-gold on sticker: the sticker is offered on light bodies and this mark can
only sit on dark. Dark bodies only, and there cannot be a light one — on white
the mark has nothing to cut into. Add a dark colourway to the item, or drop the
line.
```

It refuses, and the refusal is correct: the one-ink crest works by letting the
garment show through the banner and the dog's face, and white vinyl gives it
nothing to cut into. To do it anyway you would add a black-vinyl colourway to
the sticker item — a real variant id from a real provider — and it would then
build.

### Worked example — sell the full-colour crest on a cap

The four cap colourways in the line are black, charcoal and two-tone: all dark.
So this needs two edits, not one. Get the variant id from the catalogue first —
never type one from memory:

```
$ node packages/store/src/cli.ts variants 1743 99
  118722  One size / Black              size=One size color=Black
  ...
  118728  One size / Heather Grey/White size=One size color=Heather Grey / White
```

Then add the light colourway to the item, and the matrix line:

```ts
// in ITEMS, the cap:
colourways: [
  { name: "Black", hex: "#17191b", ground: "dark", variants: [118722] },
  ...
  { name: "Heather Grey / White", hex: "#c9c8c4", ground: "light", variants: [118728] },  // <- new
],

// in MATRIX:
{ mark: "crest", item: "cap" },   // <- new
```

Then check it before it goes anywhere near the API:

```bash
node packages/store/src/cli.ts line          # composes it, fetches nothing
node packages/store/src/cli.ts sync --dry-run  # printed size and dpi, sends nothing
npm run store:report                         # what it would cost and earn
node packages/store/src/cli.ts sync          # creates it as a DRAFT
```

### Adding a new logo

1. Put the master in `docs/logos/` or `docs/logos/vector/`. Vector is strongly
   preferred: it has no resolution ceiling.
2. Add it to `MARKS` with its grounds and its `reach` — `trim` if it already has
   transparency, `everywhere` for a one-ink mark, `border` for a full-colour
   mark on a solid background. **Getting `reach` wrong destroys the artwork**;
   `packages/store/src/artwork.ts` explains why in detail.
3. `node packages/store/src/cli.ts logos` renders it.
4. `node packages/store/src/cli.ts marks` lists every image under `docs/logos/`,
   at any depth, and shows which are wired in. Two are wired today. Everything
   else is a concept nobody can buy.
5. Add matrix lines.

### Removing a product

Delete its `MATRIX` line. **That does not delete the draft on Printify** — `sync`
only ever creates. Delete it in the dashboard, or with
`deleteProduct()` in `api.ts`. `store:report` lists anything on the shop that
the matrix no longer knows about.

### The two gates that stay

- **Every printed claim re-derives from `site.json` before an upload runs.**
  `CLAIMS` in `line.ts` is empty today because nothing in the line states a
  count, a year or a name in type. The moment a garment does, it gets a `Claim`
  there or it does not get printed. This has caught three real errors, including
  a `SAVES: 0` shirt that was false and an `EST. 2012` that was a year wrong.
- **Nothing uploads under 300 dpi at its largest printed size.** `sync` measures
  every placement in the line before it uploads a byte and throws with every
  offender named. The worst in the line today is 453 dpi.

---

## 6. What is still missing before anyone can buy

Nothing on the site sells anything. `/store` renders one sentence. Four pieces,
in order:

| # | Piece | What it does |
| --- | --- | --- |
| 1 | **Cart** | Holds variant ids and quantities. Client-side; the site is a static export |
| 2 | **Stripe Checkout session** | A Worker that prices the basket server-side — never trust a price from the browser — adds postage per the rule chosen in §4, and returns a session URL |
| 3 | **Stripe webhook** | Receives `checkout.session.completed`, verifies the signature, and is the only thing allowed to trigger fulfilment |
| 4 | **Printify order submission** | `POST /v1/shops/28277243/orders.json` with line items, address and `shipping_method`. Idempotent on the Stripe session id, or a retry ships two parcels |

Cloudflare Workers, $0 at this volume. Stripe is $0/month, 2.9% + 30¢ per sale.

### Decisions needed before any of it is worth building

1. **Postage model.** Pass through, flat rate, or absorb — §4. Everything
   downstream depends on it.
2. **Shipping method.** Standard or economy: 46¢ and three days per tee. And
   whether to enable Printify Express on the two products eligible for it.
3. **International.** EU postage on a tee is $13.49. Sell there, or US and
   Canada only?
4. **The cap.** 34% gross at $30. Raise it, or find a cheaper maker.
5. **The sticker and the mug.** Both cost more to post than they can carry
   alone. Minimum order value, or accessories only?
6. **Stripe account.** Whose, and on what legal entity.
7. **Returns and reprints.** Printify reprints its own faults free and charges
   for everything else. Who eats a wrong size?
8. **Sales tax.** Printify charges the merchant sales tax on the fulfilment.
   Whether anything must be collected from the customer is a question for an
   accountant, not for this file.

---

## Commands

```bash
npm run store:report              # cost, margin, postage, take-home. LIVE. Reads only
npm run store:catalogue "hoodie"  # what else it could be
npm run store:catalogue 77        # who makes it, and what they charge to post
npm run store:line                # the matrix as products. Fetches nothing

node packages/store/src/cli.ts marks      # every logo on disk
node packages/store/src/cli.ts audit      # every product on shop 28277243
node packages/store/src/cli.ts claims     # re-derive printed claims from site.json
node packages/store/src/cli.ts variants 12 29
node packages/store/src/cli.ts logos      # render the masters for press
node packages/store/src/cli.ts sync --dry-run
node packages/store/src/cli.ts sync       # create drafts. Cannot publish
```

Token: `PRINTIFY_API_TOKEN`, or `.secrets/printify_token.txt`. Gitignored, never
logged, never committed.

Implementation notes — the placement geometry, the two artwork traps, the shop
guard — are in [`packages/store/README.md`](../packages/store/README.md).
