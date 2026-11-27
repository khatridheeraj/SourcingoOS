import { siteClient } from "./site-data";

// "Made here before" on each product page: which of our styles count for it. Garments match any word in the style or
// its description; the private-label page counts every garment; the fabric page counts fabric styles.
const MADE: Record<string, { words: string[]; fabric: boolean }> = {
  kurtas: { words: ["kurta", "kurti", "anarkali", "tunic"], fabric: false },
  "co-ord-sets": { words: ["co-ord", "coord", "co ord"], fabric: false },
  kaftans: { words: ["kaftan", "caftan", "cover-up", "cover up", "resort"], fabric: false },
  "dresses-and-tops": { words: ["dress", "top", "blouse", "shirt", "maxi"], fabric: false },
  "printed-fabric": { words: [], fabric: true },
  "private-label": { words: [], fabric: false },
};

export type MadeBefore = { styles: number; qty: number; orders: number; lastAt: string | null; fabric: boolean; photos: { url: string; caption: string | null }[] };

// Real counts from goods that have shipped, and photos only where the owner chose to show them. Never names.
export async function madeBefore(slug: string): Promise<MadeBefore | null> {
  const m = MADE[slug];
  if (!m) return null;
  try {
    const { data, error } = await siteClient().rpc("site_made_before", { p_words: m.words, p_fabric: m.fabric });
    if (error || !data) return null;
    const d = data as { styles: number; qty: number; orders: number; last_at: string | null; photos: { path: string; caption: string | null }[] };
    if (!d.styles) return null;
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-photos/`;
    return { styles: d.styles, qty: Number(d.qty), orders: d.orders, lastAt: d.last_at, fabric: m.fabric,
      photos: (d.photos ?? []).map((p) => ({ url: base + p.path.split("/").map(encodeURIComponent).join("/"), caption: p.caption })) };
  } catch {
    return null;
  }
}
