import type { Metadata } from "next";
import Nav from "../components/Nav";
import RinkMount from "../components/rink/RinkMount";
import { CartProvider } from "../components/store/Cart";
import { FOUNDED } from "../lib/data";
import { DEFAULT_CARD, SITE_NAME, SITE_URL, TITLE_TEMPLATE } from "../lib/meta";
import "./globals.css";

const DESCRIPTION =
  `The Golden Retrievers, a Buffalo men's-league hockey team, est. ${FOUNDED}. ` +
  "The full record — seasons, rosters, games, honours — and the team store.";

const TITLE = `Golden Retrievers — Buffalo, est. ${FOUNDED}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The team is the GOLDEN RETRIEVERS, plural, everywhere it is written. The
  // domain is still goldenretrieverhockey.com and that is fine — a URL is not
  // the club's name. "Hockey" comes off with the singular: "Buffalo, est. …"
  // already says what this is, and says it with facts instead of a category.
  // The year is counted from the earliest session on file, never typed.
  title: {
    default: TITLE,
    template: TITLE_TEMPLATE,
  },
  description: DESCRIPTION,
  icons: {
    icon: [{ url: "/brand/golden-retrievers-crest.png", type: "image/png" }],
    apple: [{ url: "/brand/golden-retrievers-crest.png", type: "image/png" }],
  },
  // THE CARD IS 1200x630 AND THE FAVICON IS NOT.
  //
  // This pointed `og:image` at the 256x256 crest while Next's default
  // `summary_large_image` Twitter card asks for 1200x630 at 1.91:1. Every link
  // ever shared out of here — and one player sending another a link is the only
  // distribution this shop has — previewed as a thumbnail in a corner or as
  // nothing at all. `golden-retrievers-card.png` is built from the vector master
  // by `npm run build:brand-assets`.
  //
  // **THIS BLOCK IS THE HOME PAGE'S CARD AND THE FALLBACK, NOT THE SITE'S.**
  // Because it sets `title` and `description` explicitly, Next stopped deriving
  // them from each page's own metadata and handed these two literal strings to
  // all 505 pages — measured in the built export on 2026-08-07, every route
  // from a product to a player unfurled as the club rather than as itself. That
  // is fixed in `lib/meta.ts`, where every real route states its own card; what
  // is left inheriting this is the four `redirect()` stubs and 404, which have
  // no identity of their own and should unfurl as the club.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    type: "website",
    images: [DEFAULT_CARD],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">Skip to content</a>
        {/* Wraps everything because the basket count lives in the masthead and
            the drawer has to be able to open over any route. It holds no state
            until something is added, and renders nothing until then. */}
        <CartProvider>
          <RinkMount />
          <Nav />
          <main id="main">{children}</main>
          {/* NO SITE FOOTER. One was added on 2026-07-30 after a review found
              the contact address reachable only from /store/help, and the
              captain removed it the next day: "links to the shipping & returns
              & email being at the bottom of the sales page is already
              sufficient." It is — /store carries both in its hero and again at
              the foot of the page, the product page carries one, and so does
              the basket drawer. A masthead-and-footer chrome on every archive
              page was answering a shop's problem on 458 pages that are not a
              shop. */}
        </CartProvider>
      </body>
    </html>
  );
}
