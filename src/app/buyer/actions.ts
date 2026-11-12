"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { priceText, qtyText } from "@/lib/inquiry-input";

// The buyer approves a sample or asks for changes, with photos already uploaded. An approval marks the step done.
export async function answerSample(id: string, approved: boolean, note: string, photos: string[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  if (!approved && !note.trim()) return { error: "Say what to change, so the factory can fix it." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_sample", { p_id: id, p_approved: approved, p_note: note.slice(0, 1000), p_photos: photos });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}

// The buyer writes to Sourcingo about one of its open POs. The order's merchandiser sees it on Home until answered.
export async function sendBuyerMessage(orderId: string, body: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  const text = body.trim();
  if (!text) return { error: "Write your message first." };
  if (text.length > 2000) return { error: "Keep the message under 2,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_buyer_message", { p_order: orderId, p_body: text });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}

// The buyer sends a new PO: its files are already uploaded to the company's PO folder under this PO's id.
export async function sendPo(id: string, files: { path: string; name: string; type: string; size: number }[], po: string, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  if (!files.length) return { error: "Pick the PO file first." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("buyer_send_po", {
    p_id: id, p_files: files.map((f) => ({ path: f.path, name: f.name.slice(0, 200), type: f.type, size: f.size })),
    p_po: po.trim().slice(0, 100), p_note: note.trim().slice(0, 1000),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}

// The buyer asks for the costing of an exact product; its photos are already uploaded to the ask's own folder.
export async function askCosting(id: string, a: { product: string; details: string; qty: string; target: string }, photos: string[]): Promise<{ error?: string; no?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  const product = a.product.trim();
  if (!product) return { error: "Say what the product is, like \"Cotton co-ord set\"." };
  const qty = qtyText(a.qty);
  if (!/^\d+$/.test(qty) || Number(qty) < 1) return { error: "Enter how many pieces you need, like 500." };
  const target = a.target.trim() ? priceText(a.target) : "";
  if (a.target.trim() && (!target || /-\s*\d/.test(a.target) || !(Number(target) > 0))) return { error: "Enter the target price a piece in rupees, like 450, or leave it empty." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("buyer_ask_costing", {
    p_id: id, p_product: product.slice(0, 200), p_details: a.details.trim().slice(0, 4000), p_qty: Number(qty),
    p_target: target ? Number(target) : null, p_photos: photos,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return { no: data as string };
}

// The buyer accepts Sourcingo's latest quote, or asks to revise it with what should change.
export async function answerCosting(id: string, accept: boolean, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  if (!accept && !note.trim()) return { error: "Say what to change, like a target price or a different fabric." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("buyer_answer_costing", { p_inquiry: id, p_accept: accept, p_note: note.trim().slice(0, 1000) });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}

// The buyer raises a claim on a style of its PO, with photos already uploaded. Sourcingo decides within 7 days.
export async function raiseClaim(c: import("@/components/claim-form").ClaimInput): Promise<{ error?: string; no?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("raise_buyer_claim", {
    p_line: c.lineId, p_reason: c.reason, p_pieces: c.pieces, p_ask: c.ask, p_detail: c.detail.trim().slice(0, 800), p_photos: c.photos,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return { no: data as string };
}
