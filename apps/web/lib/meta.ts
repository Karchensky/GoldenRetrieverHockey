import type { Metadata } from "next";

/**
 * ONE PAGE'S IDENTITY: its title, its description, its canonical URL and the
 * card it unfurls as.
 *
 * **Every page on this site used to share one social card.** Measured against
 * the built export on 2026-08-07, all 505 pages emitted the same three tags:
 *
 *     og:title        Golden Retrievers — Buffalo, est. 2011
 *     og:description  The Golden Retrievers, a Buffalo men's-league hockey…
 *     og:image        /brand/golden-retrievers-card.png
 *
 * The per-page `<title>` and `<meta name="description">` were correct the whole
 * time and never reached the card. The cause is in `app/layout.tsx`: Next fills
 * `openGraph.title` from the page's own title ONLY when no ancestor has set it
 * explicitly, and the root layout sets it — so every child inherited that
 * literal string instead.
 *
 * That is the wrong failure to have here of all places. This shop's entire
 * distribution is one player sending another a link, and the archive's is
 * sending eighty men their own page; a link that previews as the club crest
 * with a generic blurb is the one that does not get opened. The 1200×630 card
 * built on 2026-08-03 was made for exactly that link and only the home page
 * ever used it.
 *
 * So: no page inherits its card. Every real route calls `pageMeta` and states
 * its own.
 */

/** The origin, in one place. `layout.tsx` and `sitemap.ts` both read it. */
export const SITE_URL = "https://goldenretrieverhockey.com";

export const SITE_NAME = "Golden Retrievers";

/**
 * The browser-tab template, exported rather than written twice.
 *
 * `og:title` has to read the same as `<title>` or a shared link says one thing
 * in the tab and another in the unfurl. The layout applies this through Next's
 * `title.template` and `titled()` applies the same string here, so the two
 * cannot drift apart.
 */
export const TITLE_TEMPLATE = `%s — ${SITE_NAME}`;

export const titled = (title: string): string => TITLE_TEMPLATE.replace("%s", title);

export type SocialImage = {
  url: string;
  alt: string;
  width: number;
  height: number;
};

/**
 * The fallback card — the rink-board lockup, drawn from the vector master by
 * `npm run build:brand-assets`.
 *
 * Used by any page that has no photograph of its own, which is every archive
 * page. A product supplies its own; see `productCard` in `lib/store.ts`.
 */
export const DEFAULT_CARD: SocialImage = {
  url: "/brand/golden-retrievers-card.png",
  width: 1200,
  height: 630,
  alt: "The Golden Retrievers rink-board lockup — the dog in a gold roundel beside the club name",
};

export type PageMetaInput = {
  /** Bare, without the site name. The template adds that. */
  title: string;
  description: string;
  /** Root-relative and without a trailing slash: "/store/crossed-shield-tee". */
  path: string;
  image?: SocialImage;
};

/**
 * **THE CANONICAL IS NOT OPTIONAL AND IT IS NOT SET IN THE LAYOUT.**
 *
 * Setting it once on the root would be inherited by every route that did not
 * override it, and every one of those pages would then declare itself a
 * duplicate of the home page — which is worse than having none at all. It is
 * stated per page, or not at all.
 *
 * The four redirect stubs (`/roster`, `/games`, `/stats`, `/history`) are the
 * deliberate "not at all": they are bare `redirect()` calls holding no content,
 * and they are absent from the sitemap for the same reason.
 *
 * `metadataBase` is set in the layout, so a root-relative path here resolves to
 * an absolute URL in the output.
 */
export function pageMeta({ title, description, path, image }: PageMetaInput): Metadata {
  const card = image ?? DEFAULT_CARD;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: titled(title),
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      images: [card],
    },
    // NO `twitter` BLOCK. Next derives the twitter card from openGraph when one
    // is not given — verified in the built export, which carries twitter:title,
    // twitter:description and twitter:image matching the og tags on every page.
    // Writing it out again would be a second copy to keep in step.
  };
}
