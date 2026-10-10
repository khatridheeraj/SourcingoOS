"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { STAGES } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type OrderInput = {
  id?: string;
  buyer_id: string;
  buyer_po: string;
  po_date: string;
  ship_date: string;
  status: string;
  merchandiser_id: string;
  notes: string;
};
export type LineInput = {
  id?: string;
  style: string;
  description: string;
  colour: string;
  qty: string;
  buyer_rate: string;
  factory_id: string;
  factory_rate: string;
};

const num = (s: string) => s.replace(/[,₹\s]/g, "");

export async function saveOrder(order: OrderInput, lines: LineInput[]): Promise<{ error?: string; id?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!order.buyer_id) return { error: "Pick the buyer." };
  if (!order.buyer_po.trim()) return { error: "Enter the buyer's PO number." };

  const filled = lines.filter((l) => l.style.trim() || l.qty.trim());
  if (filled.length === 0) return { error: "Add at least one style." };
  for (const [i, l] of filled.entries()) {
    const n = i + 1;
    if (!l.style.trim()) return { error: `Line ${n}: enter the style number.` };
    const q = Number(num(l.qty));
    if (!Number.isInteger(q) || q <= 0) return { error: `Line ${n}: quantity must be a whole number above zero.` };
    for (const [k, label] of [["buyer_rate", "buyer rate"], ["factory_rate", "factory rate"]] as const) {
      if (l[k].trim() && !(Number(num(l[k])) >= 0)) return { error: `Line ${n}: the ${label} must be a number.` };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_order", {
    p_order: { ...order, buyer_po: order.buyer_po.trim() },
    p_lines: filled.map((l) => ({
      ...l,
      qty: num(l.qty),
      buyer_rate: num(l.buyer_rate),
      factory_rate: num(l.factory_rate),
    })),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  return { id: data as string };
}

export type ProgressInput = { stage: string; revised_ship_date: string; delay_reason: string };

// Updates only the production details, so it never touches the styles or prices.
export async function saveProgress(id: string, p: ProgressInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (p.stage && !STAGES.some((s) => s.key === p.stage)) return { error: "Pick a stage from the list." };
  if (p.revised_ship_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.revised_ship_date)) return { error: "Enter the new ship date as a date." };
  if (p.revised_ship_date && !p.delay_reason.trim()) return { error: "Say why the ship date moved, so everyone knows." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({
      stage: p.stage || null,
      revised_ship_date: p.revised_ship_date || null,
      delay_reason: p.delay_reason.trim() || null,
    })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "Only open orders can be updated here. Reload the page." };
  revalidatePath("/");
  revalidatePath(`/orders/${id}`);
  return {};
}
