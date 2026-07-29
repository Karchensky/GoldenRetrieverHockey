import type { Metadata } from "next";
import Link from "next/link";
import ProductCard from "../../components/store/ProductCard";
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

export const metadata: Metadata = {
  title: "Store",
  description:
    "Tees, hoodies, caps, beanies, mugs, stickers and pucks, carrying nine crests " +
    "drawn for the Golden Retrievers — Buffalo's premier golden retriever " +
    "themed hockey team since 2011.",
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
        <p className="hero-p">
          Nine crests, drawn for the club and printed one order at a time in the
          United States. Tees, hoodies, caps, mugs, stickers &mdash; and a puck.
        </p>

        <nav className={s.categoryNav} aria-label="Sections">
          {groups.map((group) => (
            <a key={group.itemId} href={`#${group.itemId}`}>{group.label}</a>
          ))}
        </nav>
      </header>

      {groups.map((group) => (
        <section key={group.itemId} id={group.itemId} data-reveal>
          <h2 className="head">{group.label}</h2>
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

      <p className={s.detailCopy}>
        Everything is made to order, so allow 2&ndash;5 business days before it ships.
        Shipping is charged at cost &mdash; whatever the post office charges us, and
        nothing on top. <Link href="/store/help">Shipping &amp; returns</Link>
      </p>
    </div>
  );
}
