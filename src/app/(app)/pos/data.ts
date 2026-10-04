import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PoLine = { style_code?: string | null; description?: string | null; colour?: string | null; qty?: number | string | null; rate?: number | string | null };
export type ReceivedPo = {
  id: string; buyer_id: string; po_number: string; po_date: string | null; delivery_date: string | null; order_type: "garment" | "fabric";
  currency: string | null; payment_terms: string | null; sender_name: string | null; sender_email: string | null; email_thread_id: string | null;
  received_at: string; attachments: string[]; lines: PoLine[]; notes: string | null; status: "new" | "in_progress" | "converted" | "rejected";
  reject_reason: string | null; inquiry_id: string | null; so_id: string | null; created_at: string; updated_at: string;
};

export const PO_STATUS: Record<ReceivedPo["status"], [string, string]> = {
  new: ["info", "New"],
  in_progress: ["warn", "In progress"],
  converted: ["ok", "Converted"],
  rejected: ["bad", "Rejected"],
};

// Opens the email in Gmail (for whoever has the Sourcingo mailbox).
export const gmailLink = (thread: string | null) => (thread ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(thread)}` : null);

export const poQty = (p: ReceivedPo) => p.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
export const poValue = (p: ReceivedPo) =>
  p.lines.every((l) => l.qty != null && l.rate != null && l.qty !== "" && l.rate !== "") ? p.lines.reduce((a, l) => a + Number(l.qty) * Number(l.rate), 0) : null;

// Received POs plus buyer labels (real names for the owner only).
export async function loadPos(id?: string) {
  const me = await getMe();
  const supabase = await createClient();
  const isOwner = me?.role === "owner";
  let q = supabase.from("received_pos").select("*").order("received_at", { ascending: false });
  if (id) q = q.eq("id", id);
  const [pos, buyers, registry] = await Promise.all([
    q,
    supabase.from("buyers").select("id, code"),
    isOwner ? supabase.from("buyer_registry").select("buyer_id, real_name") : Promise.resolve({ data: [] as { buyer_id: string; real_name: string }[], error: null }),
  ]);
  const code = new Map((buyers.data ?? []).map((b) => [b.id, b.code as string]));
  const real = new Map((registry.data ?? []).map((r) => [r.buyer_id, r.real_name as string]));
  const buyer = (bid: string) => ({ code: code.get(bid) ?? "Unknown buyer", real_name: isOwner ? real.get(bid) : undefined });
  const list = ((pos.data ?? []) as ReceivedPo[]).map((p) => ({ ...p, lines: Array.isArray(p.lines) ? p.lines : [], attachments: p.attachments ?? [] }));
  return { me, pos: list, buyer, error: pos.error || buyers.error || registry.error };
}
