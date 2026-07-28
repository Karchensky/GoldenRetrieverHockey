import type { MetadataRoute } from "next";
import { players } from "../lib/data";
import { AVAILABLE_SEASONS } from "../lib/seasons";

/**
 * The sitemap is DERIVED from the record, not maintained by hand.
 *
 * Player pages exist because people are on file; the day a sweep recovers a
 * lost session, this grows on its own. A hand-kept list
 * would be one more number in this repo that drifts away from the data — there
 * have already been three of those today.
 *
 * This project's whole subject is what happens when a team's history becomes
 * unfindable. Making the recovered version findable is not housekeeping.
 */
export const dynamic = "force-static";

const SITE = "https://goldenretrieverhockey.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const fixed = ["", "/store", "/seasons"].map((path) => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    // The store is the front door by instruction; the record is the reason.
    priority: path === "" ? 1 : path === "/store" ? 0.9 : 0.8,
  }));

  return [
    ...fixed,
    ...AVAILABLE_SEASONS.map((season) => ({
      url: `${SITE}${season.href}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...players.map((p) => ({
      url: `${SITE}/players/${p.slug}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];
}
