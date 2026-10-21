"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type InquiryInput = {
  buyer_id: string;
  prospect: string;
  contact_name: string;
  contact: string;
  source: string;
  product: string;
  est_qty: string;
  unit: string;
  target_price: string;
  merchandiser_id: string;
  next_follow_up: string;
  notes: string;
};

const num = (s: string) => s.replace(/[,₹\s]/g, "");
const isDate = (d: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);

async function team() {
  const me = await getMe();
  if (!me?.role || !me.companyId) return { error: "Your account is not switched on yet." } as const;
  if (!canEditOrders(me.role)) return { error: "Only the orders team works with inquiries." } as const;
  return { me, supabase: await createClient() } as const;
}

function clean(i: InquiryInput): { error: string } | { row: Record<string, unknown> } {
  if (!i.buyer_id && !i.prospect.trim()) return { error: "Pick the buyer, or type the name of a new one." };
  if (!i.product.trim()) return { error: "Say what the buyer is asking for." };
  const qty = num(i.est_qty);
  if (qty && !(Number.isInteger(Number(qty)) && Number(qty) > 0)) return { error: "The quantity must be a whole number above zero." };
  const price = num(i.target_price);
  if (price && !(Number(price) >= 0)) return { error: "The target price must be a number." };
  if (!isDate(i.next_follow_up)) return { error: "Enter the follow-up as a date." };
  return {
    row: {
      buyer_id: i.buyer_id || null,
      prospect: i.buyer_id ? null : i.prospect.trim().slice(0, 120),
      contact_name: i.contact_name.trim().slice(0, 120) || null,
      contact: i.contact.trim().slice(0, 200) || null,
      source: i.source || "email",
      product: i.product.trim().slice(0, 200),
      est_qty: qty ? Number(qty) : null,
      unit: i.unit === "m" ? "m" : "pcs",
      target_price: price ? Number(price) : null,
      merchandiser_id: i.merchandiser_id || null,
      next_follow_up: i.next_follow_up || null,
      notes: i.notes.trim().slice(0, 4000) || null,
    },
  };
}

// Logs a new inquiry. Photos are added after it exists, since they go in its own folder.
export async function createInquiry(i: InquiryInput): Promise<{ error?: string; id?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  const c = clean(i);
  if ("error" in c) return { error: c.error };
  const { data, error } = await t.supabase.from("inquiries").insert(c.row).select("id").single();
  if (error) return { error: friendly(error) };
  revalidatePath("/inquiries");
  revalidatePath("/today");
  return { id: data.id };
}

export async function updateInquiry(id: string, i: InquiryInput): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  const c = clean(i);
  if ("error" in c) return { error: c.error };
  const { data, error } = await t.supabase.from("inquiries").update(c.row).eq("id", id).in("status", ["new", "quoted"]).select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "Only open inquiries can be changed. Reload the page." };
  revalidatePath("/inquiries");
  revalidatePath(`/inquiries/${id}`);
  revalidatePath("/today");
  return {};
}

// Moves an open inquiry on: quoted (with the price given), lost (with the reason) or back to new.
export async function setInquiryStatus(id: string, status: "new" | "quoted" | "lost", p: { quoted_price?: string; lost_reason?: string }): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  const patch: Record<string, unknown> = { status };
  if (status === "quoted") {
    const price = num(p.quoted_price ?? "");
    if (!price || !(Number(price) >= 0)) return { error: "Enter the price you quoted, per piece." };
    patch.quoted_price = Number(price);
  }
  if (status === "lost") {
    const reason = (p.lost_reason ?? "").trim();
    if (!reason) return { error: "Say why it was lost, so the team learns from it." };
    patch.lost_reason = reason.slice(0, 300);
  } else {
    patch.lost_reason = null;
  }
  const { data, error } = await t.supabase.from("inquiries").update(patch).eq("id", id).in("status", ["new", "quoted", "lost"]).select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "This inquiry is already an order. Reload the page." };
  revalidatePath("/inquiries");
  revalidatePath(`/inquiries/${id}`);
  revalidatePath("/today");
  return {};
}

// A follow-up note, and optionally the next follow-up date.
export async function addInquiryNote(id: string, body: string, nextFollowUp: string): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  if (!body.trim() && !nextFollowUp) return { error: "Write what happened, or pick the next follow-up date." };
  if (!isDate(nextFollowUp)) return { error: "Enter the follow-up as a date." };
  if (nextFollowUp && nextFollowUp < todayIST()) return { error: "The next follow-up can't be in the past." };
  if (body.trim()) {
    const { error } = await t.supabase.from("inquiry_notes").insert({ inquiry_id: id, body: body.trim().slice(0, 2000), created_by: t.me.id });
    if (error) return { error: friendly(error) };
  }
  if (nextFollowUp) {
    const { error } = await t.supabase.from("inquiries").update({ next_follow_up: nextFollowUp }).eq("id", id).in("status", ["new", "quoted"]);
    if (error) return { error: friendly(error) };
  }
  revalidatePath(`/inquiries/${id}`);
  revalidatePath("/inquiries");
  revalidatePath("/today");
  return {};
}

// Saves the inquiry's photo list after uploads or a removal. Paths must be in the inquiry's own folder.
export async function setInquiryPhotos(id: string, photos: string[]): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  if (photos.length > 12) return { error: "An inquiry can keep up to 12 photos." };
  if (photos.some((p) => !p.startsWith(`${t.me.companyId}/inquiries/${id}/`) || p.includes(".."))) return { error: "Those photos didn't upload properly. Try again." };
  const { error } = await t.supabase.from("inquiries").update({ photos }).eq("id", id);
  if (error) return { error: friendly(error) };
  revalidatePath(`/inquiries/${id}`);
  return {};
}
