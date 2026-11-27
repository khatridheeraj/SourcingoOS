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
