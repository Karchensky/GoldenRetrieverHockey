# The store

Print-on-demand through Printify, sold on `goldenretrieverhockey.com`.

Shop **28277243** only. `13449786` is a live Etsy storefront for an unrelated
business; `packages/store/src/api.ts` refuses to address it and takes no shop id
from any caller. All eight products are `visible=false` — drafts. Nothing in this
repo can publish; that is one click in the dashboard.

| Decision | Where |
| --- | --- |
| Which garment, which maker, which logo, what it costs the customer | `packages/store/src/matrix.ts` |
| What a variant costs **you** | Printify, read back by `npm run store:report` or `cli.ts cost` |
| Postage, tax, delivery speed | this file, §2 and §3 |
| Whether the shop is public | Printify dashboard |

---

## 1. The line

Two logos, six items, eight products. **Quality chose every row; price only set
the retail figure afterwards.** Costs measured live on 2026-07-28 —
`npm run store:report` is the source of truth and this table is a snapshot.

| Product | Garment | Maker | Your cost | US post | Retail | You keep | Net |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `crest-tee`, `crest-gold-tee` | Bella+Canvas 3001 | Printful | $14.25 – $18.43 | $4.75 | **$36.00** | $15.66 – $11.48 | 43.5 – 31.9% |
| `crest-hoodie`, `crest-gold-hoodie` | Independent Trading IND4000 | SwiftPOD | $32.92 – $36.74 | $8.49 | **$74.00** | $30.14 – $26.32 | 40.7 – 35.6% |
| `crest-gold-cap` | Richardson 112 | Printful | $20.08 | $4.89 | **$40.00** | $13.57 | 33.9% |
| `crest-gold-beanie` | Yupoong 1501KC | Printful | $14.96 | $4.89 | **$32.00** | $10.92 | 34.1% |
| `crest-gold-mug` | Black ceramic, 11/15 oz | Printify Choice | $7.19 – $8.29 | $8.99 | **$26.00** | $8.77 – $7.67 | 33.7 – 29.5% |
| `crest-sticker` | Kiss-cut white vinyl | Printify Choice | $4.74 – $6.00 | $4.77 | **$18.00** *(three)* | $7.67 – $6.41 | 42.6 – 35.6% |

**Net** is what is left after the goods, US standard postage and Stripe — not
gross margin, which flatters every item by the price of its own parcel.

One of each, worst-case size, free US shipping: customer pays **$336.00**,
Printify takes **$209.69**, Stripe takes **$12.14**, you keep **$114.17** —
34.0%. At the old prices the same policy kept $57.27 on $250, 22.9%, with the
sticker at −$1.06 a sale and the mug at −$2.12.

### Why each one

| | Chosen | Over | Because |
| --- | --- | --- | --- |
| **Tee** | Bella+Canvas 3001 · **Printful** | Monster Digital; Comfort Colors 1717 | 3001 is the DTG standard and stayed. Printful posts to the EU for **$4.79** where Monster Digital charges $13.49, carries 432 variants against 299, and offers embroidery placements on the same shirt. It costs $2.71 more on a 3XL. Comfort Colors 1717 was probed at **$20.51** — 44% dearer for a garment-dyed body whose colour varies unit to unit. |
| **Hoodie** | Independent Trading **IND4000** · SwiftPOD | Gildan 18500; Lane Seven LS14001; Champion S700 | Gildan 18500 is the budget default: 8 oz of 50/50. IND4000 is 10 oz of 80/20 with a jersey-lined hood, and its 15 × 10in front canvas prints the crest 8.35in wide against the Gildan's 8.31 in a smaller frame. SwiftPOD over Monster Digital because Monster Digital's IND4000 **has no black and stops at 2XL**. Lane Seven costs $29.26 and is the fallback if $74 proves too much. |
| **Cap** | Richardson 112 · **Printful** | Printify Choice; Duplium | The 112 was already right. Printful is one named embroiderer rather than a routing layer, charges the same $4.89 in the US, and opens the EU at $4.59 — which Printify Choice does not offer **at any price**. It costs 19¢ more. |
| **Beanie** | Yupoong 1501KC · **Printful** | Printify Choice | Identical cost, $14.96 either way, identical US postage. Printful adds Europe at $4.59. |
| **Mug** | Black ceramic · **Printify Choice** | Monster Digital; District Photo; ORCA Coatings | $8.29 against Monster Digital's $10.31 for the same object at the same postage. ORCA Coatings — the only real *brand* in the mug category — was probed at **$13.08**, which is a $30 mug. A sublimated mug is a commodity; the money belongs in the garments. |
| **Sticker** | Kiss-cut vinyl · Printify Choice | SPOKE | SPOKE rejects creation outright (`Decorator 1 not available for this blueprint 400`). There is no other maker. |

