import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Reach } from "./artwork.ts";

/**
 * The mix-and-match matrix. **This is the file the captain edits.**
 *
 * Three lists and nothing else:
 *
 *   MARKS   the logos, each with the grounds it may sit on
 *   ITEMS   the things to print on, named the way he says them — tee, hoodie, cap
 *   MATRIX  one line per product: which mark, on which item
 *
 * Add a line to MATRIX and there is a new product. Delete one and it is gone.
 * Everything a product needs beyond those two words — its id, its title, its
 * colourways, its price, its placement, its description — is derived from the
 * mark and the item, so the same tee cannot be $36 in one place and $32 in
 * another.
 *
 * **Nothing here is a printed claim about the archive.** Copy that states a
 * year carries a `{{firstYear}}` token resolved from site.json at upload time.
 * The moment a garment states a count, a name or a date in type, it needs a
 * `Claim` in line.ts as well, or it does not get printed. See `CLAIMS` there.
 *
 * The economics of every line below — cost, margin, shipping — are not in this
 * file and must not be typed into it. Run `npm run store:report`; it reads them
 * live from Printify. See STORE.md at the repo root (local, gitignored).
 */

export const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
/** Press-ready art harvested from the built store by scripts/build-print-files.mjs. */
export const PRINT_DIR = join(ROOT, "dist/print");
/** The captain's logos, ground removed and rendered for press by `cli.ts logos`. */
export const LOGO_DIR = join(ROOT, "dist/print/logos");
/** Where the masters live. Scanned, subdirectories and all, by `cli.ts marks`. */
export const LOGO_SOURCE_DIR = "docs/logos";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * A body is light or dark, and a mark states which of them it may sit on. Most
 * state both; two state one.
 *
 * This is not a style preference and it is the reason the matrix exists at all.
 * Every mark in `docs/logos/vector/` is drawn on a black field, so on a dark
 * body that field stops being ink and becomes the garment. What decides whether
 * that is a design or a wreck is the EDGE: a mark ringed, bordered or barred in
 * gold keeps its whole silhouette and reads as intended, and a mark whose outer
 * shape IS the black loses it entirely. `faceoff` is the second kind. The
 * mirror case is a mark carried by WHITE — `arched-varsity` is a white wordmark
 * with a gold keyline, and on a light body it hollows out into its own outline.
 *
 * Pair a mark with a ground it cannot use and `buildLine()` throws rather than
 * printing it, naming both halves and the reason.
 */
export type Ground = "light" | "dark";

export type Mark = {
  /** First half of every product id it appears in. */
  id: string;
  /** First half of every product title. */
  title: string;
  /** The grounds this mark may sit on. Seven of nine sit on both. */
  grounds: Ground[];
  /** Master, relative to the repo root. Rendered by `cli.ts logos`. */
  source: string;
  /** Press file it renders to, under dist/print/logos. Measured, never typed. */
  press: string;
  /** How the ground comes off. See artwork.ts — getting this wrong destroys the art. */
  reach: Reach | "trim";
  /** Pixel width to rasterise a vector master at. Ignored for a raster source. */
  renderWidth: number;
  /** Opening line of every product description that carries this mark. */
  blurb: string;
  /** Why it is restricted to its grounds. Printed in the description. */
  groundNote: string;
};

export type Colourway = {
  name: string;
  hex: string;
  ground: Ground;
  /** Catalog variant id per size, in the same order as the item's `sizes`. */
  variants: number[];
};

/**
 * How an item may be bought. The rule lives here, beside the price, because it
 * IS part of the price: the sticker is $6 and sold in threes, and neither half
 * of that is true without the other.
 *
 * **This is enforced, in two places, as of 2026-07-29.** It was written for a
 * checkout of our own, then sat inert while the store was pointed at a Printify
 * Pop-Up whose checkout is Printify's and takes no minimum-quantity rule from
 * us — which would have listed a $6 sticker that loses money on a single sale.
 * The Pop-Up is gone (it does not make Printify the merchant of record, which
 * was the only reason to want it), the checkout is ours again, and the rule is
 * live: `./basket.ts` refuses a basket that breaks it, in the browser so the
 * cart can say so, and again in the Worker because the browser is not trusted.
 *
 * The alternative was a fixed three-pack SKU, and it was rejected: a pack is
 * three of ONE design, and the measurement below is the whole reason not to
 * impose that on anybody.
 *
 * It exists because Printify's postage does not merge across product types.
 * Proven on 2026-07-28 against `POST /shops/28277243/orders/shipping.json`: a
 * tee and a cap, both from Printful, quote $9.64 — $4.75 + $4.89, two separate
 * first-item rates. Three stickers quote $4.77 — $4.59 plus two additional-item
 * rates of $0.09. So quantity of ONE thing is nearly free to post and a second
 * KIND of thing never is, and an item whose postage is larger than the item has
 * exactly one honest shape: sell it in a quantity that carries its own parcel.
 *
 * **The merge is by product TYPE, not by product.** Measured against the same
 * endpoint on 2026-07-29, now that there are five sticker designs to test with:
 *
 *   1 sticker                             $4.59
 *   3 stickers, one design                $4.77
 *   3 stickers, THREE DIFFERENT designs   $4.77   ← identical
 *   1 tee                                 $4.75
 *   1 tee + 3 stickers, three designs     $9.52   = $4.75 + $4.77
 *
 * This was an open assumption when the sticker was one design and it is now a
 * measurement. `minQuantity` therefore counts STICKERS and not copies of one
 * sticker: three different marks post for exactly what three of one post, so a
 * customer is never asked to buy three of a design to reach the minimum.
 */
export type Sale = {
  /** Fewest units of this item a basket may hold. Default 1. */
  minQuantity?: number;
  /** True when this may not be the only thing in a basket. */
  addOnOnly?: boolean;
  /** Why. Printed by `cli.ts line` and store:report; never guessed at. */
  why: string;
};

/**
 * The share of what the customer pays that stays with the club, on EVERY size.
 *
 * The captain's figure, 2026-07-29: *"20% margin across the board, dynamic
 * pricing for those extra large sizes that cost more… let's not abuse people
 * here."* One price per product could not express that — a 3XL tee costs $4.90
 * more to make than a small, so a flat $23 earned 37% on the small and 19.7% on
 * the 3XL, and the person taking a medium was subsidising the person taking a
 * 3XL by four dollars.
 *
 * Every variant is now priced from its OWN cost. See `pricing.ts`.
 *
 * Change this one number and re-sync and the whole shop reprices. Below about
 * 18% a single customer-error reprint, which Printify charges for, costs more
 * than three sales earn.
 */
