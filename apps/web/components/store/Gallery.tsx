"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import s from "./store.module.css";

/**
 * The product photographs, and a way to look at one properly.
 *
 * A mockup is 1200px of garment rendered down to a column a third of the page
 * wide, which is enough to choose a colour and nowhere near enough to judge a
 * print. Clicking one opens it at the size of the window.
 *
 * **It is a button, not a div with a handler.** Keyboard reaches it, screen
 * readers announce it, and Enter opens it — none of which is true of a clickable
 * image.
 *
 * **THE OVERLAY IS PORTALLED TO `document.body`, AND HAS TO BE.** It was not,
 * and the zoom had never once worked in the export. `position: fixed` resolves
 * against the nearest ancestor with a transform, not the viewport, and the
 * product page's wrapper carries `data-reveal` → `animation: rise` → a computed
 * `matrix(1,0,0,1,0,0)`. So the "full-screen" overlay was laid out inside a
 * 1060x2077 box starting 370px down the page: the enlarged image landed at
 * y=1029 in a 900px window, and the body scroll lock below meant you could not
 * even scroll to it. Measured at 1280x900 and at 360x740 — on the phone the
 * "enlargement" came out 288px against a 294px thumbnail, smaller than the
 * thing that was tapped.
 *
 * The basket drawer never had this bug because it is mounted from `layout.tsx`,
 * outside the animated subtree. This is the same escape, done deliberately.
 * The note at `globals.css` about `[data-reveal]` creating a stacking context
 * is the same fact one step short of its consequence.
 *
 * **Focus is captured and restored**, which the previous comment claimed and no
 * code did — it was accidentally true until the first Tab.
 */
export default function Gallery({
  images,
  title,
}: {
  images: { src: string; alt: string }[];
  title: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  /** Portals need a DOM; this stays false through the server render. */
  const [mounted, setMounted] = useState(false);
  /** What had focus before the overlay opened, so Escape can give it back. */
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => { setOpen(null); }, []);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open === null) {
      // Give focus back to the thumbnail, but only if it is still on the page
      // and nothing else has deliberately taken it.
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus();
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowRight") { setOpen((i) => (i === null ? null : (i + 1) % images.length)); return; }
      if (e.key === "ArrowLeft") { setOpen((i) => (i === null ? null : (i - 1 + images.length) % images.length)); return; }
      if (e.key !== "Tab") return;

      // Trap. Without it, Shift+Tab walks out under the scrim and focuses
      // controls the shopper cannot see.
      const focusable = panel.current?.querySelectorAll<HTMLElement>("button, [href]");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-screen image is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the close control, so a keyboard user starts inside the overlay
    // rather than wherever the page happened to leave them.
    panel.current?.querySelector<HTMLElement>(`.${s.lightboxClose}`)?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close, images.length]);

  if (!images.length) {
    return <p className={s.notLiveB}>No photographs of this one yet.</p>;
  }

  return (
    <>
      <div className={s.stage}>
        {images.map((image, index) => (
          <button
            key={image.src}
            type="button"
            className={s.stageBtn}
            onClick={(e) => { opener.current = e.currentTarget; setOpen(index); }}
            aria-label={`Enlarge ${image.alt}`}
          >
            <img
              className={s.stageImg}
              src={image.src}
              alt={image.alt}
              width={1200}
              height={1200}
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
            />
            <span className={s.zoomHint} aria-hidden="true">Click to enlarge</span>
          </button>
        ))}
      </div>

      {mounted && open !== null && images[open] && createPortal(
        <div className={s.lightbox} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
          {/* The whole backdrop closes it. A button so it is reachable without
              a pointer, and it sits UNDER the image so a click on the picture
              itself still lands here. */}
          <button type="button" className={s.lightboxScrim} onClick={close} aria-label="Close" />
          <img
            className={s.lightboxImg}
            src={images[open].src}
            alt={images[open].alt}
            width={1200}
            height={1200}
          />
          <div className={s.lightboxBar}>
            <span>{images[open].alt}</span>
            {images.length > 1 && (
              <span className={s.lightboxCount}>{open + 1} / {images.length}</span>
            )}
            <button type="button" className={s.lightboxClose} onClick={close}>Close</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
