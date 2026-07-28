/**
 * Printify API types.
 *
 * Transcribed from https://developers.printify.com/ on 2026-07-15. Two rules
 * were followed while writing this file and they are the only reason it is
 * worth anything:
 *
 * 1. **Nothing here is remembered.** Every field below appears in the docs.
 *    Where the docs did not show a field, it is not typed, and it is not
 *    invented — see `UNVERIFIED` notes.
 * 2. **The types are narrowed, not exhaustive.** The live API returns more
 *    than this. These describe the subset needed to resolve the ids in
 *    apps/web/data/products.json, and they are deliberately permissive about
 *    the rest.
 *
 * Nothing in this package has been executed against the live API.
 */

/** `GET /v1/shops.json` */
export type Shop = {
  id: number;
  title: string;
  /** e.g. "shopify", "etsy", "custom_integration". */
  sales_channel: string;
};

/**
 * `GET /v1/catalog/blueprints.json`
 *
 * A blueprint is a garment model — "Unisex Heavy Cotton Tee", not a colour or a
 * size. This is the number that has to be right.
 */
export type Blueprint = {
  id: number;
  title: string;
  /** "Gildan", "Bella+Canvas". */
  brand: string;
  /** "5000", "3001". */
  model: string;
  /** Absolute URLs on Printify's CDN. Not fetched by anything here. */
  images: string[];
};

/** `GET /v1/catalog/blueprints/{blueprint_id}/print_providers.json` */
export type PrintProvider = {
  id: number;
  title: string;
};

/**
 * `GET /v1/catalog/blueprints/{id}/print_providers/{id}/variants.json`
 *
 * A variant is one concrete purchasable thing: this blueprint, from this
 * provider, in Navy, in L.
 */
export type Variant = {
  id: number;
  /** Human label, e.g. "Navy / L". */
  title: string;
  /** Free-form per blueprint. Commonly `{ color: "Navy", size: "L" }`. */
  options: Record<string, string>;
};

export type VariantsResponse = {
  id: number;
  title: string;
  variants: Variant[];
};

/* ==================================================================
   Below this line: typed, NOT implemented.

   These describe the write path — upload artwork, create a product,
   publish it. They are types only. src/api.ts implements GETs and
   stops, on purpose. See README.md.
   ================================================================== */

/**
 * `POST /v1/uploads/images.json`
 *
 * Body is either `{ file_name, contents }` where contents is base64, or
 * `{ file_name, url }` where Printify fetches it. Both are documented.
 */
export type UploadImageBody =
  | { file_name: string; contents: string }
  | { file_name: string; url: string };

export type UploadedImage = {
  id: string;
  file_name: string;
  height: number;
  width: number;
  size: number;
  mime_type: string;
  preview_url: string;
  upload_time: string;
};

/**
 * One placed image inside a print area.
 *
 * The geometry, resolved against a live product and read back rather than read
 * about: `x` and `y` are fractions of the print area, origin top-left, so
 * 0.5/0.5 is centred. `scale` is the rendered image WIDTH as a fraction of the
 * print area width; the height follows from the image's own aspect. `angle` is
 * degrees clockwise, 0 for everything in this line.
 *
 * The consequence worth knowing: because these are proportions, one placement
 * is correct for every garment size even though the catalog reports a bigger
 * print area for a 3XL than for an S. The print grows with the shirt.
 */
export type PlacedImage = {
  /** `UploadedImage["id"]`. */
  id: string;
  x: number;
  y: number;
  scale: number;
  angle: number;
};

/**
 * Legal positions are per blueprint and come from the catalog, not the docs:
 * each variant's `placeholders[].position` lists exactly what that garment
 * accepts. Bella+Canvas 3001 and Gildan 18500 through Monster Digital accept
 * front, back, left_sleeve, right_sleeve and neck; the sticker accepts front.
 */
export type Placeholder = {
  position: string;
  images: PlacedImage[];
};

export type PrintArea = {
  variant_ids: number[];
  placeholders: Placeholder[];
};

/** One placeholder as the CATALOG reports it — the print canvas, in pixels. */
export type CatalogPlaceholder = {
  position: string;
  width: number;
  height: number;
  decoration_method?: string;
};

export type ProductVariantInput = {
  /** `Variant["id"]` from the catalog. */
  id: number;
  /** Integer cents. Confirmed: a product created at 2800 reads back as $28.00. */
  price: number;
  is_enabled: boolean;
};

/**
 * `POST /v1/shops/{shop_id}/products.json`
 *
 * `visible` is the field that decides whether this is a draft, and **Printify
 * defaults it to true**. Omitting it does not get you a draft; it gets you a
 * product that appears in the storefront the moment a sales channel is
 * connected. It is required here rather than optional so that no future caller
 * can create a live product by forgetting a line.
 */
export type CreateProductBody = {
  title: string;
  description: string;
  blueprint_id: number;
  print_provider_id: number;
  visible: boolean;
  variants: ProductVariantInput[];
  print_areas: PrintArea[];
};

/**
 * A product as the shop returns it. Narrowed to the fields this package reads
 * back to verify what it created; the live response carries a good deal more.
 */
export type PrintifyProduct = {
  id: string;
  title: string;
  description: string;
  blueprint_id: number;
  print_provider_id: number;
  /** False for a draft. Nothing in this package sets it. */
  visible: boolean;
  /** Empty until the product is published to a sales channel. */
  external?: { id?: string; handle?: string } | null;
  variants: {
    id: number;
    title: string;
    price: number;
    /** What Printify charges. A price at or below this loses money on every sale. */
    cost: number;
    is_enabled: boolean;
    is_available?: boolean;
  }[];
  print_areas: PrintArea[];
  /** Provider-rendered previews. The only honest way to check placement. */
  images: { src: string; variant_ids: number[]; position: string; is_default: boolean }[];
};