export const MARGIN_TARGET = 0.2;

export type Item = {
  /** Second half of every product id. The word he uses for it. */
  id: string;
  /** Second half of every product title. */
  title: string;
  blueprintId: number;
  printProviderId: number;
  /**
   * Retail, integer cents, **postage NOT included**.
   *
   * It used to be. Every price carried a first-item postage rate so shipping
   * could read as free, and that was abandoned on 2026-07-29 for a reason worth
   * keeping: a single figure per product cannot express what Printify charges.
   * A second tee adds $2.40 to a $4.75 first; a second mug adds $3.09 to a
   * $6.99 first; nothing merges across product types. So the bundled rate was
   * a first-item rate on EVERY unit, and every multi-item basket overpaid —
   * two mugs carried $17.98 of assumed postage against $10.08 of real postage.
   *
   * Postage is now quoted live for the actual basket at checkout and passed
   * through at cost. These figures are the goods alone, which is also why they
   * dropped: the tee went $36 → $29 and the mug $26 → $17 without a cent of
   * margin moving.
   *
   * One price per item, whatever mark is on it. See STORE.md §5.
   */
  priceCents: number;
  /** Buying rules, where the plain "one of these, on its own" does not work. */
  sale?: Sale;
  /** Overrides `MARGIN_TARGET` for this item alone. Nothing uses it yet. */
  marginTarget?: number;
  /**
   * Stripe product tax code, which decides what the buyer is charged.
   *
   * **This is not a formality and the default is wrong for most of this shop.**
   * New York exempts clothing and footwear under $110 from the state's 4%, and
   * Erie County is one of the counties that does NOT waive its own 4.75%, so a
   * $36 tee to Buffalo is taxed at 4.75% and a $26 mug at the full 8.75%. Ship
   * every line as `txcd_99999999` and every garment is overcharged — the buyer
   * pays tax the state does not levy, and the difference is remitted to nobody.
   *
   * The codes are Stripe's, from https://docs.stripe.com/tax/tax-codes, and the
   * mapping to a jurisdiction's own rules is Stripe's job rather than ours. What
   * is ours is picking the code that describes the object:
   *
   *   txcd_30011000  Clothing & Footwear      tee, hoodie
   *   txcd_30060006  Hats                     cap, beanie
   *   txcd_99999999  General - Tangible Goods mug, sticker
   *
   * The cap and the beanie are the one pairing worth checking before the first
   * sale. New York's own clothing chart lists "Hats: exempt" and "Caps: exempt",
   * so they should be treated exactly like the tee here — but that conclusion
   * runs through Stripe's mapping of its Hats code rather than through anything
   * this repository can assert. Run a test calculation to a Buffalo ZIP and
   * confirm a cap comes back at 4.75% and not 8.75%. See STORE.md §5.
   */
  taxCode: string;
  sizes: string[];
  /**
   * Print areas this blueprint/provider offers, as the CATALOG reports them —
   * `placeholders[].position` on a variant, not the docs. Declared here so a
   * typo is caught offline; `store:report` checks it against the live catalog
   * and says so if it has drifted.
   */
  positions: string[];
  /** Where a mark goes on this item, unless a MATRIX line overrides it. */
  placement: { position: string; widthIn: number; y: number };
  colourways: Colourway[];
  /**
   * The garment paragraph, **written for somebody deciding whether to buy it**.
   *
   * What it is, what it is made of, how it fits, how it is decorated. Nothing
   * about print canvases, nothing about which mark is limited by height, and no
   * sentence that only makes sense to whoever built the line.
   */
  spec: string;
  /** Sizing, fit and care — the practical paragraph. */
  care?: string;
  /** Closing line. `null` prints none. */
  closing?: string | null;
};

export type MatrixEntry = {
  mark: string;
  item: string;
  /** Rarely needed — the item's own placement is the default. */
  placement?: Partial<Item["placement"]>;
  /** Rarely needed — the item's own price is the default. */
  priceCents?: number;
  /** Which CLAIMS in line.ts this product's art depends on. */
  claims?: string[];
};

export type Placement = {
  position: string;
  art: string;
  /** Intended printed width, in inches, before the area's own limits apply. */
  widthIn: number;
  /** Fraction of the print area. 0.5 is centred; smaller is higher. */
  y: number;
};

export type LineItem = {
  /** `{mark}-{item}`. Matches the `id` in apps/web/data/products.json. */
  id: string;
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  priceCents: number;
  /** Colour name -> variant id per size, straight from the catalog. */
  colors: { name: string; hex: string; variants: number[] }[];
  sizes: string[];
  placements: Placement[];
  /** Buying rules checkout must enforce. Undefined means "one, on its own, fine". */
  sale?: Sale;
  /** Stripe product tax code, from the item. See `Item["taxCode"]`. */
  taxCode: string;
  /** Per-item override of `MARGIN_TARGET`. Undefined means use the constant. */
  marginTarget?: number;
  claims: string[];
  /** Back-references, so a report can say what a product is made of. */
  markId: string;
  itemId: string;
};

/* ------------------------------------------------------------------ */
/* 1 — the marks                                                       */
/* ------------------------------------------------------------------ */

