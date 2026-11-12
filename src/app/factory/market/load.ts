import { createClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET } from "@/lib/storage";

// One style open to factories, as market_list() gives it to the factory whose panel this is.
export type MarketStyle = {
  id: string; order_no: string; style: string; description: string | null; colour: string | null; qty: number;
  fabric: string | null; sizes: Record<string, number> | null; photo_path: string | null; product: string;
  target_rate: number | null; ready_by: string; closes_on: string; note: string | null; opened_at: string; quotes: number;
  files: { path: string; kind: string; name: string | null }[];
  state: "open" | "won" | "closed";
  mine: { rate: number; ready_on: string; note: string | null } | null;
  photo?: string; links: { kind: string; name: string; url: string }[];
};

// The shop: every open style, and the ones this factory quoted on that closed lately, with photos and tech packs signed.
export async function loadMarket(preview?: string): Promise<{ styles: MarketStyle[]; error?: string }> {
  const supabase = await createClient(preview ? { "x-preview-factory": preview } : undefined);
  const { data, error } = await supabase.rpc("market_list");
  const styles = ((data ?? []) as MarketStyle[]).map((s) => ({ ...s, links: [] as MarketStyle["links"] }));
  const paths = styles.flatMap((s) => [...(s.photo_path ? [s.photo_path] : []), ...s.files.map((f) => f.path)]);
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  for (const s of styles) {
    s.photo = (s.photo_path && urlOf.get(s.photo_path)) || undefined;
    s.links = s.files.flatMap((f) => { const url = urlOf.get(f.path); return url ? [{ kind: f.kind, name: f.name || "", url }] : []; });
  }
  return { styles, error: error?.message };
}
