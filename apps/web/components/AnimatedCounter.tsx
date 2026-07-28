"use client";

import { useEffect, useRef, useState } from "react";
import { num } from "../lib/format";

/**
 * A figure that counts up when it scrolls into view.
 *
 * THE NUMBER IS REAL TEXT UNLESS WE KNOW THE ANIMATION CAN RUN.
 *
 * The count itself is a CSS `counter()` driven by an animated custom property,
 * which means the digits only exist while that animation is running. globals.css
 * disables every animation under `prefers-reduced-motion`, so on that setting
 * the counter never advanced and the archive rendered its seasons, players and
 * games as **0** — a reader who asks for less motion was shown wrong figures,
 * which is worse than showing them no motion.
 *
 * So the plain number is the default, on the server and on the first client
 * render, and the animated form is opted into only after mount and only when
 * the media query says motion is welcome. That also fixes it for no-JS without
 * needing the `<noscript>` special case, and it means the figure is correct
 * during hydration rather than briefly zero.
 */
export default function AnimatedCounter({
  value,
  suffix,
}: {
  value: number | string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [animate, setAnimate] = useState(false);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;               // stay as plain text, permanently
    setAnimate(true);

    // If the reader changes the preference mid-session, fall back to text.
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setAnimate(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !animate) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setCounting(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [animate]);

  const n = typeof value === "number" ? value : parseFloat(value);
  /**
   * A CSS `counter()` CANNOT PRINT A THOUSANDS SEPARATOR, so above 999 there is
   * no animation to be had — only a choice between an animated 1239 and a
   * correct 1,239. Karchensky's page led with "Points 1239" while the same
   * career read 1,239 in the leaderboard, the timelines, the timelines' own
   * sub-line and his player-index tile; The opponents' Goals tile had already
   * been routed around the counter by hand for exactly this. It is one rule
   * here rather than a formatter at every call site.
   */
  const countable = !isNaN(n) && Number.isInteger(n) && n >= 0 && n < 1000;

  // Anything the CSS counter cannot express — a record like "140-119", a
  // decimal, a negative, a figure over 999 — is plain text, and a figure is
  // set the way this site sets figures.
  if (!countable || !animate) {
    return (
      <span>
        {typeof value === "number" ? num(value) : value}
        {suffix}
      </span>
    );
  }

  return (
    <span
      ref={ref}
      className={`anim-counter${counting ? " counting" : ""}`}
      style={{ "--counter-end": n } as React.CSSProperties}
      // The digits are drawn by CSS, so the accessible name has to be supplied.
      aria-label={`${n}${suffix ?? ""}`}
    >
      {suffix}
    </span>
  );
}
