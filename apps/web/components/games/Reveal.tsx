"use client";

import { useEffect, useRef, useState } from "react";
import s from "./games.module.css";

/**
 * Reveal children once they scroll into view, staggered by index.
 *
 * Starts VISIBLE and is hidden by the effect on mount, never the other way
 * round. Static export means this HTML is what a crawler, a reader with
 * JavaScript off, and the Internet Archive all get — and an archive whose own
 * pages go blank without JS would be a poor joke. If the effect never runs,
 * the record is simply there.
 *
 * `prefers-reduced-motion` is honoured in the stylesheet rather than here, so
 * the opacity never drops for a reader who asked for stillness.
 */
export default function Reveal({
  children,
  index = 0,
  className = "",
  as = "div",
}: {
  children: React.ReactNode;
  /** Stagger position. Capped, so item 400 does not wait six seconds. */
  index?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    setArmed(true);

    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as "div";
  return (
    <Tag
      ref={ref as never}
      className={`${className} ${armed && !shown ? s.reveal : ""} ${shown ? s.revealed : ""}`}
      style={armed && !shown ? { transitionDelay: `${Math.min(index, 8) * 55}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
