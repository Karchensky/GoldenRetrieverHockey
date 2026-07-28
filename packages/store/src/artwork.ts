import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";

/**
 * Print preparation for the captain's supplied logos.
 *
 * The site remains the source of the *generated* artwork: every design drawn by
 * `apps/web/components/store/ProductFigure.tsx` is harvested from the built
 * store by `scripts/build-print-files.mjs` and lands in `dist/print/`. Nothing
 * here touches that path or duplicates a single one of those drawings.
 *
 * What this handles is the other kind of art: the team logos in `docs/logos/`,
 * which arrive as flattened PNGs on a solid ground. A ground is a rectangle when
 * it is printed on a shirt, so they cannot go to a printer as they are.
 *
 * There are two grounds in that folder and they need opposite treatments. Which
 * one a file wants is not a preference; getting it wrong destroys the artwork.
 *
 * **`reach: "border"` — a flood fill inward from the edge.** This is what the
 * cream-ground logos need. `logo_one` and `logo_two` contain large cream areas
 * that are *part of the artwork* — the RETRIEVERS banner text, the dog's muzzle,
 * the tape on the stick blades, the dog's whole head in the monogram. A global
 * "make every cream pixel transparent" punches holes through all of them. A fill
 * that starts at the border and stops at the first dark outline cannot reach
 * them.
 *
 * **`reach: "everywhere"` — a straight colour key.** This is what the
 * black-ground concepts need, and the reason is the exact inverse. In
 * `concept-04` and `concept-11` the ground is black and *nothing drawn is black*:
 * the art is gold, ivory and ice blue, and every black region is ground — the
 * counters of the O and the D, the slots in the skate blade, the gaps between
 * the dog's pixels, the space between its legs. A border fill leaves all of
 * those opaque, which was verified before this option existed: the leg gap came
 * back as a solid black blob and the letter counters as black slugs. On a black
 * shirt DTG lays a white underbase under every non-transparent pixel, so those
 * would have printed as glossy black patches on matte black cotton; on navy they
 * would simply have been black.
 *
 * Neither mode redraws, recolours, or restyles anything. Same pixels, minus the
 * ground they were sitting on.
 */

/** Which pixels count as ground. See the file header — this is not a preference. */
export type Reach = "border" | "everywhere";

export type PreparedLogo = {
  source: string;
  /** Full-resolution press file, transparent. */
  out: string;
  /** Web-sized WebP, if one was asked for. */
  web?: string;
  /** Pixel size after the transparent margin is trimmed off. */
  width: number;
  height: number;
  /** Fraction of pixels that turned out to be background. Sanity signal. */
  backgroundFraction: number;
};

/** Squared Euclidean distance in RGB. Squared to keep the inner loop integer. */
function dist2(
  r: number, g: number, b: number,
  kr: number, kg: number, kb: number,
): number {
  const dr = r - kr, dg = g - kg, db = b - kb;
  return dr * dr + dg * dg + db * db;
}

/**
 * Anything this close to the paper colour, and reachable from the border, is
 * paper. Deliberately tight: the logos' outlines are near-black, so the fill has
 * an unambiguous wall to stop at and does not need a generous tolerance to work.
 */
const HARD_TOLERANCE = 34;
/**
 * The anti-aliased rim. A pixel on the boundary is a blend of paper and ink;
 * its distance from the paper colour is how much ink is in it, which is its
 * alpha. Beyond this distance a pixel is simply ink and stays opaque.
 */
const SOFT_TOLERANCE = 112;
/** How far the rim can extend. Two pixels covers the anti-aliasing on a 1254px source. */
const FEATHER_PASSES = 2;

/**
 * Remove the paper the logo was flattened onto and trim to the artwork.
 *
 * Returns the prepared buffer rather than writing it, so callers can inspect
 * before committing anything to disk.
 */
