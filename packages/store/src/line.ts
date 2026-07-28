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
 *
 * `areaShape` is the SHAPE of the tightest canvas the same scale will be sent
 * to, as height over width, and it defaults to this area's own. It exists
 * because one `scale` covers every variant and the variants are not all the same
 * shape: a black mug is offered in 11 oz at 2475 × 1155 and 15 oz at 2448 × 1266,
 * and a scale computed against the 15 oz — which is the SMALLER canvas, so the
 * one this function is handed — overflows the 11 oz by a tenth of an inch. It
 * cost nothing to notice with a landscape wordmark on it and would have cropped
 * a portrait crest.
 */
export function place(
  area: CatalogPlaceholder,
  art: ArtBox,
  widthIn: number,
  areaShape: number = area.height / area.width,
): {
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
  const maxH = areaWIn * areaShape * 0.94;
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
 * The trim is not cosmetic. Printify places an image by its file box, so a file
 * with a transparent border around its artwork prints at the size of the border
 * rather than the size asked for. Both sources this can be handed have one: the
 * vector masters render onto a square 6000px canvas that the 4526 x 5094 mark
 * sits inside, and `scripts/build-print-files.mjs` letterboxes a harvested
 * design into the garment's print area.
 *
 * It only applies to art with an alpha channel, and that condition is load
 * bearing: trimming a FLAT file eats the artwork rather than the margin around
 * it, because there is no margin. Nothing in the line is flat today —
 * `retriever-plate.png` was, and it went with the pixel retriever — but the
 * guard costs nothing and the next mark drawn for white vinyl will need it.
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
 * One mark, two inks, eight things to put it on.
 *
 * On 2026-07-28 the captain cut the line to `logo_one` and nothing else. Three
 * marks went with the eight products that carried them — a monogram, a skate-
 * blade wordmark and a pixel retriever — and their source files are off disk.
 * Do not restore them.
 *
 * **Resolution is no longer the binding constraint, and that is the change.**
 * Every mark this file used to print was a 1254px flat carrying about 900px of
 * artwork, which is 158 dpi at six inches. That is why the crest was sold at six
 * inches and the wordmark at 5.17 and the pixel retriever at 2.85: each was
 * pinned to the width where its file stopped being sharp. The vector masters in
 * docs/logos/vector have no such ceiling. `cli.ts logos` renders them at 6000px,
 * which trims to 4526 x 5094 of artwork, and 4526px is 453 dpi at ten inches.
 * Nothing below is sized to its file any more. Everything below is sized to the
 * garment, and the garment always wins first.
 *
 * **The split is the ink, and it is forced rather than chosen.** The full-colour
 * crest is outlined in black and its banner is black: on a black or navy body it
 * loses its shield edge and its banner becomes a hole. So it goes on white, ash
 * and heather. The one-ink gold crest is the same drawing with the cream keyed
 * out, so the garment shows through the banner lettering and the dog's face —
 * which reads on black, navy and charcoal and reads as nothing at all on white.
 * That is what put a cap, a beanie and a black mug back in this line: headwear
 * is bought in black.
 *
 * One trap survives the re-export, and it is why `dpi` is a range and not a
 * number: Printify's placement is a PROPORTION of the print area, and the print
 * area is bigger on a 3XL than on an S. One scale is sent for every size. The
 * tee below prints 7.38 inches wide on a small and 10.0 on everything from L up,
 * and the second number is the one that decides whether the print looks soft, so
 * sync.ts reports both and products.json stores both.
 *
 * The floor is 300 dpi at the printed size, measured on the LARGEST size
 * offered. Nothing here is close to it; the worst in the line is 453.
 */
export const LINE: LineItem[] = [
  /* ---------------------------------------------------------------- *
   * FULL COLOUR — light bodies.                                       *
   * dist/print/logos/crest.png, 4526 x 5094, off                      *
   * docs/logos/vector/logo-one-transparent-600dpi.png.                *
   * ---------------------------------------------------------------- */
  {
    id: "crest-tee",
    title: "Golden Retrievers Crest — Tee",
    description:
      "The crest across the chest, full colour, at the size the vector master " +
      "allows rather than the size the old file could hold. Ten inches wide on a " +
      "large, seven and a half on a small — the print is a proportion of the " +
      "garment, so it grows with it.\n\n" +
      "Bella+Canvas 3001: 4.2 oz combed ringspun cotton, 32 singles, side-seamed, " +
      "shoulder-taped, unisex sizing. Direct-to-garment, front only.\n\n" +
      "White, ash and athletic heather. The shield is outlined in black and the " +
      "banner is black, so this colourway needs something under it.\n\n" +
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
    // 7.375in is the width that puts the print at 10.0in on the four sizes that
    // share the 15 x 17in canvas — L, XL, 2XL and 3XL, four of the six. Only S
    // and M are smaller. 4526px over 10in is 453 dpi, which is the number this
    // whole re-export exists to produce; the old 946px file managed 158 at six
    // inches and 116 on a 3XL.
    placements: [{ position: "front", art: "logos/crest.png", widthIn: 7.375, y: 0.42 }],
    claims: [],
  },
  {
    id: "crest-hoodie",
    title: "Golden Retrievers Crest — Hoodie",
    description:
      "The crest on eight ounces of fleece. The front panel is wider than it is " +
      "tall — the pouch takes the rest — so a portrait mark is limited by height " +
      "here and prints a little under seven inches across.\n\n" +
      "Gildan 18500: 8.0 oz cotton/polyester fleece, brushed interior, front pouch, " +
      "two-ply hood, flat drawcord, ribbed cuffs and hem. The drawcord is the extent " +
      "of the features.\n\n" +
      "Sport grey, white and ash.\n\n" +
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
    // The hoodie front is 12.36 x 8.24in on a small. At 6.85in wide the crest is
    // 7.71in tall, just inside the 94% the provider will not trim into. Sized to
    // the garment, not to the file — the file would go to fifteen.
    placements: [{ position: "front", art: "logos/crest.png", widthIn: 6.85, y: 0.5 }],
    claims: [],
  },
  {
    id: "crest-sticker",
    title: "Golden Retrievers Crest — Sticker",
    description:
      "The crest die-cut on white vinyl. Three inches or four.\n\n" +
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
    placements: [{ position: "front", art: "logos/crest.png", widthIn: 2.3, y: 0.5 }],
    claims: [],
  },

  /* ---------------------------------------------------------------- *
   * ONE INK — dark bodies.                                            *
   * dist/print/logos/crest-gold.png, 4526 x 5094, off                 *
   * docs/logos/vector/logo-one-one-color-gold.svg with the cream       *
   * keyed out everywhere, so the garment is the second colour.        *
   * ---------------------------------------------------------------- */
  {
    id: "crest-gold-tee",
    title: "Golden Retrievers Crest, Gold — Tee",
    description:
      "The same crest in a single ink. Everything that is cream in the full-colour " +
      "mark is the shirt here: the banner lettering, the muzzle, the eyes, the tape " +
      "on the blades. Ten inches wide on a large.\n\n" +
      "Bella+Canvas 3001: 4.2 oz combed ringspun cotton, 32 singles, side-seamed, " +
      "shoulder-taped, unisex sizing. Direct-to-garment, front only.\n\n" +
      "Black, navy, heather navy and dark grey heather. There is no light " +
      "colourway and there cannot be one — on white the mark has nothing to cut " +
      "into.\n\n" +
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
    placements: [{ position: "front", art: "logos/crest-gold.png", widthIn: 7.375, y: 0.42 }],
    claims: [],
  },
  {
    id: "crest-gold-hoodie",
    title: "Golden Retrievers Crest, Gold — Hoodie",
    description:
      "The one-ink crest on eight ounces of fleece.\n\n" +
      "Gildan 18500: cotton/polyester, brushed interior, front pouch, two-ply hood, " +
      "flat drawcord, ribbed cuffs and hem. The drawcord is the extent of the " +
      "features.\n\n" +
      "Black, navy and charcoal.\n\n" +
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
    placements: [{ position: "front", art: "logos/crest-gold.png", widthIn: 6.85, y: 0.5 }],
    claims: [],
  },
  {
    id: "crest-gold-cap",
    title: "Golden Retrievers Crest, Gold — Cap",
    description:
      "The crest embroidered on a Richardson 112. Structured front panels, mesh " +
      "back, pre-curved visor, snapback closure, one size.\n\n" +
      "Stitched rather than printed: the gold is thread and the shapes inside it " +
      "are bare twill. The embroidery panel is 5.9 in across and 2 in tall, and a " +
      "portrait mark is bound by the second figure.\n\n" +
      "Black, charcoal and two-tone.\n\n" +
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
    placements: [{ position: "front", art: "logos/crest-gold.png", widthIn: 1.66, y: 0.5 }],
    claims: [],
  },
  {
    id: "crest-gold-beanie",
    title: "Golden Retrievers Crest, Gold — Beanie",
    description:
      "The crest embroidered on a cuffed knit beanie. Yupoong 1501KC: acrylic, " +
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
    placements: [{ position: "front", art: "logos/crest-gold.png", widthIn: 1.45, y: 0.5 }],
    claims: [],
  },
  {
    id: "crest-gold-mug",
    title: "Golden Retrievers Crest, Gold — Mug",
    description:
      "The crest on a black ceramic mug, eleven ounces or fifteen. Dye-sublimated, " +
      "dishwasher and microwave safe.\n\n" +
      "Printed on one side. The black body is what lets this mark be used at all — " +
      "on white it has nothing to cut into.\n\n" +
      "Buffalo, N.Y. Playing since {{firstYear}}.",
    blueprintId: 479,
    printProviderId: 29,
    priceCents: 1800,
    sizes: ["11 oz", "15 oz"],
    colors: [{ name: "Black", hex: "#17191b", variants: [65217, 104470] }],
    // 3.15in, and the limit is the 11 oz rather than the 15. The two sizes are
    // not the same shape — 2475 x 1155 against 2448 x 1266 — so the taller mug
    // is the WIDER canvas and the scale that fits it overflows the smaller one.
    // `place()` is handed the tightest shape of the two for exactly this reason.
    placements: [{ position: "front", art: "logos/crest-gold.png", widthIn: 3.15, y: 0.5 }],
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
