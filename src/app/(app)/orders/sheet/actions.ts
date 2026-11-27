"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { MAX_SHEET_POS, type SheetOrder } from "@/lib/po-sheet";
import { createClient } from "@/lib/supabase/server";
import { saveOrder } from "../actions";

export type SheetSaved = { key: string; po: string; id?: string; orderNo?: string; error?: string };

// Adds each PO from a sheet the same way the New order form does, one at a time, so a PO that already exists or
// fails a check is reported on its own and the others still go in.
export async function addSheetOrders(orders: SheetOrder[], merchandiserId: string): Promise<{ error?: string; saved: SheetSaved[] }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can add orders.", saved: [] };
  if (!orders.length) return { error: "Paste the rows first.", saved: [] };
  if (orders.length > MAX_SHEET_POS) return { error: `Add at most ${MAX_SHEET_POS} POs at a time.`, saved: [] };
  const saved: SheetSaved[] = [];
  for (const o of orders) {
    if (o.problems.length) { saved.push({ key: o.key, po: o.po, error: o.problems[0] }); continue; }
    const r = await saveOrder(
      { buyer_id: o.buyerId, buyer_po: o.po, po_date: o.po_date, ship_date: o.ship_date, status: "open", merchandiser_id: merchandiserId, notes: "" },
      o.lines.map((l) => ({ style: l.style, description: l.description.slice(0, 200), colour: l.colour, qty: l.qty, buyer_rate: l.buyer_rate, factory_id: l.factory_id, factory_rate: l.factory_rate })),
    );
    if (r.id) saved.push({ key: o.key, po: o.po, id: r.id });
    else if (r.confirm) saved.push({ key: o.key, po: o.po, error: `A PO very like ${o.po} is already an order (${r.confirm.similar_po.map((x) => x.order_no).join(", ")}). If it is a different PO, add it on its own in New order.` });
    else saved.push({ key: o.key, po: o.po, error: r.error ?? "It didn't save." });
  }
  const ids = saved.filter((s) => s.id).map((s) => s.id!);
  if (ids.length) {
    const supabase = await createClient();
    const { data } = await supabase.from("orders").select("id, order_no").in("id", ids);
    const no = new Map((data ?? []).map((d) => [d.id, d.order_no as string]));
    for (const s of saved) if (s.id) s.orderNo = no.get(s.id);
    revalidatePath("/");
  }
  return { saved };
}
