import type { Metadata } from "next";
import Link from "next/link";
import ProductCard from "../../components/store/ProductCard";
import { pageMeta } from "../../lib/meta";
import { groups, products } from "../../lib/store";
import s from "../../components/store/store.module.css";

/**
 * THE STORE.
 *
 * It was a placeholder saying "Not open yet" for three days, and the note that
 * stood here explained why: the products it had listed were drafts on a Printify
 * shop, several carrying artwork that could not print above 300 dpi, and the
 * copy described a range that did not exist. All of that is fixed. Twenty-three
 * products across nine marks and six items exist on shop 28277243, every one
 * read back and verified, the worst print in the line at 437 dpi against a floor
 * of 300.
 *
 * **This page can take money now.** Between the placeholder and this there was a
 * plan to hand checkout to a Printify Pop-Up store — a second website on a
 * second domain that the customer would be handed off to. It was abandoned on
 * 2026-07-29 for the reason it was chosen: it does NOT make Printify the
 * merchant of record, which was the only thing it was for. Their own help pages
 * say the seller is, and that no tax is applied at their checkout at all. So the
 * tax obligation was identical either way, and the Pop-Up cost the experience
 * for nothing. Checkout is `workers/checkout`, on this domain, in this design.
 *
 * The grid renders from `apps/web/data/products.json`, which is written by the
 * sync from the verified read-back. A product that failed to sync is not in that
 * file and therefore cannot appear here — which is the correct failure, because
 * it does not exist to be bought.
 */

/**
 * THIS SENTENCE LISTED THREE THINGS THE SHOP DOES NOT SELL, for weeks, and it
 * is the first thing a search engine and a link preview quote.
 *
 * It read "Tees, hoodies, caps, beanies, mugs, stickers and pucks, carrying
 * nine crests". The puck came off on 2026-07-29 (one maker, $18 for a rubber
 * disc), the cap and the beanie on 2026-08-03 (our linework is 0.24mm against a
 * 1mm stitch floor), and there are ten marks, not nine.
 *
 * Nothing checks this file against the line, because metadata is prose and the
 * line is data. Keep it to what cannot go stale: the categories change, the
 * club does not.
 */
export const metadata: Metadata = pageMeta({
  title: "Store",
  path: "/store",
  description:
    "Tees, long sleeves, crewnecks, hoodies, youth tees, mugs and stickers, " +
    "carrying the crests of the Golden Retrievers — Buffalo's premier " +
    "golden-retriever-themed hockey team since 2011.",
});

export default function StorePage() {
  return (
    <div className="wrap wrap-shelf page">
      <header className="hero seq">
        <h1 className="hero-h">
          The team
          <br />
          <i>store.</i>
        </h1>
        {/* NO TERMS UNDER THE HEADING. A paragraph here used to open the shop
            with "Made to order, 2–5 business days. Shipping charged at cost",
            on the reasoning that the grid is where a shopper decides whether
            the place is real and the only route out was 99.7% of the way down
            the page. The route out stays — it is the link in the footer below —
            but leading with fulfilment terms tells the reader how the thing is
            made before it tells them what it is. */}
        <nav className={s.categoryNav} aria-label="Sections">
          {groups.map((group) => (
            <a key={group.itemId} href={`#${group.itemId}`}>{group.label}</a>
          ))}
        </nav>
      </header>

      {groups.map((group) => (
        <section key={group.itemId} id={group.itemId} data-reveal>
          {/* The count is not decoration: three cards are in view and the rest
              are along the row, so "8" is the only thing that tells a shopper
              at a glance that there are five more. */}
          <h2 className="head">
            {group.label}
            <span className={s.headCount}>{group.products.length}</span>
          </h2>
          <div className={s.grid} data-stagger>
            {group.products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ))}

      {!products.length && (
        <p className={s.soon}>
          The catalog is empty — the shop has not been synced. Nothing is listed
          rather than something being guessed at.
        </p>
      )}

      {/* THE LINK, AND ONLY THE LINK. The prose that used to wrap it —
          "everything is made to order, so allow 2–5 business days… shipping is
          charged at cost" — said on the shelf what the help page says properly,
          and "made to order" invites the reader to work out that this is print
          on demand. The terms have one home now and this points at it. */}
      <p className={s.detailCopy}>
        <Link href="/store/help">Shipping &amp; returns</Link>
      </p>
    </div>
  );
}