### The sticker, and why it is sold in threes

One sticker costs $2.00 and $4.59 to post. Free shipping on one needs $7.10 to
break even and about $11 to earn anything, and an $11 sticker is not a store
anybody wants to shop in. **Three post for $4.77.** So three is the unit: $18,
posted free, 35.6% net. `matrix.ts` carries this as `sale.minQuantity` beside the
price, because it *is* part of the price, and checkout has to enforce it.

### The finding that shapes all of it

**Postage does not merge across product types.** Verified against
`POST /shops/28277243/orders/shipping.json` on 2026-07-28:

| Basket | Quoted | Which is |
| --- | ---: | --- |
| tee | $4.75 | |
| tee + cap, **both Printful** | $9.64 | $4.75 + $4.89 — two first-item rates |
| tee + sticker | $9.34 | $4.75 + $4.59 |
| tee × 2 | $7.15 | $4.75 + $2.40 — *this* merges |
| sticker × 3 | $4.77 | $4.59 + 2 × $0.09 |

Only **quantity of one thing** merges. Consolidating makers buys quality and
international reach; it buys nothing on postage. Every price above therefore
carries its own US first-item rate.

---

## 2. Shipping

**Free within the US, priced in.** The customer pays the shelf price and nothing
else. Postage is a cost of goods, and every retail figure in §1 already covers it.

**International pays the difference, at cost** — their rate *minus* the US rate
already inside the price, so nothing is charged twice. Where a maker posts abroad
for less than it posts at home, there is no surcharge at all.

| Destination | Tee | Hoodie | Cap | Beanie | Mug | Sticker ×3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| US | free | free | free | free | free | free |
| EU | +$0.04 | +$10.00 | free | free | **not offered** | **not offered** |
| Canada | +$4.64 | +$4.20 | +$4.50 | +$4.50 | +$5.90 | +$5.00 |
| Rest of world | +$5.25 | +$6.51 | +$5.10 | +$5.10 | +$12.20 | +$8.20 |

Europe costs four cents on a tee and nothing on a cap, because Printful posts
there for $4.79 and $4.59 — against Monster Digital's $13.49, which is what the
tee used to cost to send. Printify Choice does not ship to the EU at all, so the
mug and the sticker are US, Canada and rest-of-world only.

**Method: standard. Always.** Economy saves 46¢ on a tee, 80¢ on a hoodie and
$2.20 on a mug — $4.56 across one of everything, 2.1% of retail — and costs three
days, moving 2–5 days to 4–8. It also carries **no international rates at all**,
so using it would mean two shipping policies. A delivery estimate is part of the
product; it is not for sale at 46¢.

**Printify Express: not enabled, and mostly not available.** Printful quotes no
express or priority on the tee, the cap or the beanie — standard and economy are
the whole menu. The only product that offers it is the hoodie, where the live
calculator returns `{"standard":849,"express":2099,"priority":2099}`: **$20.99
against $8.49** to save perhaps two days on a 2–5 day service. The $13.99 quoted
in earlier notes was ordinary carrier express on the old Monster Digital tee, not
the Printify Express programme. One speed, one honest price. Revisit if customers
ask, not before.

