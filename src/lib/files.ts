import { getMe } from "@/lib/auth";
import { type FileCategory, type FileItem, type FileTarget, TARGET_COLUMN } from "@/lib/file-kinds";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string; category: FileCategory; file_name: string; mime_type: string; size_bytes: number; created_at: string;
  uploaded_by: string | null; storage_path: string; inquiry_id: string | null; style_id: string | null; grn_id: string | null;
};

// Files attached to the given inquiries, styles or GRNs, grouped by owner id,
// newest first, each with a link that works for an hour. Row-level security
// decides which files come back.
export async function loadFiles(target: FileTarget, ids: string[], nameOf?: (id: string | null) => string) {
  const out = new Map<string, FileItem[]>();
  if (!ids.length) return out;
  const me = await getMe();
  const supabase = await createClient();
  const col = TARGET_COLUMN[target];
  const { data } = await supabase.from("files").select("*").in(col, ids).order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  if (!rows.length) return out;
  const { data: signed } = await supabase.storage.from("files").createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  for (const r of rows) {
    const key = r[col] as string;
    const mine = !!me && r.uploaded_by === me.id;
    const item: FileItem = {
      id: r.id, category: r.category, file_name: r.file_name, mime_type: r.mime_type, size_bytes: r.size_bytes, created_at: r.created_at,
      by: mine ? "You" : nameOf ? nameOf(r.uploaded_by) : "Sourcingo", mine, url: urls.get(r.storage_path) ?? null,
    };
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

// The latest photo of each style, for catalogue cards.
export async function loadCovers(styleIds: string[]) {
  const out = new Map<string, string>();
  if (!styleIds.length) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("files").select("style_id, storage_path").eq("category", "style_photo").in("style_id", styleIds)
    .order("created_at", { ascending: false });
  const latest = new Map<string, string>();
  for (const r of (data ?? []) as { style_id: string; storage_path: string }[]) if (!latest.has(r.style_id)) latest.set(r.style_id, r.storage_path);
  if (!latest.size) return out;
  const { data: signed } = await supabase.storage.from("files").createSignedUrls([...latest.values()], 3600);
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  for (const [sid, path] of latest) { const u = urls.get(path); if (u) out.set(sid, u); }
  return out;
}
