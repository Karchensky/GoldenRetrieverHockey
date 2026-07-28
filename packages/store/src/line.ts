import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { CatalogPlaceholder } from "./types.ts";

/**
 * The product line, and the rule that governs it.
 *
 * **A garment that quotes the archive has to be as accountable as the archive.**
 * That rule is written down in apps/web/data/products.json and it has already
 * been broken twice. "120 goaltender lines" traced to nothing and was
 * silkscreened anyway. "16 sessions" was true for a day. This file exists so it
 * cannot happen a third time: every factual claim carried by a design is
 * re-derived from apps/web/data/site.json before a single byte is uploaded, and
 * a claim that no longer holds stops the sync.
 *
 * It caught one immediately. The catalog shipped a shirt reading **SAVES 0 /
 * EVERY GOALTENDER SEASON**. It is now false — Brent Seymour's 2012 and 2013
 * lines record 775, 180 and 118 saves, recovered after that shirt was written.
 * The zeroes belong to the HarborCenter era, whose platform does not record
 * saves at all. That design is not in this line and must not go on a garment
 * until the sentence on it is true again.
 *
 * **The line no longer quotes the archive at all.** The captain's instruction on
 * 2026-07-26 was team logos only, and the three shirts that carried archive text
 * — Everything Comes Back, Four Spellings, 45:00 — were deleted from the shop
 * and from this file. What is left prints a mark and a place: no counts, no
 * years, no names. `CLAIMS` is therefore empty, and the note above it records
 * what each retired claim guarded and why it went. The gate stays wired. The
 * moment a garment states something again, it is here that the statement gets
 * checked, and a `claims: []` that should not be empty is the failure mode to
 * watch for.
 */

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SITE_JSON = join(ROOT, "apps/web/data/site.json");
/** Press-ready art harvested from the built store by scripts/build-print-files.mjs. */
const PRINT_DIR = join(ROOT, "dist/print");
/** The captain's logos, background removed by ./artwork.ts. */
const LOGO_DIR = join(ROOT, "dist/print/logos");

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

export type Claim = {
  id: string;
  /** What the garment says, in the words a reader would use. */
  says: string;
  /** Re-derives it from site.json. Returns null when it holds, or why it does not. */
  check: (site: SiteData) => string | null;
};

type GoalieLine = { minutes?: string | null };
type Game = { goalies?: GoalieLine[] | null };
type Player = { name: string; aliases?: string[]; jerseys?: string[] };
type Session = { id: string; sort: number };
export type SiteData = { sessions: Session[]; players: Player[]; games: Game[] };

/**
 * The founding year, counted rather than typed.
 *
 * Deliberately the same calculation as `FOUNDED` in apps/web/lib/data.ts — the
 * floor of the earliest session's sort key — because this package cannot import
 * from the app and two different ways of counting one number is how a parcel
 * ends up disagreeing with the page that sold it. A session sorts on the year it
 * began, so the floor of the earliest is the year the club started.
 */
const firstYear = (site: SiteData): number =>
  Math.floor(site.sessions.reduce((earliest, s) => Math.min(earliest, s.sort), Infinity));

/**
 * Empty, and that is the correct state for this line.
 *
 * Three claims stood here. `forty-five` and `four-spellings` guarded sentences
 * printed on two shirts; both shirts were deleted on the captain's instruction
 * and both sentences still hold. `est-2012` guarded **EST. 2012**, and on
 * 2026-07-26 it stopped this sync cold: the captain's own stats workbook had
 * just been ingested, carrying a **Winter 2011** season with full statistics and
 * a paid franchise fee — the fee to *establish* a franchise. The club is a year
 * older than its own masthead claimed, the captain has ruled 2011, and EST. 2012
 * was false on a garment about to be printed.
 *
 * The fix was not to write 2011 anywhere. Every garment's copy now resolves
 * `{{firstYear}}` from site.json at upload time, and a derived number cannot be
 * stale — if a 2010 season ever turns up, the next sync prints it. A claim
 * guarding a token is a check on arithmetic, so there is nothing left here to
 * check: no mark in docs/logos carries a date, and no product states a count,
 * a year or a name in type.
 *
 * What survives is the machinery, which has now caught three real errors and
 * cost nothing. A garment that states a fact in type again gets a `Claim` here,
 * or it does not get printed.
 */
export const CLAIMS: Claim[] = [];

export async function loadSite(): Promise<SiteData> {
  return JSON.parse(await readFile(SITE_JSON, "utf8")) as SiteData;
}

