import type { PrintPlacement, ProductImage } from "../../lib/store";
import { inkOn, ballOn } from "../../lib/store";

/** The subset of a placement a drawing needs: how wide, and how high up. */
type Place = Pick<PrintPlacement, "scale" | "y">;

/**
 * Product imagery, drawn.
 *
 * There are no photographs in this store and there is no photo shoot planned.
 * Every figure on this page is inline SVG generated from products.json at build
 * time. Three reasons, in order of how much they mattered:
 *
 * 1. The archive does not ship things it cannot source. A stock mockup of a
 *    shirt that has never been printed is a photograph of a lie. A technical
 *    drawing of a shirt that has never been printed is a drawing.
 * 2. It makes the colour switcher real. A swatch recolours the garment because
 *    the garment is a path with a fill, not a JPEG someone rendered in a
 *    different colour and uploaded.
 * 3. It renders into static HTML with no JS and no network. The catalog is
 *    fully legible with scripting off, which was a hard requirement.
 *
 * These are flats, in the manner of a spec sheet, because that is what the rest
 * of the site looks like. When Printify is wired up, real mockups arrive from
 * the provider and these become the fallback. See packages/store/README.md.
 */

type Box = { x: number; y: number; w: number; h: number };

/* ------------------------------------------------------------------ */
/* Artwork. Each design draws itself into a box, in one ink colour.    */
/* ------------------------------------------------------------------ */

/** The tennis ball. The whole brand. No paw prints, no puns. */
function Ball({ cx, cy, r, ball, ink }: { cx: number; cy: number; r: number; ball: string; ink: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={ball} />
      {/* The seam curves toward the middle on each side. It is the only
          decoration this brand gets. */}
      <path
        d={`M ${cx - r * 0.72} ${cy - r * 0.7} Q ${cx - r * 0.02} ${cy} ${cx - r * 0.72} ${cy + r * 0.7}`}
        fill="none" stroke={ink} strokeWidth={r * 0.1} strokeLinecap="round" opacity={0.85}
      />
      <path
        d={`M ${cx + r * 0.72} ${cy - r * 0.7} Q ${cx + r * 0.02} ${cy} ${cx + r * 0.72} ${cy + r * 0.7}`}
        fill="none" stroke={ink} strokeWidth={r * 0.1} strokeLinecap="round" opacity={0.85}
      />
    </g>
  );
}

/* A drawn `Crest` stood here — a ball, "Golden Retrievers", and a founding year
   set in type — alongside five other drawings that set archive text: a wordmark,
   a small wordmark, an `est`, an `eighty-nine`, a `four-spellings` and a
   `forty-five`. All six are deleted rather than commented out, so nobody reaches
   for one.

   Two of them typed the founding year as a literal, and on 2026-07-26 that
   became false: the captain's stats workbook carries a Winter 2011 season with
   full statistics and a paid franchise fee, and he has ruled 2011. Nothing here
   types it now. Where the store states the year at all it resolves `FOUNDED`
   from lib/data.ts, which counts it off the earliest session and moves on its
   own the next time an older season turns up. */

function BallOnly({ b, ink, ball }: { b: Box; ink: string; ball: string }) {
  return <Ball cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={Math.min(b.w, b.h) * 0.42} ball={ball} ink={ink} />;
}

/**
 * The team's marks, which are raster files and not drawings.
 *
 * The `ball` above is drawn here and harvested back out by
 * `scripts/build-print-files.mjs`, so the site is the single source of that art.
 * These run the other way: they arrive as flattened PNGs in `docs/logos`, and
 * `packages/store/src/artwork.ts` produces the press file and the web file from
 * that one source in a single pass. Same picture at both ends.
 *
 * They carry no `data-art` (see the render below), which is what keeps the
 * harvester's hands off them — there is nothing here it could lift that would be
 * better than the file it came from.
 *
 * Each aspect is the prepared file's own, so the box only ever constrains it.
 * Change one of these only when the file behind it changes: they are how the
 * drawing on this page stays the shape of the thing that gets printed.
 */
