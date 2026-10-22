"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { addBuyer } from "../buyers/actions";
import { ignoreSender, setAside } from "../pos/actions";
import { addDays } from "@/lib/payments";
import { buyerByDomain, parseInquiry } from "@/lib/inquiry-parse";

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
export async function createInquiry(i: InquiryInput): Promise<{ error?: string; id?: string; no?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  const c = clean(i);
  if ("error" in c) return { error: c.error };
  if (c.row.next_follow_up && String(c.row.next_follow_up) < todayIST()) return { error: "The follow-up can't be in the past." };
  const { data, error } = await t.supabase.from("inquiries").insert(c.row).select("id, inquiry_no").single();
  if (error) return { error: friendly(error) };
  revalidatePath("/inquiries");
  revalidatePath("/today");
  return { id: data.id, no: data.inquiry_no };
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

// The sample went to the buyer (or, with no date, didn't after all). The inquiry stays open while they look at it.
export async function setInquirySample(id: string, on: string, note: string): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  if (!isDate(on)) return { error: "Enter the day the sample went as a date." };
  if (on && on > todayIST()) return { error: "The sample can't be sent in the future. Pick today or an earlier day." };
  const { data, error } = await t.supabase.from("inquiries")
    .update({ sample_sent_on: on || null, sample_note: on ? note.trim().slice(0, 300) || null : null })
    .eq("id", id).in("status", ["new", "quoted"]).select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "Only open inquiries can be changed. Reload the page." };
  revalidatePath("/inquiries");
  revalidatePath(`/inquiries/${id}`);
  return {};
}

// Logs an inquiry from an email the PO pickup caught that isn't a PO: who sent it, the subject, the message and a
// link back to its files. The email then leaves the PO list (set aside, or ignored when it was from an unknown sender).
export async function inquiryFromEmail(poId: string): Promise<{ error?: string; id?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  const { data: po } = await t.supabase.from("incoming_pos").select("id, status, email_from, email_subject, email_body, buyer_id").eq("id", poId).maybeSingle();
  if (!po) return { error: "This email is no longer here. Reload the page." };
  if (po.status === "added") return { error: "This email is already an order." };
  const { data: had } = await t.supabase.from("inquiries").select("id").eq("incoming_po_id", poId).maybeSingle();
  if (had) return { id: had.id };
  const from = String(po.email_from ?? "");
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  const address = from.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? "";
  const subject = String(po.email_subject ?? "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  const domain = address.split("@")[1]?.split(".")[0] ?? "";
  // What the message asks for, read the same way as a pasted message: the buyer, the product, quantity and price.
  const [{ data: buyers }, { data: names }] = await Promise.all([
    t.supabase.from("buyers").select("id, code").eq("company_id", t.me.companyId!).eq("active", true),
    t.supabase.from("buyer_names").select("buyer_id, real_name").eq("company_id", t.me.companyId!),
  ]);
  const nameOf = new Map((names ?? []).map((n) => [n.buyer_id as string, n.real_name as string]));
  const known = (buyers ?? []).map((b) => ({ id: b.id, names: [nameOf.get(b.id) ?? "", b.code] }));
  const read = parseInquiry(`${subject}\n${String(po.email_body ?? "").slice(0, 3000)}\n${name}`, known);
  const buyerId = po.buyer_id ?? (read.buyer_id || buyerByDomain(address, known) || null);
  const row = {
    buyer_id: buyerId,
    prospect: buyerId ? null : (/^(gmail|yahoo|hotmail|outlook|rediffmail|icloud)$/i.test(domain) ? name : domain ? domain[0].toUpperCase() + domain.slice(1) : name) || "Unknown sender",
    contact_name: name.slice(0, 120) || null,
    contact: address.slice(0, 200) || null,
    source: "email",
    product: (/\b(?:co-?ords?|sets?|kurtas?|kurtis?|dress|tops?|shirts?|tees?|trousers?|pants?|skirts?|suits?|kaftans?|fabric|night\s*suits?)\b/i.test(subject) || !read.product ? subject || read.product || "See the email" : read.product).slice(0, 200),
    est_qty: read.est_qty ? Number(read.est_qty) : null,
    unit: read.unit,
    target_price: read.target_price ? Number(read.target_price) : null,
    notes: String(po.email_body ?? "").trim().slice(0, 4000) || null,
    merchandiser_id: t.me.id,
    next_follow_up: addDays(todayIST(), 1),
    incoming_po_id: po.id,
  };
  const { data, error } = await t.supabase.from("inquiries").insert(row).select("id").single();
  if (error) return { error: friendly(error) };
  if (po.status === "held") {
    if (t.me.role === "owner") await ignoreSender(po.id);
  } else if (po.status !== "not_po") {
    await setAside(po.id, true);
  }
  revalidatePath("/inquiries");
  revalidatePath(`/pos/${poId}`);
  revalidatePath("/pos");
  revalidatePath("/today");
  return { id: data.id };
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

// The owner adds an inquiry's new buyer to Buyers and puts it on the inquiry, so the order can be made from it.
export async function addInquiryBuyer(id: string, code: string, realName: string): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return { error: t.error };
  const added = await addBuyer(code, realName);
  if (added.error || !added.id) return { error: added.error ?? "Couldn't add the buyer." };
  const { data, error } = await t.supabase.from("inquiries").update({ buyer_id: added.id }).eq("id", id).in("status", ["new", "quoted"]).select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "The buyer was added, but this inquiry is closed. Pick them on a new inquiry or order." };
  revalidatePath("/inquiries");
  revalidatePath(`/inquiries/${id}`);
  return {};
}
