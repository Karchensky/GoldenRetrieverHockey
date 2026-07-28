import catalog from "../data/products.json";
import { FOUNDED, data as site } from "./data";

/**
 * The store's data contract.
 *
 * Same rules as the rest of the site: read at BUILD time, rendered to static
 * HTML, no runtime fetch. Six products is not a database's problem either.
 *
 * The one rule that carries over from the archive and is not negotiable here:
 * **the site does not pretend.** The archive refuses to interpolate across a
 * missing stat; the store refuses to imply it can take money. It cannot — this
 * is a static export with no server — so it does not try. Checkout is a
 * Printify Pop-Up store and every buy link leaves the site.
 */

/** Which silhouette to draw. There are no photographs — see ProductFigure.tsx. */
export type Silhouette =
  | "tee"
  | "tee-back"
  | "hoodie"
  | "jersey"
  | "cap"
  | "beanie"
  | "sticker"
  | "puck"
  | "mug";

/**
 * Which artwork goes in the print area.
 *
 * Everything with a `-logo` suffix is a file rather than a drawing — one of the
 * marks in `docs/logos`, prepared by `packages/store/src/artwork.ts`, so the
 * mark on this page and the mark on the parcel are the same picture.
 *
 * Six designs were removed here rather than retired, in two rounds and for the
 * same reason. `saves-zero` read SAVES 0 / EVERY GOALTENDER SEASON, which is
 * false: three of Brent Seymour's lines record 775, 180 and 118 saves. Then on
 * 2026-07-26 the captain's instruction was team logos only, and `wordmark`,
 * `wordmark-small`, `est`, `eighty-nine`, `four-spellings` and `forty-five` —
 * every drawing that set archive text in type — went with the three products
 * that carried them. Leaving a drawing in the codebase leaves it available to
 * whoever adds the next shirt.
 */
export type Design =
  | "crest-logo"
  | "monogram-logo"
  | "wordmark-logo"
  | "retriever-logo"
  | "retriever-plate"
  | "ball";

/**
 * A view of a product. NOT a photograph and not a file on disk: it is a
 * drawing instruction, resolved to inline SVG at render time. That is why a
 * colour swatch can actually recolour the garment instead of swapping a JPEG.
 */
export type ProductImage = {
  view: "front" | "back";
  silhouette: Silhouette;
  design: Design;
};

export type Colorway = {
  name: string;
  /** The garment body colour. The print colour is derived — see `inkOn`. */
  hex: string;
};

/**
 * Which mark this carries.
 *
 * The families are not a marketing device — they are forced by the ground each
 * mark was drawn on. The crest and the monogram are drawn on cream with black
 * outlines and disappear into a black shirt. The wordmark and the pixel
 * retriever are drawn on black and lose their ivory and their ice blue on white.
 * That is why no colourway is shared across the split, and why there was no cap
 * and no beanie in this line until there was a mark drawn for black.
 */
export type Family = "crest" | "monogram" | "wordmark" | "retriever";

/**
 * What will actually be printed, in inches, at the resolution it will be
 * printed at.
 *
 * These are not the blueprint's maximum print area — that is what the figures
 * used to label, and it was false: a 6-inch crest was captioned "12 in × 16 in".
 * They are the placement `packages/store/src/sync.ts` computed and sent, read
 * back off the created product. `sync` compares these against the live shop on
 * every run, so the caption under a drawing and the file at the printer cannot
 * quietly disagree.
 *
 * Two figures, not one, because Printify's placement is a PROPORTION of the
 * print area and the print area grows with the garment. One scale is sent for
 * every size, so the same design prints 5.17 inches wide on a small and 7.01 on
 * a 3XL. `widthIn` and `dpi` are the smallest size offered; `maxWidthIn` and
 * `minDpi` are the largest, and that second pair is the one that decides whether
 * the print looks soft.
 */
export type PrintPlacement = {
  position: string;
  /** On the smallest size offered. */
  widthIn: number;
  heightIn: number;
  /** Source pixels per printed inch, on the smallest size. Under 150 is visibly soft. */
  dpi: number;
  /** On the largest size offered. Equal to `widthIn` on a one-size product. */
  maxWidthIn: number;
  /** The worst case, and the honest one. */
  minDpi: number;
  /**
   * Rendered width as a fraction of the print area's width — Printify's own
   * number, sent on the product. `ProductFigure` draws the mark at exactly this
   * fraction of the print box, which is what stops the page showing a wordmark
   * across a whole chest when five inches of it get printed.
   */
  scale: number;
  /** Where the mark's centre sits in the print area. 0.5 is the middle; smaller is higher. */
  y: number;
};

/** What exists on Printify, and what state it is in. */
export type PrintifyRef = {
  blueprintId: number;
  printProviderId: number;
  /** The product on shop 28277243. Null until `sync` has created it. */
  productId: string | null;
  /** `draft` is visible in the dashboard and nowhere else. */
  status: "draft" | "published";
  print: PrintPlacement[];
};

export type Product = {
  id: string;
  name: string;
  kind: string;
  family: Family;
  /** Dry, specific, true. Every number in here was checked against site.json. */
  blurb: string;
  /** Spec-sheet lines. */
  spec: string[];
  priceCents: number;
  sizes: string[];
  colors: Colorway[];
  images: ProductImage[];
  printify: PrintifyRef;
  /**
   * The product's own page in the Printify Pop-Up store, once it exists. Null
   * means the Pop-Up has not been set up or this product has not been published
   * into it — never "no link"; the store falls back to the shop root and, when
   * there is no shop either, says so rather than offering a dead button.
   */
  popUpUrl: string | null;
};

export type Catalog = {
  products: Product[];
};

