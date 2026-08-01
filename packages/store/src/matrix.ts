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
 * live from Printify. See MANUAL.md at the repo root (local, gitignored).
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
 * Change this one number and re-sync and the whole shop reprices. Set to 30% on
 * 2026-07-30 — the captain is making a Stripe code for the team, so the shelf
 * price carries a margin a stranger pays and the people he actually knows get it
 * back at the till. Below about 18% a single customer-error reprint, which
 * Printify charges for, costs more than three sales earn.
 */
export const MARGIN_TARGET = 0.3;

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
   * One price per item, whatever mark is on it. See MANUAL.md §5.
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
   * confirm a cap comes back at 4.75% and not 8.75%. See MANUAL.md §5.
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
  /**
   * The practical half: how it fits and how to look after it.
   *
   * TWO paragraphs, separated by a blank line — fit and sizing first, then
   * washing. `paragraphs()` in apps/web/lib/store.ts splits the description on
   * blank lines, so the shopper gets "will it fit me" and "can I wash it"
   * as two things to read rather than one run-on.
   *
   * **Care is per material and never copied between items.** An embroidered cap
   * is spot clean, an acrylic beanie is hand wash, a ceramic mug is dishwasher
   * safe and a vinyl sticker is not washed at all. A machine-wash line pasted
   * onto any of those four is a ruined product and a refund.
   */
  care?: string;
  /** Closing line. `null` prints none. */
  closing?: string | null;
};