const MARKS: Record<string, { href: string; aspect: number }> = {
  "crest-logo": { href: "/store/crest.webp", aspect: 1067 / 946 },
  "monogram-logo": { href: "/store/monogram.webp", aspect: 820 / 884 },
  "wordmark-logo": { href: "/store/wordmark.webp", aspect: 538 / 1551 },
  "retriever-logo": { href: "/store/retriever.webp", aspect: 754 / 856 },
};

function Mark({ b, design, place }: { b: Box; design: string; place?: Place }) {
  const mark = MARKS[design];
  if (!mark) return null;
  // `place` is the placement actually sent to the shop: `scale` is the fraction
  // of the print area's width the mark occupies and `y` is where its centre
  // sits. Without it the mark fills the box, which is only right for a product
  // that has never been sent and has no measured placement to draw.
  const w = place ? b.w * place.scale : Math.min(b.w, b.h / mark.aspect);
  const h = w * mark.aspect;
  const cy = b.y + b.h * (place?.y ?? 0.5);
  return (
    <image
      href={mark.href}
      x={b.x + (b.w - w) / 2}
      y={cy - h / 2}
      width={w}
      height={h}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

/**
 * The pixel retriever with the black it was drawn on, which is what the sticker
 * actually is.
 *
 * Vinyl is white and this mark has no light colourway, so the press file for the
 * sticker is the untouched source — ground and all. The plate here reproduces
 * that: a black square, with the art at the 68% of its width it occupies in the
 * file. Drawing the keyed mark on white here would show a sticker nobody is
 * going to receive.
 */
function RetrieverPlate({ b, place }: { b: Box; place?: Place }) {
  const side = place ? b.w * place.scale : Math.min(b.w, b.h);
  const x = b.x + (b.w - side) / 2;
  const y = b.y + b.h * (place?.y ?? 0.5) - side / 2;
  // The art occupies 856 px of the 1254 px plate. Same fraction here.
  const inset = side * ((1 - 856 / 1254) / 2);
  return (
    <g>
      <rect x={x} y={y} width={side} height={side} rx={side * 0.04} fill="#0b0c0d" />
      <Mark
        b={{ x: x + inset, y: y + inset, w: side - inset * 2, h: side - inset * 2 }}
        design="retriever-logo"
      />
    </g>
  );
}

function Art({ design, b, ink, ball, place }: {
  design: ProductImage["design"]; b: Box; ink: string; ball: string; place?: Place;
}) {
  switch (design) {
    case "crest-logo":
    case "monogram-logo":
    case "wordmark-logo":
    case "retriever-logo": return <Mark b={b} design={design} place={place} />;
    case "retriever-plate": return <RetrieverPlate b={b} place={place} />;
    case "ball": return <BallOnly b={b} ink={ink} ball={ball} />;
  }
}

/** Designs that are files rather than drawings, and so are not harvested. */
const IMAGE_DESIGNS = new Set<ProductImage["design"]>([
  "crest-logo", "monogram-logo", "wordmark-logo", "retriever-logo", "retriever-plate",
]);

/* ------------------------------------------------------------------ */
/* Silhouettes. Flats, on a 400 × 420 field.                           */
/* ------------------------------------------------------------------ */

/** Collar depth is the only difference between the front and back of a tee. */
const teePath = (collarDip: number) =>
  `M 168 92 L 141 85 Q 132 83 124 89 L 80 122 Q 72 128 76 137 L 99 195 Q 103 205 114 201 ` +
  `L 136 192 L 136 362 Q 136 372 146 372 L 254 372 Q 264 372 264 362 L 264 192 ` +
  `L 286 201 Q 297 205 301 195 L 324 137 Q 328 128 320 122 L 276 89 Q 268 83 259 85 ` +
  `L 232 92 C 226 ${92 + collarDip} 174 ${92 + collarDip} 168 92 Z`;

const HOODIE_BODY =
  `M 158 104 L 132 92 Q 122 89 113 96 L 66 132 Q 57 139 62 149 L 88 212 Q 93 223 105 218 ` +
  `L 130 207 L 130 368 Q 130 380 142 380 L 258 380 Q 270 380 270 368 L 270 207 L 295 218 ` +
  `Q 307 223 312 212 L 338 149 Q 343 139 334 132 L 287 96 Q 278 89 268 92 L 242 104 ` +
  `C 234 124 166 124 158 104 Z`;

const JERSEY_BODY =
  `M 162 96 L 134 86 Q 122 83 112 91 L 58 136 Q 47 145 54 157 L 92 224 Q 99 236 111 230 ` +
  `L 132 219 L 128 372 Q 127 386 141 386 L 259 386 Q 273 386 272 372 L 268 219 L 289 230 ` +
  `Q 301 236 308 224 L 346 157 Q 353 145 342 136 L 288 91 Q 278 83 266 86 L 238 96 ` +
  `C 230 116 170 116 162 96 Z`;

type SilProps = { fill: string; ink: string; ball: string; id: string; children?: React.ReactNode };

function Shade({ id }: { id: string }) {
  return (
    <defs>
      {/* A flat is still a garment. One soft gradient keeps it from reading as a
          logo, without pretending to be a photograph. */}
      <linearGradient id={`${id}-sh`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.13" />
      </linearGradient>
    </defs>
  );
}

const seam = (ink: string) => ({ fill: "none", stroke: ink, strokeWidth: 1, opacity: 0.16 });

function Tee({ fill, ink, id, children, back }: SilProps & { back?: boolean }) {
  const d = teePath(back ? 12 : 26);
  return (
    <g>
      <Shade id={id} />
      <path d={d} fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.28} strokeLinejoin="round" />
      <path d={d} fill={`url(#${id}-sh)`} />
      {/* collar rib */}
      <path
        d={back
          ? "M 168 92 C 174 100 226 100 232 92"
          : "M 168 92 C 174 114 226 114 232 92"}
        {...seam(ink)} strokeWidth={2} opacity={0.3}
      />
      {/* sleeve hems */}
      <path d="M 99 195 L 136 192" {...seam(ink)} />
      <path d="M 301 195 L 264 192" {...seam(ink)} />
      {/* bottom hem */}
      <path d="M 136 358 L 264 358" {...seam(ink)} />
      {children}
    </g>
  );
}

function Hoodie({ fill, ink, ball, id, children }: SilProps) {
  return (
    <g>
      <Shade id={id} />
      {/* hood, behind */}
      <path
        d="M 158 104 C 150 60 250 60 242 104 C 226 122 174 122 158 104 Z"
        fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.28}
      />
      <path d="M 158 104 C 176 84 224 84 242 104" {...seam(ink)} strokeWidth={1.5} />
      <path d={HOODIE_BODY} fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.28} strokeLinejoin="round" />
      <path d={HOODIE_BODY} fill={`url(#${id}-sh)`} />
      {/* pouch pocket */}
      <path
        d="M 148 300 L 252 300 L 246 352 L 154 352 Z"
        {...seam(ink)} strokeWidth={1.25} opacity={0.24}
      />
      {/* cuffs + hem ribbing */}
      <path d="M 88 212 L 130 207" {...seam(ink)} />
      <path d="M 312 212 L 270 207" {...seam(ink)} />
      <path d="M 130 362 L 270 362" {...seam(ink)} strokeWidth={1.5} />
      {/* drawcords — the extent of the features */}
      <path d="M 186 112 L 182 158" fill="none" stroke={ball} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M 214 112 L 219 152" fill="none" stroke={ball} strokeWidth={2.4} strokeLinecap="round" />
      {children}
    </g>
  );
}