/** Throws with every failure listed, rather than the first one. */
export function assertClaims(site: SiteData, ids: string[]): void {
  const failures: string[] = [];
  for (const id of ids) {
    const claim = CLAIMS.find((c) => c.id === id);
    if (!claim) { failures.push(`${id}: no such claim`); continue; }
    const why = claim.check(site);
    if (why) failures.push(`${id} — the art says "${claim.says}" but ${why}`);
  }
  if (failures.length) {
    throw new Error(
      `Refusing to upload art whose claims no longer hold:\n  ${failures.join("\n  ")}\n` +
        `Fix the design, or drop the product. Do not print it and hope.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

export type ArtBox = { width: number; height: number };

/**
 * The `scale` that renders `art` at `widthIn` inches inside `area`, and the
 * effective print resolution that results.
 *
 * `scale` is a fraction of the print area's WIDTH, so a portrait image inside a
 * landscape print area — every hoodie front — is limited by height instead, and
 * the caller gets told rather than getting a print that runs off the garment.
 */
export function place(area: CatalogPlaceholder, art: ArtBox, widthIn: number): {
  scale: number;
  widthIn: number;
  heightIn: number;
  dpi: number;
  heightFill: number;
} {
  // Printify's canvases are quoted at 300 dpi.
  const areaWIn = area.width / 300;
  const areaHIn = area.height / 300;
  const aspect = art.height / art.width;

  let w = widthIn;
  let h = w * aspect;
  // Never let a print exceed 94% of the area in either direction: providers
  // trim at the edge and a design that touches it comes back cropped.
  const maxH = areaHIn * 0.94;
  const maxW = areaWIn * 0.94;
  if (h > maxH) { h = maxH; w = h / aspect; }
  if (w > maxW) { w = maxW; h = w * aspect; }

  return {
    scale: Number((w / areaWIn).toFixed(4)),
    widthIn: Number(w.toFixed(2)),
    heightIn: Number(h.toFixed(2)),
    dpi: Math.round(art.width / w),
    heightFill: Number((h / areaHIn).toFixed(3)),
  };
}

/* ------------------------------------------------------------------ */
/* Art                                                                 */
/* ------------------------------------------------------------------ */

export type Art = { name: string; base64: string; box: ArtBox; sourcePath: string };

/**
 * Read a print file, trim its transparent margin, and return it ready to upload.
 *
 * The trim is not cosmetic. `scripts/build-print-files.mjs` renders each design
 * letterboxed into the garment's print area — a design can be 2520 x 3360 of
 * which the art is 2366 x 1778, the rest transparent. Printify places an image
 * by its file box, so uploading it untrimmed puts a wide empty border inside the
 * print area and silently shrinks the print to roughly half the size asked for.
 *
 * It only applies to art with an alpha channel, and that condition is load
 * bearing. `retriever-plate.png` is a flat black square on purpose — its ground
 * IS the sticker — and trimming a flat file eats the artwork rather than the
 * margin around it.
 */
export async function loadArt(file: string): Promise<Art> {
  const sourcePath = file.startsWith("logos/")
    ? join(LOGO_DIR, file.slice("logos/".length))
    : join(PRINT_DIR, file);
  const source = sharp(await readFile(sourcePath));
  const hasAlpha = (await source.metadata()).hasAlpha ?? false;
  const prepared = await (hasAlpha ? source.trim({ threshold: 0 }) : source)
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return {
    name: file.replace(/[/\\]/g, "-"),
    base64: prepared.data.toString("base64"),
    box: { width: prepared.info.width, height: prepared.info.height },
    sourcePath,
  };
}

/* ------------------------------------------------------------------ */
/* The line                                                            */
/* ------------------------------------------------------------------ */

export type Placement = {
  position: string;
  art: string;
  /** Intended printed width, in inches, before the area's own limits apply. */
  widthIn: number;
  /** Fraction of the print area. 0.5 is centred; smaller is higher. */
  y: number;
};

export type LineItem = {
  /** Matches the `id` in apps/web/data/products.json. One product, two places. */
  id: string;
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  /** Retail price, integer cents. Checked against Printify's cost after creation. */
  priceCents: number;
  /** Colour name -> variant id per size, straight from the catalog. */
  colors: { name: string; hex: string; variants: number[] }[];
  sizes: string[];
  placements: Placement[];
  /** Which CLAIMS this product's art depends on. */
  claims: string[];
};

/**
 * Four marks, and which garments each one can survive.
 *
 * The split is not a marketing device. It is forced by the ground each mark was
 * drawn on, and getting it wrong is not a matter of taste — it deletes half the
 * artwork.
 *
 * **Drawn on cream, so they go on light bodies.** `crest` is outlined in black
 * and `monogram`'s R and wordmark are solid black. On a black or navy garment
 * the crest loses its shield edge and the monogram reads as a floating gold C
 * with no second letter. Both were rendered against black, navy, charcoal and
 * white before this was written down.
 *
 * **Drawn on black, so they go on dark bodies.** `wordmark` is gold and ivory;
 * `retriever` is gold and ice blue. On white the ivory and the ice blue vanish.
 * These two are what make a cap, a beanie and a black mug possible at all —
 * headwear is bought in black, and until there was a mark drawn for black there
 * was no headwear in this line.
 *
 * **Resolution is the binding constraint on all four, and it is a file problem,
 * not a design problem.** Every source in docs/logos is a 72 dpi export around
 * 1254 px. So every placement below is sized to the art rather than to the
 * garment: the width asked for is the width at which that file prints at 300
 * dpi, and no further. Where a mark looks small on a shirt, that is why. A
 * re-export at 3000 px would let every one of these grow by a factor of three
 * with nothing else in this file changing.
 *
 * One further trap, and it is why `dpi` is a range and not a number: Printify's
 * placement is a PROPORTION of the print area, and the print area is bigger on a
 * 3XL than on an S. The same product prints 5.17 inches wide on a small and 7.01
 * on a 3XL. The first number is the best case and the second is the one that
 * decides whether the print looks soft, so sync.ts reports both and
 * products.json stores both.
 */
export const LINE: LineItem[] = [
  {
    id: "crest-tee",
    title: "Golden Retrievers Crest — Tee",
    description:
      "The team crest, printed across the chest.\n\n" +
      "Bella+Canvas 3001: 4.2 oz combed ringspun cotton, 32 singles, side-seamed, " +
      "shoulder-taped, unisex sizing. Direct-to-garment, front only.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 12,
    printProviderId: 29,
    priceCents: 2800,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    colors: [
      { name: "White", hex: "#f4f4f2", variants: [18540, 18541, 18542, 18543, 18544, 18545] },
      { name: "Ash", hex: "#c9cbc8", variants: [38602, 38605, 38608, 38611, 38614, 38617] },
      { name: "Athletic Heather", hex: "#b0b2ad", variants: [18076, 18077, 18078, 18079, 18080, 18081] },
    ],
    // 6 inches, not the 7 a full-front print would take. The crest is a 946px
    // file; at 7in it prints at 135 dpi and at 6in it prints at 158 on a small
    // and 116 on a 3XL. Neither is the 300 a printer wants. This product and the
    // hoodie below predate the rule the rest of the line follows and are left as
    // the captain has already seen them; a 3000px re-export fixes both.
    placements: [{ position: "front", art: "logos/crest.png", widthIn: 6.0, y: 0.42 }],
    claims: [],
  },
  {
    id: "crest-hoodie",
    title: "Golden Retrievers Crest — Hoodie",
    description:
      "The team crest, on the chest.\n\n" +
      "Gildan 18500: 8.0 oz cotton/polyester fleece, brushed interior, front pouch, " +
      "two-ply hood, flat drawcord, ribbed cuffs and hem. The drawcord is the extent " +
      "of the features.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 77,
    printProviderId: 29,
    priceCents: 5800,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    colors: [
      { name: "Sport Grey", hex: "#a7a9a6", variants: [32902, 32903, 32904, 32905, 32906, 32907] },
      { name: "White", hex: "#f4f4f2", variants: [32910, 32911, 32912, 32913, 32914, 32915] },
      { name: "Ash", hex: "#c9cbc8", variants: [33345, 33346, 33347, 33348, 33349, 33350] },
    ],
    placements: [{ position: "front", art: "logos/crest.png", widthIn: 6.0, y: 0.5 }],
    claims: [],
  },
  {
    id: "crest-sticker",
    title: "Golden Retrievers Crest — Sticker",
    description:
      "The team crest, die-cut on white vinyl. Three inches or four.\n\n" +
      "UV printed, kiss-cut, rated for outdoor use. It will outlast at least two of " +
      "the platforms this team's record had to be recovered from.",
    blueprintId: 400,
    // Printify Choice, not SPOKE (provider 1). SPOKE appears in the catalog for
    // this blueprint but rejects creation with "Decorator 1 not available for
    // this blueprint 400" — a decorator restriction the catalog endpoint does
    // not advertise. Found by probing, not by reading.
    printProviderId: 99,
    priceCents: 600,
    sizes: ['3" × 3"', '4" × 4"'],
    colors: [{ name: "White vinyl", hex: "#f4f4f2", variants: [45750, 45752] }],
    placements: [{ position: "front", art: "logos/crest.png", widthIn: 3.5, y: 0.5 }],
    claims: [],
  },
  {
    id: "monogram-tee",
    title: "Golden Retrievers Monogram — Tee",
    description:
      "The C-R monogram, high on the chest.\n\n" +
      "Bella+Canvas 3001: 4.2 oz combed ringspun cotton, 32 singles, side-seamed, " +
      "shoulder-taped, unisex sizing. Direct-to-garment, front only.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 12,
    printProviderId: 29,
    priceCents: 2800,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    colors: [
      { name: "White", hex: "#f4f4f2", variants: [18540, 18541, 18542, 18543, 18544, 18545] },
      { name: "Ash", hex: "#c9cbc8", variants: [38602, 38605, 38608, 38611, 38614, 38617] },
      { name: "Athletic Heather", hex: "#b0b2ad", variants: [18076, 18077, 18078, 18079, 18080, 18081] },
    ],
    // 884px of art. 2.95in is where it prints at 300 dpi, so that is where it
    // prints. Small on a shirt, and honest about why.
    placements: [{ position: "front", art: "logos/monogram.png", widthIn: 2.95, y: 0.3 }],
    claims: [],
  },
  {
    id: "wordmark-tee",
    title: "Golden Retrievers Wordmark — Tee",
    description:
      "The wordmark across the chest, gold over ivory on a skate-blade underline.\n\n" +
      "Bella+Canvas 3001: 4.2 oz combed ringspun cotton, 32 singles, side-seamed, " +
      "shoulder-taped, unisex sizing. Direct-to-garment, front only.\n\n" +
      "Black, navy, heather navy and dark grey heather. The mark was drawn on black " +
      "and is offered on the bodies it was drawn for.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 12,
    printProviderId: 29,
    priceCents: 2800,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    colors: [
      { name: "Black", hex: "#17191b", variants: [18100, 18101, 18102, 18103, 18104, 18105] },
      { name: "Navy", hex: "#1b2a3d", variants: [18396, 18397, 18398, 18399, 18400, 18401] },
      { name: "Heather Navy", hex: "#2f3a4c", variants: [18268, 18269, 18270, 18271, 18272, 18273] },
      { name: "Dark Grey Heather", hex: "#3e4245", variants: [18148, 18149, 18150, 18151, 18152, 18153] },
    ],
    placements: [{ position: "front", art: "logos/wordmark.png", widthIn: 5.17, y: 0.34 }],
    claims: [],
  },
  {
    id: "wordmark-hoodie",
    title: "Golden Retrievers Wordmark — Hoodie",
    description:
      "The wordmark on eight ounces of fleece.\n\n" +
      "Gildan 18500: cotton/polyester, brushed interior, front pouch, two-ply hood, " +
      "flat drawcord, ribbed cuffs and hem. The drawcord is the extent of the " +
      "features.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 77,
    printProviderId: 29,
    priceCents: 5800,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    colors: [
      { name: "Black", hex: "#17191b", variants: [32918, 32919, 32920, 32921, 32922, 32923] },
      { name: "Navy", hex: "#1b2a3d", variants: [32894, 32895, 32896, 32897, 32898, 32899] },
      { name: "Charcoal", hex: "#4a4d4f", variants: [42211, 42212, 42213, 42214, 42215, 42216] },
    ],
    placements: [{ position: "front", art: "logos/wordmark.png", widthIn: 5.17, y: 0.42 }],
    claims: [],
  },
  {
    id: "wordmark-cap",
    title: "Golden Retrievers Wordmark — Cap",
    description:
      "The wordmark embroidered on a Richardson 112. Structured front panels, " +
      "mesh back, pre-curved visor, snapback closure, one size.\n\n" +
      "Stitched rather than printed: the gold and the ivory are thread, and the " +
      "shapes between them are bare twill.\n\n" +
      "Black, charcoal and two-tone. There is no light colourway: the mark's " +
      "second word is ivory.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    // Richardson 112 through Printify Choice rather than the same cap through
    // Duplium, which the catalog also offers. Two reasons, both checked against
    // the shipping endpoint: it is $4.49 to post rather than $7.49, and it keeps
    // the whole line to two print providers. Printify groups shipping by product
    // type AND provider, so a third provider would not merge with anything.
    // Rates are in docs/store/POP-UP.md.
    blueprintId: 1743,
    printProviderId: 99,
    priceCents: 3000,
    sizes: ["One size"],
    colors: [
      { name: "Black", hex: "#17191b", variants: [118722] },
      { name: "Black / Charcoal", hex: "#232628", variants: [118723] },
      { name: "Black / White", hex: "#1c1f21", variants: [118724] },
      { name: "Charcoal / Black", hex: "#3b3e40", variants: [118726] },
    ],
    placements: [{ position: "front", art: "logos/wordmark.png", widthIn: 5.17, y: 0.5 }],
    claims: [],
  },
  {
    id: "wordmark-beanie",
    title: "Golden Retrievers Wordmark — Beanie",
    description:
      "The wordmark embroidered on a cuffed knit beanie. Yupoong 1501KC: acrylic, " +
      "double-layer cuff, one size.\n\n" +
      "Black and navy.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 1691,
    printProviderId: 99,
    priceCents: 2600,
    sizes: ["One size"],
    colors: [
      { name: "Black", hex: "#17191b", variants: [116417] },
      { name: "Navy", hex: "#1b2a3d", variants: [116425] },
    ],
    placements: [{ position: "front", art: "logos/wordmark.png", widthIn: 4.7, y: 0.5 }],
    claims: [],
  },
  {
    id: "wordmark-mug",
    title: "Golden Retrievers Wordmark — Mug",
    description:
      "The wordmark on a black ceramic mug, eleven ounces or fifteen. " +
      "Dye-sublimated, dishwasher and microwave safe.\n\n" +
      "Printed on one side. The black body is what lets this mark be used at all — " +
      "on white it loses its second word.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 479,
    printProviderId: 29,
    priceCents: 1800,
    sizes: ["11 oz", "15 oz"],
    colors: [{ name: "Black", hex: "#17191b", variants: [65217, 104470] }],
    placements: [{ position: "front", art: "logos/wordmark.png", widthIn: 5.17, y: 0.5 }],
    claims: [],
  },
  {
    id: "retriever-tee",
    title: "Golden Retrievers Pixel Retriever — Tee",
    description:
      "The retriever, assembled out of ice pixels and coming apart at the tail, " +
      "with a tennis ball in orbit. High on the chest.\n\n" +
      "Bella+Canvas 3001: 4.2 oz combed ringspun cotton, 32 singles, side-seamed, " +
      "shoulder-taped, unisex sizing. Direct-to-garment, front only. Black and navy.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 12,
    printProviderId: 29,
    priceCents: 2800,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    colors: [
      { name: "Black", hex: "#17191b", variants: [18100, 18101, 18102, 18103, 18104, 18105] },
      { name: "Navy", hex: "#1b2a3d", variants: [18396, 18397, 18398, 18399, 18400, 18401] },
    ],
    // 856px of art, so 2.85in at 300 dpi and no more. A badge, not a chest print.
    placements: [{ position: "front", art: "logos/retriever.png", widthIn: 2.85, y: 0.22 }],
    claims: [],
  },
  {
    id: "retriever-sticker",
    title: "Golden Retrievers Pixel Retriever — Sticker",
    description:
      "The pixel retriever on the black it was drawn on, die-cut on white vinyl. " +
      "Three inches or four.\n\n" +
      "UV printed, kiss-cut, rated for outdoor use.",
    blueprintId: 400,
    printProviderId: 99,
    priceCents: 600,
    sizes: ['3" × 3"', '4" × 4"'],
    colors: [{ name: "Black on white vinyl", hex: "#17191b", variants: [45750, 45752] }],
    // The plate, not the keyed file. Vinyl is white and this mark has no light
    // colourway, so it carries its own ground onto the sticker.
    placements: [{ position: "front", art: "logos/retriever-plate.png", widthIn: 2.6, y: 0.5 }],
    claims: [],
  },
];

/** Resolve {{tokens}} in a description from site.json. Same idiom as lib/store.ts. */
export function fillTokens(text: string, site: SiteData): string {
  const values: Record<string, () => string> = {
    firstYear: () => String(firstYear(site)),
    sessions: () => String(site.sessions.length),
    people: () => String(site.players.length),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (whole, k: string) => values[k]?.() ?? whole);
}
