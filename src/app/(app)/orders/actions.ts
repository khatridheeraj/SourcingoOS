"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
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
