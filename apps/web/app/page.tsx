import type { Metadata } from "next";
import JsonLd from "../components/JsonLd";
import FarShore from "../components/rink/home/FarShore";
import { teamSchema } from "../lib/schema";

/**
 * THE HOME PAGE IS "THE FAR SHORE".
 *
 * A frozen lake at dawn under three ranges of mountains, the sun cresting a col
 * and laying a column of gold down the ice to the lens, and a golden retriever
 * — a point cloud sampled off the real rigged mesh — standing out on the ice
 * with his reflection under him. The opener tournament's winner
 * (docs/openers/o-2.html), ported into R3F.
 *
 * ONE VIEWPORT. NO SCROLL JOURNEY. The old scroll home — aerial open,
 * whiteouts, the ball, the retriever, 640vh of scroll track — is retired and
 * deleted; the camera on this page drifts a few degrees on an 18-second period
 * and that is all the movement there is.
 *
 * Two doors, and they are the entire copy budget: Store, and Team Archive.
 * Metadata comes from the root layout; `Nav` hides the masthead here and
 * `RinkMount` keeps the ambient world off a route that is a world already.
 */
/**
 * The one route that does NOT call `pageMeta`.
 *
 * Its title, description and card are the site's own — `title.default` rather
 * than the template, so putting it through the helper would append the club
 * name to a string that already ends in it. Everything the layout states is
 * already right for this page; the canonical is the one thing missing, and it
 * has to be stated here because a canonical on the layout would be inherited by
 * every route that did not override it. See `lib/meta.ts`.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      {/* THE CLUB'S OWN NODE, DEFINED HERE AND REFERENCED EVERYWHERE ELSE.
          Every game page and every player page points at this `@id` rather than
          restating the club, so a crawler reads 328 fixtures and 80 men as
          belonging to one team instead of to several that share a name. The
          founding year in it is counted from the earliest session on file. */}
      <JsonLd data={teamSchema()} />
      <FarShore />
    </>
  );
}
