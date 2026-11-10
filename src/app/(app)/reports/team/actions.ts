"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { canLead } from "@/lib/team-board";

// Moves open orders from one merchandiser to another (leave, a new joiner, a busy week). Only orders still with the
// first person move, so two people handing over at once can't take an order back.
export async function handOver(fromId: string, toId: string, orderIds: string[]): Promise<{ error?: string; moved?: number }> {
  const me = await getMe();
  if (!canLead(me?.role) || !me?.companyId) return { error: "Only the owner or a manager hands over orders." };
  if (!toId) return { error: "Pick who takes them over." };
  if (toId === fromId) return { error: "Pick someone else to take them over." };
  if (!orderIds.length) return { error: "Tick at least one order." };
  const supabase = await createClient();
  const { data: to } = await supabase.from("members").select("role, active").eq("company_id", me.companyId).eq("user_id", toId).maybeSingle();
  if (!to?.active || !["owner", "manager", "merchandiser"].includes(to.role)) return { error: "Orders can go only to the owner, a manager or a merchandiser on the team." };
  const { data, error } = await supabase.from("orders").update({ merchandiser_id: toId })
    .eq("company_id", me.companyId).eq("merchandiser_id", fromId).eq("status", "open").in("id", orderIds).select("id");
  if (error) return { error: friendly(error) };
  revalidatePath("/reports/team");
  revalidatePath("/today");
  return { moved: data?.length ?? 0 };
}