/**
 * The nine approved marks, every one off the THREE-COLOUR production masters in
 * `docs/logos/vector/production-3color-svg/`.
 *
 * **`logo_one` and `crest-gold` are retired** and are not coming back. They were
 * one drawing in two inks; these are nine drawings in one palette — black
 * `#0B0B0D`, white `#FFFFFF`, athletic gold `#D9A333` — and the palette is what
 * makes them a line rather than a pile.
 *
 * **Why the three-colour SVG and not the detailed master or the 600 dpi PNG.**
 * `tools/build_vector_assets.py` renders both PNG sets from the DETAILED
 * masters, which carry 238–1,730 tonal fills apiece. Three flat inks is what a
 * garment actually is: DTG holds a hard edge and muddies a gradient, embroidery
 * is thread and has no gradient at all, and vinyl is cut. The three-colour file
 * is also the one any vendor asks for. Rendered here at 6000 px it trims to
 * 5,400–5,700 px of artwork, which beats the 4,526 px the retired crest carried.
 *
 * **`reach` is "trim" on all nine, and that is not laziness.** These files
 * already carry alpha, so there is no ground to key. They still get trimmed:
 * Printify places an image by its file BOX, and the rasteriser leaves the mark
 * inset in a rectangular canvas — uploading one untrimmed silently shrinks the
 * print. Do not reach for `"everywhere"` here. Every one of these marks is
 * OUTLINED in black, so keying black out would dissolve the drawing rather than
 * free the garment; artwork.ts explains what the two keying modes are for.
 *
 * **`grounds` is measured, not chosen.** All nine sit on a black field, so on a
 * dark body the field becomes the body and what has to survive is the EDGE. On
 * seven of the nine that edge is a gold ring, border or bar and it carries the
 * whole silhouette. The two that cannot go both ways say why on their own entry.
 *
 * To add a mark: master into `docs/logos/`, an entry here, `cli.ts marks` to see
 * it measured, then a line in MATRIX. `cli.ts logos` is a loop over this list.
 */
export const MARKS: Mark[] = [
  {
    // concept 21 — dense-heritage-seal
    id: "heritage-seal",
    title: "Golden Retrievers Heritage Seal",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/production-3color-svg/21-dense-heritage-seal-3color.svg",
    press: "logos/heritage-seal.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "A double gold ring with GOLDEN arched over the top and RETRIEVERS around " +
      "the foot, the dog in three-quarter profile over crossed sticks. Drawn as " +
      "a seal, so it wants to be round and it wants an edge.",
    groundNote:
      "The field inside the rings is black: on a light body it reads as a " +
      "printed seal, and on a dark one it becomes the body and the gold rings " +
      "carry the shape.",
  },
  {
    // concept 28 — dual-retriever-faceoff
    id: "faceoff",
    title: "Golden Retrievers Faceoff",
    grounds: ["light"],
    source: "docs/logos/vector/production-3color-svg/28-dual-retriever-faceoff-3color.svg",
    press: "logos/faceoff.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "Two dogs and two pucks inside one disc — one dog in gold, one in white, " +
      "and the gold line between them where the puck drops.",
    // The one mark in the set with no edge. Everything else is ringed, bordered
    // or barred in gold; this is a bare black disc, so on a dark body the disc
    // is the first thing to go and the dogs are left floating either side of a
    // gold line that no longer means anything.
    groundNote:
      "The disc has no border — it IS the black — so on a dark body it " +
      "disappears and the dogs float with nothing holding them. Light bodies " +
      "only.",
  },
  {
    // concept 33 — front-mascot-medallion
    id: "mascot-medallion",
    title: "Golden Retrievers Mascot Medallion",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/production-3color-svg/33-front-mascot-medallion-3color.svg",
    press: "logos/mascot-medallion.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "The dog head-on and filling the frame, sticks crossed behind, inside a " +
      "single heavy gold ring. The most drawing of any mark in the set, and the " +
      "one that most wants room.",
    groundNote:
      "The medallion is black inside the ring, and the ring is what holds it on " +
      "a dark body.",
  },
  {
    // concept 35 — octagon-retrievers-patch. The only portrait mark, 3:2 tall.
    id: "octagon-patch",
    title: "Golden Retrievers Octagon Patch",
    // LIGHT ONLY, and this was decided by a mockup rather than by looking at the
    // file. It is the only mark in the set whose black is a RECTANGLE — 88.7% of
    // its bounding box is inked against 55-83% for the rest — because the
    // octagon is drawn INSIDE a filled black panel rather than cut out of one.
    // On a black hoodie back the provider's mockup showed exactly that: a
    // rectangular slab of ink with square corners sitting on the garment. On a
    // light body the same rectangle reads as what it is, a patch.
    grounds: ["light"],
    source: "docs/logos/vector/production-3color-svg/35-octagon-retrievers-patch-3color.svg",
    press: "logos/octagon-patch.png",
    reach: "trim",
    // Portrait, so 6000 would render 8,800 px tall for no gain — `renderWidth`
    // is a WIDTH. 5000 puts the long edge at about 7,300 and still trims to
    // ~4,650 px across, which is 437 dpi at the widest it is ever printed.
    renderWidth: 5000,
    blurb:
      "A tall octagon cut like a sewn patch — GOLDEN across the top, the dog in " +
      "profile between two upright sticks, RETRIEVERS on a white banner at the " +
      "foot.",
    groundNote:
      "The octagon sits inside a filled black panel rather than being cut out " +
      "of one, so it prints as a rectangle. On a light body that is a patch; on " +
      "a dark one it is a slab. Light bodies only.",
  },
  {
    // concept 36 — crossed-shield-retriever
    id: "crossed-shield",
    title: "Golden Retrievers Crossed Shield",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/production-3color-svg/36-crossed-shield-retriever-3color.svg",
    press: "logos/crossed-shield.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "A shield with two sticks crossed through it, GOLDEN on the gold banner " +
      "above, RETRIEVERS on the banner below, a puck at the point.",
    groundNote:
      "The most open drawing in the set — the sticks, the banners and the dog " +
      "all sit proud of the shield, so it holds together on either body.",
  },
  {
    // concept 38 — arched-varsity-lockup
    id: "arched-varsity",
    title: "Golden Retrievers Arched Varsity",
    grounds: ["dark"],
    source: "docs/logos/vector/production-3color-svg/38-arched-varsity-lockup-3color.svg",
    press: "logos/arched-varsity.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "GOLDEN RETRIEVERS arched in white varsity block over a small gold " +
      "roundel, a stick and a puck running out beneath the word.",
    // The inverse of the faceoff's problem, and the only WHITE-forward mark in
    // the set: 26% of its ink is white against 9-18% everywhere else. On a white
    // or ash body the letterforms hollow out into their own outlines and the
    // wordmark loses the weight it is built on.
    groundNote:
      "The wordmark is white with a gold keyline and the white is the whole " +
      "weight of it — on a light body it hollows out into an outline. Dark " +
      "bodies only.",
  },
  {
    // concept 45 — rink-board-lockup. The widest mark in the set, 3:1.
    id: "rink-board",
    title: "Golden Retrievers Rink Board",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/production-3color-svg/45-rink-board-lockup-3color.svg",
    press: "logos/rink-board.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "The name the way it would be painted on the boards: a long gold-edged " +
      "bar, the dog in a roundel at the left, a stick and a puck running out to " +
      "the right.",
    groundNote:
      "The board is black inside a gold edge. On a dark body the edge is what " +
      "you see and the board becomes the garment.",
  },
  {
    // concept 48 — dual-capsule-retrievers
    id: "nose-to-nose",
    title: "Golden Retrievers Nose to Nose",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/production-3color-svg/48-dual-capsule-retrievers-3color.svg",
    press: "logos/nose-to-nose.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "Two dogs facing each other over a dropped puck inside a gold capsule, " +
      "GOLDEN RETRIEVERS on the banner beneath them. One in gold, one in white.",
    groundNote:
      "The capsule is black inside a gold outline, and the outline is what " +
      "holds it on a dark body.",
  },
  {
    // concept 50 — championship-roundel
    id: "championship-roundel",
    title: "Golden Retrievers Championship Roundel",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/production-3color-svg/50-championship-roundel-3color.svg",
    press: "logos/championship-roundel.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "A full roundel — GOLDEN arched in gold over the top, RETRIEVERS in white " +
      "around the foot, the dog centred over crossed sticks and a puck.",
    groundNote:
      "Two gold rings around a black field. The rings survive a dark body; the " +
      "field turns into it.",
  },
];

