import Link from "next/link";
import { blurb, fromLabel, heroIndex, heroMockup, mockupSrcSet } from "../../lib/store";
import type { Product } from "../../lib/store";
import s from "./store.module.css";

/**
 * One product in the grid.
 *
 * **The swatches do not swap the picture, and the reason has changed.** It used
 * to be that they could not: nothing in Printify's response was thought to name
 * the colourway a mockup showed, so a swatch that changed the image would have
 * been guessing. That was wrong — every image carries `variant_ids`, the detail
 * page now follows the swatch exactly, and this card could too.
 *
 * It does not, because a grid is not a picker. There is nothing selected here,
 * and the one thing the grid must avoid is twenty white shirts down the page.
 * `heroIndex` deliberately leads each card with a different colourway from its
 * neighbours — see `heroIndexFor` in packages/store/src/gallery.ts. The swatches
 * are what they look like: the colours it comes in. Choosing happens on the
 * detail page, against the real list.
 *
 * No tilt handler either. The card's `--rx`/`--ry` are declared in the stylesheet
 * and default to flat, so this renders as a static card with no script; the
 * parallax is a progressive enhancement the grid does not need to ship.
 */
export default function ProductCard({ product }: { product: Product }) {
  const hero = heroMockup(product);
  const at = heroIndex(product);

  return (
    <article className={s.card}>
      <div className={s.figWrap}>
        {hero ? (
          <img
            className={s.cardImg}
            src={hero}
            srcSet={mockupSrcSet(product.id, at)}
            /* Three across on a desktop row, two on a tablet, one and a bit on
               a phone — matching `.grid`'s own breakpoints, so the browser is
               told the truth rather than the default 100vw. */
            sizes="(max-width: 600px) 78vw, (max-width: 900px) 45vw, 30vw"
            alt={product.title}
            width={1200}
            height={1200}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className={s.cardImgMissing} aria-hidden="true" />
        )}
      </div>

      <div className={s.body}>
        <div className={s.nameRow}>
          <h3 className={s.name}>
            <Link href={`/store/${product.id}`}>{product.title}</Link>
          </h3>
          <span className={s.price}>{fromLabel(product)}</span>
        </div>

        <p className={s.blurb}>{blurb(product)}</p>

        <div className={s.swatches}>
          {product.colors.map((color) => (
            <span
              key={color.name}
              className={s.swatch}
              style={{ background: color.hex }}
              title={color.name}
            />
          ))}
          {/* The count is what fits; the NAMES are what a screen reader needs.
              A card's accessible text used to end "…6 colours" and the colour
              names were unavailable anywhere on /store. */}
          <span className={s.swatchName} aria-hidden="true">
            {product.colors.length === 1
              ? product.colors[0]?.name
              : `${product.colors.length} colours`}
          </span>
          <span className={s.srOnly}>
            {product.colors.length === 1
              ? `Colour: ${product.colors[0]?.name}`
              : `${product.colors.length} colours: ${product.colors.map((c) => c.name).join(", ")}`}
          </span>
        </div>
      </div>
    </article>
  );
}
