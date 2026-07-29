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
 * live from Printify. See docs/STORE.md.
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
 * A body is light or dark, and a mark can only sit on one of them.
 *
 * This is not a style preference and it is the reason the matrix exists at all.
 * The full-colour crest is outlined in black and its banner is black: on a black
 * or navy body it loses its shield edge and the banner becomes a hole. The
 * one-ink gold crest is the same drawing with the cream keyed out, so the
 * garment shows through the banner lettering and the dog's face — which reads on
 * black and reads as nothing at all on white. Pair a mark with a ground it
 * cannot use and `buildLine()` throws rather than printing it.
 */
export type Ground = "light" | "dark";

export type Mark = {
  /** First half of every product id it appears in. */
  id: string;
  /** First half of every product title. */
  title: string;
  /** The grounds this mark may sit on. Never both, on this line. */
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
 * How an item may be bought. **Checkout enforces this; the rule lives here,
 * beside the price, because it IS part of the price.**
 *
 * It exists because Printify's postage does not merge across product types.
 * Proven on 2026-07-28 against `POST /shops/28277243/orders/shipping.json`: a
 * tee and a cap, both from Printful, quote $9.64 — $4.75 + $4.89, two separate
 * first-item rates. Three stickers quote $4.77 — $4.59 plus two additional-item
 * rates of $0.09. So quantity of ONE thing is nearly free to post and a second
 * KIND of thing never is, and an item whose postage is larger than the item has
 * exactly one honest shape: sell it in a quantity that carries its own parcel.
 */
export type Sale = {
  /** Fewest units of this item a basket may hold. Default 1. */
  minQuantity?: number;
  /** True when this may not be the only thing in a basket. */
  addOnOnly?: boolean;
  /** Why. Printed by `cli.ts line` and store:report; never guessed at. */
  why: string;
};

export type Item = {
  /** Second half of every product id. The word he uses for it. */
  id: string;
  /** Second half of every product title. */
  title: string;
  blueprintId: number;
  printProviderId: number;
  /**
   * Retail, integer cents, **US postage included** — the store ships free
   * within the US, so the rate is a cost of goods and not a line at checkout.
   * One price per item, whatever mark is on it. See docs/STORE.md §3.
   */
  priceCents: number;
  /** Buying rules, where the plain "one of these, on its own" does not work. */
  sale?: Sale;
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
  /** The garment paragraph of the description. */
  spec: string;
  /** Overrides the colour sentence where the generated one reads badly. */
  colourSentence?: Partial<Record<Ground, string>>;
  /**
   * Overrides the mark's own `groundNote` on this item, or drops it with `null`.
   * The mark's note explains a garment ("this needs a light body under it"), and
   * on a sticker or a mug that sentence is about the wrong object.
   */
  groundNote?: Partial<Record<Ground, string | null>>;
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
  claims: string[];
  /** Back-references, so a report can say what a product is made of. */
  markId: string;
  itemId: string;
};

/* ------------------------------------------------------------------ */
/* 1 — the marks                                                       */
/* ------------------------------------------------------------------ */

/**
 * Two marks, both `logo_one`, both off the VECTOR masters.
 *
 * The flats beside them are why this list is short. Every mark this line used to
 * print was a 1254 px PNG carrying about 900 px of artwork — 158 dpi at six
 * inches, 116 on a 3XL — which is why the crest was once sold at six inches and
 * the wordmark at 5.17. `docs/logos/vector/` has no such ceiling: rendered at
 * 6000 px it trims to 4526 x 5094 of artwork, and 4526 px is 453 dpi at ten
 * inches. Nothing below is sized to its file any more. Everything is sized to
 * the garment.
 *
 * To add a mark: put the master in `docs/logos/`, add an entry here, run
 * `node packages/store/src/cli.ts marks` to see it measured, then wire it into
 * MATRIX. `cli.ts logos` renders every entry in this list — it is not a separate
 * list any more.
 */
export const MARKS: Mark[] = [
  {
    id: "crest",
    title: "Golden Retrievers Crest",
    grounds: ["light"],
    source: "docs/logos/vector/logo-one-transparent-600dpi.png",
    press: "logos/crest.png",
    // Already carries alpha. It still gets trimmed: Printify places an image by
    // its file box and the export is a square canvas with the artwork inset, so
    // uploading it untrimmed would silently shrink the print.
    reach: "trim",
    renderWidth: 6000,
    blurb:
      "The crest in full colour — the shield, the banner, the dog — at the size " +
      "the vector master allows rather than the size an old flat could hold.",
    groundNote:
      "The shield is outlined in black and the banner is black, so this mark " +
      "needs a light body under it.",
  },
  {
    id: "crest-gold",
    title: "Golden Retrievers Crest, Gold",
    grounds: ["dark"],
    source: "docs/logos/vector/logo-one-one-color-gold.svg",
    press: "logos/crest-gold.png",
    // A straight colour key, not a border fill. This file has two colours and
    // nothing drawn is cream: every cream region is either the ground or
    // negative space cut into the gold. On a dark garment that negative space is
    // meant to BE the garment, and DTG lays a white underbase under every
    // non-transparent pixel — a border fill would print the banner lettering and
    // the eyes as cream slugs on black.
    reach: "everywhere",
    renderWidth: 6000,
    blurb:
      "The same crest in a single ink. Everything that is cream in the " +
      "full-colour mark is the garment here: the banner lettering, the muzzle, " +
      "the eyes, the tape on the blades.",
    groundNote:
      "Dark bodies only, and there cannot be a light one — on white the mark " +
      "has nothing to cut into.",
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
 * costs and the reasoning are in docs/STORE.md §1.
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
    printProviderId: 410,
    priceCents: 3600,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    // Ten of them, and the whole list has to be declared: store:report compares
    // this against the live catalog and flags a difference in either direction.
    positions: [
      "front", "back", "left_sleeve", "right_sleeve", "neck",
      "large_center_embroidery", "front_left_chest", "front_center_chest",
      "left_sleeve_embroidery", "right_sleeve_embroidery",
    ],
    // y 0.42 lifts it off the hem. The width is checked by `sync --dry-run`,
    // which prints the printed size on the smallest garment and the largest.
    placement: { position: "front", widthIn: 7.375, y: 0.42 },
    colourways: [
      { name: "White", hex: "#f4f4f2", ground: "light", variants: [18540, 18541, 18542, 18543, 18544, 18545] },
      { name: "Ash", hex: "#c9cbc8", ground: "light", variants: [38602, 38605, 38608, 38611, 38614, 38617] },
      { name: "Athletic Heather", hex: "#b0b2ad", ground: "light", variants: [18076, 18077, 18078, 18079, 18080, 18081] },
      { name: "Black", hex: "#17191b", ground: "dark", variants: [18100, 18101, 18102, 18103, 18104, 18105] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [18396, 18397, 18398, 18399, 18400, 18401] },
      { name: "Heather Navy", hex: "#2f3a4c", ground: "dark", variants: [18268, 18269, 18270, 18271, 18272, 18273] },
      { name: "Dark Grey Heather", hex: "#3e4245", ground: "dark", variants: [18148, 18149, 18150, 18151, 18152, 18153] },
    ],
    spec:
      "Bella+Canvas 3001: 4.2 oz combed ringspun cotton, 32 singles, side-seamed, " +
      "shoulder-taped, unisex sizing. Printed direct-to-garment by Printful, " +
      "front only. The print is a proportion of the garment, so it grows with " +
      "it — seven and a half inches across on a small, ten on a 3XL.",
  },
  {
    id: "hoodie",
    title: "Hoodie",
    // Independent Trading Co. IND4000, not Gildan 18500. The Gildan is the
    // budget default: 8 oz of 50/50 blend with a one-ply body. The IND4000 is
    // 10 oz of 80/20, jersey-lined hood, twill-taped neck — the hoodie the
    // merchandise trade treats as the quality tier. It also carries a 15 x 10in
    // front canvas against the Gildan's 12.4 x 8.2, which is what lets this
    // crest print eight inches across instead of under seven.
    blueprintId: 2002,
    // SwiftPOD, not Monster Digital, and the reason is stock rather than money:
    // Monster Digital's IND4000 has no black and stops at 2XL. SwiftPOD carries
    // black, runs to 3XL, and adds the back and both sleeves as print areas. It
    // is also 55 cents cheaper on black.
    printProviderId: 39,
    priceCents: 7400,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    positions: ["front", "back", "left_sleeve", "right_sleeve", "neck"],
    // The front is 15 x 10in — wider than it is tall, because the pouch takes
    // the rest — so a portrait mark is bound by HEIGHT. 8.3in wide puts the
    // crest at 9.34in tall, just inside the 94% the provider will not trim into.
    placement: { position: "front", widthIn: 8.3, y: 0.5 },
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
      "Independent Trading Co. IND4000: 10 oz of 80/20 cotton-polyester " +
      "heavyweight fleece, jersey-lined hood, twill-taped neck, ribbed cuffs and " +
      "hem, front pouch. The front panel is wider than it is tall, so a portrait " +
      "mark is limited by height here — just under seven inches across on a " +
      "small, eight and a third on a 3XL.",
  },
  {
    id: "sticker",
    title: "Sticker",
    blueprintId: 400,
    // Printify Choice, not SPOKE (provider 1). SPOKE appears in the catalog for
    // this blueprint and rejects creation outright — see REJECTS_CREATION.
    printProviderId: 99,
    priceCents: 600,
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
        "shipping on one would need an $11 price tag. Three post for $4.77.",
    },
    sizes: ['3" × 3"', '4" × 4"'],
    positions: ["front"],
    placement: { position: "front", widthIn: 2.3, y: 0.5 },
    colourways: [
      { name: "White vinyl", hex: "#f4f4f2", ground: "light", variants: [45750, 45752] },
    ],
    spec:
      "UV printed on white vinyl, kiss-cut, rated for outdoor use. It will " +
      "outlast at least two of the platforms this team's record had to be " +
      "recovered from. Sold in threes — one sticker costs more to post than to " +
      "make, and three cost the same to post as one.",
    colourSentence: { light: "Three inches or four, mix them as you like." },
    // A sticker has no body, so the mark's note about needing a light one under
    // it is about the wrong object. The white vinyl IS the light ground.
    groundNote: { light: null },
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
    priceCents: 4000,
    sizes: ["One size"],
    positions: ["front"],
    // The embroidery panel is 5.9 x 2in. A portrait mark is bound by the second
    // figure, which is what puts this at 1.66in rather than anything wider.
    placement: { position: "front", widthIn: 1.66, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [118722] },
      { name: "Black / Charcoal", hex: "#232628", ground: "dark", variants: [118723] },
      { name: "Black / White", hex: "#1c1f21", ground: "dark", variants: [118724] },
      { name: "Charcoal / Black", hex: "#3b3e40", ground: "dark", variants: [118726] },
    ],
    spec:
      "Richardson 112: structured six-panel front, mesh back, pre-curved visor, " +
      "snapback closure, one size. Stitched rather than printed — the gold is " +
      "thread and the shapes inside it are bare twill.",
    colourSentence: { dark: "Black, charcoal and two-tone." },
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
    priceCents: 3200,
    sizes: ["One size"],
    positions: ["front"],
    placement: { position: "front", widthIn: 1.45, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [116417] },
      { name: "Navy", hex: "#1b2a3d", ground: "dark", variants: [116425] },
    ],
    spec:
      "Yupoong 1501KC: acrylic knit, double-layer cuff, one size. Embroidered on " +
      "the cuff face, stitched rather than printed.",
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
    priceCents: 2600,
    sizes: ["11 oz", "15 oz"],
    positions: ["front"],
    // 3.0in, and the limit is the 11 oz rather than the 15. The two sizes are
    // not the same SHAPE, so the taller mug is the wider canvas and a scale
    // that fits it overflows the smaller one.
    placement: { position: "front", widthIn: 3.0, y: 0.5 },
    colourways: [
      { name: "Black", hex: "#17191b", ground: "dark", variants: [65217, 104470] },
    ],
    spec:
      "Black ceramic, eleven ounces or fifteen. Dye-sublimated, dishwasher and " +
      "microwave safe, printed on one side.",
    colourSentence: { dark: "" },
    groundNote: {
      dark: "The black body is what makes this mark usable at all — on white it " +
        "has nothing to cut into.",
    },
  },
];