/* ------------------------------------------------------------------ */
/* 2 — the items                                                       */
/* ------------------------------------------------------------------ */

/**
 * What there is to print on. Blueprint and provider are the two numbers that
 * decide brand, cost and shipping; `npm run store:report` prints all three from
 * the live API, `store:catalogue` shows what else is on offer, and
 * `cli.ts cost <bp> <pp>` gets a real per-variant cost out of a provider this
 * shop has never used.
 *
 * **Quality is the selection rule here, not price.** Every blueprint below is
 * the best garment its category offers on this platform and every provider is
 * the best maker of it, judged on the print method, the size of the canvas, the
 * colourways carried, where it posts from and what it charges to post abroad.
 * Cost decided nothing; it only set the retail price afterwards. The measured
 * costs and the reasoning are in STORE.md §1.
 *
 * **Postage does not merge across product types**, which is the fact that shapes
 * this list. See `Sale` above: a tee and a cap from the SAME provider quote two
 * first-item rates. So consolidating providers buys quality and international
 * reach, not postage, and every price below carries its own US first-item rate.
 */
export const ITEMS: Item[] = [
  {
    id: "tee",
    title: "Tee",
    blueprintId: 12,
    // Printful rather than Monster Digital. The garment is identical — the
    // variant ids are per blueprint, not per provider — and the choice buys
    // three things measured on 2026-07-28: the EU first-item rate falls from
    // $13.49 to $4.79, which is four cents more than posting it inside the US;
    // 432 variants and 72 colourways against 299 and fewer; and embroidery
    // placements on the same shirt that Monster Digital does not offer. It also
    // makes the cap and the beanie, so three of the six items come off one
    // accountable manufacturer. It costs $2.71 more on the dearest size.
    // MONSTER DIGITAL, not Printful, as of 2026-07-29 — and it is the SAME
    // SHIRT. Variant ids are per blueprint, so this is Bella+Canvas 3001 either
    // way; what changes is who prints it and for how much: $11.54/$14.10/$16.44
    // against Printful's $14.25–$18.43. That is $2.71 off the dearest tee for
    // no change to the garment, which is exactly the kind of saving the captain
    // asked for on 2026-07-29 ("get the price as low as possible without this
    // kind of quality sacrifice").
    //
    // What Printful bought was reach: it posts a tee to the EU for $4.79 where
    // Monster Digital charges $13.49, and it offers embroidery placements on the
    // same shirt. Checkout is US-only and nothing in this line is embroidered on
    // a tee, so both were being paid for and neither was being used. **Switch
    // back the day international opens** — the EU difference is larger than the
    // saving.
    printProviderId: 29,
    priceCents: 2300,
    taxCode: "txcd_30011000",
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    // Three, not the ten Printful offered: Monster Digital prints and does not
    // embroider. store:report compares this against the live catalog and flags
    // a difference in either direction.
    positions: ["front", "back", "neck"],
    // 8in on the smallest body this shirt is sold in, y 0.42 to lift it off the
    // hem. A placement is a PROPORTION, so this is ~11in on a 3XL; asking for
    // ten on a small would put fifteen on a 3XL and cover the shirt. Checked by
    // `sync --dry-run`, which prints both ends of the range and the dpi at each.
    placement: { position: "front", widthIn: 8.0, y: 0.42 },
    colourways: [
      { name: "White", hex: "#f4f4f2", ground: "light", variants: [18540, 18541, 18542, 18543, 18544, 18545] },
      // Ash was here and came off with the move to Monster Digital: they carry
      // 41 of our 42 tee variants and the one they do not is Ash in L. A
      // colourway missing its most-ordered size is not a colourway. White and
      // athletic heather still cover the light bodies.
      { name: "Athletic Heather", hex: "#b0b2ad", ground: "light", variants: [18076, 18077, 18078, 18079, 18080, 18081] },
      { name: "Black", hex: "#17191b", ground: "dark", variants: [18100, 18101, 18102, 18103, 18104, 18105] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [18396, 18397, 18398, 18399, 18400, 18401] },
      { name: "Heather Navy", hex: "#2f3a4c", ground: "dark", variants: [18268, 18269, 18270, 18271, 18272, 18273] },
      { name: "Dark Grey Heather", hex: "#3e4245", ground: "dark", variants: [18148, 18149, 18150, 18151, 18152, 18153] },
    ],
    spec:
      "Bella+Canvas 3001 — 4.2 oz of combed and ring-spun cotton in a 32-single " +
      "knit, so it is light and soft rather than boxy. Side-seamed with taped " +
      "shoulders. Printed direct-to-garment on the chest.",
    care:
      "Unisex sizing, true to size, with a slim-ish cut through the body — size " +
      "up if you want room. Machine wash cold and tumble dry low; the print " +
      "lasts longer inside out.",
  },
  {
    id: "hoodie",
    title: "Hoodie",
    // Independent Trading Co. IND4000, not Gildan 18500. The Gildan is the
    // budget default: 8 oz of 50/50 blend with a one-ply body. The IND4000 is
    // 10 oz of 80/20, jersey-lined hood, twill-taped neck — the hoodie the
    // merchandise trade treats as the quality tier. It also carries a 15 x 10in
    // front canvas against the Gildan's 12.4 x 8.2, which is what lets a square
    // mark print seven inches across on a small instead of under six.
    blueprintId: 2002,
    // SwiftPOD, not Monster Digital, and the reason is stock rather than money:
    // Monster Digital's IND4000 has no black and stops at 2XL. SwiftPOD carries
    // black, runs to 3XL, and adds the back and both sleeves as print areas. It
    // is also 55 cents cheaper on black.
    printProviderId: 39,
    priceCents: 5100,
    taxCode: "txcd_30011000",
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    positions: ["front", "back", "left_sleeve", "right_sleeve", "neck"],
    // The front is 15 x 10in — wider than it is tall, because the pouch takes
    // the rest — so a SQUARE mark is bound by HEIGHT and clamps to 7.15in
    // however much is asked for. Asking 7.5 says "as big as the height allows"
    // and gets there without pretending the extra inch exists.
    placement: { position: "front", widthIn: 7.5, y: 0.5 },
    // Three, and the missing ones are a cost decision made in the open.
    // Measured on 2026-07-28: black is $32.92/$34.16, navy $34.58/$36.74, white
    // $34.58/$35.79 — and every other colour SwiftPOD offers, the heathers and
    // bone and sandstone among them, jumps to $42.35-$42.71 at 2XL and 3XL.
    // That is a different garment's price, and one price per item cannot carry
    // both. Bring one back and the retail has to rise with it.
    colourways: [
      { name: "White", hex: "#f4f4f2", ground: "light", variants: [123996, 123981, 123966, 124011, 123936, 123951] },
      { name: "Black", hex: "#17191b", ground: "dark", variants: [123875, 123859, 123843, 123891, 123811, 123827] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [147880, 147879, 147878, 147881, 147876, 147877] },
    ],
    spec:
      "Independent Trading Co. IND4000 — 10 oz of 80/20 cotton-poly heavyweight " +
      "fleece, which is the weight the good ones are. Jersey-lined hood, " +
      "twill-taped neck, ribbed cuffs and hem, front pouch.",
    care:
      "Unisex sizing and true to size, cut a little roomier than the tee. " +
      "Machine wash cold, tumble dry low. It will soften and not shrink much.",
  },
  {
    id: "sticker",
    title: "Sticker",
    blueprintId: 400,
    // Printify Choice, not SPOKE (provider 1). SPOKE appears in the catalog for
    // this blueprint and rejects creation outright — see REJECTS_CREATION.
    printProviderId: 99,
    priceCents: 320,
    // Vinyl, not apparel. No exemption anywhere applies to it.
    taxCode: "txcd_99999999",
    // Three at a time, and this is arithmetic rather than merchandising.
    // A single sticker costs $2.00 to make and $4.59 to post, so free shipping
    // needs $7.10 just to break even and about $11 to earn anything — an $11
    // price on a $2 object, which is not a store anybody should want to shop in.
    // Quantity of ONE thing is the only postage Printify discounts: three
    // stickers post for $4.77, not $13.77. So three is the unit. $18 for three,
    // posted free, keeps 35.6% and reads as a fair price for what arrives.
    sale: {
      minQuantity: 3,
      why:
        "One sticker costs more to post ($4.59) than to make ($2.00), and free " +
        "shipping on one would need an $11 price tag. Three post for $4.77. " +
        "The three are three STICKERS and not three of one design: every sticker " +
        "here is the same blueprint through the same maker, so postage merges " +
        "across the designs as readily as across copies of one.",
    },
    sizes: ['3" × 3"', '4" × 4"'],
    positions: ["front"],
    // Kiss-cut, so the vinyl takes the shape of the mark. Ask for more than the
    // area holds and `place()` clamps to 94% of it, which is the right answer
    // for a sticker: as large as the sheet allows, whatever shape the mark is.
    placement: { position: "front", widthIn: 2.8, y: 0.5 },
    colourways: [
      { name: "White vinyl", hex: "#f4f4f2", ground: "light", variants: [45750, 45752] },
    ],
    spec:
      "Kiss-cut white vinyl, UV printed and rated for outdoor use — it will " +
      "survive a water bottle, a laptop lid or a car window.",
    care:
      "Three inches or four. Sold in threes, and the three can be three " +
      "different designs: one sticker costs more to post than it does to make, " +
      "and three post for the same as one.",
    closing: null,
  },
  {
    id: "cap",
    title: "Cap",
    // Richardson 112 is already the standard — the cap the trade embroiders when
    // the cap matters. Nothing in the catalog beats it, so the blueprint stayed.
    blueprintId: 1743,
    // Printful rather than Printify Choice. Printify Choice is a routing layer:
    // it picks a partner for you and does not offer Europe at all. Printful is
    // one named embroiderer with its own machines, charges the same $4.89 to
    // post inside the US, opens the EU at $4.59, and costs 19 cents more per
    // cap. On embroidery, where the difference between shops is visible in the
    // stitch, 19 cents is not a decision.
    printProviderId: 410,
    priceCents: 2800,
    // Hats, not general clothing. New York exempts caps the same way it exempts
    // shirts; the specific code is the one that says so in every other state too.
    taxCode: "txcd_30060006",
    sizes: ["One size"],
    positions: ["front"],
    // The embroidery panel is 5.9 x 2in. A SQUARE mark is bound by the second
    // figure and clamps to 1.88in, which is the size a seal wants on a cap
    // front; a bar overrides this in MATRIX and runs most of the panel.
    placement: { position: "front", widthIn: 1.9, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [118722] },
      { name: "Black / Charcoal", hex: "#232628", ground: "dark", variants: [118723] },
      { name: "Black / White", hex: "#1c1f21", ground: "dark", variants: [118724] },
      { name: "Charcoal / Black", hex: "#3b3e40", ground: "dark", variants: [118726] },
    ],
    spec:
      "Richardson 112 — the trucker cap the trade embroiders when the cap " +
      "matters. Structured six-panel front, mesh back, pre-curved visor, " +
      "snapback. Embroidered rather than printed, in black, white and gold thread.",
    care:
      "One size, adjustable. Spot clean; the structured front does not enjoy a " +
      "washing machine.",
  },
  {
    id: "beanie",
    title: "Beanie",
    blueprintId: 1691,
    // Printful, for the cap's reasons and at literally no cost: measured on
    // 2026-07-28, Printful and Printify Choice both charge $14.96 for this
    // beanie and the same $4.89 to post it. Printful adds Europe at $4.59,
    // which Printify Choice does not offer at any price.
    printProviderId: 410,
    priceCents: 2100,
    taxCode: "txcd_30060006",
    sizes: ["One size"],
    positions: ["front"],
    // 5.0 x 1.75in of cuff, so a square mark clamps to 1.645in — smaller than
    // the cap, which is why the beanie carries the two simplest marks in the set.
    placement: { position: "front", widthIn: 1.7, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [116417] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [116425] },
    ],
    spec:
      "Yupoong 1501KC — acrylic knit with a double-layer cuff, embroidered on " +
      "the cuff face.",
    care: "One size. Hand wash cold and lay flat to dry.",
  },
  {
    /* A HOCKEY PUCK, and the answer to "are there any hockey jersey items?".
       There are not: Printify's catalog returns nothing for "hockey jersey" and
       every hit for "jersey" is jersey-KNIT fabric — t-shirts. A real sublimated
       hockey sweater is teamwear, made by a teamwear supplier, and print-on-
       demand does not do it. What Printify does have, from exactly one maker, is
       this: blueprint 1203, a regulation 3-inch puck.
       One variant, one size, one provider. The print area is 795 x 795 px, which
       is 2.65in square at 300 dpi — small, and round, so it takes a badge and
       nothing else. It posts for $7.59, which is most of what it costs. */
    id: "puck",
    title: "Puck",
    blueprintId: 1203,
    printProviderId: 80,
    // An anchor only. The reprice pass sets the real figure from the cost the
    // shop reports — see MARGIN_TARGET.
    priceCents: 2000,
    // Not apparel and not a mug: a puck is general tangible goods.
    taxCode: "txcd_99999999",
    sizes: ['3"'],
    positions: ["front"],
    // 2.65in of canvas, so a square badge clamps to 2.49in. There is no version
    // of this that takes a wide lockup.
    placement: { position: "front", widthIn: 2.5, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [91951] },
    ],
    spec:
      "A regulation three-inch vulcanised rubber puck, printed on one face. " +
      "Six ounces of the only object in this shop that has ever been shot at " +
      "somebody.",
    care: "One size, because a puck is one size. Not for actual use on ice.",
  },
  {
    id: "mug",
    title: "Mug",
    blueprintId: 479,
    // Printify Choice rather than Monster Digital: $7.19/$8.29 against
    // $9.66/$10.31 for the same object posted at the same $8.99, measured on
    // 2026-07-28. A sublimated ceramic mug is a commodity — the coating and the
    // press are the same everywhere, and the quality argument that buys a named
    // embroiderer for the cap buys nothing here. ORCA Coatings, the one actual
    // BRAND in the mug category, was probed and costs $13.08 through the single
    // provider that carries it. That is a $30 mug, and it is not one.
    printProviderId: 99,
    priceCents: 1400,
    // Ceramic. Fully taxable everywhere this shop can post to.
    taxCode: "txcd_99999999",
    sizes: ["11 oz", "15 oz"],
    positions: ["front"],
    // A square mark clamps to 3.40in, and the limit is the 11 oz rather than the
    // 15. The two sizes are not the same SHAPE, so the taller mug is the wider
    // canvas and a scale that fits it overflows the smaller one.
    placement: { position: "front", widthIn: 3.5, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [65217, 104470] },
    ],
    spec:
      "Black ceramic, dye-sublimated on one side. Every mark in this shop was " +
      "drawn on a black field, so on a black mug the drawing and the object " +
      "agree — which is why it is not a white one.",
    care: "Eleven ounces or fifteen. Dishwasher and microwave safe.",
  },
];

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

