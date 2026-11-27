import type { MetadataRoute } from "next";
import { SITE_PAGES, SITE_URL } from "@/lib/site";
import { siteFacts } from "@/lib/site-data";

export const revalidate = 3600;

// The public website's pages, for search engines. The signed-in app is never listed; our record only once it is on.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const facts = await siteFacts();
  const pages = facts.record ? [...SITE_PAGES, { path: "/record", priority: 0.7 }] : SITE_PAGES;
  return pages.map((p) => ({ url: `${SITE_URL}${p.path === "/" ? "" : p.path}`, changeFrequency: "monthly", priority: p.priority }));
}
