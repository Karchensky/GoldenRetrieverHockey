/**
 * Which of the provider's renders go on the page, and what colour each one is.
 *
 * Pure. No API, no filesystem, no clock — `sync.ts` hands it the `images` array
 * off a read-back and gets the gallery in return, and the tests hand it captured
 * bytes. It is the whole of the "photograph follows the swatch" decision.
 *
 * **THE COLOUR OF A MOCKUP IS KNOWN, and TODO.md was wrong to say otherwise.**
 * Each image carries `variant_ids`; `colors[].variants` maps those to a
 * colourway. The variant id is also the third path segment of the URL, which is
 * used here as an independent cross-check rather than a fallback — two sources
 * that agree, or a recorded problem. Verified against the 181 mockups already
 * mirrored: 181 resolved, 0 did not.
 */

/** One photograph, tagged with what it is a photograph of. */
export type Mockup = { src: string; color: string; camera: string };

/** The subset of a Printify product image this module reads. */
export type ProviderImage = {
  src: string;
  variant_ids: number[];
  position: string;
  is_default: boolean;
};

/**
 * WHAT THE SHOPPER IS SHOWN, per item, in order. An allow-list, and it has to be.
 *
 * Printify renders 4 to 33 views of every colourway and 53 distinct
 * `camera_label`s across this shop — measured by `cli.ts mockups` on
 * 2026-08-01. Most of them must never reach the page:
 *
 *   people        person-1…11, lifestyle, lifestyle-man, lifestyle-woman,
 *                 duo, duo-2…4. The captain's rule is the garment on its own.
 *   not a photo   size-chart, 155 of them.
 *   staged props  context-1…3. Two of the three sampled were Christmas scenes —
 *                 candles, pine cones, gingerbread — which date a photograph and
 *                 have nothing to do with hockey.
 *   nothing to see front-collar-closeup, back-collar-closeup, neck-label-inner:
 *                 a crop so tight the print is not in the frame.
 *   cut off       the mug's `left`, `right` and `back`, where the artwork runs
 *                 off the edge of the barrel or is not on the visible side.
 *
 * **A deny-list was tried on paper and is not safe.** The filter this replaces
 * was `/camera_label=[^&]*person/i`, which does not match `lifestyle-man`,
 * `lifestyle-woman`, `duo` or `duo-2`. Six hundred and sixty person shots on
 * this shop carry a label with no "person" in it. They stayed off the page only
 * because a *different* filter — position must equal a printed face — happened
 * to exclude them, and that filter is the one being relaxed to get more angles.
 * Naming what is allowed cannot fail that way.
 *
 * Every label here was checked against the pixels, and every one is present for
 * EVERY colourway of its item, so switching colour never changes how many
 * photographs are on the page.
 */
export const ANGLES: Record<string, readonly string[]> = {
  tee: ["front", "back", "hanging-1", "folded"],
  youth: ["front", "back", "folded"],
  longsleeve: ["front", "back", "left-sleeve", "right-sleeve"],
  crewneck: ["front", "back", "hanging", "flat-lay"],
  hoodie: ["front", "back", "folded"],
  cap: ["front", "back"],
  beanie: ["front", "back"],
  mug: ["front", "angled-1", "angled-2"],
  // The provider renders exactly one studio view of a sticker. The other two are
  // a laptop lid and a Christmas parcel.
  sticker: ["front"],
};

/**
 * Every `camera_label` this shop was observed to use, captured 2026-08-01.
 *
 * Not a filter — `ANGLES` is the filter. This is a tripwire: a label that is not
 * in here is one Printify has started producing since, and it might be a better
 * angle than the ones chosen or a new way of putting a person in the frame.
 * Either way somebody should look, so it is reported rather than silently
 * dropped.
 */
export const KNOWN_LABELS: ReadonlySet<string> = new Set([
  "front", "back", "front-2", "back-2", "folded", "flat-lay", "hanging",
  "hanging-1", "hanging-2", "hanging-3", "front-collar-closeup",
  "back-collar-closeup", "neck-label-inner", "left-sleeve", "right-sleeve",
  "left", "right", "angled-1", "angled-2", "size-chart",
  "context-1", "context-2", "context-3", "context-1-left", "context-1-right",
  "lifestyle", "lifestyle-man", "lifestyle-woman",
  "duo", "duo-2", "duo-3", "duo-4",
  "person-1", "person-2", "person-3", "person-4", "person-5", "person-6",
  "person-1-front", "person-1-back", "person-2-front", "person-2-back",
  "person-2-back-closeup", "person-6-back", "person-7-front", "person-7-back",
  "person-8-front", "person-8-back", "person-9-front", "person-9-back",
  "person-10-left-sleeve", "person-10-right-sleeve",
  "person-11-left-sleeve", "person-11-right-sleeve",
]);

/** The label Printify hangs off the mockup URL. `none` where there is no query. */
export function cameraLabel(src: string): string {
  const m = /[?&]camera_label=([^&]*)/.exec(src);
  return m?.[1] ? decodeURIComponent(m[1]) : "none";
}

