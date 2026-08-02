"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  /** Saved lines discarded on load because the shop no longer sells them. */
  dropped: number;
  /** Acknowledge the notice, so it does not follow the shopper around. */
  seenDropped: () => void;
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
function load(): { lines: BasketLine[]; dropped: number } {
  if (typeof window === "undefined") return { lines: [], dropped: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lines: [], dropped: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { lines: [], dropped: 0 };
    const known = new Map(products.map((p) => [p.id, p]));
    const lines = parsed.flatMap((entry): BasketLine[] => {
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
    /**
     * **COUNT WHAT WAS THROWN AWAY, and say so in the drawer.**
     *
     * Dropping the unknown lines is right; doing it in silence is not. The
     * pruned array is written straight back over the stored one, so a returning
     * shopper's basket went from five things to two with no explanation and no
     * evidence left to explain it — which reads as a shop that lost the order,
     * not a shop that retired a product.
     */
    return { lines, dropped: parsed.length - lines.length };
  } catch {
    return { lines: [], dropped: 0 };
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [open, setOpen] = useState(false);
  // Deliberately not the initial state: this component renders on the server
  // during the export, and reading localStorage in a useState initialiser makes
  // the first client render disagree with the HTML that was shipped.
  const [ready, setReady] = useState(false);
  /** How many saved lines named something the shop no longer sells. */
  const [dropped, setDropped] = useState(0);

  useEffect(() => {
    const restored = load();
    setLines(restored.lines);
    setDropped(restored.dropped);
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

  /**
   * Empty the basket, and the saved copy of it.
   *
   * WIPING STORAGE IS THE WHOLE FIX, not tidiness. `ClearBasket` on
   * /store/thanks is a CHILD of this provider, and React runs child effects
   * before parent ones — so on 2026-08-01 it cleared the basket, and then the
   * hydration effect below read localStorage and put the paid-for mug straight
   * back. The customer saw the thank-you page with the thing they had just
   * bought still in the drawer.
   *
   * Removing the key means that restore finds nothing to restore, whatever
   * order the effects happen to run in.
   */
  const clear = useCallback(() => {
    setLines([]);
    setDropped(0);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Same reasoning as the write below: storage being unavailable is not a
      // reason to leave the basket in memory.
    }
  }, []);

  /** Dismiss the "no longer in the shop" line once it has been read. */
  const seenDropped = useCallback(() => { setDropped(0); }, []);

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  const value = useMemo(
    () => ({ lines, add, setQuantity, remove, clear, open, setOpen, count, dropped, seenDropped }),
    [lines, add, setQuantity, remove, clear, open, count, dropped, seenDropped],
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
  const { lines, setQuantity, remove, open, setOpen, dropped, seenDropped } = useCart();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The control that opened the drawer, so Escape can hand focus back. */
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  /**
   * Escape closes it, Tab stays inside it, and focus goes back where it came
   * from.
   *
   * The first version did only the first of those and the drawer was not
   * operable without a mouse: after Add, focus stayed on the Add button, five
   * Tab presses were needed to reach the basket that had just opened over the
   * page, and Shift+Tab walked straight out to controls sitting *underneath*
   * the scrim. Escape then left focus wherever the tabbing had stranded it.
   *
   * A panel that covers the page and traps you is still worse than no panel, so
   * Escape is unconditional and the trap only cycles Tab — it never blocks the
   * way out.
   */
  useEffect(() => {
    if (!open) {
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus();
      return;
    }

    opener.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href]")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);

    // The page behind must not scroll while the drawer is over it. `.drawer`
    // also sets `overscroll-behavior: contain`; without the lock a wheel over
    // the drawer still moved the page 35px once the list hit its end.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    panel.current?.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
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
      <aside
        className={s.drawer}
        aria-label="Basket"
        role="dialog"
        aria-modal="true"
        ref={panel}
      >
        <header className={s.head}>
          {/* tabIndex so focus can land here on open and the screen reader
              announces what just covered the page. */}
          <h2 className={s.headTitle} tabIndex={-1}>Basket</h2>
          <button type="button" className={s.close} onClick={() => { setOpen(false); }}>Close</button>
        </header>

        {dropped > 0 && (
          <p className={s.dropped} role="status">
            {dropped === 1
              ? "One thing you had saved is no longer in the shop, so it has been taken out."
              : `${dropped} things you had saved are no longer in the shop, so they have been taken out.`}{" "}
            <button type="button" className={s.droppedOk} onClick={seenDropped}>Got it</button>
          </p>
        )}

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
                        aria-label={
                          line.quantity >= MAX_PER_LINE
                            ? `${MAX_PER_LINE} is the most of one thing per order`
                            : `One more ${product.title}`
                        }
                        title={line.quantity >= MAX_PER_LINE ? `${MAX_PER_LINE} is the most of one thing per order` : undefined}
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
            {/* TWO FACTS AND NOTHING ELSE.
                This carried two more. "Made to order in 2–5 business days"
                described HOW the thing is made rather than when it arrives, and
                invites the reader to work out that it is print on demand. And
                "Got a code from the team? Enter it at checkout" advertised the
                discount codes to every shopper, including the ones who do not
                have one — a prompt to go looking for a code, on the screen
                where they were about to pay full price. Codes still work at
                Stripe; they are simply not announced here. */}
            <p className={s.note}>
              Shipping and tax are calculated at checkout. Typically ships
              within 2&ndash;5 business days from order.
            </p>
            {/* The link is its own paragraph, not the tail of the sentence
                above. Run together, it read as a fourth clause of the shipping
                explanation and was the easiest thing on the panel to miss. */}
            <p className={s.noteLink}>
              <a href="/store/help">Shipping &amp; returns</a>
            </p>

            {/* role=alert: this appears at the moment a shopper presses the
                only button that takes their money, and without it a screen
                reader is told nothing at all. */}
            {failure && <p className={s.failure} role="alert">{failure}</p>}

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
