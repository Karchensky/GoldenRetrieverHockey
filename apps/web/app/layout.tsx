import type { Metadata } from "next";
import Nav from "../components/Nav";
import RinkMount from "../components/rink/RinkMount";
import { CartProvider } from "../components/store/Cart";
import { FOUNDED } from "../lib/data";
import "./globals.css";

const DESCRIPTION =
  `The Golden Retrievers, a Buffalo men's-league hockey team, est. ${FOUNDED}. ` +
  "The full record — seasons, rosters, games, honours — and the team store.";

const TITLE = `Golden Retrievers — Buffalo, est. ${FOUNDED}`;

export const metadata: Metadata = {
  metadataBase: new URL("https://goldenretrieverhockey.com"),
  // The team is the GOLDEN RETRIEVERS, plural, everywhere it is written. The
  // domain is still goldenretrieverhockey.com and that is fine — a URL is not
  // the club's name. "Hockey" comes off with the singular: "Buffalo, est. …"
  // already says what this is, and says it with facts instead of a category.
  // The year is counted from the earliest session on file, never typed.
  title: {
    default: TITLE,
    template: "%s — Golden Retrievers",
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
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{
      url: "/brand/golden-retrievers-card.png",
      width: 1200,
      height: 630,
      alt: "The Golden Retrievers rink-board lockup — the dog in a gold roundel beside the club name",
    }],
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
