"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAmbientBed, type AmbientBed } from "./audio/ambient-bed";

/**
 * The sound gate.
 *
 * One control, bottom left, on every route. It is off, and it stays off until
 * somebody asks — no autoplay, and nothing is even fetched before the click, so
 * a visitor who never touches it pays nothing for it.
 *
 * The label is the state and there is no second line explaining what the button
 * does. The dot sits dim while the recorded beds are still arriving and comes
 * up when they are under the mix, which is the only thing about the control the
 * word "on" cannot say by itself.
 *
 * This component lives in RinkMount, which is in the root layout — so moving
 * between the archive and the store does not cut the sound off and start it
 * again. A full page load does, and that is correct: a reload is a new visit
 * and a new visit does not get sound it did not ask for.
 */
export default function ExperienceSound() {
  const [on, setOn] = useState(false);
  const [pending, setPending] = useState(false);
  const bed = useRef<AmbientBed | null>(null);
  // Off and on again while the beds are still downloading leaves the first
  // start() resolving into a world it no longer owns. Only the newest press
  // gets to say what the control reads.
  const press = useRef(0);
  const pathname = usePathname();

  useEffect(() => () => {
    bed.current?.dispose();
    bed.current = null;
  }, []);

  const toggle = useCallback(async () => {
    const active = bed.current;
    press.current += 1;
    if (active?.isRunning()) {
      active.stop();
      setOn(false);
      setPending(false);
      return;
    }
    const next = active ?? createAmbientBed();
    bed.current = next;
    setOn(true);
    setPending(true);
    const mine = press.current;
    const ok = await next.start();
    if (press.current !== mine) return;
    setPending(false);
    if (!ok) setOn(false);
  }, []);

  // THE POINTER IS A RAY THROUGH THE WORLD, AND ONLY ON THE WORLD PAGE.
  // On the far shore the cursor parts the dog's coat and lifts snow off the
  // ice, so a granular answer scaled to how fast it moved belongs there. On a
  // page somebody is reading, the same thing is a noise that fires while they
  // move to a link.
  useEffect(() => {
    if (!on || pathname !== "/") return;
    let x = 0, y = 0, t = 0;
    const onMove = (e: PointerEvent) => {
      const now = e.timeStamp;
      const nx = e.clientX / window.innerWidth;
      const ny = e.clientY / window.innerHeight;
      const dt = (now - t) / 1000;
      if (t > 0 && dt > 0 && dt < 0.25) {
        const speed = Math.hypot(nx - x, ny - y) / dt;   // viewport widths / s
        bed.current?.poke(Math.min(1, speed / 3));
      }
      x = nx; y = ny; t = now;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [on, pathname]);

  return (
    <button
      type="button"
      className="sound-gate"
      aria-pressed={on}
      onClick={() => { void toggle(); }}
    >
      <span
        aria-hidden="true"
        className="sound-gate-mark"
        style={pending ? { opacity: 0.4 } : undefined}
      />
      Sound {on ? "on" : "off"}
    </button>
  );
}
