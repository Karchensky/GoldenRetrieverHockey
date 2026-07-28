import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductDetail from "../../../components/store/ProductDetail";
import s from "../../../components/store/store.module.css";
import { byId, formatUSD, products } from "../../../lib/store";
import { buyLink, hostedStorefrontUrl } from "../../../lib/storefront";

export function generateStaticParams() {
  return products.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = byId(id);
  if (!p) return { title: "Not found" };
  return { title: `${p.name} — ${p.kind}`, description: p.blurb };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = byId(id);
  if (!p) notFound();

  const buy = buyLink(p);
  const others = products.filter((o) => o.id !== p.id);

  return (
    <div className="wrap page">
      <div style={{ paddingTop: 8 }}>
        <Link href="/store" className="kicker">
          ← Store
        </Link>
      </div>

      <header style={{ padding: "clamp(28px,6vh,64px) 0 clamp(20px,4vh,36px)", display: "grid", gap: 16 }}>
        <span className="kicker">
          {p.kind} · {p.colors.length} {p.colors.length === 1 ? "colourway" : "colourways"} · printed to order
        </span>
        <h1
          style={{
            fontFamily: "var(--disp)",
            fontWeight: 300,
            fontSize: "clamp(1.9rem,5.4vw,3.4rem)",
            letterSpacing: "0.02em",
            margin: 0,
            textWrap: "balance",
          }}
        >
          {p.name}
        </h1>
        <p style={{ margin: 0, color: "var(--dim)", fontSize: 12.5, lineHeight: 1.75, maxWidth: "var(--measure)" }}>
          {p.blurb}
        </p>
        {!hostedStorefrontUrl && (
          <div style={{ fontSize: "1.25rem", fontVariantNumeric: "tabular-nums", fontFamily: "var(--disp)", fontWeight: 300 }}>
            {formatUSD(p.priceCents)}
          </div>
        )}
      </header>

      <ProductDetail product={p} buy={buy} />

      <section className="section">
        <div className="head">
          <h2>The rest of it</h2>
          <span className="kicker">{others.length} more</span>
        </div>
        <div className={s.otherList}>
          {others.map((o) => (
            <Link key={o.id} href={`/store/${o.id}`} className={s.otherRow}>
              <span>
                {o.name}
                <span className={s.otherKind}> · {o.kind}</span>
              </span>
              {!hostedStorefrontUrl && <span className={s.otherPrice}>{formatUSD(o.priceCents)}</span>}
            </Link>
          ))}
        </div>
      </section>

      <footer className="site">
        <Link href="/store" style={{ borderBottom: "1px solid var(--line)" }}>
          Back to the store
        </Link>
      </footer>
    </div>
  );
}
