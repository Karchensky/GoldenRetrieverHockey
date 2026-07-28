import type { MetadataRoute } from "next";

/**
 * Everything is crawlable, deliberately.
 *
 * This archive exists because four platforms stopped serving a team's history
 * and one of them went down entirely — an era survived only because the
 * Internet Archive's crawler had been allowed in. Disallowing crawlers on THIS
 * site, of all sites, would be a failure to learn the one lesson the project
 * is about.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://goldenretrieverhockey.com/sitemap.xml",
  };
}
