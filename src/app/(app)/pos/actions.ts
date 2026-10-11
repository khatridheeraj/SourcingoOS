"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { PO_FILE_TYPES, PO_MAX_BYTES, type StoredFile } from "@/lib/po-files";
import { askToRead } from "@/lib/po-inbox";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A PO file the team uploaded (for example one shared in a WhatsApp group). It is read straight after.
export async function addPoFiles(id: string, files: StoredFile[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) return { error: "Only the orders team can add POs." };
  if (!UUID.test(id) || !files.length) return { error: "Pick a PO file first." };
  for (const f of files) {
    const ext = f.path.split(".").pop() ?? "";
    if (!f.path.startsWith(`${me.companyId}/${id}/`) || f.path.includes("..") || PO_FILE_TYPES[ext] !== f.type || !(f.size > 0 && f.size <= PO_MAX_BYTES)) {
      return { error: "That file didn't upload properly. Try again." };
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.from("incoming_pos").insert({
    id, source: "upload", received_at: new Date().toISOString(),
    files: files.map((f) => ({ path: f.path, name: f.name.slice(0, 200), type: f.type, size: f.size })),
  });
  if (error) return { error: friendly(error) };
  const read = await askToRead(supabase, id);
  revalidatePath("/pos");
  return read;
}

export async function readAgain(id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can do this." };
  const supabase = await createClient();
  const { data } = await supabase.from("incoming_pos").select("id, status").eq("id", id).maybeSingle();
  if (!data) return { error: "This PO is no longer here. Reload the page." };
  if (data.status === "added") return { error: "This PO is already added as an order." };
  const read = await askToRead(supabase, id);
  revalidatePath(`/pos/${id}`);
  return read;
}

export async function setAside(id: string, aside: boolean): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_incoming_po_status", { p_id: id, p_status: aside ? "not_po" : "to_check" });
  if (error) return { error: friendly(error) };
  revalidatePath("/pos");
  revalidatePath(`/pos/${id}`);
  return {};
}

// The owner pastes the AI key that reads POs. It is stored where only the PO reader can fetch it.
export async function setAiKey(key: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ai_key", { p_key: key });
  if (error) return { error: friendly(error) };
  revalidatePath("/pos");
  return {};
}
