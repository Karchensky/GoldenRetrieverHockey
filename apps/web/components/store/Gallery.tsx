"use client";

import { useCallback, useEffect, useState } from "react";
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
 * image. The overlay traps nothing: Escape closes it, so does clicking anywhere,
 * and focus returns to the thumbnail that opened it.
 */
export default function Gallery({
  images,
  title,
}: {
  images: { src: string; alt: string }[];
  title: string;
}) {
  const [open, setOpen] = useState<number | null>(null);

  const close = useCallback(() => { setOpen(null); }, []);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? null : (i + 1) % images.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? null : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-screen image is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
            onClick={() => { setOpen(index); }}
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

      {open !== null && images[open] && (
        <div className={s.lightbox} role="dialog" aria-modal="true" aria-label={title}>
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
        </div>
      )}
    </>
  );
}
