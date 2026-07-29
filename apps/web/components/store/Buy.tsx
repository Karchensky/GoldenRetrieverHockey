"use client";

import { useState } from "react";
import { money, unitPriceFor, variantIdFor } from "../../../../packages/store/src/basket";
import type { Product } from "../../lib/store";
import { useCart } from "./Cart";
import s from "./store.module.css";

/**
 * Choose a colour and a size, and put it in the basket.
 *
 * The only interactive part of a product page, and it is the smallest it can be:
 * a colour, a size, and a button. Everything it offers comes off the catalog —
 * the colours a product actually has, the sizes it actually comes in — so a
 * choice that cannot be made cannot be shown, and the basket line it builds is
 * three strings the Worker will resolve for itself.
 *
 * **The size list is now a control.** It was a read-only sentence in the version
 * of this page that shipped to a Pop-Up store, with a comment explaining that
 * there was nothing on this side to choose into because the size went in on
 * Printify's checkout. There is something to choose into now.
 */
export default function Buy({ product }: { product: Product }) {
  const { add } = useCart();
  const [color, setColor] = useState(product.colors[0]?.name ?? "");
  const [size, setSize] = useState(product.sizes[0] ?? "");
  const [added, setAdded] = useState(false);

  const minimum = product.sale?.minQuantity ?? 1;
  // The price of what is SELECTED, not of the product. Every size is priced off
  // its own cost, so this moves as the size buttons move — which is the whole
  // point: nobody should discover at checkout that a 3XL is dearer.
  const unitCents = unitPriceFor(product, variantIdFor(product, color, size));

  function addToBasket() {
    if (!color || !size) return;
    // A product sold in threes goes in as three. The rule counts the ITEM rather
    // than the design, so a customer who wants three different marks can take
    // two of these back out and add the others — but the first click should not
    // leave them holding an invalid basket and a sentence explaining it.
    add({ productId: product.id, color, size, quantity: minimum });
    setAdded(true);
    window.setTimeout(() => { setAdded(false); }, 1800);
  }

  return (
    <div className={s.opts}>
      {product.colors.length > 1 && (
        <div className={s.optRow}>
          <div className={s.optLabel}>
            <span className={s.optName}>Colour</span>
            <span className={s.optValue}>{color}</span>
          </div>
          <div className={s.swatches}>
            {product.colors.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`${s.swatch} ${c.name === color ? s.swatchOn : ""}`}
                style={{ background: c.hex }}
                title={c.name}
                aria-label={c.name}
                aria-pressed={c.name === color}
                onClick={() => { setColor(c.name); }}
              />
            ))}
          </div>
        </div>
      )}

      {product.sizes.length > 1 && (
        <div className={s.optRow}>
          <div className={s.optLabel}>
            <span className={s.optName}>Size</span>
            <span className={s.optValue}>{size}</span>
          </div>
          <div className={s.sizes}>
            {product.sizes.map((sz) => (
              <button
                key={sz}
                type="button"
                className={`${s.sizeBtn} ${sz === size ? s.sizeOn : ""}`}
                aria-pressed={sz === size}
                onClick={() => { setSize(sz); }}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={s.buyRow}>
        <button type="button" className={s.add} onClick={addToBasket}>
          {added
            ? "In the basket"
            : minimum > 1
              ? `Add ${minimum} — ${money(unitCents * minimum)}`
              : `Add — ${money(unitCents)}`}
        </button>

        {product.sale && <p className={s.saleNote}>{product.sale.why}</p>}

        <p className={s.notLiveB}>
          Made to order &mdash; 2&ndash;5 business days, then shipping at cost.{" "}
          <a href="/store/help">Shipping &amp; returns</a>
        </p>
      </div>
    </div>
  );
}
