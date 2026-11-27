import type { MetadataRoute } from "next";
import { SITE_PAGES, SITE_URL } from "@/lib/site";

// The public website's pages, for search engines. The signed-in app is never listed.
export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_PAGES.map((p) => ({ url: `${SITE_URL}${p.path === "/" ? "" : p.path}`, changeFrequency: "monthly", priority: p.priority }));
}
