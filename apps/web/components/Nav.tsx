"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOUNDED } from "../lib/data";

/**
 * The masthead.
 *
 * Fixed, thin, and frosted, because the rink is the page background and the
 * dog is live underneath it the whole way down — a solid bar would be a lid
 * on the one thing worth looking at. `pointer-events` is surgical for the
 * same reason: the nav itself takes the pointer, the strip around it does not,
 * so the ice stays interactive right up to the edge of the links.
 *
 * EXCEPT on the world routes, where it does not appear at all — see WORLDS.
 */

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/store", label: "Store" },
  { href: "/seasons", label: "Team Archive" },
] as const;

/**
 * Routes that ARE a world rather than a page.
 *
 * These carry no masthead. The reason is measured, not stylistic: the bar
 * renders as a static near-black gradient strip across the top of the frame,
 * and that is precisely the failure this project's own reference measurement
 * called out — "igloo's dark pixels sit at mean y=657, foreground shadow, an
 * object between you and the light; ours sat at y=192, a black bar across the
 * top where there is nothing to see". On /opener it costs three metrics at
 * once: it is a flat region (4.0% against a 3% ceiling), it never changes
 * (aliveness 52.8 -> 47.9), and it drags the frame's darks to the top
 * (placement 0.881 -> 0.648). Hiding it returns all three to the lab's values.
 *
 * The journey does not need it either way: its two doors ARE the navigation —
 * ball to the Store, retriever to the Archive — which is the signed-off "one
 * world, two doors". Archive and Store keep the masthead; they are pages.
 */
const WORLDS = ["/", "/opener", "/aerial"];

export default function Nav() {
  const path = usePathname();
  if (WORLDS.includes(path)) return null;

  return (
    <nav aria-label="Primary" className="nav">
      <div className="nav-in">
        <Link href="/" className="brand" aria-label="The Golden Retrievers, home">
          {/* The team is the GOLDEN RETRIEVERS. Plural, always — the singular is
              a dog, the plural is the club, and the wordmark had it wrong.

              The sub-line used to read "Hockey / Interactive world", which is
              the site announcing its own genre to a reader who is already
              looking at it — the exact failure the house rules name. A masthead
              carries a dateline instead: where the team is and when it started,
              two facts the nav cannot show you. */}
          <span className="brand-t">
            Golden Retrievers
            <span className="brand-s">Buffalo · est. {FOUNDED}</span>
          </span>
        </Link>

        <ul className="links">
          {LINKS.map((l) => {
            const base = l.href.split("#")[0]!;
            const on = l.href === "/" ? path === "/" : path === base || path.startsWith(`${base}/`);
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={on ? "page" : undefined} className={on ? "on" : ""}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