/**
 * What the club said about itself, recovered from its own site.
 *
 * Every line below is VERBATIM from a game recap in `site.json` — the same
 * corpus the archive is built from — written by whoever was keeping the site in
 * 2012. It is a deadpan sports-desk parody with Shakespeare in it, and it is the
 * best copy anybody is going to write for this shop: nothing invented here could
 * beat a defenceman comparing glory to a circle in the water.
 *
 * The attribution is the player's own name and number as the recap gave it.
 *
 * **Do not write new ones.** The value is that a customer is reading the team,
 * not a marketing department. A quote with no source does not go in this map.
 */
const QUOTES: Record<string, string> = {
  "championship-roundel":
    "“Glory is like a circle in the water, which never ceaseth to enlarge " +
    "itself, till by broad spreading it disperses to naught.” " +
    "— Rich Fedele, defence",
  "heritage-seal":
    "“What a piece of work is a Golden Retriever. How noble in reason, how " +
    "infinite in faculties. In action how like an Angel.” " +
    "— Brett Koeppel, #18",
  "crossed-shield":
    "“The Golden Retrievers are good. Scary Good.” — Justin Wheeler, forward",
  "arched-varsity":
    "On first pulling on the golden jersey: “I’m never taking this off, " +
    "ever.” — Greg Suffoletto, forward",
  "faceoff":
    "“It felt like we were skating in circles, just chasing our tails all " +
    "night.” — Dan Schmitt, defence",
  "mascot-medallion":
    "“I do it well, very well.” — Vinny Terrana, forward, " +
    "after a nine-point game",
  "rink-board":
    "“Crabcakes and Retriever Hockey, that’s what Suffoletto’s do.” " +
    "— Greg Suffoletto, forward",
  "nose-to-nose":
    "“Us Cat’s gotta stick together.” — Brent “The Cat” " +
    "Seymour, goaltender, on letting in a couple against the CLUB Panthers",
  "octagon-patch":
    "“Pain has a structure. It has a floor plan… it is a poem.” " +
    "— Justin Wheeler, forward, playing injured",
};

