"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

// The owner shows a shipped style's photo on the public product pages: the photo is copied to the public bucket (so
// nothing private ever gets a public link) and the style is marked. Taking it off unmarks it.
export async function showOnSite(lineId: string, show: boolean, caption: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner" || !me.companyId) return { error: "Only the owner chooses what shows on the website." };
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) return { error: "This style is not here any more. Reload the page." };
  const supabase = await createClient();
  let path: string | null = null;
  if (show) {
    const { data: l } = await supabase.from("order_lines").select("photo_path, order_id").eq("id", lineId).maybeSingle();
    if (!l?.photo_path) return { error: "Add a photo of the style first." };
    const { data: file, error: dl } = await supabase.storage.from(PHOTO_BUCKET).download(l.photo_path);
    if (dl || !file) return { error: "Couldn't read the photo. Try again." };
    const ext = (l.photo_path.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z]/g, "") || "jpg";
    path = `${me.companyId}/${lineId}-${Date.now()}.${ext}`;
    const { error: up } = await supabase.storage.from("site-photos").upload(path, file, { contentType: file.type || "image/jpeg" });
    if (up) return { error: friendly(up) };
  }
  const { error } = await supabase.rpc("set_site_photo", { p_line: lineId, p_path: path, p_caption: caption.trim().slice(0, 80) });
  if (error) return { error: friendly(error) };
  revalidatePath("/make/[slug]", "page");
  return {};
}
