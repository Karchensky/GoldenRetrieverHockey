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
 * What this handles is the other kind of art: the team logo in `docs/logos/`,
 * which arrives on a solid cream ground. A ground is a rectangle when it is
 * printed on a shirt, so it cannot go to a printer as it is.
 *
 * There are two ways a ground comes off and they are opposite. Which one a file
 * wants is not a preference; getting it wrong destroys the artwork.
 *
 * **`reach: "border"` — a flood fill inward from the edge.** This is what the
 * FULL-COLOUR crest needs. It contains large cream areas that are *part of the
 * artwork* — the RETRIEVERS banner text, the dog's muzzle, the tape on the stick
 * blades. A global "make every cream pixel transparent" punches holes through
 * all of them. A fill that starts at the border and stops at the first dark
 * outline cannot reach them.
 *
 * **`reach: "everywhere"` — a straight colour key.** This is what a ONE-INK mark
 * needs, and the reason is the exact inverse. In `logo-one-one-color-gold.svg`
 * there are exactly two colours, gold and cream, and *nothing drawn is cream*:
 * every cream region is either the ground or negative space cut into the gold —
 * the banner lettering, the dog's muzzle and eyes, the tape on the blades. On a
 * dark garment that negative space is supposed to be the garment showing
 * through, so every cream pixel has to go, enclosed or not. A border fill leaves
 * all of them opaque, and DTG lays a white underbase under every non-transparent
 * pixel: the lettering would print as cream slugs on a black shirt.
 *
 * Removing them the other way round is just as fatal and was measured: deleting
 * the cream *paths* from the vector instead of keying the cream *pixels* leaves
 * a gold blob with no face and an empty banner.
 *
 * Neither mode redraws, recolours, or restyles anything. Same pixels, minus the
 * ground they were sitting on.
 *
 * **`reach: "trim"` — nothing removed.** For a source that already carries an
 * alpha channel, which the vector exports do. It still trims, because Printify
 * places an image by its file box and the exports are square canvases with the
 * artwork inset.
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
/**
 * How far the rim can extend. Rasterisers anti-alias over about a pixel whatever
 * the output size, so two passes covers a 1254px flat and a 6000px vector export
 * alike.
 */
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
 * Rasterise an SVG at an exact pixel width, **with the edges intact**.
 *
 * `density` is dots per inch against the document's own units, and sharp reads
 * an SVG at 72 units to the inch, so the density that lands on a target width
 * depends on the document. Rounded UP and then resized down: rendering short and
 * scaling up would be the same lost detail the vector masters exist to avoid.
 *
 * **THE PADDING IS NOT COSMETIC AND IT FIXED TWO PRODUCTS.**
 *
 * None of the production masters carries a `viewBox`. Their coordinate space is
 * therefore exactly `width` x `height`, and a stroke CENTRED on that boundary
 * loses its outer half to the canvas edge. Most marks are drawn inset and never
 * notice. Two are not: `mascot-medallion`'s gold ring came off the press file
 * with a flat top and bottom, and `faceoff`'s disc was cut flat at both sides.
 * Both shipped to the shop that way and both were visible on the provider's
 * mockup — a medallion whose ring does not close.
 *
 * A `viewBox` offset by `PAD` on every side renders the same drawing into a
 * slightly larger frame, so the half-stroke that was falling off the edge lands
 * inside it. Nothing is scaled, moved or invented: this is the artwork the SVG
 * always described.
 *
 * It costs nothing for the marks that did not need it. `prepare()` trims the
 * transparent margin immediately afterwards, so a drawing that was already
 * inset comes back byte-for-byte what it was.
 */
const PAD = 40;

async function rasterise(svg: Buffer, width: number): Promise<Buffer> {
  const meta = await sharp(svg).metadata();
  const natural = meta.width ?? 0;
  const naturalHeight = meta.height ?? 0;
  if (!natural || !naturalHeight) throw new Error("cannot read the source's natural size");

  const padded = Buffer.from(
    svg.toString("utf8").replace(/<svg([^>]*)>/, (whole, attrs: string) => {
      // A document that already declares a viewBox knows its own frame; adding
      // a second one would fight it. Leave it alone.
      if (/viewBox\s*=/.test(attrs)) return whole;
      const resized = attrs
        .replace(/\bwidth="[^"]*"/, `width="${natural + PAD * 2}"`)
        .replace(/\bheight="[^"]*"/, `height="${naturalHeight + PAD * 2}"`);
      return `<svg${resized} viewBox="${-PAD} ${-PAD} ${natural + PAD * 2} ${naturalHeight + PAD * 2}">`;
    }),
  );

  const paddedNatural = (await sharp(padded).metadata()).width ?? natural;
  const density = Math.ceil((72 * width) / paddedNatural);
  return sharp(padded, { density }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Prepare one logo and write the file a printer receives, optionally alongside a
 * web-sized copy of the same picture.
 *
 * They are the same artwork and must stay that way — a store whose page shows
 * one mark and whose parcels carry another is the exact drift this repo builds
 * its whole print pipeline to avoid. So both come out of this one function, off
 * one source file, in one pass. The press file is a full-resolution PNG with an
 * alpha channel; the web file is a WebP at the largest size a page could
 * actually use, because the press PNG is megabytes and no page should pay that.
 *
 * **`render` is what lets a vector source in.** `docs/logos/vector/` holds the
 * masters, and a mark taken from those has no resolution ceiling — the ceiling
 * is whatever pixel width is asked for here. It is the whole reason a crest can
 * print ten inches wide at 453 dpi when the flat PNG it replaced managed 158 at
 * six. A raster source ignores it: resampling a 1254px flat up to 6000 invents
 * detail and this function will not do that.
 */
export async function prepareLogo(
  source: string,
  destDir: string,
  options: {
    reach?: Reach | "trim";
    as?: string;
    web?: { path: string; width: number };
    /** Rasterise a vector source at this pixel width. Ignored for a raster. */
    render?: { width: number };
  } = {},
): Promise<PreparedLogo> {
  const { reach = "border", as, web, render } = options;
  const png = render && source.toLowerCase().endsWith(".svg")
    ? await rasterise(await readFile(source), render.width)
    : await readFile(source);
  const { buffer, backgroundFraction } =
    reach === "trim"
      ? {
          buffer: await sharp(png).trim({ threshold: 0 }).png({ compressionLevel: 9 }).toBuffer(),
          backgroundFraction: 0,
        }
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
