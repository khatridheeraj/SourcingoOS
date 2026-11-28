"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { can, canEditOrders, getMe } from "@/lib/auth";
import { profileProblem, type BuyerProfile, type DocKind } from "@/lib/buyer-profile";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// What the profile form sends: every box as typed (strings), the contacts, and the buyer's main ship-to address,
// currency and credit days. The database checks and cleans each field again.
export type ProfileInput = Record<string, unknown>;

async function team() {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !can(me, "buyers")) return null;
  return me;
}

const num = (s: string | undefined) => (s == null || s.trim() === "" ? null : Number(s.replace(/[,\s]/g, "")));

export async function saveBuyerProfile(buyerId: string, p: ProfileInput): Promise<{ error?: string }> {
  if (!(await team())) return { error: "Only the orders team or Accounts, with Buyer details, can change a buyer's details." };
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const bad = profileProblem({ gstin: str("gstin"), pan: str("pan"), contacts: Array.isArray(p.contacts) ? (p.contacts as BuyerProfile["contacts"]) : [],
    deposit_pct: num(str("deposit_pct")), credit_limit: num(str("credit_limit")) });
  if (bad) return { error: bad };
  const days = str("credit_days")?.trim();
  if (days && !/^\d{1,3}$/.test(days)) return { error: "Credit days is a number of days, like 45." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_buyer_profile", { p_buyer: buyerId, p });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyers", "layout");
  return {};
}

export async function addBuyerDoc(buyerId: string, kind: DocKind, path: string, name: string): Promise<{ error?: string }> {
  if (!(await team())) return { error: "Only the orders team or Accounts, with Buyer details, can add a buyer's papers." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_buyer_document", { p_buyer: buyerId, p_kind: kind, p_path: path, p_name: name });
  if (error) return { error: friendly(error) };
  revalidatePath(`/buyers/${buyerId}`);
  return {};
}

export async function removeBuyerDoc(buyerId: string, id: string): Promise<{ error?: string }> {
  if (!(await team())) return { error: "Only the orders team or Accounts, with Buyer details, can take off a buyer's papers." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_buyer_document", { p_id: id });
  if (error) return { error: friendly(error) };
  revalidatePath(`/buyers/${buyerId}`);
  return {};
}

// Marks that we asked, and gives back the buyer's own link for the message.
export async function askBuyerDetails(buyerId: string): Promise<{ error?: string; url?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role) || me?.role === "accounts" || !can(me, "buyers")) return { error: "Only the orders team, with Buyer details, can ask a buyer for its details." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("buyer_link", { p_buyer: buyerId, p_renew: false });
  if (error || typeof data !== "string") return { error: error ? friendly(error) : "Couldn't make the buyer's link. Try again." };
  const { error: e2 } = await supabase.rpc("ask_buyer_details", { p_buyer: buyerId });
  if (e2) return { error: friendly(e2) };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "sourcingo-os.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  revalidatePath(`/buyers/${buyerId}`);
  return { url: `${proto}://${host}/s/${data}` };
}