**Printify sets these rates and you cannot.** `store:report` breaks them out per
method and region; `POST /shops/28277243/orders/shipping.json` prices a real
basket and creates nothing. That second call is what checkout will make.

---

## 3. Tax

**Not settled by code, and nothing in this repo collects a cent.** Two separate
questions, both the captain's:

**1 — Tax you charge the customer.** The regular way for a US store selling
direct is **Stripe Tax**: it calculates at checkout from the buyer's address and
adds the line itself. It costs 0.5% of transactions where tax is calculated. It
does **not** file or remit — that stays with you or a filing service.

- Register in **New York** first: the business is here, so there is nexus from
  the first sale.
- Other states only once their economic-nexus threshold is crossed — commonly
  $100,000 or 200 transactions in twelve months. A store this size will most
  likely never cross one. Stripe Tax monitors thresholds and warns.
- Enable it, set the origin address, add the NY registration, done.

**2 — Tax Printify charges you.** Printify charges US sales tax on the
*fulfilment*, to you, unless a **resale certificate** is on file — you are
reselling the goods, not consuming them, and the tax is meant to be collected
once, from the customer. Without it the same goods are taxed twice.

- Printify → account settings → tax exemption → upload the resale certificate
  for the state you are registered in.
- This needs the registration in (1) to exist first.

Ask an accountant before the first sale. Neither of these is a code change.

---

## 4. Stripe setup

Everything here is done by the captain, in a browser, in this order. **Test mode
until a real card has to work.**

| # | Step | Detail |
| --- | --- | --- |
| 1 | Create the account | `dashboard.stripe.com`. Business entity and bank account are needed before payouts, not before testing |
| 2 | Stay in **Test mode** | The toggle, top right. Every key below has a test twin. Nothing built against test keys can move money |
| 3 | Copy the two keys | Developers → API keys. **Publishable** (`pk_…`) and **Secret** (`sk_…`) |
| 4 | Put them in `.secrets/` | `.secrets/stripe_publishable.txt`, `.secrets/stripe_secret.txt`. The directory is gitignored, same as the Printify token |
| 5 | Turn on **Stripe Tax** | Settings → Tax. Set the origin address. Add the New York registration. Leave the rest to threshold monitoring |
| 6 | Create the webhook | Developers → Webhooks → add endpoint, the Worker's URL, event `checkout.session.completed`. Copy the **signing secret** (`whsec_…`) to `.secrets/stripe_webhook_secret.txt` |
| 7 | Test the whole path | Card `4242 4242 4242 4242`, any future expiry. The order must reach Printify as a draft order and no further |
| 8 | Go live last | Flip to Live mode, repeat 3 and 6 with the live keys, run one real order and refund it |

**Do not:**

- put any key in the repo, in `matrix.ts`, in a Worker's source, or in a commit
  message — `.secrets/` and Cloudflare's encrypted variables, nowhere else;
- expose the secret key to the browser. `pk_…` is public by design, `sk_…` never
  leaves the server;
- price a basket from the browser. The Worker re-prices every line from
  `matrix.ts` before it creates a session, or a customer sets their own price;
- go live before a test order has gone end to end and been refunded.

---

## 5. Changing something

Everything is in **`packages/store/src/matrix.ts`** — `MARKS` (the logos),
`ITEMS` (the things to print on), `MATRIX` (one line per product). Ids, titles,
colourways, descriptions and placements are all derived, so a tee cannot be $36
in one place and $32 in another.

