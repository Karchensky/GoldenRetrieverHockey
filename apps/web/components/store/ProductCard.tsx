import Link from "next/link";
import { blurb, fromLabel, heroMockup, mockupSrcSet } from "../../lib/store";
import type { Product } from "../../lib/store";
import s from "./store.module.css";

/**
 * One product in the grid.
 *
 * **The swatches do not swap the picture, and that is deliberate.** A product
 * carries up to four provider mockups and nothing in Printify's response says
 * which colourway each one shows — `is_default` marks a view, not a colour. A
 * swatch that changed the image would be guessing, and a store that guesses
 * about what colour arrives is the one thing this one must not do. So they are
 * what they look like: the colours it comes in. Choosing happens on the detail
 * page, against the real list.
 *
 * No tilt handler either. The card's `--rx`/`--ry` are declared in the stylesheet
 * and default to flat, so this renders as a static card with no script; the
 * parallax is a progressive enhancement the grid does not need to ship.
 */
export default function ProductCard({ product }: { product: Product }) {
  const hero = heroMockup(product);

  return (
    <article className={s.card}>
      <div className={s.figWrap}>
        {hero ? (
          <img
            className={s.cardImg}
            src={hero}
            srcSet={mockupSrcSet(product.id, 0)}
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
