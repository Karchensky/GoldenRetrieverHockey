"use client";

import { useMemo, useState } from "react";
import Buy from "./Buy";
import Gallery from "./Gallery";
import { colorsWithPhotos, mockupPath, mockupsFor, priceLabel } from "../../lib/store";
import type { Product } from "../../lib/store";
import s from "./store.module.css";

/**
 * The picture and the picker, sharing one colour.
 *
 * **This component exists only because they have to agree.** `Buy` owned the
 * colour and `Gallery` was its sibling, two children of a server-rendered grid
 * with no way to talk — so the swatch was a statement of intent and the
 * photograph above it showed whatever colourway the mirroring script had
 * rotated to. The page carried a paragraph apologising for it. Lifting the
 * state one level up is the whole fix; neither child changed much.
 *
 * **It returns a FRAGMENT, deliberately.** `s.detail` is a two-column grid and
 * its `data-reveal` wrapper is what animates the page in. Wrapping these two in
 * a div of its own would make them one grid cell and collapse the layout, so
 * they stay direct children of `.detail` and this component is invisible in the
 * DOM.
 *
 * Size lives here too. Nothing above the fold needs it, but a picker split
 * across two owners is how the colour got out of step in the first place.
 */
export default function ProductView({ product }: { product: Product }) {
  const offered = colorsWithPhotos(product);
  const [color, setColor] = useState(offered[0]?.name ?? "");
  const [size, setSize] = useState(product.sizes[0] ?? "");

  /* MEMOISED ON THE COLOUR, not rebuilt every render. `Gallery` treats a new
     array as "the shopper changed colour" and drops any open lightbox, so a
     fresh array on every keystroke of the size picker would be a reset for no
     reason. This is the only thing that should change identity when the colour
     does. */
  const images = useMemo(
    () =>
      mockupsFor(product, color).map(({ index, alt }) => ({
        src: mockupPath(product.id, index),
        alt,
      })),
    [product, color],
  );

  return (
    <>
      <Gallery title={product.title} images={images} />

      <div>
        {/* PRICE, THEN THE THING THAT SPENDS IT, THEN THE PROSE.
            The picker used to sit under six paragraphs of fabric copy: the Add
            button measured 602px below the fold at 1280x900 and 2,836px down —
            3.8 screens — at 360. Nothing purchasable was on screen at any
            width. */}
        <p className={s.detailPrice}>{priceLabel(product)}</p>

        <Buy
          product={product}
          colors={offered}
          color={color}
          size={size}
          onColor={setColor}
          onSize={setSize}
        />

        {product.description
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((para) => (
            <p key={para} className={s.detailCopy}>{para}</p>
          ))}
      </div>
    </>
  );
}
