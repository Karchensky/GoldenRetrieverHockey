/**
 * What a basket is allowed to be, decided once.
 *
 * **This module is imported by the browser AND by the checkout Worker**, and
 * that is its whole reason for existing. The cart needs the rules so it can say
 * "three stickers, or none" before anybody reaches a card form. The Worker needs
 * the same rules because the cart runs on the customer's machine and a customer
 * can post whatever they like to `/api/checkout`. Two implementations of one
 * rule is how a shop ends up refusing a basket in the drawer and accepting it at
 * the till, so there is one.
 *
 * It therefore imports nothing — no React, no Next, no Node. It is given a
 * catalog and some lines and it answers.
 *
 * **It lives in packages/store rather than apps/web**, and that is not
 * bikeshedding: `apps/web` has no `"type": "module"`, so under the root
 * tsconfig's NodeNext resolution a file there is CommonJS, and the package
 * tests that import it would not compile. It also belongs here — the rules it
 * enforces are written in `matrix.ts`, three files away.
 *
 * **A basket line never carries a price.** It carries a product id, a colour
 * name and a size, and every figure is looked up. The browser is free to send a
 * $1 hoodie; nothing here reads that field because there is no such field.
 */

export type CatalogColor = { name: string; hex: string; variants: number[] };

export type CatalogProduct = {
  id: string;
  title: string;
  description: string;
  /**
   * The CHEAPEST variant's price — a "from" figure for a card, and a fallback.
   *
   * Not the price of anything in particular. See `prices`.
   */
  priceCents: number;
  /**
   * Variant id (as a string, because JSON) -> price in cents.
   *
   * **Every size is priced off its own cost**, so that a 3XL tee and a small
   * both earn the same margin instead of the small subsidising the 3XL. A
   * basket line therefore cannot be priced from the product; it has to be
   * priced from the variant the colour and size resolve to.
   */
  prices?: Record<string, number>;
  taxCode: string;
  markId: string;
  itemId: string;
  /**
   * That maker's real first-item US postage, in cents, as the sync measured it.
   *
   * It has been written into `products.json` all along and was missing from
   * this type, so nothing could read it without an assertion. The checkout does
   * not use it — the Worker quotes Printify per basket, which is the only
   * figure that can be charged — but a single-item listing has to state a
   * postage somewhere, and this is the honest one. See `schema.ts`.
   */
  postageCents?: number;
  colors: CatalogColor[];
  sizes: string[];
  sale?: { minQuantity?: number; addOnOnly?: boolean; why: string };
  /**
   * The provider's photographs, each tagged with the colourway it shows.
   *
   * A bare `string[]` until 2026-08-01. The product page could not make the
   * picture follow the swatch because the storefront had a list of URLs and no
   * idea what colour was in them — the colour was in Printify's response the
   * whole time, in `variant_ids`. See `chooseGallery` in gallery.ts.
   *
   * **The index is the filename.** `mirror-mockups.mjs` writes
   * `<id>-<index>.webp`, so this array's order is load-bearing.
   */
  mockups: { src: string; color: string; camera: string }[];
  /** Which index the /store card leads with, so the grid is not all white. */
  heroIndex?: number;
  printify?: {
    productId?: string;
    blueprintId?: number;
    printProviderId?: number;
    /**
     * The geometry that came back off the shop, in inches and dpi, at both ends
     * of the size run. The storefront prints it under the product; the Worker
     * has no use for it and does not read it.
     */
    print?: {
      position: string;
      widthIn: number;
      heightIn: number;
      dpi: number;
      maxWidthIn: number;
      minDpi: number;
      scale: number;
      y: number;
    }[];
  };
};

/** What the browser stores and posts. Three strings and a number, nothing else. */
export type BasketLine = {
  productId: string;
  color: string;
  size: string;
  quantity: number;
};

export type ResolvedLine = {
  line: BasketLine;
  product: CatalogProduct;
  /** The Printify catalog variant. Resolved here; never sent by the browser. */
  variantId: number;
  unitCents: number;
  subtotalCents: number;
};

export type Resolution =
  | { ok: true; lines: ResolvedLine[]; subtotalCents: number }
  | { ok: false; problems: string[] };

/**
 * Nobody needs twenty of one shirt, and a quantity field is an obvious place to
 * put a number that overflows something downstream. Printify would reject the
 * order eventually; refusing it here means the customer is told rather than
 * charged and then disappointed.
 */
export const MAX_PER_LINE = 10;

/**
 * The variant a colour and size resolve to, or null.
 *
 * Exported because the cart and the product page both need to price a SELECTION
 * before it is a basket line, and duplicating this two-line lookup is how a
 * page ends up showing one price and charging another.
 */
export function variantIdFor(product: CatalogProduct, color: string, size: string): number | null {
  const way = product.colors.find((c) => c.name === color);
  const index = product.sizes.indexOf(size);
  if (!way || index < 0) return null;
  return way.variants[index] ?? null;
}

/** What one of that variant costs. Falls back to the "from" price. */
export const unitPriceFor = (product: CatalogProduct, variantId: number | null): number =>
  (variantId === null ? undefined : product.prices?.[String(variantId)]) ?? product.priceCents;

