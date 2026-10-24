import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://weekend-league-web.vercel.app";

// Public, signed-out pages only. Keep in sync with robots.ts's allow list.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/welcome`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/commissioners`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/waitlist`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
