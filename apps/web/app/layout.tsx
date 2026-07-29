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
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{
      url: "/brand/golden-retrievers-crest.png",
      width: 256,
      height: 256,
      alt: "Golden Retrievers hockey crest",
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
        </CartProvider>
      </body>
    </html>
  );
}
