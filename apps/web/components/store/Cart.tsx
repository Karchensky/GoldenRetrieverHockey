"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MAX_PER_LINE, lineKey, money, resolveBasket, unitPriceFor, variantIdFor } from "../../../../packages/store/src/basket";
import type { BasketLine } from "../../../../packages/store/src/basket";
import { products } from "../../lib/store";
import s from "./cart.module.css";

/**
 * The basket, and the only part of this site that holds state across a click.
 *
 * **It lives in the browser and it is not authoritative about anything.** It
 * stores three strings and a number per line — product, colour, size, quantity —
 * and every price it shows is looked up from the same catalog the Worker holds.
 * When it checks out it posts those same three strings, and the Worker resolves
 * prices, variant ids and the buying rules again from its own copy. Nothing the
 * customer can edit in this file changes what they are charged.
 *
 * It shows the rules as it goes, which is the whole point of doing the work
 * twice: a basket with one sticker in it says so in the drawer, at the moment it
 * happens, instead of at a card form after somebody has entered an address.
 */

const STORAGE_KEY = "gr-basket-v1";

type CartState = {
  lines: BasketLine[];
  add: (line: BasketLine) => void;
  setQuantity: (line: BasketLine, quantity: number) => void;
  remove: (line: BasketLine) => void;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  count: number;
};

const CartContext = createContext<CartState | null>(null);

export function useCart(): CartState {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart outside CartProvider");
  return cart;
}

/**
 * Read what a previous visit left, defensively.
 *
 * A basket can outlive the catalog that made it — a product gets retired, a
 * colourway comes off, the whole line gets rebuilt, and any of those leaves a
 * line in localStorage naming something that no longer exists. Discarding the
 * unknown lines here rather than at checkout means the drawer shows what can
 * still be bought instead of an error about something the customer chose weeks
 * ago and does not remember.
 */
function load(): BasketLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Map(products.map((p) => [p.id, p]));
    return parsed.flatMap((entry): BasketLine[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const { productId, color, size, quantity } = entry as Record<string, unknown>;
      if (typeof productId !== "string" || typeof color !== "string" || typeof size !== "string") return [];
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return [];
      const product = known.get(productId);
      if (!product) return [];
      if (!product.colors.some((c) => c.name === color)) return [];
      if (!product.sizes.includes(size)) return [];
      return [{ productId, color, size, quantity: Math.min(quantity, MAX_PER_LINE) }];
    });
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [open, setOpen] = useState(false);
  // Deliberately not the initial state: this component renders on the server
  // during the export, and reading localStorage in a useState initialiser makes
  // the first client render disagree with the HTML that was shipped.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(load());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // A full or disabled store is not a reason to lose the basket in memory.
    }
  }, [lines, ready]);

  const add = useCallback((line: BasketLine) => {
    setLines((current) => {
      const key = lineKey(line);
      const already = current.find((l) => lineKey(l) === key);
      if (!already) return [...current, line];
      return current.map((l) =>
        lineKey(l) === key
          ? { ...l, quantity: Math.min(l.quantity + line.quantity, MAX_PER_LINE) }
          : l,
      );
    });
    setOpen(true);
  }, []);

  const setQuantity = useCallback((line: BasketLine, quantity: number) => {
    const key = lineKey(line);
    setLines((current) =>
      quantity < 1
        ? current.filter((l) => lineKey(l) !== key)
        : current.map((l) =>
            lineKey(l) === key ? { ...l, quantity: Math.min(quantity, MAX_PER_LINE) } : l,
          ),
    );
  }, []);

  const remove = useCallback((line: BasketLine) => {
    const key = lineKey(line);
    setLines((current) => current.filter((l) => lineKey(l) !== key));
  }, []);

  const clear = useCallback(() => { setLines([]); }, []);

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  const value = useMemo(
    () => ({ lines, add, setQuantity, remove, clear, open, setOpen, count }),
    [lines, add, setQuantity, remove, clear, open, count],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartDrawer />
    </CartContext.Provider>
  );
}

