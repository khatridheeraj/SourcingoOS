"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// senders: email addresses or @domains that send this buyer's POs, one per line or comma. Only the owner sees them.
export type BuyerInput = { id?: string; code: string; realName: string; city: string; notes: string; active: boolean; senders: string };

const senderList = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

export async function saveBuyer(b: BuyerInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can add or change buyers." };
  const code = b.code.trim().toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) return { error: "Use 2 to 20 capital letters, numbers or dashes for the code, like BYR-OZ." };
  if (!b.realName.trim()) return { error: "Enter the buyer's real name." };

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_buyer", {
    p: { id: b.id ?? "", code, real_name: b.realName.trim(), city: b.city, notes: b.notes, active: b.active },
  });
  if (error) return { error: friendly(error) };
  const { error: senders } = await supabase.rpc("set_buyer_po_senders", { p_buyer: id, p_senders: senderList(b.senders) });
  revalidatePath("/", "layout");
  if (senders) return { error: `The buyer is saved, but not its PO senders: ${friendly(senders)}` };
  return {};
}

// Days the buyer takes to send its GRN after goods ship; the merchandiser is reminded when it is due. Blank uses 7.
export async function setGrnDays(buyerId: string, days: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can set GRN days." };
  const v = days.trim() === "" ? null : Number(days);
  if (v != null && (!Number.isInteger(v) || v < 0 || v > 120)) return { error: "Use 0 to 120 days." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_buyer_grn_days", { p_buyer: buyerId, p_days: v });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyers");
  return {};
}

// Adds a new buyer from an incoming PO, so the PO can be added as an order straight away. Returns the new buyer.
export async function addBuyer(code: string, realName: string): Promise<{ error?: string; id?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can add buyers." };
  const c = code.trim().toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9-]{2,20}$/.test(c)) return { error: "Use 2 to 20 capital letters, numbers or dashes for the code, like BYR-OZ." };
  if (!realName.trim()) return { error: "Enter the buyer's real name." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_buyer", { p: { code: c, real_name: realName.trim(), city: "", notes: "", active: true } });
  if (error) return { error: friendly(error) };
  revalidatePath("/", "layout");
  return { id: data as string };
}

// The buyer's status link: opening it shows the buyer's own orders live, with no password. The same link is given
// each time until a new one is made, which stops the old one and signs out every phone that used it.
export async function buyerLink(buyerId: string, renew = false): Promise<{ url?: string; error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can send a buyer its link." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("buyer_link", { p_buyer: buyerId, p_renew: renew });
  if (error || typeof data !== "string") return { error: error ? friendly(error) : "Couldn't make the link. Try again." };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "sourcingo-os.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { url: `${proto}://${host}/s/${data}` };
}
