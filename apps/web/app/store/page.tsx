import type { Metadata } from "next";
import Link from "next/link";
import ProductCard from "../../components/store/ProductCard";
import s from "../../components/store/store.module.css";
import { families, products } from "../../lib/store";
import { buyableCount, hostedStorefrontUrl } from "../../lib/storefront";

// The root layout sets title.template = "%s — Golden Retriever Hockey". Anything
// with the suffix baked in here comes out saying it twice.
export const metadata: Metadata = {
  title: "Store",
  description: hostedStorefrontUrl
    ? `${products.length} items, printed to order.`
    : `${products.length} items, printed to order. Not yet open.`,
};

const live = buyableCount(products);

export default function StorePage() {
  return (
    <div className="wrap page">
      <header className="hero seq">
        <span className="kicker">
          {products.length} items · printed to order{live ? "" : " · not yet open"}
        </span>
        <h1 className="hero-h">
          The team
          <br />
          <i>store.</i>
        </h1>
        <p className="hero-p">
          The crest on light bodies, the archive&rsquo;s own artwork on dark. Printed one at a time,
          when somebody orders one.
        </p>
        <nav className={s.categoryNav} aria-label="Store sections">
          {families.map((f) => (
            <a href={`#${f.id}`} key={f.id}>
              {f.label}
            </a>
          ))}
        </nav>
      </header>

      {/* NOT OPEN, AND SAID ONCE WHERE IT CANNOT BE MISSED.
          A page that lays out eleven products, prices them and gives each one
          its own detail page IS a shop, to anybody who lands on it. That it
          cannot take an order was stated in an 11px kicker above the headline,
          which is where a reader looks last. This is the one thing about this
          page that cannot be worked out by looking at it.
          Derived: it disappears by itself the day a product carries a buy link,
          rather than waiting for somebody to remember to delete it. */}
      {live === 0 && (
        <aside className={s.notOpen} role="status">
          <strong>The store is not open yet.</strong>
          <span>The designs are finished. Checkout is not.</span>
        </aside>
      )}

      {/* No `.card` wrapper around a family. The archive puts tables inside a
          frosted panel; here the products ARE the panels, and a panel of panels
          reads as a frame around a frame. */}
      {families.map((family) => (
        <section className="section" id={family.id} aria-labelledby={`${family.id}-title`} key={family.id} data-reveal>
          <div className="head">
            <h2 id={`${family.id}-title`}>{family.label}</h2>
            <span className="kicker">
              {family.note} · {family.items.length} {family.items.length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className={s.grid} data-stagger>
            {family.items.map((product) => (
              <ProductCard key={product.id} product={product} showPrice={!hostedStorefrontUrl} />
            ))}
          </div>
        </section>
      ))}

      <footer className="site">
        {live
          ? `${live} of ${products.length} available at the print shop.`
          : "Every item exists as a draft at the print shop. None of them ship yet."}{" "}
        <Link href="/seasons" style={{ borderBottom: "1px solid var(--line)" }}>
          Team archive
        </Link>
      </footer>
    </div>
  );
}
