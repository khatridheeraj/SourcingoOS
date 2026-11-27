import type { MetadataRoute } from "next";

// Nothing here is for search engines: sourcingo.in is the public site (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
