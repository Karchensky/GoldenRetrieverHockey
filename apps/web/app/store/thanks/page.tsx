import type { Metadata } from "next";
import Link from "next/link";
import s from "../../../components/store/store.module.css";

/**
 * Where Stripe sends somebody after they have paid.
 *
 * **It states nothing it cannot know.** This is a static page in a static
 * export: it has no session, no order and no way to look one up, and the
 * `session_id` Stripe appends to the URL is not read here. A page that greeted
 * the customer with a summary of their order would be reading that id in the
 * browser and asking a server for the answer, which is a second endpoint and a
 * second thing to get wrong for no benefit — Stripe has already emailed them a
 * receipt with every figure on it.
 *
 * The order is placed by the webhook, not by this page being reached. Somebody
 * who closes the tab on the payment screen still gets their parcel, and somebody
 * who reloads this page does not get a second one.
 */

export const metadata: Metadata = {
  title: "Thank you",
  description: "The order is in.",
  // Nothing to index: it is reachable only with a session id and says the same
  // thing to everybody.
  robots: { index: false, follow: false },
};

export default function ThanksPage() {
  return (
    <div className="wrap page">
      <header className="hero seq">
        <h1 className="hero-h">
          That&rsquo;s
          <br />
          <i>ordered.</i>
        </h1>
        <p className="hero-p">
          Stripe has emailed you a receipt. Everything here is printed to order, so
          it is made after you buy it rather than pulled off a shelf — reckon on a
          few days in production and a few more in the post.
        </p>
      </header>

      <p className={s.detailCopy}>
        <Link href="/store">Back to the store</Link>
        {" · "}
        <Link href="/seasons">The team archive</Link>
      </p>
    </div>
  );
}