/**
 * The basket, in the masthead.
 *
 * **It is always here.** The first version rendered nothing until something had
 * been added, on the reasoning that an empty basket is not worth a control. That
 * is wrong twice over: a shopper cannot check what is in their basket without
 * first putting something in it, and a store with no visible basket reads as a
 * store that cannot take money. The captain could not find it, which is the only
 * evidence needed.
 *
 * The count appears when there is one.
 */
export function CartButton() {
  const { count, setOpen } = useCart();
  return (
    <button
      type="button"
      className={s.navButton}
      onClick={() => { setOpen(true); }}
      aria-label={count ? `Basket, ${count} item${count === 1 ? "" : "s"}` : "Basket, empty"}
    >
      Basket{count > 0 && <span className={s.navCount}>{count}</span>}
    </button>
  );
}

function CartDrawer() {
  const { lines, setQuantity, remove, open, setOpen } = useCart();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Escape closes it, because a panel that covers the page and traps you is a
  // worse thing than no panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);

  const resolution = useMemo(() => resolveBasket(lines, products), [lines]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), []);

  // Per VARIANT. Summing `priceCents` would quote every size at the cheapest
  // one and disagree with the invoice.
  const priceOf = (l: BasketLine): number => {
    const product = byId.get(l.productId);
    if (!product) return 0;
    return unitPriceFor(product, variantIdFor(product, l.color, l.size));
  };
  const subtotal = lines.reduce((sum, l) => sum + priceOf(l) * l.quantity, 0);

  async function checkout() {
    setSending(true);
    setFailure(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const body = (await res.json()) as { url?: string; problems?: string[]; error?: string };
      if (!res.ok || !body.url) {
        setFailure(body.problems?.join(" ") ?? body.error ?? "Checkout is not answering. Try again in a minute.");
        setSending(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setFailure("Could not reach checkout. Check your connection and try again.");
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className={s.scrim}
        aria-label="Close basket"
        onClick={() => { setOpen(false); }}
      />
      <aside className={s.drawer} aria-label="Basket">
        <header className={s.head}>
          <h2 className={s.headTitle}>Basket</h2>
          <button type="button" className={s.close} onClick={() => { setOpen(false); }}>Close</button>
        </header>

        {!lines.length ? (
          <p className={s.empty}>
            Your basket is empty. <a href="/store">Have a look at the shop</a>.
          </p>
        ) : (
          <>
            <ul className={s.lines}>
              {lines.map((line) => {
                const product = byId.get(line.productId);
                if (!product) return null;
                return (
                  <li key={lineKey(line)} className={s.line}>
                    <div className={s.lineMain}>
                      <span className={s.lineName}>{product.title}</span>
                      <span className={s.lineOpts}>
                        {line.color} · {line.size}
                      </span>
                    </div>
                    <div className={s.lineQty}>
                      <button
                        type="button"
                        onClick={() => { setQuantity(line, line.quantity - 1); }}
                        aria-label={`One fewer ${product.title}`}
                      >
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => { setQuantity(line, line.quantity + 1); }}
                        disabled={line.quantity >= MAX_PER_LINE}
                        aria-label={`One more ${product.title}`}
                      >
                        +
                      </button>
                    </div>
                    <span className={s.linePrice}>{money(priceOf(line) * line.quantity)}</span>
                    <button
                      type="button"
                      className={s.lineDrop}
                      onClick={() => { remove(line); }}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>

            {!resolution.ok && (
              <ul className={s.problems}>
                {resolution.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}

            <div className={s.totals}>
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <p className={s.note}>
              Shipping and tax are calculated at checkout. Made to order in 2&ndash;5
              business days. Got a code from the team? Enter it at checkout.{" "}
              <a href="/store/help">Shipping &amp; returns</a>
            </p>

            {failure && <p className={s.failure}>{failure}</p>}

            <button
              type="button"
              className={s.checkout}
              disabled={!resolution.ok || sending}
              onClick={() => { void checkout(); }}
            >
              {sending ? "Taking you to checkout…" : "Checkout"}
            </button>
          </>
        )}
      </aside>
    </>
  );
}
