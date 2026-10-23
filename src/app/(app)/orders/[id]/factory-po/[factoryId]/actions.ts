"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type PoDetails = {
  orderId: string;
  factoryId: string;
  // The factory has been asked for its plan, so its PO row exists and can carry a number.
  hasPo: boolean;
  poNo: string;
  deliveryNote: string;
  factory: { address: string; gstin: string; phone: string; email: string };
  // Only sent by the owner.
  company?: { legalName: string; address: string; shipAddress: string; gstin: string; phone: string; email: string };
};

const GSTIN = /^[0-9]{2}[A-Z0-9]{13}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Everything printed on one factory PO that isn't the order itself: its number and delivery line, the factory's
// address and tax details (kept on the factory for every later PO), and, for the owner, our own details.
export async function savePoDetails(d: PoDetails): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can change a factory PO." };
  const fGstin = d.factory.gstin.trim().toUpperCase();
  if (fGstin && !GSTIN.test(fGstin)) return { error: "The factory's GSTIN doesn't look right. It has 15 letters and numbers, like 08ABCDE1234F1Z5." };
  const fEmail = d.factory.email.trim().toLowerCase();
  if (fEmail && !EMAIL.test(fEmail)) return { error: "The factory's email doesn't look right." };
  if (d.company && d.company.email.trim() && !EMAIL.test(d.company.email.trim())) return { error: "Our email doesn't look right." };
  if (d.company && me?.role !== "owner") return { error: "Only the owner can change our company details." };

  const supabase = await createClient();
  if (d.hasPo) {
    const { error: e1 } = await supabase.rpc("set_factory_po_details", { p_order: d.orderId, p_factory: d.factoryId, p_po_no: d.poNo, p_delivery_note: d.deliveryNote });
    if (e1) return { error: friendly(e1) };
  }
  const { error: e2 } = await supabase.from("factories").update({
    address: d.factory.address.trim() || null,
    gstin: fGstin || null,
    phone: d.factory.phone.trim() || null,
    email: fEmail || null,
  }).eq("id", d.factoryId);
  if (e2) return { error: friendly(e2) };
  if (d.company) {
    const c = d.company;
    const { error: e3 } = await supabase.rpc("set_company_po_details", {
      p_legal_name: c.legalName, p_address: c.address, p_ship_address: c.shipAddress, p_gstin: c.gstin, p_phone: c.phone, p_email: c.email,
    });
    if (e3) return { error: friendly(e3) };
  }
  revalidatePath(`/orders/${d.orderId}/factory-po/${d.factoryId}`);
  revalidatePath("/factories");
  return {};
}

// "Email PO to factory": the email goes from the owner's Gmail within half an hour, then a follow-up every 2 hours
// (9 am to 9 pm, Monday to Saturday) until the factory accepts.
export async function emailPo(orderId: string, factoryId: string, to: string, cc: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can email a factory PO." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_po_mail", { p_order: orderId, p_factory: factoryId, p_to: to, p_cc: cc });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}/factory-po/${factoryId}`);
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// The factory said yes on the phone or WhatsApp.
export async function markAccepted(orderId: string, factoryId: string, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can mark a PO accepted." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_po_accepted", { p_order: orderId, p_factory: factoryId, p_note: note });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}/factory-po/${factoryId}`);
  revalidatePath(`/orders/${orderId}`);
  return {};
}
