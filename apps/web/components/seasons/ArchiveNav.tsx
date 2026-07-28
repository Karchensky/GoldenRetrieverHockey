"use client";

import { useEffect, useRef, useState } from "react";
import s from "./seasons.module.css";

/**
 * The archive's map, and it says where you are.
 *
 * Making it sticky was half the job. Nine destinations that travel down a
 * nineteen-thousand-pixel document and never mark the section under them leave
 * a reader twelve thousand pixels in with no way to tell whether the last eight
 * screens were the sin bin or the opponents.
 *
 * One observer over the nine section elements, and the LAST one whose top has
 * crossed the sticky bar wins — not the largest intersection, which flickers
 * between two sections wherever a short one sits inside a tall one, and not the
 * first intersecting, which marks a section the reader has already left. A
 * section is current from the moment its heading reaches the bar until the next
 * heading does.
 *
 * The links are ordinary anchors and the marking is an attribute on them, so
 * with JavaScript off this is exactly what it was: a row of links that work.
 * Ten of them — the count is what sets the width the row stops overflowing at,
 * and the fade in `seasons.module.css` is switched off a swept measurement
 * rather than a guess.
 */
export default function ArchiveNav({
  sections,
  spine,
}: {
  /**
   * THE ROUTE, IN THE ORDER OF THE PAGE — every entry, with nothing set apart.
   *
   * `Data coverage` used to arrive through a slot of its own and render ahead
   * of this list, quieter and behind a rule, on the argument that it is the key
   * to the sections rather than one of them. That argument put an entry at the
   * head of a bar whose only promise is that it is in the order of the document,
   * and it is now the second section on the page. One list.
   */
  sections: readonly (readonly [string, string])[];
  spine: readonly (readonly [string, string])[];
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const nav = useRef<HTMLElement | null>(null);
  const ids = [...sections, ...spine].map(([href]) => href).join(" ");

  /**
   * THE MARK TRAVELS INTO VIEW, because on a phone it almost never was in it.
   *
   * Measured at 375: the row is 1,126px of links in a 335px window and eight of
   * the ten sit outside it — `Session history` by 12px, `Player index` by 791 —
   * and those eight sections span 83% of the document. At 430 it is 73% and at
   * 768 still 61%. So from the third section onward the reader had a bar that
   * marks a link they cannot see, with no reason to drag it sideways to find
   * out. The half of the job that was added was off-screen for five sixths of
   * the scroll.
   *
   * `scrollLeft` is written directly rather than `scrollIntoView`, which scrolls
   * every ancestor that can scroll — including the page, in the middle of a
   * scroll the reader is driving. Skipped where the row does not overflow, so
   * nothing moves on a desktop that shows all ten.
   */
  useEffect(() => {
    const row = nav.current;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    const here = row.querySelector<HTMLElement>('[aria-current="true"]');
    if (!here) return;
    row.scrollLeft = here.offsetLeft - (row.clientWidth - here.offsetWidth) / 2;
  }, [current]);

  useEffect(() => {
    const targets = ids
      .split(" ")
      .map((href) => document.getElementById(href.slice(1)))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    /** The sticky bar's own floor, so a heading behind it is not "here". */
    const mark = () => {
      const line = 150;
      let found: string | null = null;
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= line) found = `#${el.id}`;
      }
      setCurrent(found);
    };

    mark();
    const onScroll = () => window.requestAnimationFrame(mark);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);

  const link = ([href, label]: readonly [string, string], spineLink: boolean) => (
    <a
      key={href}
      href={href}
      className={spineLink ? s.archiveNavSpine : undefined}
      aria-current={current === href ? "true" : undefined}
    >
      {label}
    </a>
  );

  return (
    <div className={s.archiveNavWrap}>
      <nav ref={nav} className={s.archiveNav} aria-label="Team archive sections">
        {sections.map((item) => link(item, false))}
        {spine.map((item) => link(item, true))}
      </nav>
    </div>
  );
}