/* ------------------------------------------------------------------ */
/* 3 — the matrix                                                      */
/* ------------------------------------------------------------------ */

/**
 * One line, one product. Twenty-three lines, twenty-three products.
 *
 * **Nine marks against six items is fifty-four products, and fifty-four is a
 * worse shop than a considered twenty.** So the mark is matched to the garment
 * rather than multiplied by it, and three things decide the pairing.
 *
 * **1 — the SHAPE of the canvas.** These are the smallest each garment offers; a
 * placement is a proportion of it, so the print grows with the size, and
 * `cli.ts sync --dry-run` prints both ends of the range with the dpi at each.
 *
 *   tee front      10.95 x 12.41in portrait   a badge, big, one to a shirt
 *   hoodie front   12.36 x  8.24in LANDSCAPE  a wide lockup; a square mark caps at 7.15in
 *   hoodie back    12.36 x 14.01in portrait   the biggest canvas in the line
 *   cap front       5.90 x  2.00in            EMBROIDERY
 *   beanie front    5.00 x  1.75in            EMBROIDERY, smaller again
 *   mug front       7.76 x  3.62in landscape  a wide lockup, or a 3.4in medallion
 *   sticker        die-cut to the art         whatever shape the mark already is
 *
 * **2 — the ground.** `faceoff` and `octagon-patch` are absent from every dark
 * item and `arched-varsity` from every light one. Not a choice made here:
 * `buildLine()` refuses those pairings and names the reason.
 *
 * **3 — what a needle can hold.** The cap and the beanie are stitched, not
 * printed, and the provider's own mockups are what settled which marks may go on
 * them. A dense badge at 1.88in on a cap panel and 1.64in on a cuff loses its
 * type entirely — the two rings of lettering on the heritage seal and the
 * championship roundel came back as mush, and a cap is the one thing in this
 * shop that is looked at from three feet away. Both now carry only the three
 * WIDE marks, which get 2.9-4.75in of panel and keep their letterforms.
 *
 * Every mark appears at least twice; `rink-board` appears on four items because
 * it is the only one in the set that survives being an inch and a half tall.
 * Every item carries at least two marks.
 *
 * Adding a line creates a DRAFT on the next `sync`. It does not publish
 * anything, and nothing in this package can.
 */
