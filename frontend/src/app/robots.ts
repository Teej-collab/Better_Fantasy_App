import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://weekend-league-web.vercel.app";

// Everything behind sign-in is useless to a crawler (it just lands on
// the sign-in gate), so only the public pages are open to indexing.
// /api is the backend proxy and /auth the OAuth callbacks. Neither
// should ever appear in search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/welcome", "/commissioners", "/waitlist", "/privacy", "/terms"],
      disallow: ["/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