/** The cheapest and dearest this product is sold at. Equal on a one-size item. */
export function priceRange(product: CatalogProduct): { from: number; to: number } {
  const all = Object.values(product.prices ?? {});
  if (!all.length) return { from: product.priceCents, to: product.priceCents };
  return { from: Math.min(...all), to: Math.max(...all) };
}

/** A stable key for a line. Same product, colour and size is the same line. */
export const lineKey = (l: Pick<BasketLine, "productId" | "color" | "size">): string =>
  `${l.productId}::${l.color}::${l.size}`;

/**
 * Resolve a basket against the catalog, or say everything that is wrong with it.
 *
 * Every problem is collected rather than thrown on the first one: a cart that
 * has gone stale across a catalog change can easily have three, and a customer
 * being told about them one reload at a time is a worse experience than being
 * told once.
 */
export function resolveBasket(lines: BasketLine[], catalog: CatalogProduct[]): Resolution {
  const problems: string[] = [];
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const resolved: ResolvedLine[] = [];

  if (!lines.length) return { ok: false, problems: ["The basket is empty."] };

  // Duplicate lines would each pass on their own and break the per-line cap
  // between them, so they are merged before anything else looks at quantities.
  const merged = new Map<string, BasketLine>();
  for (const line of lines) {
    const key = lineKey(line);
    const already = merged.get(key);
    merged.set(key, already ? { ...already, quantity: already.quantity + line.quantity } : { ...line });
  }

  for (const line of merged.values()) {
    const product = byId.get(line.productId);
    if (!product) {
      problems.push(`"${line.productId}" is not in the shop.`);
      continue;
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      problems.push(`${product.title}: a quantity has to be a whole number, one or more.`);
      continue;
    }
    if (line.quantity > MAX_PER_LINE) {
      problems.push(`${product.title}: ${MAX_PER_LINE} is the most of one thing per order.`);
      continue;
    }

    const color = product.colors.find((c) => c.name === line.color);
    if (!color) {
      problems.push(
        `${product.title}: "${line.color}" is not a colour it comes in ` +
          `(${product.colors.map((c) => c.name).join(", ")}).`,
      );
      continue;
    }
    const sizeIndex = product.sizes.indexOf(line.size);
    if (sizeIndex < 0) {
      problems.push(
        `${product.title}: "${line.size}" is not a size it comes in ` +
          `(${product.sizes.join(", ")}).`,
      );
      continue;
    }

    // The colourway carries one variant id per size, in the order `sizes` lists
    // them. buildLine() refuses a colourway whose count disagrees, so an
    // undefined here means the catalog was written by something else.
    const variantId = color.variants[sizeIndex];
    if (variantId === undefined) {
      problems.push(`${product.title}: no variant for ${line.color} / ${line.size}.`);
      continue;
    }

    // The variant's own price, never the product's. `priceCents` is the
    // cheapest size and would undercharge every size above it.
    const unitCents = product.prices?.[String(variantId)] ?? product.priceCents;
    if (!Number.isInteger(unitCents) || unitCents <= 0) {
      problems.push(`${product.title}: no price on record for ${line.color} / ${line.size}.`);
      continue;
    }

    resolved.push({
      line,
      product,
      variantId,
      unitCents,
      subtotalCents: unitCents * line.quantity,
    });
  }

  problems.push(...saleProblems(resolved));
  if (problems.length) return { ok: false, problems };

  return {
    ok: true,
    lines: resolved,
    subtotalCents: resolved.reduce((sum, l) => sum + l.subtotalCents, 0),
  };
}

/**
 * The buying rules, checked across the whole basket rather than per line.
 *
 * **The minimum counts the ITEM, not the product**, and that distinction is the
 * measurement it was built on: three different sticker designs post for $4.77,
 * which is exactly what three copies of one post for. So a customer who wants
 * the seal, the roundel and the shield has met the minimum, and is never told
 * to buy three of something they only wanted one of.
 */
function saleProblems(lines: ResolvedLine[]): string[] {
  const problems: string[] = [];
  const quantityByItem = new Map<string, number>();
  for (const l of lines) {
    quantityByItem.set(l.product.itemId, (quantityByItem.get(l.product.itemId) ?? 0) + l.line.quantity);
  }

  const rules = new Map<string, { rule: NonNullable<CatalogProduct["sale"]>; title: string }>();
  for (const l of lines) {
    if (l.product.sale && !rules.has(l.product.itemId)) {
      rules.set(l.product.itemId, { rule: l.product.sale, title: l.product.title });
    }
  }

  for (const [itemId, { rule }] of rules) {
    const have = quantityByItem.get(itemId) ?? 0;
    const need = rule.minQuantity ?? 1;
    if (have < need) {
      problems.push(
        `${itemId === "sticker" ? "Stickers" : itemId} come in ${need}s — ` +
          `there ${have === 1 ? "is" : "are"} ${have} in the basket. ` +
          `They can be ${need} different designs.`,
      );
    }
    if (rule.addOnOnly && lines.every((l) => l.product.itemId === itemId)) {
      problems.push(`${itemId} cannot be the only thing in an order.`);
    }
  }

  return problems;
}

/** "$36.00". Cents in, because nothing here holds a price as a float. */
export const money = (cents: number): string =>
  `$${(cents / 100).toFixed(2)}`;