/** The variant id Printify puts in the mockup URL path, or null if it is not there. */
export function variantInUrl(src: string): number | null {
  try {
    // /mockup/{productId}/{variantId}/{sceneId}/{slug}.jpg
    const id = Number(new URL(src).pathname.split("/")[3]);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

type Colourway = { name: string; hex: string; variants: number[] };

/**
 * Perceived lightness of a hex, 0 (black) to 1 (white). Rec. 709 coefficients.
 *
 * This replaces a pass that downloaded every mockup and measured the mean
 * luminance of the middle third of the frame. That existed because the code
 * doing the ordering could not see a colour — it held a list of URLs. It can
 * now: the colourway is on every mockup, and `hex` has been in the matrix all
 * along. Fetching an image to find out how dark Black is was never the cheapest
 * way to know.
 */
export function lightness(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return 0.5;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * The photographs for one product, grouped by colourway.
 *
 * Ordered: colourways in the order the matrix lists them, and within a colourway
 * **the printed face first**. A hoodie printed on the back leads with its back,
 * which is the failure that put a photograph of a blank white hoodie on a $74
 * product page. Everything after that is the angle order in `ANGLES`.
 */
export function chooseGallery(
  images: readonly ProviderImage[],
  item: { id: string; itemId: string; colors: readonly Colourway[] },
  printed: ReadonlySet<string>,
  problems: string[],
): Mockup[] {
  const angles = ANGLES[item.itemId];
  if (!angles) {
    problems.push(
      `no angle set for item "${item.itemId}" — add one to ANGLES in gallery.ts. ` +
        `Nothing is shown rather than a guess at which renders are safe.`,
    );
    return [];
  }

  const colourOf = new Map<number, string>();
  for (const c of item.colors) for (const v of c.variants) colourOf.set(v, c.name);

  /** colour -> label -> src. A label is rendered once per colour; keep the first. */
  const byColour = new Map<string, Map<string, ProviderImage>>();
  const unknown = new Set<string>();

  for (const image of images) {
    const label = cameraLabel(image.src);
    if (!KNOWN_LABELS.has(label)) unknown.add(label);
    if (!angles.includes(label)) continue;

    const named = new Set(
      (image.variant_ids ?? [])
        .map((v) => colourOf.get(v))
        .filter((n): n is string => Boolean(n)),
    );
    if (named.size > 1) {
      problems.push(`a "${label}" render covers ${[...named].join(" and ")} at once — not shown`);
      continue;
    }
    const fromIds = [...named][0];
    const urlVariant = variantInUrl(image.src);
    const fromUrl = urlVariant === null ? undefined : colourOf.get(urlVariant);

    if (fromIds && fromUrl && fromIds !== fromUrl) {
      problems.push(`a "${label}" render: variant_ids say ${fromIds}, the URL says ${fromUrl} — not shown`);
      continue;
    }
    const colour = fromIds ?? fromUrl;
    if (!colour) continue;

    const bucket = byColour.get(colour) ?? new Map<string, ProviderImage>();
    if (!bucket.has(label)) bucket.set(label, image);
    byColour.set(colour, bucket);
  }

  if (unknown.size) {
    problems.push(
      `camera_label${unknown.size === 1 ? "" : "s"} not seen when ANGLES was written: ` +
        `${[...unknown].sort().join(", ")}. Excluded. Run \`cli.ts mockups\` and look.`,
    );
  }

  const out: Mockup[] = [];
  for (const colour of item.colors) {
    const bucket = byColour.get(colour.name);
    if (!bucket?.size) {
      problems.push(`nothing rendered for ${colour.name} — that colourway cannot be offered`);
      continue;
    }
    const ordered = [...bucket.entries()].sort((a, b) => {
      // The side with the artwork on it leads. Everything else is an angle.
      const facing = Number(printed.has(b[1].position)) - Number(printed.has(a[1].position));
      return facing || angles.indexOf(a[0]) - angles.indexOf(b[0]);
    });
    for (const [label, image] of ordered) {
      out.push({ src: image.src, color: colour.name, camera: label });
    }
  }
  return out;
}

/**
 * The photographs of one colourway, as INDICES into the array they came from.
 *
 * Indices, not URLs, because `mirror-mockups.mjs` writes `<id>-<index>.webp` —
 * the position in this array is the filename on disk, and it is the only thing
 * the storefront can address a mirrored file by.
 *
 * **Falls back to the whole list when the colour is unknown**, rather than to
 * nothing. A product page that cannot resolve its own swatch should show the
 * shopper something; an empty column is the worse failure.
 *
 * Lives here rather than in `apps/web/lib/store.ts` so that the function the
 * page calls when a swatch is pressed is the function the tests call.
 */
export function photographsOf(mockups: readonly Mockup[], colorName: string): number[] {
  const mine: number[] = [];
  mockups.forEach((m, index) => { if (m.color === colorName) mine.push(index); });
  return mine.length ? mine : mockups.map((_, index) => index);
}

/**
 * Which photograph the `/store` card leads with — NOT `mockups[0]`.
 *
 * The grid must not be twenty white shirts. Printify returns White first for
 * almost everything and the matrix lists it first, so the naive hero is white
 * every time. Sorting fixes that by creating the opposite problem — any total
 * order over near-identical products yields a uniform row, and sorting darkest
 * first made every hoodie navy and every tee black.
 *
 * So the colourways are ranked by lightness and then ROTATED by the product's
 * position within its own category. Neighbouring cards lead with different
 * colourways by construction, the same catalog always produces the same grid,
 * and no product ever leads with a colour it does not come in.
 *
 * **This used to live in `scripts/mirror-mockups.mjs`, which reordered the
 * array.** That cannot survive a gallery grouped by colour: the file on disk is
 * named by its index, so reordering the list silently renames every photograph.
 * Choosing an index instead leaves the order alone.
 */
export function heroIndexFor(
  mockups: readonly Mockup[],
  colors: readonly Colourway[],
  rankInCategory: number,
): number {
  if (!mockups.length) return 0;
  const shown = colors.filter((c) => mockups.some((m) => m.color === c.name));
  if (!shown.length) return 0;
  const ranked = [...shown].sort((a, b) => lightness(a.hex) - lightness(b.hex));
  const at = ((rankInCategory % ranked.length) + ranked.length) % ranked.length;
  const pick = ranked[at]!;
  const index = mockups.findIndex((m) => m.color === pick.name);
  return index < 0 ? 0 : index;
}