/* ------------------------------------------------------------------ */
/* 3 — the matrix                                                      */
/* ------------------------------------------------------------------ */

/**
 * One line, one product. Eight lines, eight products.
 *
 * `crest` is missing from cap, beanie and mug because those are bought in black
 * and the full-colour mark cannot go on black — `buildLine()` would throw if it
 * were added, naming the ground it cannot use. `crest-gold` is missing from the
 * sticker because the sticker is white vinyl for the same reason in reverse.
 *
 * These eight are the captain's approved line. Adding a line here creates a
 * DRAFT on the next `sync`; it does not publish anything, and nothing in this
 * package can.
 */
export const MATRIX: MatrixEntry[] = [
  { mark: "crest", item: "tee" },
  { mark: "crest", item: "hoodie" },
  { mark: "crest", item: "sticker" },

  { mark: "crest-gold", item: "tee" },
  { mark: "crest-gold", item: "hoodie" },
  { mark: "crest-gold", item: "cap" },
  { mark: "crest-gold", item: "beanie" },
  { mark: "crest-gold", item: "mug" },
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

/** "White, ash and athletic heather." — an Oxford-free list of what it comes in. */
function colourSentence(item: Item, ground: Ground): string {
  // `undefined` means "generate one". An explicit "" means "say nothing" — the
  // mug comes in one colour and one shape and listing it reads as filler.
  const override = item.colourSentence?.[ground];
  if (override !== undefined) return override;
  const names = item.colourways.filter((c) => c.ground === ground).map((c) => c.name.toLowerCase());
  const first = names[0];
  if (!first) return "";
  const sentence = names.length === 1
    ? first
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

const DEFAULT_CLOSING = "Buffalo, N.Y. Playing since {{firstYear}}.";

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

    const grounds = [...new Set(usable.map((c) => c.ground))];
    const colours = grounds.map((g) => colourSentence(item, g)).filter(Boolean).join(" ");
    const notes = grounds
      .map((g) => (g in (item.groundNote ?? {}) ? item.groundNote?.[g] : mark.groundNote))
      .filter((n): n is string => Boolean(n));
    const closing = item.closing === undefined ? DEFAULT_CLOSING : item.closing;

    line.push({
      id,
      title: `${mark.title} — ${item.title}`,
      description: [mark.blurb, item.spec, [colours, ...notes].filter(Boolean).join(" "), closing]
        .filter((p): p is string => Boolean(p))
        .join("\n\n"),
      blueprintId: item.blueprintId,
      printProviderId: item.printProviderId,
      priceCents: entry.priceCents ?? item.priceCents,
      colors: usable.map((c) => ({ name: c.name, hex: c.hex, variants: c.variants })),
      sizes: item.sizes,
      placements: [{ ...placement, art: mark.press }],
      ...(item.sale ? { sale: item.sale } : {}),
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
