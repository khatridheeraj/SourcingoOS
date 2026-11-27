"use server";

import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { personLink } from "../../buyers/actions";

// Makes the asker of an inquiry a buyer with their own page link (make_buyer_from_inquiry, 0102).
export async function giveBuyerPage(inquiryId: string): Promise<{ error?: string; url?: string; name?: string; existing?: boolean; buyerId?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can add buyers." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("make_buyer_from_inquiry", { p_inquiry: inquiryId });
  if (error) return { error: friendly(error) };
  const r = data as { buyer_id: string; person_id: string; existing: boolean; name: string };
  const link = await personLink(r.person_id);
  // No revalidate here: refreshing would close the send box before the link goes out. Done refreshes the page.
  if (link.error) return { error: `They are a buyer now, but the link didn't come: ${link.error} Open Buyers > their people to send it.`, buyerId: r.buyer_id };
  return { url: link.url, name: r.name, existing: r.existing, buyerId: r.buyer_id };
}
