"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { Product } from "../../lib/store";
import { formatUSD, placementFor, printLabel } from "../../lib/store";
import ProductFigure from "./ProductFigure";
import s from "./store.module.css";

/**
 * One product, on the ice.
 *
 * The tilt writes two CSS custom properties and lets the stylesheet do the
 * transform. That keeps the whole effect declarative, keeps the parallax on the
 * figure to one line of CSS, and means the fallback — no script, coarse
 * pointer, reduced motion — is simply that the card sits flat, which is a
 * perfectly good card.
 */
export default function ProductCard({ product, showPrice = true }: { product: Product; showPrice?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  const [colorIdx, setColorIdx] = useState(0);
  const [hot, setHot] = useState(false);

  const color = product.colors[colorIdx] ?? product.colors[0]!;
  const image = product.images[0]!;

  const tilt = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = ref.current;
    // Touch drags should scroll the page, not rotate a t-shirt.
    if (!el || e.pointerType !== "mouse") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(px * 7).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-py * 7).toFixed(2)}deg`);
  }, []);

  const flatten = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
    setHot(false);
  }, []);

  return (
    <article
      ref={ref}
      className={s.card}
      onPointerMove={tilt}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={flatten}
      onFocus={() => setHot(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) flatten();
      }}
      style={{ transition: hot ? "box-shadow .35s ease, border-color .35s ease" : "box-shadow .35s ease, border-color .35s ease, transform .5s cubic-bezier(.16,1,.3,1)" }}
    >
      <div className={s.figWrap}>
        <ProductFigure
          image={image}
          color={color.hex}
          id={`c-${product.id}`}
          showPrintArea={hot}
          printLabel={printLabel(product, image.view)}
          placement={placementFor(product, image.view)}
        />
      </div>

      <div className={s.body}>
        <div className={s.nameRow}>
          <h3 className={s.name}>
            <Link href={`/store/${product.id}`}>{product.name}</Link>
          </h3>
          {showPrice && <span className={s.price}>{formatUSD(product.priceCents)}</span>}
        </div>

        <p className={s.blurb}>{product.blurb}</p>

        {product.colors.length > 1 ? (
          <div className={s.swatches}>
            {product.colors.map((c, i) => (
              <button
                key={c.name}
                type="button"
                className={`${s.swatch} ${i === colorIdx ? s.swatchOn : ""}`}
                style={{ background: c.hex }}
                aria-label={`${c.name}${i === colorIdx ? ", selected" : ""}`}
                aria-pressed={i === colorIdx}
                onClick={() => setColorIdx(i)}
              />
            ))}
            <span className={s.swatchName}>{color.name}</span>
          </div>
        ) : (
          <div className={s.swatches}>
            <span className={s.swatchName} style={{ marginLeft: 0 }}>
              {product.colors[0]!.name} · {product.sizes.join(" / ")}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
