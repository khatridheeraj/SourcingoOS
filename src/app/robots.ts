import type { MetadataRoute } from "next";

// sourcingo.in is Sourcingo's public face (Dheeraj chose to keep it, 28 Nov 2026). This app's website pages
// stay reachable for links from there (costing form, product pages), but search engines leave the whole app alone
// so the two sites never compete.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