const data = catalog as unknown as Catalog;

/**
 * Copy that counts things must COUNT them.
 *
 * The beanie shipped saying "Nine of the sixteen sessions on file ran through
 * a Buffalo winter", and the other spec line said the other seven were summer.
 * Both were true when written and both were wrong within a day: a lost season
 * came back and it is seventeen now, nine winter and eight summer. That is the
 * fourth hardcoded count in this repo to drift in a single day — the <head>
 * description, next.config's comment, lib/data's own header, and now a t-shirt.
 *
 * It will drift again. Sessions are actively being recovered from the Internet
 * Archive as this is written, and a garment that states a figure about the
 * archive has to be as accountable as the archive is. So the catalog stores a
 * token and the number is read from the same generated data as everything else.
 *
 * Deliberately spelled out rather than rendered as digits: this is prose on a
 * hat, not a stat line.
 */
const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one",
  "twenty-two", "twenty-three", "twenty-four",
];
const spell = (n: number) => WORDS[n] ?? String(n);

const COUNTS: Record<string, () => string> = {
  sessions: () => spell(site.sessions.length),
  winterSessions: () => spell(site.sessions.filter((s) => s.half === "fall-winter").length),
  summerSessions: () => spell(site.sessions.filter((s) => s.half === "summer").length),
  people: () => spell(site.players.length),
  /**
   * Digits, not words: this one appears beside other years. And it comes from
   * `FOUNDED` rather than from a second derivation of its own — this file used
   * to parse the year out of the earliest session id, which is a different
   * calculation that happened to agree. Two ways of counting the same thing is
   * how a store ends up disagreeing with the masthead above it.
   */
  firstYear: () => String(FOUNDED),
};

/** Replace {{token}} with the live figure. An unknown token is left alone and
 *  will show up in the copy verbatim, which is the loudest safe failure. */
function fillCounts(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, k: string) => COUNTS[k]?.() ?? whole);
}

export const products: Product[] = data.products.map((p) => ({
  ...p,
  blurb: fillCounts(p.blurb),
  spec: p.spec.map(fillCounts),
}));

export const byId = (id: string): Product | undefined =>
  products.find((p) => p.id === id);

/**
 * The caption under a drawing: what gets printed, where, and how big.
 *
 * Falls back to the position alone when there is no measured placement, which
 * is the correct behaviour for a product that has not been sent to the shop
 * yet — a size it has never been given is not a size worth stating.
 */
/**
 * The placement a figure should draw, or undefined for a product that has never
 * been sent to the shop and therefore has no measured one.
 */
export function placementFor(product: Product, position: string): PrintPlacement | undefined {
  return product.printify.print.find((x) => x.position === position);
}

/**
 * How the mark gets onto the thing. Read off the created products'
 * `print_areas[].placeholders[].decoration_method`, not guessed: this file used
 * to call everything DTG, and two of these are stitched rather than printed.
 */
const METHOD: Record<string, string> = {
  sticker: "kiss-cut",
  cap: "embroidered",
  beanie: "embroidered",
  mug: "dye-sublimated",
};

export function printLabel(product: Product, position: string): string {
  const p = product.printify.print.find((x) => x.position === position);
  const method = METHOD[product.kind] ?? "DTG";
  if (!p) return `${method} ${position}`;
  // Name the face only when it is worth naming. On a one-print garment "front"
  // is the only thing it could be, and the caption is drawn from the print
  // box's left edge with nothing to wrap against.
  const named = product.printify.print.length > 1 || p.position !== "front";
  // A width, or a range. The range is not padding: the print is a proportion of
  // an area that grows with the garment, so a small and a 3XL genuinely do not
  // get the same size print, and one number would be true of one size only.
  const width = p.maxWidthIn > p.widthIn
    ? `${p.widthIn}–${p.maxWidthIn} in wide`
    : `${p.widthIn} in × ${p.heightIn} in`;
  return `${width} · ${method}${named ? ` ${p.position}` : ""}`;
}

/** The marks, in catalog order. Empty families are dropped. */
export const families: { id: Family; label: string; note: string; items: Product[] }[] =
  ([
    { id: "crest", label: "The crest", note: "Shield, dog, two sticks" },
    { id: "monogram", label: "The monogram", note: "C and R, interlocked" },
    { id: "wordmark", label: "The wordmark", note: "Gold over ivory, on black" },
    { id: "retriever", label: "The retriever", note: "Drawn in ice pixels" },
  ] as const)
    .map((f) => ({ ...f, items: products.filter((p) => p.family === f.id) }))
    .filter((f) => f.items.length > 0);

/** Cents to "$28.00". Integer cents in, no floating point anywhere near money. */
export function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Relative luminance, sRGB, per WCAG. Used to decide whether the print reads
 * light or dark on a given garment, so that adding a colourway to
 * products.json never requires also remembering to pick an ink.
 */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** The colour the artwork prints in, given the garment under it. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.35 ? "#0e1518" : "#f2f6f4";
}

/** The ball is the brand. It stays tennis-coloured unless the garment is too close to it. */
export function ballOn(hex: string): string {
  return luminance(hex) > 0.6 ? "#a8b93e" : "#d4e157";
}

/* There was a cart here — a localStorage store, a drawer, a subtotal, and a
   Checkout button that was permanently disabled. All of it is gone.

   Checkout is a Printify Pop-Up store, which owns the basket, the sizes, the
   shipping and the money. A second cart on this side could only ever be a
   waiting room that collects an order it cannot place, and the drawer had to
   carry a panel explaining as much. Removing it removed the need for the
   explanation, which is the better version of the same honesty.

   See lib/storefront.ts for how a product resolves to a link. */
