"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { PackRow } from "@/lib/packing";
import { exportProblem, type ExportDetails } from "@/lib/export-docs";

// Gives a dispatch its delivery challan number the first time it is printed.
export async function issueChallan(dispatchId: string): Promise<{ error?: string }> {
  if (!canEditOrders((await getMe())?.role)) return { error: "Only the orders team can print a delivery challan." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_challan", { p_dispatch: dispatchId });
  if (error) return { error: friendly(error) };
  revalidatePath(`/goods/${dispatchId}/challan`);
  revalidatePath("/goods");
  return {};
}

export async function setBuyerDelivery(dispatchId: string, buyerId: string, address: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_buyer_delivery", { p_buyer: buyerId, p_address: address });
  if (error) return { error: friendly(error) };
  revalidatePath(`/goods/${dispatchId}/challan`);
  return {};
}

export async function setCompanyDetails(dispatchId: string, address: string, gstin: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_company_details", { p_address: address, p_gstin: gstin.replace(/\s+/g, "") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/goods/${dispatchId}/challan`);
  return {};
}

// The owner's e-way bill limits (0132). The database checks them again and looks at waiting lots afresh.
export async function saveEwayRules(v: { home_state: string; inter_state: string; in_state: string; same_city: string; checked_on: string; source: string }): Promise<{ error?: string }> {
  if ((await getMe())?.role !== "owner") return { error: "Only the owner can change the e-way bill limits." };
  const rs = (x: string) => x.replace(/[,₹\s]|^Rs\.?/gi, "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_eway_rules", { p: { ...v, inter_state: rs(v.inter_state), in_state: rs(v.in_state), same_city: rs(v.same_city), source: v.source.trim() } });
  if (error) return { error: friendly(error) };
  revalidatePath("/goods");
  revalidatePath("/orders", "layout");
  return {};
}

// Saves a lot's packing list as a whole: runs of identical cartons with pieces per size.
export async function savePackingList(dispatchId: string, rows: PackRow[]): Promise<{ error?: string }> {
  if (!canEditOrders((await getMe())?.role)) return { error: "Only the orders team makes packing lists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_packing_list", { p_dispatch: dispatchId, p_rows: rows });
  if (error) return { error: friendly(error) };
  revalidatePath(`/goods/${dispatchId}/packing`);
  revalidatePath("/goods");
  return {};
}

// A lot's export details, as typed. Blank boxes are kept blank: the papers list what is still missing.
export async function saveExport(dispatchId: string, e: ExportDetails): Promise<{ error?: string }> {
  if (!canEditOrders((await getMe())?.role)) return { error: "Only the orders team makes export papers." };
  const bad = exportProblem(e);
  if (bad) return { error: bad };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_export", { p_dispatch: dispatchId, p: e });
  if (error) return { error: friendly(error) };
  revalidatePath(`/goods/${dispatchId}/export`);
  return {};
}

export type Exporter = { iec: string; ad_code: string; lut_no: string; lut_date: string; export_bank: string; export_port: string };
// Our exporter details, kept for every export invoice. Owner only (checked again in the database).
export async function saveExporter(dispatchId: string, x: Exporter): Promise<{ error?: string }> {
  if ((await getMe())?.role !== "owner") return { error: "Only the owner changes our exporter details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_exporter", { p: x });
  if (error) return { error: friendly(error) };
  revalidatePath(`/goods/${dispatchId}/export`);
  return {};
}

const trackDone = (id: string) => { revalidatePath(`/goods/${id}/track`); revalidatePath("/goods"); revalidatePath("/buyer"); revalidatePath("/guarantee"); };

export type TrackInput = { mode: string; carrier: string; no: string; to: string; eta: string };
// How a shipped part travels: mode, carrier and its number, where to, and when it should arrive.
export async function saveTracking(dispatchId: string, t: TrackInput): Promise<{ error?: string }> {
  if (!canEditOrders((await getMe())?.role)) return { error: "Only the orders team keeps tracking." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_tracking", {
    p_dispatch: dispatchId, p_mode: t.mode, p_carrier: t.carrier.trim() || null, p_no: t.no.trim() || null, p_to: t.to.trim() || null,
    p_eta: /^\d{4}-\d{2}-\d{2}$/.test(t.eta) ? t.eta : null,
  });
  if (error) return { error: friendly(error) };
  trackDone(dispatchId);
  return {};
}

// A dated update at a stage of the journey.
export async function addTrackEvent(dispatchId: string, stage: string, on: string, place: string, note: string): Promise<{ error?: string }> {
  if (!canEditOrders((await getMe())?.role)) return { error: "Only the orders team keeps tracking." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: "Pick the day." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_shipment_event", { p_dispatch: dispatchId, p_stage: stage, p_on: on, p_place: place.trim().slice(0, 80) || null, p_note: note.trim().slice(0, 300) || null });
  if (error) return { error: friendly(error) };
  trackDone(dispatchId);
  return {};
}

export async function takeBackTrackEvent(dispatchId: string, eventId: string): Promise<{ error?: string }> {
  if (!canEditOrders((await getMe())?.role)) return { error: "Only the orders team keeps tracking." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_shipment_event", { p_id: eventId });
  if (error) return { error: friendly(error) };
  trackDone(dispatchId);
  return {};
}