function Jersey({ fill, ink, ball, id, children }: SilProps) {
  return (
    <g>
      <Shade id={id} />
      <path d={JERSEY_BODY} fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.28} strokeLinejoin="round" />
      <path d={JERSEY_BODY} fill={`url(#${id}-sh)`} />
      {/* shoulder yoke */}
      <path d="M 134 122 C 170 140 230 140 266 122" {...seam(ink)} strokeWidth={1.5} opacity={0.22} />
      {/* sleeve stripes: two, because that is how many this team has */}
      <path d="M 78 178 L 116 205" fill="none" stroke={ball} strokeWidth={7} opacity={0.9} />
      <path d="M 89 160 L 127 187" fill="none" stroke={ink} strokeWidth={4} opacity={0.35} />
      <path d="M 322 178 L 284 205" fill="none" stroke={ball} strokeWidth={7} opacity={0.9} />
      <path d="M 311 160 L 273 187" fill="none" stroke={ink} strokeWidth={4} opacity={0.35} />
      {/* hem stripe */}
      <path d="M 129 356 L 271 356" fill="none" stroke={ball} strokeWidth={7} opacity={0.9} />
      {/* laced collar */}
      <path d="M 162 96 C 170 116 230 116 238 96" {...seam(ink)} strokeWidth={2} opacity={0.3} />
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M ${188 - i * 2} ${106 + i * 9} L ${212 + i * 2} ${112 + i * 9}`}
          fill="none" stroke={ink} strokeWidth={1.4} opacity={0.45}
        />
      ))}
      {children}
    </g>
  );
}

function Cap({ fill, ink, id, children }: SilProps) {
  return (
    <g>
      <Shade id={id} />
      {/* brim */}
      <path
        d="M 92 258 Q 200 232 308 258 Q 312 288 200 292 Q 88 288 92 258 Z"
        fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.3}
      />
      <path d="M 100 268 Q 200 250 300 268" {...seam(ink)} strokeWidth={1.2} />
      {/* crown. The cubic's apex is y≈177.5, NOT the 150 in the control points —
          everything below has to sit under that curve or it reads as antennae. */}
      <path
        d="M 104 260 C 104 150 296 150 296 260 Q 200 240 104 260 Z"
        fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.3}
      />
      <path d="M 104 260 C 104 150 296 150 296 260 Q 200 240 104 260 Z" fill={`url(#${id}-sh)`} />
      {/* panel seams — six panels, three of them visible. The lower ends stop at
          the crown's bottom edge, which dips to y=250 at centre and y≈252 at the
          sides. */}
      <path d="M 200 181 L 200 249" {...seam(ink)} strokeWidth={1.2} opacity={0.22} />
      <path d="M 152 196 C 158 218 156 236 154 250" {...seam(ink)} strokeWidth={1.2} opacity={0.18} />
      <path d="M 248 196 C 242 218 244 236 246 250" {...seam(ink)} strokeWidth={1.2} opacity={0.18} />
      {/* button, tucked just under the apex */}
      <circle cx={200} cy={183} r={4} fill={ink} opacity={0.3} />
      {children}
    </g>
  );
}

