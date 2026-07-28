import FarShore from "../components/rink/home/FarShore";

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
export default function Home() {
  return <FarShore />;
}