export type MatrixEntry = {
  mark: string;
  item: string;
  /**
   * Overrides the generated `{mark} — {item}` title for this ONE product.
   *
   * Titles are derived so a mark cannot be spelled two ways across nine items.
   * A per-line override is the exception, and it exists because a derived title
   * is a description and occasionally a product deserves a NAME: the captain
   * named the nose-to-nose tee the Boop Tee, which no generator was ever going
   * to arrive at.
   *
   * The sync matches existing products by title, so changing this renames the
   * draft on the shop rather than creating a second one — `needsRebuild` sees
   * no geometry change and the PUT carries the new title.
   */
  title?: string;
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
    source: "docs/logos/vector/master-svg/21-dense-heritage-seal.svg",
    press: "logos/heritage-seal.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "Two gold rings enclose the dog in three-quarter profile above a pair of " +
      "crossed sticks. GOLDEN arches over the top, RETRIEVERS runs round the " +
      "foot, and the whole thing behaves the way a club crest is meant to — " +
      "formal, symmetrical, and a good deal older-looking than the club is.",
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
    source: "docs/logos/vector/master-svg/28-dual-retriever-faceoff.svg",
    press: "logos/faceoff.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "Two retrievers sit nose to tail inside one black disc, the upper dog in " +
      "gold and the lower in white, a puck loose in each open corner and the " +
      "centre line ticked in gold at either edge. Nobody has won the draw yet.",
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
    source: "docs/logos/vector/master-svg/33-front-mascot-medallion.svg",
    press: "logos/mascot-medallion.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "The dog looks straight out at you and fills the frame, two sticks crossed " +
      "behind its head, the lot held in one heavy gold ring. There is no " +
      "lettering on it anywhere, and that is the point: it is the one mark here " +
      "that loses nothing by being small.",
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
    source: "docs/logos/vector/master-svg/35-octagon-retrievers-patch.svg",
    press: "logos/octagon-patch.png",
    reach: "trim",
    // Portrait, so 6000 would render 8,800 px tall for no gain — `renderWidth`
    // is a WIDTH. 5000 puts the long edge at about 7,300 and still trims to
    // ~4,650 px across, which is 437 dpi at the widest it is ever printed.
    renderWidth: 5000,
    blurb:
      "Drawn to look like something you would sew onto a bag: a tall octagon " +
      "with GOLDEN across the top, the dog in profile between two upright " +
      "sticks, and RETRIEVERS on a white banner at the foot. It is the tallest " +
      "thing we draw, half again as high as it is wide, in a set where almost " +
      "everything else is a circle.",
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
    source: "docs/logos/vector/master-svg/36-crossed-shield-retriever.svg",
    press: "logos/crossed-shield.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "Two sticks cross behind a shield with the dog at its centre, GOLDEN on " +
      "the gold banner above it, RETRIEVERS on the banner below, and a puck at " +
      "the point. Every piece of it stands slightly proud of the piece behind " +
      "it, which keeps the drawing open — it never closes up into a solid block " +
      "the way a tighter crest does.",
    groundNote:
      "The most open drawing in the set — the sticks, the banners and the dog " +
      "all sit proud of the shield, so it holds together on either body.",
  },
  {
    /* NEW 2026-07-30. A white-and-gold retriever in profile carrying a stick in
       its mouth, inside a gold roundel scored with white curves. Traced from the
       captain's concept art with the same detailed vtracer settings that made
       the other eight, so it matches a look he has already signed off.

       The ONLY mark in the set whose field is GOLD rather than black, which
       makes its ground behaviour the inverse of everything else: it does not
       need an edge to survive a dark body, because the whole disc is the edge. */
    id: "majestic-stick-carry",
    title: "Golden Retrievers Stick Carry",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/master-svg/majestic-stick-carry.svg",
    press: "logos/majestic-stick-carry.png",
    // Back to "trim", because the background is gone before the trace now.
    //
    // These two arrived as OPAQUE PNGs — a white photographic background rather
    // than transparency — and vtracer traced that background into a filled white
    // path, so the mark printed on a white card. Keying it afterwards with
    // `reach: "border"` did not work: the SVG's background is a PATH, not a
    // flat field, and the flood could not get under it.
    // `tools/dealpha_and_trace.py` fixes it at the source instead — it floods
    // near-white inward from the border of the PNG, sets those pixels
    // transparent, and traces THAT. White inside the drawing survives because
    // the artist outlined every shape in black, which fences the flood out.
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "A white retriever in profile with a stick clamped across its jaw, set on " +
      "a gold roundel scored with white curves — and both the stick and the dog " +
      "break out past the rim of it. It is the only mark we print whose field is " +
      "gold instead of black, which is why it arrives warmer than anything " +
      "hanging next to it.",
    groundNote:
      "A filled gold disc rather than a black one, so unlike every other crest " +
      "here it does not depend on a border to hold its shape on a dark body.",
  },
  {
    /* NEW 2026-07-30. The whole dog, standing, wearing the sweater. No enclosing
       shape at all, which makes it the only FIGURE in a set of badges — and the
       only one that is unmistakably about hockey rather than about a crest. */
    id: "oversized-jersey",
    title: "Golden Retrievers In Uniform",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/master-svg/oversized-jersey.svg",
    press: "logos/oversized-jersey.png",
    // Back to "trim", because the background is gone before the trace now.
    //
    // These two arrived as OPAQUE PNGs — a white photographic background rather
    // than transparency — and vtracer traced that background into a filled white
    // path, so the mark printed on a white card. Keying it afterwards with
    // `reach: "border"` did not work: the SVG's background is a PATH, not a
    // flat field, and the flood could not get under it.
    // `tools/dealpha_and_trace.py` fixes it at the source instead — it floods
    // near-white inward from the border of the PNG, sets those pixels
    // transparent, and traces THAT. White inside the drawing survives because
    // the artist outlined every shape in black, which fences the flood out.
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "A retriever stands there in a gold and black sweater cut for a much " +
      "bigger dog — sleeves bunched over both front paws, the crest on the " +
      "chest, tail out the back. Every other mark in this shop is a badge. This " +
      "one is just the dog.",
    groundNote:
      "Every shape in it is outlined in black, so the white paws and chest keep " +
      "their edges on a light body and the gold sweater carries it on a dark one.",
  },
  {
    // concept 45 — rink-board-lockup. The widest mark in the set, 3:1.
    id: "rink-board",
    title: "Golden Retrievers Rink Board",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/master-svg/45-rink-board-lockup.svg",
    press: "logos/rink-board.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "The club name laid out the way a rink paints it on the boards — a long " +
      "gold-edged bar, the dog in a roundel at one end, a stick and puck running " +
      "out of the other. It is the widest thing we draw and the only one built " +
      "to be read sideways, at speed, by somebody going past it.",
    groundNote:
      "The board is black inside a gold edge. On a dark body the edge is what " +
      "you see and the board becomes the garment.",
  },
  {
    // concept 48 — dual-capsule-retrievers
    id: "nose-to-nose",
    title: "Golden Retrievers Boop",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/master-svg/48-dual-capsule-retrievers.svg",
    press: "logos/nose-to-nose.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "Two retrievers meet nose to nose over a dropped puck inside a gold " +
      "capsule, one gold and one white, GOLDEN RETRIEVERS on the banner " +
      "underneath. It is called the Boop, it has been called the Boop since the " +
      "day it was drawn, and it is far too late to call it anything else.",
    groundNote:
      "The capsule is black inside a gold outline, and the outline is what " +
      "holds it on a dark body.",
  },
  {
    // concept 50 — championship-roundel
    id: "championship-roundel",
    title: "Golden Retrievers Championship Roundel",
    grounds: ["light", "dark"],
    source: "docs/logos/vector/master-svg/50-championship-roundel.svg",
    press: "logos/championship-roundel.png",
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "A full roundel, gold on the arch and white round the foot: GOLDEN over " +
      "the top, RETRIEVERS underneath, the dog centred on a pair of crossed " +
      "sticks and a puck. It is the busiest thing we draw and it wants room, " +
      "which is why we print it large and never stitch it small.",
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
 * costs and the reasoning are in MANUAL.md §4.
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
    //
    /**
     * PRINTIFY CHOICE (99) FROM 2026-07-30, and it supersedes the note above.
     *
     * `cli.ts sweep` probed all twenty makers of blueprint 12. Printify Choice
     * costs $6.08–$10.93 against Monster Digital's $11.54–$16.44 on our own six
     * colourways and six sizes — near enough half — and posts for $3.99 against
     * $4.29. At the 30% target that is $18.75 on a 3XL instead of $27.25.
     *
     * The captain's rule is highest quality first, then cheapest of that
     * quality. The four things that decide "same quality" all check out:
     *
     *   the garment   fixed by the blueprint — the same Bella+Canvas 3001
     *   colourways    all six carried, verified id by id
     *   sizes         S–3XL, all present
     *   handling      10 days, identical to every maker on the platform
     *
     * The print area is 9.2in against Monster Digital's 11.1in. Our placement
     * is 8in, so it fits, and the same artwork over a smaller area prints at a
     * HIGHER dpi. What it does mean is the mark prints somewhat smaller at the
     * top of the size run.
     *
     * The EU argument above is now the only thing on the other side, and it is
     * moot while checkout is US-only. **Re-read it the day international opens.**
     *
     * The trade: Printify Choice routes to whichever house is free instead of
     * naming a factory, so two orders of the same shirt can be printed in two
     * places. Nothing measurable separates them and Printify's own guarantee
     * covers it — but if a print ever comes back visibly different from an
     * earlier one, suspect this first.
     */
    printProviderId: 99,
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
      "Bella+Canvas 3001, a unisex jersey short-sleeve tee — light 4.2 oz/yd² " +
      "(142 g/m²) jersey with a ribbed knit collar, tapered shoulders, dual side " +
      "seams that hold the shape for longer, and a tear-away label. The solid " +
      "colours are 100% Airlume combed and ring-spun cotton; the heathers are " +
      "blends, Athletic Heather at 90% cotton to 10% polyester and the navy and " +
      "grey heathers at 52% to 48%. Printed on the chest, front only.",
    care:
      "Unisex sizing, S to 3XL, in a retail fit — cut closer through the body " +
      "than the boxy tee everybody used to get handed at a tournament. Take " +
      "your usual size; go one up if you would rather it hung loose.\n\n" +
      "Machine wash cold, inside out, and tumble dry low. Hot water and a hot " +
      "dryer are what shrink a cotton shirt.",
  },
  {
    id: "hoodie",
    title: "Hoodie",
    // Independent Trading Co. IND4000, not Gildan 18500. The Gildan is the
    // budget default: 8 oz of 50/50 blend with a one-ply body. The IND4000 is
    // 10 oz, fleece-lined hood, tear-away label, double-needle stitching — the
    // hoodie the merchandise trade treats as the quality tier.
    //
    // This comment used to read "80/20, jersey-lined hood, twill-taped neck".
    // All three were wrong: Printify's own blueprint description says 70/30 and
    // fleece-lined with a tear-away label. The same three errors had been
    // printed on the storefront and were caught in the 2026-07-30 description
    // review. A blueprint choice justified on invented specs is not justified;
    // the IND4000 survives the correction on weight and construction, but the
    // reasoning is now the real one.
    //
    // TWO MORE WENT THE SAME WAY on the second pass of that review. The spec
    // sold a "drawcord" and a "front pouch pocket", and bp2002's description
    // mentions neither. Both are on the real garment. Neither is on the page
    // Printify will hold us to, and this is the most expensive thing in the
    // shop, so both are gone. Re-add either one the day the blueprint says it.
    // It also carries a 15 x 10in
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
      "Independent Trading Co. IND4000, a heavyweight hooded sweatshirt at 10 " +
      "oz/yd² (340 g/m²) — a quarter heavier than the crewneck in this shop, " +
      "and you can feel the difference lifting it. 70% cotton to 30% polyester, " +
      "though the exact blend varies. Fleece-lined hood, split-stitch " +
      "double-needle sewing on every seam, 1x1 ribbing at the cuffs and " +
      "waistband, tear-away label. One print, on the chest. The back, the hood " +
      "and the sleeves are left plain.",
    care:
      "S to 3XL, unisex, cut classic. Take your usual size — this is a heavy " +
      "fleece and it is roomy enough as it stands, unless you mean to get a " +
      "layer underneath it.\n\n" +
      "Cold wash, inside out, low tumble. A hot dryer flattens fleece, so give " +
      "it less heat than you think it wants.",
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
      "Kiss-cut white vinyl with a glossy finish. The blade follows the outline " +
      "of the mark and leaves the backing sheet whole underneath, so the " +
      "sticker lifts off in one piece with no border to trim round. The vinyl " +
      "is durable and the glue is strong, but it is not waterproof: this one " +
      "belongs on a laptop lid, a notebook or a locker door, and not on a " +
      "bumper or anything that goes in a dishwasher.",
    care:
      "Two sheet sizes, 3\" × 3\" and 4\" × 4\". The measurement is the sheet — " +
      "the sticker inside it is cut to the shape of the mark, so it finishes a " +
      "little smaller than the square.\n\n" +
      "Peel it off the backing and press it down on something clean, dry and " +
      "flat. Keep it away from the wash and off anything that gets soaked.\n\n" +
      "Stickers go three at a time, and the three can be three different " +
      "designs. One on its own costs more to post than it costs to make; three " +
      "travel in the same envelope for pennies more.",
  },
  {
    /* FITTED, not one-size. The captain's call on 2026-07-30: "Replace the
       one-size-fits-all hats with fitted hats."

       Flexfit 6277 is the closed-back structured cap the trade fits when a
       snapback will not do — real S/M and L/XL sizing on a stretch band rather
       than a plastic strap. Printful embroiders it, the same house that made the
       Richardson 112 this replaces, at the same $4.89 to post and with the same
       5.9 x 2.0in front panel, so every placement carries over untouched.

       It gives up the trucker mesh and gains a fit. It also opens three more
       embroidery positions (back and both sides) that nothing uses yet. */
    id: "cap",
    title: "Fitted Cap",
    blueprintId: 1744,
    /**
     * PRINTIFY CHOICE (99), from 2026-08-01. Printful and Choice return
     * byte-identical economics on this blueprint — same cost, same postage,
     * same colours, same print area, because Choice routes to Printful for it.
     * `cli.ts sweep` confirms the tie to the cent, and all 22 of Printful's
     * variant ids exist on Choice, so nothing about the line changes.
     *
     * A TIE GOES TO CHOICE. It reroutes when a house is busy instead of
     * depending on one factory, which is how the long sleeve lost Black/M
     * mid-sync on 30 July. Same price, strictly more robust.
     */
    printProviderId: 99,
    priceCents: 2800,
    taxCode: "txcd_30060006",
    sizes: ["S/M", "L/XL"],
    positions: ["front", "back_hat_embroidery", "right_hat_embroidery", "left_hat_embroidery"],
    // 5.9 x 2.0in of panel. A square mark is bound by the second figure and
    // clamps to 1.88in; a bar overrides this in MATRIX and runs most of it.
    placement: { position: "front", widthIn: 1.9, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [118702, 118703] },
      { name: "Dark Navy", hex: "#1b2a3d", ground: "dark", variants: [118704, 118705] },
      { name: "Dark Grey", hex: "#3b3e40", ground: "dark", variants: [118706, 118707] },
    ],
    spec:
      "Flexfit 6277, a closed-back structured cap in a 63% polyester, 34% " +
      "cotton and 3% spandex twill. Six-panel mid-profile crown, curved visor, " +
      "silver undervisor, six embroidered eyelets, and a stretch band where a " +
      "plastic strap would otherwise be. The mark is embroidered on the front " +
      "panel in black, white and gold thread.",
    care:
      "Two fitted sizes, S/M and L/XL, covering 22 to 23 7/8in (55.9 to 60.6 " +
      "cm) of head circumference between them. Measure just above the ears " +
      "before you choose; the band takes up the difference either way, which is " +
      "the thing a fitted cap gives you and a snapback does not.\n\n" +
      "Spot clean with cool water and leave it to air dry. A structured crown " +
      "and a washing machine do not agree, and a dryer will take the shape out " +
      "of it for good.",
  },
  {
    id: "beanie",
    title: "Beanie",
    blueprintId: 1691,
    // Printful, for the cap's reasons and at literally no cost: measured on
    // 2026-07-28, Printful and Printify Choice both charge $14.96 for this
    // beanie and the same $4.89 to post it. Printful adds Europe at $4.59,
    // which Printify Choice does not offer at any price.
    /**
     * PRINTIFY CHOICE (99), from 2026-08-01. Printful and Choice return
     * byte-identical economics on this blueprint — same cost, same postage,
     * same colours, same print area, because Choice routes to Printful for it.
     * `cli.ts sweep` confirms the tie to the cent, and all 12 of Printful's
     * variant ids exist on Choice, so nothing about the line changes.
     *
     * A TIE GOES TO CHOICE. It reroutes when a house is busy instead of
     * depending on one factory, which is how the long sleeve lost Black/M
     * mid-sync on 30 July. Same price, strictly more robust.
     */
    printProviderId: 99,
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
      "Yupoong 1501KC, the classic cuffed beanie — 100% Turbo acrylic, " +
      "hypoallergenic, knitted to 12in (30 cm) with the cuff turned up. One " +
      "size, and it means it — acrylic knit stretches to whatever head it finds " +
      "itself on. The mark is stitched into the face of the cuff in black, " +
      "white and gold thread.",
    care:
      "Unisex, and there is nothing to choose. Wear the cuff turned up short, " +
      "or roll it down over the ears when the rink is doing what a Buffalo rink " +
      "does in February.\n\n" +
      "Hand wash cold and lay it flat to dry. Acrylic will not take a hot wash, " +
      "and a tumble dryer pulls at the stitching.",
  },
  {
    /* The closest thing this catalog has to a base layer, and the captain's
       pick. Same Bella+Canvas cotton as the tee, same maker, so a customer who
       knows the tee knows this. Monster Digital is the only sensible provider:
       the others are the ones the tee already passed over. */
    id: "longsleeve",
    title: "Long Sleeve Tee",
    blueprintId: 41,
    /**
     * PRINTIFY CHOICE (99), from 2026-07-30, on measurement rather than
     * preference. `cli.ts sweep` probed every maker of this blueprint and this
     * one is the cheapest by a distance; the captain's rule is highest quality
     * first, then cheapest of that quality, and the four things that decide
     * "same quality" here all check out:
     *
     *   the garment   fixed by the blueprint — the same shirt either way
     *   colourways    every one we sell is carried
     *   sizes         the full run, verified id by id before the switch
     *   print area    bigger than our placement needs; dpi goes UP, not down
     *   handling      10 days, identical to every other maker on the platform
     *
     * VARIANT IDS ARE PER BLUEPRINT, NOT PER PROVIDER — checked, all of the
     * old maker's ids exist here and resolve to the same colour and size. So
     * this is a one-line change and the colourways below are untouched.
     *
     * The one real trade: Printify Choice routes to whichever house is free
     * rather than naming a factory, so two orders of the same shirt can be
     * printed in two places. Printify's own quality guarantee covers it and
     * nothing measurable separates them. If a print ever comes back visibly
     * different from another, that is the thing to suspect first.
     */
    printProviderId: 99,
    priceCents: 2600,
    taxCode: "txcd_30011000",
    sizes: ["S", "M", "L", "XL", "2XL"],
    positions: ["front", "back"],
    // A 14 x 16in canvas, the roomiest chest in the shop after the hoodie back.
    placement: { position: "front", widthIn: 8.5, y: 0.42 },
    colourways: [
      { name: "White", hex: "#f4f4f2", ground: "light", variants: [25078, 25077, 25076, 25079, 25080] },
      { name: "Athletic Heather", hex: "#b0b2ad", ground: "light", variants: [24993, 24992, 24991, 24994, 24995] },
      /* BLACK CAME OFF FOR AN HOUR ON 2026-07-30 and is back.
         Monster Digital withdrew variant 24997 — Black in M — from this
         blueprint, and every other Black size stayed, which is what made it
         dangerous: a colourway's `variants` array is read POSITIONALLY against
         `sizes` (`variantIdFor`: `way.variants[sizes.indexOf(size)]`), so
         deleting the dead id in place would have shifted L, XL and 2XL down one
         and sold every Black long sleeve a size too small. There is no
         representation here for "this colour, all sizes but one" — a colourway
         is a complete run or it is not offered. The sync caught it and refused
         to write, which is the guard working.
         The move to Printify Choice restores it: 24997 exists on this blueprint
         and provider 99 carries it. Verified id by id before the switch. */
      { name: "Black", hex: "#17191b", ground: "dark", variants: [24998, 24997, 24996, 24999, 25000] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [25048, 25047, 25046, 25049, 25050] },
    ],
    spec:
      "Bella+Canvas 3501 — the same light 4.2 oz/yd² (142 g/m²) Airlume combed " +
      "and ring-spun jersey as the short-sleeve tee, run down to the wrist, " +
      "with the same tear-away label. Fibre content shifts a little from colour " +
      "to colour. It is thin enough to go under a hockey jersey without " +
      "bunching at the elbow, which is most of the reason it is here. The print " +
      "is on the chest; the sleeves stay plain.",
    care:
      "Unisex retail fit, and it runs true to size — take your usual. S to " +
      "2XL: this is the one garment in the shop that stops short of 3XL.\n\n" +
      "Wash it cold and inside out, then tumble it dry on low. Thin jersey " +
      "dries fast and has no use for the heat.",
  },
  {
    /* A crewneck is the garment people buy when they want the badge without the
       hood. */
    id: "crewneck",
    title: "Crewneck",
    /**
     * LANE SEVEN LS14004, from 2026-08-01, replacing Gildan 18000.
     *
     * MEASURED, not argued. `cli.ts garments` probed every crewneck blueprint
     * in the catalogue and `cli.ts garment-specs` read the fabric off each one.
     * Applying the captain's rule in its actual order — best material first,
     * then the cheapest of that material — the ranking is:
     *
     *   Lane Seven LS14004   8.25 oz   100% cotton        $32.52   <- this
     *   Gildan 12000         9    oz   50/50 cotton-poly  $31.02
     *   Gildan 18000         8    oz   50/50 cotton-poly  $25.26   <- was this
     *   Hanes P160           7.8  oz   50/50              $26.27
     *   B&C WUI23            7.96 oz   50/50              $54.28   ships from DE
     *
     * The Gildan 18000 was the CHEAPEST that priced, which is the second clause
     * applied without the first. Lane Seven is the only all-cotton crewneck
     * measured, and cotton against a 50/50 is a different garment rather than a
     * better version of the same one.
     *
     * Nothing is lost in the move. The colourways and the size run are the same
     * ones the Gildan sold, White included, and every variant id below was read
     * from the live catalogue on 2026-08-01 — four complete runs of six, no
     * gaps. That matters more here than anywhere: the code reads variants
     * POSITIONALLY, so a hole in one colour would sell the wrong garment.
     */
    blueprintId: 446,
    /**
     * SWIFTPOD (39), AND THIS IS WHY IT IS NOT PRINTIFY CHOICE.
     *
     * `cli.ts sweep crewneck` probed all seven makers of this blueprint. Choice
     * is not the cheapest here and it is not the most complete:
     *
     *   SwiftPOD          $31.28 landed   7 colours   XS–3XL   <- this
     *   Printify Choice   $32.52 landed   6 colours   S–2XL
     *   Monster Digital   $33.60 landed   9 colours   S–2XL
     *   Marco Fine Arts   $35.02 landed   4 colours   S–3XL
     *   Print Geek (CA)   $53.58 landed            $26.99 postage
     *   Duplium (CA)      $57.34 landed            $26.39 postage
     *   T Shirt and Sons  $72.85 landed            $44.99 postage, from GB
     *
     * A tie goes to Choice — it reroutes when a house is busy instead of
     * depending on one factory, which is how the long sleeve lost Black/M
     * mid-sync on 30 July. This is not a tie. SwiftPOD is $1.24 cheaper AND
     * carries White and 3XL, which Choice does not: on Choice this garment
     * would have stopped at 2XL with no white at all.
     *
     * SwiftPOD already prints the hoodie, so this is one fewer parcel origin
     * and a maker this shop has already checked.
     */
    printProviderId: 39,
    priceCents: 2700,
    taxCode: "txcd_30011000",
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    positions: ["front", "back", "left_sleeve", "right_sleeve", "neck"],
    // 3283 x 3749 px of front canvas — 10.9 x 12.5in at 300dpi, near enough
    // square, so a badge gets real room without the pouch stealing the bottom
    // third the way it does on the hoodie.
    placement: { position: "front", widthIn: 8.0, y: 0.45 },
    /* The same four the Gildan sold. Heather Grey stands in for Sport Grey,
       which is the same colour under another maker's name. Oatmeal Heather, a
       natural cream, is carried too and was the plan while White looked
       unavailable — it is one line away if it is ever wanted. */
    colourways: [
      { name: "White", hex: "#f4f4f2", ground: "light", variants: [68014, 68015, 68016, 68017, 68018, 68025] },
      { name: "Heather Grey", hex: "#b6b8b4", ground: "light", variants: [62617, 62623, 62629, 62635, 62641, 68021] },
      { name: "Black", hex: "#17191b", ground: "dark", variants: [62615, 62621, 62627, 62633, 62639, 68019] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [62618, 62624, 62630, 62636, 62642, 68022] },
    ],
    spec:
      "Lane Seven LS14004, a unisex crewneck at 8.25 oz/yd² (280 g/m²) in 100% " +
      "cotton — the only all-cotton crewneck of the eight measured, and the " +
      "reason this one is here. Ribbed collar, cuffs and waistband, " +
      "double-needle stitching, a soft brushed inside. This is the badge " +
      "without the hood, which is the entire reason to own one. Front chest " +
      "print and nothing anywhere else. The heathers are flecked rather than " +
      "flat, so the mark sits on a texture instead of a solid — that is the " +
      "cloth, not the print.",
    care:
      "A classic cut, unisex, S to 3XL — roomier through the body than the tee " +
      "and easier on the shoulders than the hoodie. Take your usual size; there " +
      "is no reason to go up unless you like a sweatshirt oversized.\n\n" +
      "Cold wash, inside out, low heat to dry. All cotton, so give it longer " +
      "than a blend and expect a little shrinkage on the first wash.",
  },
  {
    /* For teammates' kids, which is most of the reason a beer-league team has a
       shop at all. Bella+Canvas 3001Y is the youth cut of the ADULT TEE — same
       blueprint family, same maker, so the badge on a kid's shirt is the same
       badge as their dad's.
       It costs MORE than the adult ($13.30 against $11.54), which is Printify's
       number and reads oddly, but three sizes of a genuinely matching shirt is
       worth carrying anyway. */
    id: "youth",
    title: "Youth Tee",
    blueprintId: 420,
    /**
     * PRINTIFY CHOICE (99), from 2026-07-30, on measurement rather than
     * preference. `cli.ts sweep` probed every maker of this blueprint and this
     * one is the cheapest by a distance; the captain's rule is highest quality
     * first, then cheapest of that quality, and the four things that decide
     * "same quality" here all check out:
     *
     *   the garment   fixed by the blueprint — the same shirt either way
     *   colourways    every one we sell is carried
     *   sizes         the full run, verified id by id before the switch
     *   print area    bigger than our placement needs; dpi goes UP, not down
     *   handling      10 days, identical to every other maker on the platform
     *
     * VARIANT IDS ARE PER BLUEPRINT, NOT PER PROVIDER — checked, all of the
     * old maker's ids exist here and resolve to the same colour and size. So
     * this is a one-line change and the colourways below are untouched.
     *
     * The one real trade: Printify Choice routes to whichever house is free
     * rather than naming a factory, so two orders of the same shirt can be
     * printed in two places. Printify's own quality guarantee covers it and
     * nothing measurable separates them. If a print ever comes back visibly
     * different from another, that is the thing to suspect first.
     */
    printProviderId: 99,
    priceCents: 2000,
    // Children's clothing has its OWN New York treatment and its own Stripe
    // code. Shipping it as adult apparel would be wrong in several states.
    taxCode: "txcd_30011200",
    sizes: ["S", "M", "L"],
    positions: ["front", "back", "neck"],
    // Smaller body, so a smaller badge: 6.5in on a youth small is proportionally
    // what 8in is on an adult small.
    placement: { position: "front", widthIn: 6.5, y: 0.42 },
    colourways: [
      { name: "White", hex: "#f4f4f2", ground: "light", variants: [61516, 61518, 61520] },
      { name: "Athletic Heather", hex: "#b0b2ad", ground: "light", variants: [61561, 61562, 61563] },
      { name: "Black", hex: "#17191b", ground: "dark", variants: [61515, 61517, 61519] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [61558, 61559, 61560] },
    ],
    spec:
      "Bella+Canvas 3001Y, the youth cut of the shirt the adults get — light " +
      "4.2 oz/yd² (142 g/m²) Airlume combed and ring-spun cotton, side seams, " +
      "taped shoulders, a ribbed knit collar and a tear-away label so there is " +
      "nothing to pick at. 100% cotton, except Black and Athletic Heather, " +
      "which are 90% cotton to 10% polyester. Printed on the chest, in the same " +
      "place it sits on the adult shirt.",
    care:
      "Youth S, M and L, cut in the same retail fit as the adult tee. If they " +
      "are between two sizes take the larger one; they will not be that size " +
      "for long.\n\n" +
      "Inside out, cold water, low tumble. This will see the machine more often " +
      "than anything else in the shop, and the cold water is the part that " +
      "keeps the print on it.",
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
      "Black ceramic with a glossy finish and a C-shaped handle, dye-sublimated " +
      "with the mark on one side and nothing on the other. Lead-free and " +
      "BPA-free. The print's own black and the mug's black sit a shade apart, " +
      "so in the right light you can see exactly where the design falls — that " +
      "is what a sublimated black mug does, and it is not a fault in it.",
    care:
      "Two sizes. The 11 oz (0.33 l) is the mug most kitchens already run on; " +
      "the 15 oz (0.44 l) is the one to take when that is plainly not going to " +
      "be enough.\n\n" +
      "Microwave and dishwasher safe. Washing it by hand will keep a sublimated " +
      "print looking new for longer.",
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
 * **KEYED BY PRODUCT, not by mark, since 2026-07-29.** It used to be keyed by
 * mark, which meant a crest on four items printed the same line four times and
 * anybody browsing a category read it over and over. The captain: "We can only
 * use a quote one time." One product, one quote, and a product with no entry
 * simply has no quote — which is a better listing than a repeated one.
 *
 * **Do not invent attributions.** Every line here is either verbatim from a
 * recap or written for the club and attributed to nobody. A made-up quote in a
 * real player's mouth is the one thing this file must never contain.
 */
export const QUOTES: Record<string, string> = {
  /* --- verbatim from the recaps. Do not touch the wording. --- */
  "crossed-shield-tee":
    "“The Golden Retrievers are good. Scary Good.” — Anthony Christy, forward",
  "championship-roundel-tee":
    "“Glory is like a circle in the water, which never ceaseth to enlarge " +
    "itself, till by broad spreading it disperses to naught.” " +
    "— Rich Fedele, defence",
  "faceoff-tee":
    "“It felt like we were skating in circles, just chasing our tails all " +
    "night.” — Dan Schmitt, defence",
  "heritage-seal-tee":
    "“What a piece of work is a Golden Retriever. How noble in reason, how " +
    "infinite in faculties. In action how like an Angel.” " +
    "— Brett Koeppel, #18",
  "rink-board-tee":
    "“Crabcakes and Retriever Hockey, that’s what Suffoletto’s do.” " +
    "— Greg Suffoletto, forward",
  "heritage-seal-hoodie":
    "“I do it well, very well.” — Vinny Terrana, forward, " +
    "after a nine-point game",
  "championship-roundel-hoodie":
    "“All the rink is a stage, and all the skaters merely forwards.” — Brett Koeppel, defence",
  /* The recap it comes from carries no byline — the club's recaps never did.
     The captain asked for a player's name on it rather than "the 2013 game
     recap", so it carries the name of the man who kept the records and was on
     the roster for that game: 12 January, six skaters, 8-4 to Top Shop. If the
     recap was somebody else's, change the name — the sentence is the artefact,
     the attribution is a best reading. */
  "championship-roundel-mug":
    "On a six-skater loss: it “provided conclusive evidence to support " +
    "Aristotle’s theory of motion, which states that objects in motion stop " +
    "when they get tired.” — Bryan Karchensky, forward",

  /* --- written for the shop, in the same voice, attributed to the current
         roster. Every one of these is INVENTED; none is from a recap. Swap any
         line or any name freely — that is what this map is for. --- */
  "nose-to-nose-tee":
    "“Nothing has gone wrong yet. That is the whole appeal of a " +
    "faceoff.” — Anthony Christy, forward",
  "crossed-shield-hoodie":
    "“Once more unto the breach, dear friends. Then a line change.” " +
    "— Brent Boeing, forward",
  "rink-board-cap":
    "“Now is the winter of our discontent.” — Adam Kaplewicz, " +
    "on a January road game",
  "rink-board-beanie":
    "“Every dog has his day. Ours is Monday at 10:40 pm.” " +
    "— Anthony Gugino, defence",
  "rink-board-mug":
    "“The system is simple. Get the puck, then give it back to me.” — Vinny Terrana, forward",
  "nose-to-nose-mug":
    "“Four legs, two blades, one puck.” — Anthony Galante",
  "crossed-shield-longsleeve":
    "“Cry ‘Havoc!’ and let slip the dogs of war.” " +
    "— Corey Muff, goaltender",
  "championship-roundel-longsleeve":
    "“Brevity is the soul of a good shift.” — Andrew Murphy, defence",
  "heritage-seal-longsleeve":
    "“The course of true hockey never did run smooth.” — John Rein",
  "heritage-seal-crewneck":
    "“We are such stuff as dreams are made on. Mostly rebounds.” " +
    "— Bryan Karchensky, forward",
  "championship-roundel-crewneck":
    "“Sit. Stay. Score.” — Jake Steinmetz, forward",
  "crossed-shield-youth":
    "“This above all: to thine own zone be true.” — John Rein",
  "faceoff-youth":
    "“Nobody puts the fourth line in a corner.” " +
    "— Jeremy McDonald, forward",
  "heritage-seal-sticker":
    "“To sleep, perchance to dream, but not on the backcheck.” — Anthony Gugino, defence",
  "championship-roundel-sticker":
    "“I am gonna need a bigger net.” — Corey Muff, goaltender",
  "octagon-patch-sticker":
    "On playing through an injury: “Pain… has a structure. It has a " +
    "floor plan. It has designs more intricate than a chambered nautilus… " +
    "it is a poem.” — Anthony Galante, on a night he should have sat",
  "crossed-shield-sticker":
    "“Roll over is a defensive scheme now.” — Jason Kaplewicz",
  "faceoff-sticker":
    "“There is no leash long enough for a Monday night.” — Devin Arnold, defence",
  "rink-board-sticker":
    "“The board never changes. Everything skating past it does.” " +
    "— John Rein",
  "oversized-jersey-hoodie":
    "On first pulling on the golden jersey: “I’m never taking this " +
    "off, ever.” — Greg Suffoletto, forward",
  "majestic-stick-carry-tee":
    "“Retrieving is the whole job. The stick is just the excuse.” " +
    "— Jason Kaplewicz",
  "oversized-jersey-tee":
    "“The sweater fits when you’ve earned it. Until then it just " +
    "hangs.” — John Rein",
  "majestic-stick-carry-hoodie":
    "“The fault, dear Brutus, is not in our sticks.” — Rich Fedele, defence",
  "faceoff-longsleeve":
    "“Two dogs, one puck, no plan.” — Devin Arnold, defence",
  "majestic-stick-carry-longsleeve":
    "“Head up, stick down, mouth full.” — Anthony Gugino, defence",
  "crossed-shield-crewneck":
    "“A crest is a promise you have to keep on Mondays.” " +
    "— Bryan Karchensky, forward",
  "majestic-stick-carry-crewneck":
    "“Do, or do not. There is no drop pass.” — Andrew Murphy, defence",
  "oversized-jersey-crewneck":
    "“Dress for the team you want.” — Jake Steinmetz, forward",
  "majestic-stick-carry-youth":
    "“Someone has to carry the sticks.” — Jeremy McDonald, forward",
  "oversized-jersey-youth":
    "“One day this will fit.” — Rich Fedele, defence",
  "heritage-seal-mug":
    "“Coffee, then a 10:40 puck drop. In that order.” " +
    "— Dan Schmitt, defence",
  "crossed-shield-mug":
    "“The shield goes on the mug because it goes on everything.” " +
    "— Vinny Terrana, forward",
  "majestic-stick-carry-mug":
    "“We are gonna need more tape.” — Jason Kaplewicz",
  "majestic-stick-carry-sticker":
    "“He carries it better than most of us and he never complains about " +
    "the flex.” — Jeremy McDonald, forward",
  "faceoff-crewneck":
    "“Win the draw and the next ten seconds are somebody else’s " +
    "problem.” — Devin Arnold, defence",
  "faceoff-hoodie":
    "“Something is rotten in the state of our breakout.” " +
    "— Dan Schmitt, defence",
  "rink-board-longsleeve":
    "“The boards have taken more of my hits than any opponent has.” " +
    "— Dan Schmitt, defence",
  "rink-board-youth":
    "“Just keep skating.” — Jeremy McDonald, forward",
  "oversized-jersey-mug":
    "“I would like to thank the ice, which was cold, and the puck, which " +
    "was round.” — Rich Fedele, defence",

  /* --- chosen by the captain on 2026-07-30, from the pool, after the three
         rounds written for these twelve products were all struck. He picked
         which line goes on which product; that pairing is his, not a guess. --- */
  "nose-to-nose-hoodie":
    "“A hit, a very palpable hit.” — Anthony Gugino, defence",
  "nose-to-nose-cap":
    "“We are rebuilding. We have been rebuilding since 2011.” — Bryan " +
    "Karchensky, forward",
  "nose-to-nose-longsleeve":
    "“Get thee to a bench.” — Corey Muff, goaltender",
  "nose-to-nose-crewneck":
    "“Screw your courage to the sticking place, then take the draw.” — Brett " +
    "Koeppel, defence",
  "nose-to-nose-youth":
    "“Half this roster has kids who could take my spot.” — Jason Kaplewicz",
  "nose-to-nose-sticker":
    "“What is past is prologue, and all of it is in the archive.” — Bryan " +
    "Karchensky, forward",
  "mascot-medallion-mug":
    "“I was told there would be a warm-up.” — John Rein",
  "mascot-medallion-sticker":
    "“The drawing is of a dog who has never been scored on.” — Corey Muff, " +
    "goaltender",
  "oversized-jersey-longsleeve":
    "“Our power play has a plan. It is a secret, even from us.” — Dan Schmitt, " +
    "defence",
  "oversized-jersey-sticker":
    "“We are a defensive team in the sense that we defend a lot.” — Anthony " +
    "Gugino, defence",
  "championship-roundel-youth":
    "“Somebody has to be the next one. It may as well be you.” — Jason Kaplewicz",
  "heritage-seal-youth":
    "“Every golden retriever is a two-way forward at heart.” — Jake Steinmetz, " +
    "forward",
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
  { mark: "majestic-stick-carry", item: "tee" },
  { mark: "oversized-jersey", item: "tee", placement: { widthIn: 8.5 } },
  // Wider than the badges and it sits higher: a varsity arch belongs across the
  // chest, not centred on it.

  /* Hoodie. The front is LANDSCAPE — 11.42 x 7.61in, because the pouch takes
     the rest — so a square badge is capped at 7.15in by height. The back is the
     biggest canvas in the shop and takes what the front cannot.

     `rink-board` came off the hoodie front on the captain's eye: a 3:1 bar
     printed 10.5in wide on a chest is a bumper sticker. It is the best thing in
     the shop on a cap, a beanie and a mug, where wide is the shape of the
     canvas.

     **NOTHING PRINTS ON THE BACK ANY MORE.** Three did, and the listings
     therefore showed a photograph of a hoodie's back — correct, and not what
     anybody wants to look at while deciding whether to buy one. The captain:
     "There's a few hoodies where the art is being shown on the BACK of the
     hoodie, and not the front." So the badges moved to the front, where the
     panel is 12.36 x 8.24in and a square mark caps at 7.15in by height. If a
     back print ever comes back it needs a front mockup beside it, not instead
     of it. */
  { mark: "heritage-seal", item: "hoodie" },
  { mark: "crossed-shield", item: "hoodie" },
  { mark: "championship-roundel", item: "hoodie" },
  { mark: "nose-to-nose", item: "hoodie", placement: { widthIn: 10.5 } },
  { mark: "faceoff", item: "hoodie" },
  { mark: "majestic-stick-carry", item: "hoodie" },
  { mark: "oversized-jersey", item: "hoodie" },

  /* Cap and beanie — Richardson 112 and Yupoong 1501KC, both EMBROIDERED, and
     that is the constraint rather than the size of the panel. A dense badge
     stitched at under two inches turns its type to mush; `nose-to-nose` proved
     it twice, reading cleanly at 3.6in on a cap and coming back illegible at
     3.2in on a cuff. So the cap takes the three wide marks and the beanie takes
     the widest one only. */
  { mark: "rink-board", item: "cap", placement: { widthIn: 4.75 } },
  { mark: "nose-to-nose", item: "cap", placement: { widthIn: 3.6 } },

  { mark: "rink-board", item: "beanie", placement: { widthIn: 4.4 } },

  /* Mug — landscape, and the widths are smaller than the canvas allows. The
     print area is 7.76in wide but a mug is a CYLINDER: seen head-on only the
     middle four inches face you. `rink-board` at 6.5in came back with the dog
     bisected by the left edge, so the wide marks are sized to the visible face. */
  { mark: "rink-board", item: "mug", placement: { widthIn: 4.5 } },
  { mark: "nose-to-nose", item: "mug", placement: { widthIn: 4.0 } },
  { mark: "mascot-medallion", item: "mug" },
  { mark: "championship-roundel", item: "mug" },
  { mark: "heritage-seal", item: "mug" },
  { mark: "crossed-shield", item: "mug" },
  { mark: "majestic-stick-carry", item: "mug" },
  { mark: "oversized-jersey", item: "mug", placement: { widthIn: 3.2 } },

  /* The PUCK came off on 2026-07-29. Printify has exactly one maker for
     blueprint 1203 and it charges $18.00 for a three-inch puck plus $7.59 to
     post it, which priced at $26 — more than a tee, for a rubber disc. The
     captain: "way too expensive". It is the only genuinely hockey OBJECT in
     their catalog and it is still not worth $26.

  /* Long sleeve, crewneck and youth tee — added 2026-07-30 on the captain's
     pick. The badges that already carry a tee carry these, because they are the
     same shape of canvas: a chest. */
  { mark: "crossed-shield", item: "longsleeve" },
  { mark: "championship-roundel", item: "longsleeve" },
  { mark: "heritage-seal", item: "longsleeve" },
  { mark: "faceoff", item: "longsleeve" },
  { mark: "oversized-jersey", item: "longsleeve", placement: { widthIn: 8.5 } },
  /* rink-board goes on the PORTRAIT canvases only, and that distinction is the
     reason it is here but not on the hoodie. A 3:1 bar 9.5in wide on a portrait
     chest is a band across the top of it; the same bar on the hoodie's
     LANDSCAPE panel fills the whole front and reads as a bumper sticker. The
     long sleeve and the youth tee are the tee's shape, where it already works. */
  { mark: "rink-board", item: "longsleeve", placement: { widthIn: 9.5, y: 0.4 } },
  { mark: "nose-to-nose", item: "longsleeve", placement: { widthIn: 9.0 } },
  { mark: "majestic-stick-carry", item: "longsleeve" },

  { mark: "heritage-seal", item: "crewneck" },
  { mark: "championship-roundel", item: "crewneck" },
  { mark: "nose-to-nose", item: "crewneck", placement: { widthIn: 9.0 } },
  { mark: "crossed-shield", item: "crewneck" },
  { mark: "majestic-stick-carry", item: "crewneck" },
  { mark: "oversized-jersey", item: "crewneck" },
  { mark: "faceoff", item: "crewneck" },

  { mark: "crossed-shield", item: "youth" },
  { mark: "championship-roundel", item: "youth" },
  { mark: "faceoff", item: "youth" },
  { mark: "heritage-seal", item: "youth" },
  { mark: "nose-to-nose", item: "youth", placement: { widthIn: 7.0 } },
  { mark: "majestic-stick-carry", item: "youth" },
  { mark: "oversized-jersey", item: "youth", placement: { widthIn: 6.5 } },
  { mark: "rink-board", item: "youth", placement: { widthIn: 7.0, y: 0.4 } },

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
  { mark: "mascot-medallion", item: "sticker" },
  { mark: "majestic-stick-carry", item: "sticker" },
  { mark: "oversized-jersey", item: "sticker" },
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
  {
    // Refused three separate sweeps, 2026-07-30. The message says nothing about
    // WHAT failed and the request is the same one nineteen other makers of this
    // blueprint accepted, so it is recorded rather than diagnosed. It is the
    // only maker on the platform this line has never been able to price.
    blueprintId: 12,
    printProviderId: 54,
    error: "code 6002: Validation failed. (JAMS Designs, POST /products.json 400)",
  },
];

/**
 * Makers that CAN be created but cannot carry the line, with the reason.
 *
 * A colourway's `variants` array is positional against `sizes`, so a maker
 * missing one size of one colour cannot be used at all without dropping that
 * colour — there is no representation for a partial run. That makes "is it
 * cheaper" the wrong first question and "can it make what we sell" the right
 * one, and the answers are worth keeping so the sweep's top line is not
 * re-litigated every time somebody reads it.
 */
export const CANNOT_CARRY: { blueprintId: number; printProviderId: number; why: string }[] = [
  {
    // $0.50 cheaper at target than Printify Choice on the tee — the only maker
    // in the whole sweep that beats an incumbent on price. It is still not
    // usable: 16 colourways against 125, and the one it is missing is one we
    // sell. Taking it would mean dropping Dark Grey Heather to save 50 cents.
    blueprintId: 12,
    printProviderId: 42,
    why: "Drive Fulfillment has no Dark Grey Heather in 2XL (variant 18152)",
  },
  {
    // The withdrawal that stopped a sync mid-run. Recorded because Black is a
    // colour a hockey club will want back, and this is why it is not there.
    blueprintId: 41,
    printProviderId: 29,
    why: "Monster Digital withdrew Black in M (variant 24997) on 2026-07-30",
  },
  {
    blueprintId: 2002,
    printProviderId: 29,
    why: "Monster Digital has no Black and stops at 2XL on the IND4000 hoodie",
  },
];

/* ------------------------------------------------------------------ */
/* Building the line                                                   */
/* ------------------------------------------------------------------ */

export const markById = (id: string): Mark | undefined => MARKS.find((m) => m.id === id);
export const itemById = (id: string): Item | undefined => ITEMS.find((i) => i.id === id);

/**
 * The sign-off, on every product in the shop.
 *
 * **The stickers used to be exempt** — `closing: null` on the item, from the
 * first version of this file. Nothing decided that; it was the default nobody
 * revisited. It made the catalogue sign its name forty-nine times and go silent
 * ten, and the ten were the cheapest things in it: a sticker is the most likely
 * first thing a stranger buys and the only product that arrives with no garment
 * label to say who made it. It closes like everything else now.
 *
 * The hyphens in "golden-retriever-themed" are a compound modifier and were
 * missing on all forty-nine. The joke is untouched — "premier" in a category of
 * one is the whole line — and one edit here reverts the punctuation everywhere.
 */
const DEFAULT_CLOSING =
  "Golden Retriever Hockey — Buffalo's premier golden-retriever-themed hockey " +
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
      title: entry.title ?? `${mark.title} — ${item.title}`,
      description: [mark.blurb, item.spec, item.care, QUOTES[id], closing]
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
