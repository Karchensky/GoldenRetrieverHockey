"use client";

import { useState } from "react";
import type { Product } from "../../lib/store";
import { formatUSD, placementFor, printLabel } from "../../lib/store";
import type { BuyLink } from "../../lib/storefront";
import ProductFigure from "./ProductFigure";
import s from "./store.module.css";

/**
 * One product, in full.
 *
 * The colour switcher is not decoration: the figure is SVG, so picking Navy
 * genuinely repaints the garment and re-derives the ink colour under it. There
 * is no second image to load and nothing to go stale.
 *
 * Sizes are listed, not selected. They used to be buttons, which made sense
 * when this page had a cart to put a size into. Checkout is a Printify Pop-Up
 * store now and the size is chosen there, on the page that will actually take
 * the order — a size picker here would be a control that remembers nothing and
 * decides nothing.
 */
export default function ProductDetail({ product, buy }: { product: Product; buy: BuyLink }) {
  const [view, setView] = useState(0);
  const [colorIdx, setColorIdx] = useState(0);

  const color = product.colors[colorIdx] ?? product.colors[0]!;
  const image = product.images[view] ?? product.images[0]!;

  return (
    <div className={s.detail}>
      <div>
        <div className={s.stage}>
          <ProductFigure
            image={image}
            color={color.hex}
            id={`d-${product.id}-${view}`}
            showPrintArea
            printLabel={printLabel(product, image.view)}
            placement={placementFor(product, image.view)}
          />
        </div>
        {product.images.length > 1 && (
          <div className={s.views}>
            {product.images.map((im, i) => (
              <button
                key={im.view}
                type="button"
                className={`${s.viewBtn} ${i === view ? s.viewOn : ""}`}
                aria-pressed={i === view}
                onClick={() => setView(i)}
              >
                {im.view}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={s.opts}>
        {product.colors.length > 1 && (
          <div className={s.optRow}>
            <div className={s.optLabel}>
              <span className="kicker">Colour</span>
              <span className={s.swatchName}>{color.name}</span>
            </div>
            <div className={s.swatches}>
              {product.colors.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  className={`${s.swatch} ${i === colorIdx ? s.swatchOn : ""}`}
                  style={{ background: c.hex, width: 22, height: 22 }}
                  aria-label={`${c.name}${i === colorIdx ? ", selected" : ""}`}
                  aria-pressed={i === colorIdx}
                  onClick={() => setColorIdx(i)}
                />
              ))}
            </div>
          </div>
        )}

        <div className={s.optRow}>
          <span className="kicker">Sizes</span>
          <span className={s.sizeList}>{product.sizes.join(" · ")}</span>
        </div>

        <div className={s.buyRow}>
          {buy.kind === "none" ? (
            <>
              <span className={s.notLiveT}>Not yet taking orders</span>
              <p className={s.notLiveB}>
                The garment exists as a draft at the print shop. Nothing ships until the store opens.
              </p>
            </>
          ) : (
            <>
              <a className={s.add} href={buy.href} target="_blank" rel="noreferrer">
                {buy.kind === "product" ? "Buy" : "Open the store"} <span aria-hidden="true">↗</span>
              </a>
              <p className={s.notLiveB}>
                {buy.kind === "product"
                  ? `${formatUSD(product.priceCents)} at the print shop, which handles sizes, shipping and payment.`
                  : "This one is not listed yet. The link opens the shop."}
              </p>
            </>
          )}
        </div>

        <table className={s.specTable}>
          <caption className="kicker" style={{ textAlign: "left", paddingBottom: 6 }}>
            Specification
          </caption>
          <tbody>
            {product.spec.map((line, i) => (
              <tr key={i}>
                <td aria-hidden="true">·</td>
                <td>{line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
