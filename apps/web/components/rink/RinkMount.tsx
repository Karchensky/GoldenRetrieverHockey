"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import ExperienceSound from "./ExperienceSound";

/**
 * One persistent world for the whole site.
 *
 * This component lives in the root layout, so client-side navigation does not
 * throw the rink away and construct another one behind the next page. The route
 * changes what is on top of it; the place itself survives.
 *
 * THE WORLD BEHIND THE CONTENT PAGES IS THE AERIAL POND. The legacy indoor
 * rink that used to be the background here was a different place from the one
 * the home page stands in, and two identities on one site is worse than
 * either — so it was replaced rather than joined, and then deleted. Mounting
 * two worlds would put two full WebGL scenes on every page of the archive, one
 * of them invisible behind the other and both of them paid for. There is
 * exactly one canvas per route, and this is where it is decided.
 */
const AmbientRink = dynamic(() => import("./ambient/AmbientRink"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        background: "radial-gradient(126% 96% at 50% 66%, #14232f 0%, #0b1520 38%, #070c14 72%, #04060b 100%)",
      }}
    />
  ),
});

export default function RinkMount() {
  const pathname = usePathname();
  const home = pathname === "/";
  // Routes that ARE a world of their own; mounting the ambient world under them
  // would render a hidden second scene behind an opaque canvas.
  // /journey, /icehouse and /home-next are gone — abandoned attempts at this,
  // retired when the far shore won. /opener is the remaining lab.
  const ownWorld = home || pathname === "/aerial" || pathname === "/opener";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("prologue-hold"); // retired with the old home prologue
  }, [home]);

  return (
    <>
      {!ownWorld && <AmbientRink />}
      {!ownWorld && <div aria-hidden="true" className="rink-scrim" />}
      <ExperienceSound />
    </>
  );
}