function Beanie({ fill, ink, id, children }: SilProps) {
  return (
    <g>
      <Shade id={id} />
      <path
        d="M 116 286 C 108 168 292 168 284 286 Z"
        fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.3}
      />
      <path d="M 116 286 C 108 168 292 168 284 286 Z" fill={`url(#${id}-sh)`} />
      {/* rib knit */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path
          key={i}
          d={`M ${132 + i * 23} ${186 + Math.abs(3 - i) * 9} L ${132 + i * 23} 284`}
          {...seam(ink)} strokeWidth={1.4} opacity={0.14}
        />
      ))}
      {/* cuff, double layer */}
      <rect x={112} y={284} width={176} height={46} rx={3} fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.3} />
      <rect x={112} y={284} width={176} height={46} rx={3} fill={`url(#${id}-sh)`} />
      <path d="M 112 307 L 288 307" {...seam(ink)} strokeWidth={1.2} />
      {children}
    </g>
  );
}

/**
 * One kiss-cut sticker, not a sheet.
 *
 * This drew a five-up sheet, because the catalog used to sell one. Printify
 * does not make a five-up sheet; it makes a single die-cut square with a white
 * margin, which is what the product is now and what this draws. The rounded
 * square is the cut line and the shadow under it is the backing paper.
 */
function StickerDieCut({ ink, id, children }: SilProps) {
  return (
    <g>
      <Shade id={id} />
      {/* backing paper, offset to read as a separate layer */}
      <rect x={92} y={112} width={216} height={216} rx={10} fill="#e8e6e1" opacity={0.5} />
      <rect x={88} y={106} width={216} height={216} rx={10} fill="#fdfdfc" stroke={ink} strokeWidth={1.25} strokeOpacity={0.25} />
      <rect x={88} y={106} width={216} height={216} rx={10} fill={`url(#${id}-sh)`} />
      {/* the cut line itself */}
      <rect
        x={99} y={117} width={194} height={194} rx={7}
        fill="none" stroke={ink} strokeWidth={1} strokeOpacity={0.2} strokeDasharray="4 3"
      />
      {children}
    </g>
  );
}

