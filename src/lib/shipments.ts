import { fetchAll } from "@/lib/fetch-all";
import { qty } from "@/lib/format";
import type { createClient } from "@/lib/supabase/server";

// Pieces of each style across its order's dispatches, from ship_progress() in the database:
// bought (on a live dispatch), billed (invoiced to the buyer) and shipped (LR in).
export type LineShip = { order_id: string; line_id: string; ordered: number; bought: number; billed: number; shipped: number };
// The same for a whole order, counted style by style (extra pieces on one style don't make up for another):
// toShip, pieces not shipped yet; unbilled, pieces not yet bought and billed in Dispatch (what closing short gives up).
export type OrderShip = { ordered: number; bought: number; billed: number; shipped: number; toShip: number; unbilled: number; part: boolean };

export async function loadShipProgress(supabase: Awaited<ReturnType<typeof createClient>>, orderIds: string[]) {
  if (!orderIds.length) return { data: [] as LineShip[], error: null };
  return fetchAll<LineShip>((a, z) => supabase.rpc("ship_progress", { p_orders: orderIds }).order("line_id").range(a, z));
}

export function orderShip(rows: LineShip[], orderId?: string): OrderShip {
  const mine = orderId ? rows.filter((r) => r.order_id === orderId) : rows;
  const s = { ordered: 0, bought: 0, billed: 0, shipped: 0, toShip: 0, unbilled: 0 };
  for (const r of mine) {
    s.ordered += r.ordered; s.bought += r.bought; s.billed += r.billed; s.shipped += r.shipped;
    s.toShip += Math.max(0, r.ordered - r.shipped);
    s.unbilled += Math.max(0, r.ordered - r.billed);
  }
  // Some pieces have gone and some are still to go: the order waits for its next part (or to be closed short).
  return { ...s, part: s.shipped > 0 && s.toShip > 0 };
}

// "579 of 600 pcs shipped · 21 to send", or "· 21 being dispatched" once the next part is bought.
export function partText(s: OrderShip) {
  const moving = Math.min(s.toShip, Math.max(0, s.bought - s.shipped));
  const rest = s.toShip - moving;
  return `${qty(s.shipped)} of ${qty(s.ordered)} pcs shipped`
    + (moving ? ` · ${qty(moving)} being dispatched` : "") + (rest ? ` · ${qty(rest)} to send` : "");
}
