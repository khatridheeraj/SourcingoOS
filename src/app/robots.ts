import type { MetadataRoute } from "next";
import { SITE_PAGES, SITE_URL } from "@/lib/site";

// Search engines may read the public website; private links (factory, buyer, PO) and the app stay out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: SITE_PAGES.map((p) => p.path), disallow: ["/f/", "/s/", "/po/", "/buyer", "/factory", "/login", "/auth", "/api/", "/welcome"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