function Puck({ id, children }: SilProps) {
  // A puck is black. It is not a colourway and products.json does not offer one.
  const black = "#17191b";
  return (
    <g>
      <Shade id={id} />
      {/* side wall */}
      <path d="M 106 210 L 106 250 A 94 34 0 0 0 294 250 L 294 210 Z" fill="#0e0f10" />
      {/* diamond-cut edge */}
      {Array.from({ length: 26 }, (_, i) => {
        const t = (i / 25) * Math.PI;
        const x = 200 - Math.cos(t) * 94;
        const yb = 210 + Math.sin(t) * 34;
        return <line key={i} x1={x} y1={yb - 2} x2={x} y2={yb + 38} stroke="#2a2d30" strokeWidth={1.6} opacity={0.7} />;
      })}
      {/* top face */}
      <ellipse cx={200} cy={210} rx={94} ry={34} fill={black} stroke="#3a3f43" strokeWidth={1.2} />
      <ellipse cx={200} cy={210} rx={94} ry={34} fill={`url(#${id}-sh)`} />
      <ellipse cx={200} cy={210} rx={80} ry={27} fill="none" stroke="#3a3f43" strokeWidth={1} opacity={0.5} />
      {children}
    </g>
  );
}

function Mug({ fill, ink, id, children }: SilProps) {
  return (
    <g>
      <Shade id={id} />
      {/* handle */}
      <path
        d="M 286 176 C 340 172 344 268 286 264"
        fill="none" stroke={ink} strokeWidth={17} strokeOpacity={0.9} strokeLinecap="round"
      />
      <path
        d="M 286 176 C 340 172 344 268 286 264"
        fill="none" stroke={fill} strokeWidth={11} strokeLinecap="round"
      />
      {/* body */}
      <path
        d="M 108 158 L 292 158 L 286 314 Q 285 330 269 330 L 131 330 Q 115 330 114 314 Z"
        fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.3} strokeLinejoin="round"
      />
      <path
        d="M 108 158 L 292 158 L 286 314 Q 285 330 269 330 L 131 330 Q 115 330 114 314 Z"
        fill={`url(#${id}-sh)`}
      />
      {/* rim */}
      <ellipse cx={200} cy={158} rx={92} ry={17} fill={fill} stroke={ink} strokeWidth={1.25} strokeOpacity={0.3} />
      <ellipse cx={200} cy={158} rx={80} ry={11} fill="#0e1518" opacity={0.13} />
      {children}
    </g>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Where the artwork sits on each silhouette, and what the spec sheet calls it.
 *
 * `label` is the FALLBACK only. It used to be the whole story and it lied: it
 * quoted the blueprint's maximum print area — "12 in × 16 in" — under a crest
 * that prints six inches wide. The caption a reader sees now comes from
 * `printLabel()`, which reads the placement actually sent to and read back from
 * the shop. These strings only appear for a silhouette no product has been sent
 * for yet, and they say what the garment takes rather than what it will get.
 *
 * `art` is an optional transform applied to the artwork and to the print-area
 * box, for silhouettes whose print face is not square to the viewer. Only the
 * puck needs it: it is drawn in three-quarter view, so its face is an ellipse
 * (rx 94, ry 34) and anything laid on it must be squashed to ~0.38 or it reads
 * as floating in front of the puck rather than printed on it. `labelY` then
 * puts the dimension label back in unsquashed space, where it is legible.
 */
const PRINT: Record<
  ProductImage["silhouette"],
  { box: Box; label: string; art?: string; labelY?: number }
> = {
  tee: { box: { x: 154, y: 148, w: 92, h: 122 }, label: "DTG front" },
  "tee-back": { box: { x: 150, y: 140, w: 100, h: 134 }, label: "DTG back" },
  hoodie: { box: { x: 152, y: 168, w: 96, h: 116 }, label: "DTG front" },
  jersey: { box: { x: 148, y: 158, w: 104, h: 128 }, label: "Sublimated · full front" },
  cap: { box: { x: 168, y: 190, w: 64, h: 52 }, label: "Embroidered front" },
  beanie: { box: { x: 178, y: 292, w: 44, h: 32 }, label: "Cuff patch" },
  sticker: { box: { x: 106, y: 124, w: 180, h: 180 }, label: "Kiss-cut" },
  puck: {
    box: { x: 140, y: 150, w: 120, h: 120 },
    label: "1-colour silkscreen",
    art: "translate(200 210) scale(1 .38) translate(-200 -210)",
    labelY: 176,
  },
  mug: { box: { x: 132, y: 182, w: 136, h: 122 }, label: "Wrap print" },
};

export default function ProductFigure({
  image,
  color,
  id,
  showPrintArea = false,
  printLabel,
  placement,
}: {
  image: ProductImage;
  /** Garment hex, straight from the selected colourway. */
  color: string;
  /** Unique per instance: SVG ids are global and gradients will cross-wire. */
  id: string;
  /** The spec-sheet overlay. Shown on hover/focus on the grid; always on detail. */
  showPrintArea?: boolean;
  /** What will actually be printed. See lib/store.ts `printLabel()`. */
  printLabel?: string;
  /**
   * The placement sent to the shop, so the mark is drawn at the fraction of the
   * print area it actually occupies rather than filling the box. Undefined for a
   * product that has never been sent, which is the only case where filling the
   * box is the honest thing to do.
   */
  placement?: Place;
}) {
  const ink = inkOn(color);
  const ball = ballOn(color);
  const { box, label: fallbackLabel, art: artT, labelY } = PRINT[image.silhouette];
  const label = printLabel ?? fallbackLabel;
  const outline = "#0e1518";

  // `data-art` marks the printable artwork: scripts/build-print-files.mjs lifts
  // exactly this group out of the page to make the file the printer receives.
  // Designs that are already files carry no marker — there is nothing useful to
  // lift out of an <image> tag, and the harvester skips what it cannot find.
  const art = (
    <g transform={artT} {...(IMAGE_DESIGNS.has(image.design) ? {} : { "data-art": image.design })}>
      <Art design={image.design} b={box} ink={ink} ball={ball} place={placement} />
    </g>
  );
  const props: SilProps = { fill: color, ink: outline, ball, id };

  let body: React.ReactNode;
  switch (image.silhouette) {
    case "tee": body = <Tee {...props}>{art}</Tee>; break;
    case "tee-back": body = <Tee {...props} back>{art}</Tee>; break;
    case "hoodie": body = <Hoodie {...props}>{art}</Hoodie>; break;
    case "jersey": body = <Jersey {...props}>{art}</Jersey>; break;
    case "cap": body = <Cap {...props}>{art}</Cap>; break;
    case "beanie": body = <Beanie {...props}>{art}</Beanie>; break;
    case "sticker": body = <StickerDieCut {...props}>{art}</StickerDieCut>; break;
    case "puck": body = <Puck {...props}>{art}</Puck>; break;
    case "mug": body = <Mug {...props}>{art}</Mug>; break;
  }

  return (
    <svg
      viewBox="0 0 400 420"
      role="img"
      aria-label={`${image.silhouette.replace("-", " ")}, ${image.view}, drawn`}
      style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
    >
      {/* The garment casts a shadow onto the ice. It is the only thing on this
          page that is allowed to look soft. */}
      <ellipse cx={200} cy={392} rx={116} ry={11} fill="#0e1518" opacity={0.08} />
      {body}

      {/* Spec-sheet overlay: the print area, dimensioned, the way it would be on
          a real tech pack. This is the reveal on hover. */}
      <g
        style={{
          opacity: showPrintArea ? 1 : 0,
          transition: "opacity .32s ease",
        }}
        aria-hidden="true"
      >
        <g transform={artT}>
          <rect
            x={box.x} y={box.y} width={box.w} height={box.h}
            fill="none" stroke="var(--paint-b)" strokeWidth={1.1}
            strokeDasharray="5 4" opacity={0.85}
          />
          {[[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(
            ([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={2.2} fill="var(--paint-b)" />
          )}
        </g>
        <text
          x={box.x} y={labelY ?? box.y - 8}
          fill="var(--paint-b)" fontFamily="var(--mono)" fontSize={10.5} letterSpacing={0.6}
        >
          {label}
        </text>
      </g>
    </svg>
  );
}
