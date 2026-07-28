import type { Metadata } from "next";
import s from "../../components/store/store.module.css";

/**
 * THE STORE, BEFORE THERE IS A STORE.
 *
 * This page listed eleven products, priced them, sorted them into four families
 * and gave each one its own page. None of them was a product: they are drafts on
 * a Printify shop, invisible, several of them carrying artwork that could not
 * print above 300 dpi at any useful size and was deleted the same day. The copy
 * went further and described a range — "the crest on light bodies, the archive's
 * own artwork on dark" — which is a promise about a line that does not exist.
 *
 * So it says the one true thing instead. The line is being built and will be
 * listed when it is finished, all at once.
 *
 * The route stays because the home page has two doors and this is one of them.
 * `/store/[id]` generates nothing while this is here — an orphaned detail page
 * is still a page a crawler can find.
 */
export const metadata: Metadata = {
  title: "Store",
  description: "Not open yet.",
};

export default function StorePage() {
  return (
    <div className="wrap page">
      <header className="hero seq">
        <h1 className="hero-h">
          The team
          <br />
          <i>store.</i>
        </h1>
      </header>

      <p className={s.soon}>Not open yet.</p>
    </div>
  );
}