export const MATRIX: MatrixEntry[] = [
  /* Tee — the hero garment. Portrait canvas, DTG, 8in on a small and ~11in on a
     3XL, so this is where a badge gets room to be looked at.

     TWO CAME OFF ON 2026-07-29, both on the captain's eye and one on a
     measurement:

     `octagon-patch` — his call. It is drawn inside a filled black RECTANGLE
     rather than cut out of one, so on a shirt it reads as a slab rather than a
     patch. It stays on the sticker, where a rectangle is what a sticker is.

     `mascot-medallion` — measured. Its gold ring is 74-78px thick on the left,
     right and bottom and 192px at the TOP: two and a half times heavier, in the
     drawing itself, not in our rendering. At 3.4in on a mug that reads as hand
     inked. At eleven inches across a chest it reads as a mistake. It stays on
     the mug and the puck. **Redraw the ring uniformly and it comes back.** */
  { mark: "crossed-shield", item: "tee" },
  { mark: "championship-roundel", item: "tee" },
  { mark: "faceoff", item: "tee" },
  { mark: "heritage-seal", item: "tee" },
  { mark: "nose-to-nose", item: "tee", placement: { widthIn: 9.0 } },
  { mark: "rink-board", item: "tee", placement: { widthIn: 9.5, y: 0.4 } },
  // Wider than the badges and it sits higher: a varsity arch belongs across the
  // chest, not centred on it.
  { mark: "arched-varsity", item: "tee", placement: { widthIn: 9.0, y: 0.4 } },

  /* Hoodie. The front is LANDSCAPE — 11.42 x 7.61in, because the pouch takes
     the rest — so a square badge is capped at 7.15in by height. The back is the
     biggest canvas in the shop and takes what the front cannot.

     `rink-board` came off the hoodie front on the captain's eye: a 3:1 bar
     printed 10.5in wide on a chest is a bumper sticker. It is the best thing in
     the shop on a cap, a beanie and a mug, where wide is the shape of the
     canvas. */
  { mark: "heritage-seal", item: "hoodie" },
  { mark: "crossed-shield", item: "hoodie" },
  { mark: "championship-roundel", item: "hoodie", placement: { position: "back", widthIn: 10.0 } },
  { mark: "arched-varsity", item: "hoodie", placement: { position: "back", widthIn: 10.0, y: 0.45 } },
  { mark: "nose-to-nose", item: "hoodie", placement: { position: "back", widthIn: 10.5, y: 0.45 } },

  /* Cap and beanie — Richardson 112 and Yupoong 1501KC, both EMBROIDERED, and
     that is the constraint rather than the size of the panel. A dense badge
     stitched at under two inches turns its type to mush; `nose-to-nose` proved
     it twice, reading cleanly at 3.6in on a cap and coming back illegible at
     3.2in on a cuff. So the cap takes the three wide marks and the beanie takes
     the widest one only. */
  { mark: "rink-board", item: "cap", placement: { widthIn: 4.75 } },
  { mark: "nose-to-nose", item: "cap", placement: { widthIn: 3.6 } },
  { mark: "arched-varsity", item: "cap", placement: { widthIn: 3.2 } },

  { mark: "rink-board", item: "beanie", placement: { widthIn: 4.4 } },

  /* Mug — landscape, and the widths are smaller than the canvas allows. The
     print area is 7.76in wide but a mug is a CYLINDER: seen head-on only the
     middle four inches face you. `rink-board` at 6.5in came back with the dog
     bisected by the left edge, so the wide marks are sized to the visible face. */
  { mark: "rink-board", item: "mug", placement: { widthIn: 4.5 } },
  { mark: "nose-to-nose", item: "mug", placement: { widthIn: 4.0 } },
  { mark: "mascot-medallion", item: "mug" },
  { mark: "championship-roundel", item: "mug" },

  /* Puck — 2.65in of round canvas on a round object. Badges only, and the two
     that are drawn as seals are the two that belong on it. */
  { mark: "championship-roundel", item: "puck" },
  { mark: "heritage-seal", item: "puck" },
  { mark: "mascot-medallion", item: "puck" },

  /* Sticker — kiss-cut, so the vinyl takes the shape of the mark and every badge
     in the set is already a sticker shape. White vinyl is a light ground, which
     is why `arched-varsity` is not here and the two light-only marks are. */
  { mark: "heritage-seal", item: "sticker" },
  { mark: "championship-roundel", item: "sticker" },
  { mark: "octagon-patch", item: "sticker" },
  { mark: "crossed-shield", item: "sticker" },
  { mark: "faceoff", item: "sticker" },
  { mark: "nose-to-nose", item: "sticker" },
  { mark: "rink-board", item: "sticker" },
];

