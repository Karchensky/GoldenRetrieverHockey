import type { Metadata } from "next";
import Link from "next/link";
import ClearBasket from "../../../components/store/ClearBasket";
import s from "../../../components/store/store.module.css";

/**
 * Where Stripe sends somebody after they have paid.
 *
 * **It states nothing it cannot know.** This is a static page in a static
 * export: it has no session, no order and no way to look one up, and the
 * `session_id` Stripe appends to the URL is not read here. A page that greeted
 * the customer with a summary of their order would be reading that id in the
 * browser and asking a server for the answer, which is a second endpoint and a
 * second thing to get wrong for no benefit — the receipt already has every
 * figure on it.
 *
 * The order is placed by the webhook, not by this page being reached. Somebody
 * who closes the tab on the payment screen still gets their parcel, and somebody
 * who reloads this page does not get a second one.
 *
 * TWO SENTENCES, AND IT USED TO BE FOUR. The old copy explained that everything
 * is printed after you buy it rather than pulled off a shelf, and asked the
 * reader to "reckon on a few days in production and a few more in the post".
 * Nobody talks like that, it buried the only two facts that matter, and it told
 * every customer the shop holds no stock — which is true, and is nobody's
 * business. "Ships in 2-5 business days" is the same promise without the
 * confession, and it agrees with the 4-10 business day delivery estimate on the
 * Stripe page: dispatch, then transit.
 *
 * "We've emailed your receipt", not "Stripe has emailed you a receipt". The
 * customer bought from this shop. Who processed the card is not their problem.
 * It does depend on Stripe's "Successful payments" customer email being ON —
 * see MANUAL.md, it is off by default in test mode.
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
      <ClearBasket />
      <header className="hero seq">
        <h1 className="hero-h">
          Order
          <br />
          <i>complete.</i>
        </h1>
        <p className="hero-p">
          We&rsquo;ve emailed your receipt. Ships in 2&ndash;5 business days.
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