| Want | Do |
| --- | --- |
| Change a price | `priceCents` on the item. Then `sync` (or `updateProduct`) to push it |
| Change the garment or the maker | Compare with `cli.ts catalogue <query>` then `catalogue <blueprintId>`; get real costs with `cli.ts cost <bpId> <ppId>`; get variant ids with `cli.ts variants <bpId> <ppId>`; edit the item; then **delete the old draft in the dashboard and re-sync** |
| Add a product | One line in `MATRIX`. `cli.ts line` composes it and refuses a mark on a ground it cannot use |
| Add a logo | Master into `docs/logos/`, entry in `MARKS` with its `reach`, `cli.ts logos` to render. **Getting `reach` wrong destroys the artwork** — `packages/store/src/artwork.ts` explains why |
| Remove a product | Delete its `MATRIX` line, then delete the draft in the dashboard. `sync` only ever creates |

**Item cost is not in the catalog API and cannot be.** A variant's cost appears
for the first time on a product that exists, so `cli.ts cost` creates one draft,
reads the cost off it, and deletes it in a `finally`. Two ceilings found by
running it: **100 enabled variants** per product (`400 code 8251`), and providers
the catalog advertises that reject creation outright.

**Changing a maker changes the variant ids** — usually. On this line they did not
(blueprint 12's ids are the same through Printful and Monster Digital), but that
is a property of the blueprint, not a rule. Always read them back with
`cli.ts variants`.

### Before anything is uploaded

- **Every printed claim re-derives from `site.json`.** `CLAIMS` in `line.ts` is
  empty today because nothing in the line states a count, a year or a name in
  type. It has caught three real errors, including a `SAVES: 0` shirt that was
  false. The moment a garment states something, it gets a `Claim` or it does not
  get printed.
- **Nothing uploads under 300 dpi** at its largest printed size. The worst in the
  line today is **448 dpi** — the tee, printing 10.11in wide on a 3XL off a
  4526 × 5094 px master rendered from the vector at 6000 px.

---

## 6. What is left

`/store` on the site renders one sentence. Nothing sells anything yet.

| # | Piece | What it does |
| --- | --- | --- |
| 0 | **Rebuild the drafts** | Seven of eight products changed garment or maker. Delete them in the dashboard, refresh `apps/web/data/products.json`, run `cli.ts sync`. `store:report` flags each one `GARMENT` until this is done |
| 1 | **Cart** | Variant ids and quantities, client-side. Must enforce `sale.minQuantity` |
| 2 | **Stripe Checkout session** | A Worker that re-prices the basket from `matrix.ts`, adds the international difference per §2, and returns a session URL |
| 3 | **Stripe webhook** | `checkout.session.completed`, signature verified. The only thing allowed to trigger fulfilment |
| 4 | **Printify order** | `POST /v1/shops/28277243/orders.json`, `shipping_method: 1` (standard). Idempotent on the Stripe session id, or a retry ships two parcels |

Cloudflare Workers, $0 at this volume. Stripe $0/month + 2.9% + 30¢. Stripe Tax
0.5%. Printify free plan, per item.

**Still open:** who eats a wrong size (Printify reprints its own faults free and
charges for everything else), and which legal entity the Stripe account sits on.

---

## Commands

```bash
npm run store:report              # cost, margin, postage, take-home. LIVE. Reads only
npm run store:catalogue "hoodie"  # what else it could be
npm run store:catalogue 2002      # who makes it, and what they charge to post
npm run store:line                # the matrix as products. Fetches nothing

node packages/store/src/cli.ts cost 12 410   # real cost: creates a draft, reads it, deletes it
node packages/store/src/cli.ts variants 12 410
node packages/store/src/cli.ts marks         # every logo on disk
node packages/store/src/cli.ts audit         # every product on shop 28277243
node packages/store/src/cli.ts claims        # re-derive printed claims from site.json
node packages/store/src/cli.ts logos         # render the masters for press
node packages/store/src/cli.ts sync --dry-run
node packages/store/src/cli.ts sync          # create drafts. Cannot publish
```

Token: `PRINTIFY_API_TOKEN`, or `.secrets/printify_token.txt`. Gitignored, never
logged, never committed.

Implementation notes — placement geometry, the two artwork traps, the shop guard
— are in [`packages/store/README.md`](../packages/store/README.md).
