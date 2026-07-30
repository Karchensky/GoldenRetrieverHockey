import Link from "next/link";
import { notFound } from "next/navigation";
import Buy from "../../../components/store/Buy";
import Gallery from "../../../components/store/Gallery";
import { fromLabel, groups, mockupPath, paragraphs, priceLabel, productById, products } from "../../../lib/store";
import s from "../../../components/store/store.module.css";

/**
 * One product.
 *
 * This route was DELETED while the store was a placeholder, and the reason is
 * worth keeping: Next refuses an empty `generateStaticParams` under
 * `output: "export"`, and an orphaned detail page is still a page a crawler can
 * find. It is back because there are twenty-three products to generate it from.
 *
 * The pictures are the provider's own mockups — the maker's render of the actual
 * garment with the actual placement — mirrored into the export by
 * `npm run store:mockups` rather than hotlinked. A product whose mockups have
 * not been mirrored yet renders without them rather than with a broken image.
 */

export function generateStaticParams() {
  return products.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = productById(id);
  if (!product) return {};
  return {
    title: product.title,
    description: paragraphs(product)[0],
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = productById(id);
  if (!product) notFound();

  /* THE PRINT GEOMETRY IS NOT RENDERED, and that is deliberate.
     `product.printify.print` carries the printed width at both ends of the size
     range and the dpi at each, and this page used to set it in a table: "the
     front print runs 4.4in across on the smallest size and 4.4in on the
     largest, at 1255-1255 dpi. The floor is 300." The captain, on reading it:
     "is this useful information for the user?" It is not. It is the sync's own
     acceptance check — the numbers that decide whether this repository is
     willing to upload the art at all — and it belongs in `cli.ts sync
     --dry-run` and store:report, where it is read by whoever is deciding.
     The data stays in products.json. Nothing on the shelf prints it. */
  const copy = paragraphs(product);
  const siblings = groups
    .find((g) => g.itemId === product.itemId)
    ?.products.filter((p) => p.id !== product.id) ?? [];

  return (
    <div className="wrap page">
      <header className="hero seq">
        <p className="crumb">
          <Link href="/store">Store</Link>
        </p>
        <h1 className="hero-h">{product.title}</h1>
      </header>

      <div className={s.detail} data-reveal>
        <Gallery
          title={product.title}
          images={product.mockups.map((_, index) => ({
            src: mockupPath(product.id, index),
            alt: `${product.title}, view ${index + 1}`,
          }))}
        />

        <div>
          <p className={s.detailPrice}>{priceLabel(product)}</p>
          {copy.map((para) => (
            <p key={para} className={s.detailCopy}>{para}</p>
          ))}

          <Buy product={product} />
        </div>
      </div>

      {siblings.length > 0 && (
        <section data-reveal>
          <h2 className="head">The rest of them</h2>
          <div className={s.otherList}>
            {siblings.map((other) => (
              <Link key={other.id} href={`/store/${other.id}`} className={s.otherRow}>
                <span>
                  {other.title}
                  <span className={s.otherKind}> · {other.colors.length === 1
                    ? other.colors[0]?.name
                    : `${other.colors.length} colours`}</span>
                </span>
                <span className={s.otherPrice}>{fromLabel(other)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