export async function removeBackground(
  png: Buffer,
  options: { reach?: Reach } = {},
): Promise<{ buffer: Buffer; backgroundFraction: number }> {
  const reach = options.reach ?? "border";
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const px = data as Uint8Array;

  /** Byte at an index. Out of range is impossible here and reads as 0 if it happens. */
  const at = (i: number): number => px[i] ?? 0;

  // The paper colour, taken as the median of the border ring rather than one
  // corner: these were generated, and generated flats are rarely perfectly flat.
  const bR: number[] = [], bG: number[] = [], bB: number[] = [];
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * ch;
    bR.push(at(i)); bG.push(at(i + 1)); bB.push(at(i + 2));
  };
  for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }
  const median = (a: number[]): number => { a.sort((p, q) => p - q); return a[a.length >> 1] ?? 0; };
  const kr = median(bR), kg = median(bG), kb = median(bB);

  const hard = HARD_TOLERANCE * HARD_TOLERANCE;
  const soft = SOFT_TOLERANCE * SOFT_TOLERANCE;

  const isBg = new Uint8Array(w * h);

  if (reach === "everywhere") {
    // Colour key. Ground is ground wherever it is, enclosed or not.
    for (let p = 0; p < w * h; p++) {
      const i = p * ch;
      if (dist2(at(i), at(i + 1), at(i + 2), kr, kg, kb) <= hard) isBg[p] = 1;
    }
  } else {
    // Flood fill inward from every border pixel. Explicit stack, not recursion:
    // a 1254 x 1254 fill is ~1.5M pixels deep in the worst case and would blow
    // the call stack.
    const stack: number[] = [];
    const push = (x: number, y: number) => {
      const p = y * w + x;
      if (isBg[p]) return;
      const i = p * ch;
      if (dist2(at(i), at(i + 1), at(i + 2), kr, kg, kb) > hard) return;
      isBg[p] = 1;
      stack.push(p);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
  }

  // Feather: walk out from the fill and give each rim pixel an alpha equal to
  // how much ink it holds, then un-premultiply so the colour it carries is the
  // ink's own and not the ink blended with paper. Without the un-premultiply,
  // dark art on a light ground keeps a pale halo that only shows up once the
  // shirt underneath is black.
  const alpha = new Uint8Array(w * h).fill(255);
  for (let p = 0; p < isBg.length; p++) if (isBg[p]) alpha[p] = 0;

  let frontier: number[] = [];
  for (let p = 0; p < isBg.length; p++) if (isBg[p]) frontier.push(p);

  const touched = new Uint8Array(w * h);
  for (let pass = 0; pass < FEATHER_PASSES; pass++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % w, y = (p / w) | 0;
      const neighbours = [
        x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1,
        y > 0 ? p - w : -1, y < h - 1 ? p + w : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || isBg[n] || touched[n]) continue;
        touched[n] = 1;
        const i = n * ch;
        const d2 = dist2(at(i), at(i + 1), at(i + 2), kr, kg, kb);
        if (d2 >= soft) continue; // fully ink; leave it alone
        const a = Math.sqrt(d2 / soft);
        alpha[n] = Math.round(a * 255);
        if (a > 0.004) {
          // C = (observed - (1 - a) * paper) / a, clamped back into gamut.
          const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
          px[i] = clamp((at(i) - (1 - a) * kr) / a);
          px[i + 1] = clamp((at(i + 1) - (1 - a) * kg) / a);
          px[i + 2] = clamp((at(i + 2) - (1 - a) * kb) / a);
        }
        next.push(n);
      }
    }
    frontier = next;
  }

  const out = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const i = p * ch, o = p * 4;
    out[o] = at(i); out[o + 1] = at(i + 1); out[o + 2] = at(i + 2); out[o + 3] = alpha[p] ?? 255;
  }

  let bg = 0;
  for (let p = 0; p < isBg.length; p++) if (isBg[p]) bg++;

  const buffer = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    // Trim the transparent margin so the art fills the file it is placed by:
    // Printify positions by the image's own box, and a wide empty border would
    // silently shrink the print.
    .trim({ threshold: 0 })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { buffer, backgroundFraction: bg / (w * h) };
}

/**
 * Prepare one logo and write both the file a printer receives and the file the
 * site serves.
 *
 * They are the same artwork and must stay that way — a store whose page shows
 * one mark and whose parcels carry another is the exact drift this repo builds
 * its whole print pipeline to avoid. So both come out of this one function, off
 * one source file, in one pass. The press file is a full-resolution PNG with an
 * alpha channel; the web file is a WebP at the largest size the page can
 * actually use, because the press PNG is 1.2 MB and no page should pay that.
 *
 * `reach: "keep"` writes the flat file through untouched, ground and all. One
 * product needs that: a kiss-cut sticker is printed on white vinyl, and a mark
 * drawn for a black ground has nothing to hold it there. Its ground is the
 * sticker. Every other placement in the line is on fabric that supplies one.
 */
export async function prepareLogo(
  source: string,
  destDir: string,
  options: { reach?: Reach | "keep"; as?: string; web?: { path: string; width: number } } = {},
): Promise<PreparedLogo> {
  const { reach = "border", as, web } = options;
  const png = await readFile(source);
  const { buffer, backgroundFraction } =
    reach === "keep"
      ? { buffer: await sharp(png).png({ compressionLevel: 9 }).toBuffer(), backgroundFraction: 0 }
      : await removeBackground(png, { reach });
  await mkdir(destDir, { recursive: true });
  const out = join(destDir, as ?? basename(source));
  await writeFile(out, buffer);

  let webOut: string | undefined;
  if (web) {
    await mkdir(dirname(web.path), { recursive: true });
    await sharp(buffer)
      .resize({ width: web.width, withoutEnlargement: true })
      .webp({ quality: 88, effort: 6 })
      .toFile(web.path);
    webOut = web.path;
  }

  const meta = await sharp(buffer).metadata();
  return {
    source,
    out,
    web: webOut,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    backgroundFraction,
  };
}