/* ------------------------------------------------------------------ */
/* Providers that reject creation                                      */
/* ------------------------------------------------------------------ */

/**
 * The catalog advertises print providers that will not accept the product, and
 * there is nothing in the catalog response that predicts it. Each of these was
 * found by trying, and the API's own words are quoted.
 *
 * `store:catalogue` marks them. If another one turns up, the message Printify
 * returned goes here — a provider that failed once is not a provider anyone
 * should have to discover twice.
 */
export const REJECTS_CREATION: { blueprintId: number; printProviderId: number; error: string }[] = [
  {
    blueprintId: 400,
    printProviderId: 1,
    error: "Decorator 1 not available for this blueprint 400",
  },
];

/* ------------------------------------------------------------------ */
/* Building the line                                                   */
/* ------------------------------------------------------------------ */

export const markById = (id: string): Mark | undefined => MARKS.find((m) => m.id === id);
export const itemById = (id: string): Item | undefined => ITEMS.find((i) => i.id === id);

const DEFAULT_CLOSING =
  "Golden Retriever Hockey — Buffalo's premier golden retriever themed hockey " +
  "team since {{firstYear}}.";

/**
 * Turn the three lists into the product line, refusing anything that does not
 * hold together.
 *
 * Every failure names both halves of the pairing and what is wrong with it,
 * because a matrix line is two words and the mistake is never visible in them.
 */
export function buildLine(matrix: MatrixEntry[] = MATRIX): LineItem[] {
  const line: LineItem[] = [];
  const seen = new Set<string>();

  for (const entry of matrix) {
    const mark = markById(entry.mark);
    if (!mark) {
      throw new Error(
        `MATRIX names mark "${entry.mark}", which is not in MARKS. ` +
          `Known marks: ${MARKS.map((m) => m.id).join(", ")}.`,
      );
    }
    const item = itemById(entry.item);
    if (!item) {
      throw new Error(
        `MATRIX names item "${entry.item}", which is not in ITEMS. ` +
          `Known items: ${ITEMS.map((i) => i.id).join(", ")}.`,
      );
    }

    const id = `${mark.id}-${item.id}`;
    if (seen.has(id)) throw new Error(`MATRIX lists ${mark.id} on ${item.id} twice.`);
    seen.add(id);

    const usable = item.colourways.filter((c) => mark.grounds.includes(c.ground));
    if (!usable.length) {
      const offered = [...new Set(item.colourways.map((c) => c.ground))].join(" and ");
      throw new Error(
        `${mark.id} on ${item.id}: the ${item.title.toLowerCase()} is offered on ${offered} ` +
          `bodies and this mark can only sit on ${mark.grounds.join(" or ")}. ` +
          `${mark.groundNote} Add a ${mark.grounds.join("/")} colourway to the item, or drop the line.`,
      );
    }

    for (const c of usable) {
      if (c.variants.length !== item.sizes.length) {
        throw new Error(
          `${item.id}/${c.name}: ${c.variants.length} variant ids for ${item.sizes.length} sizes ` +
            `(${item.sizes.join(", ")}). One id per size, in that order.`,
        );
      }
    }

    const placement = { ...item.placement, ...entry.placement };
    if (!item.positions.includes(placement.position)) {
      throw new Error(
        `${id}: placement position "${placement.position}" is not one the ${item.id} offers ` +
          `(${item.positions.join(", ")}).`,
      );
    }

    /* THE DESCRIPTION IS FOR THE SHOPPER, and it was not until 2026-07-29.
       It used to append the mark's `groundNote` — sentences like "the board is
       black inside a gold edge, so on a dark body the edge is what you see and
       the board becomes the garment". That is design rationale. It explains why
       this repository allows a pairing; it tells somebody deciding whether to
       buy a hoodie nothing at all, and four of them ran together into a
       paragraph that read like a build log. The generated colour sentence went
       with it: the storefront draws swatches and Printify draws a variant
       picker, so spelling out "White. Black and navy." was the page describing
       the control immediately below it.
       `groundNote` stays on the Mark, where it documents the `grounds` list for
       whoever changes it. It is no longer printed. */
    const closing = item.closing === undefined ? DEFAULT_CLOSING : item.closing;

    line.push({
      id,
      title: `${mark.title} — ${item.title}`,
      description: [mark.blurb, item.spec, item.care, QUOTES[mark.id], closing]
        .filter((p): p is string => Boolean(p))
        .join("\n\n"),
      blueprintId: item.blueprintId,
      printProviderId: item.printProviderId,
      priceCents: entry.priceCents ?? item.priceCents,
      colors: usable.map((c) => ({ name: c.name, hex: c.hex, variants: c.variants })),
      sizes: item.sizes,
      placements: [{ ...placement, art: mark.press }],
      ...(item.sale ? { sale: item.sale } : {}),
      taxCode: item.taxCode,
      ...(item.marginTarget === undefined ? {} : { marginTarget: item.marginTarget }),
      claims: entry.claims ?? [],
      markId: mark.id,
      itemId: item.id,
    });
  }

  return line;
}

/**
 * Every image under `docs/logos/`, at any depth, and whether the matrix uses it.
 *
 * The captain asked for a list of logos to pick from. This is that list, taken
 * off disk rather than from a note, so a master that was added and never wired
 * shows up as available instead of being forgotten. It recurses because the
 * directory grows subfolders — `vector/`, `concepts/` — and a scan that only
 * read the two it knew about would quietly stop seeing new work.
 */
export async function marksOnDisk(): Promise<{ path: string; markId: string | null }[]> {
  const wired = new Map(MARKS.map((m) => [m.source.replace(/\\/g, "/"), m.id]));
  const found: { path: string; markId: string | null }[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!/\.(png|svg|pdf|jpg|jpeg|webp)$/i.test(entry.name)) continue;
      found.push({ path, markId: wired.get(path) ?? null });
    }
  }

  await walk(LOGO_SOURCE_DIR);
  return found;
}
