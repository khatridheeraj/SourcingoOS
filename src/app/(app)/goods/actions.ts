"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

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
  const { error } = await supabase.rpc("set_company_details", { p_address: address, p_gstin: gstin });
  if (error) return { error: friendly(error) };
  revalidatePath(`/goods/${dispatchId}/challan`);
  return {};
}
