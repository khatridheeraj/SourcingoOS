import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "./format";

// Other orders the one being entered may repeat (from order_entry_warnings in the database).
export type SameOrder = { id: string; order_no: string; buyer_po: string; status: string };
export type OrderWarnings = {
  same_po: SameOrder[];
  similar_po: SameOrder[];
  same_style: (SameOrder & { styles: string[] })[];
};
export const NO_WARNINGS: OrderWarnings = { same_po: [], similar_po: [], same_style: [] };

// A buyer's overdue invoices (from buyer_overdue). amount is null for anyone but the owner and Accounts.
export type Overdue = { overdue_invoices: number; oldest_days: number; amount: number | null };

// What the form warns about before an order is saved. Never throws: a check that can't run shows nothing.
export async function orderWarnings(
  supabase: SupabaseClient, buyerId: string, buyerPo: string, styles: string[], orderId?: string,
): Promise<OrderWarnings | null> {
  if (!buyerId) return NO_WARNINGS;
  const { data, error } = await supabase.rpc("order_entry_warnings", {
    p_buyer: buyerId, p_buyer_po: buyerPo.trim(), p_styles: styles.map((s) => s.trim()).filter(Boolean), p_order: orderId ?? null,
  });
  if (error || !data) return null;
  return { ...NO_WARNINGS, ...(data as Partial<OrderWarnings>) };
}

// The buyer's overdue invoices, or null when nothing is overdue or the check can't run.
export async function buyerOverdue(supabase: SupabaseClient, buyerId: string): Promise<Overdue | null> {
  if (!buyerId) return null;
  const { data, error } = await supabase.rpc("buyer_overdue", { p_buyer: buyerId });
  if (error || !data) return null;
  const o = data as Partial<Overdue>;
  const n = Number(o.overdue_invoices) || 0;
  return n > 0 ? { overdue_invoices: n, oldest_days: Number(o.oldest_days) || 0, amount: o.amount == null ? null : Number(o.amount) } : null;
}

// "Ozia Retail has 18 invoices overdue, the oldest by 92 days (₹62,40,000). Check with Accounts before confirming this order."
export function overdueText(buyer: string, o: Overdue): string {
  const days = `${o.oldest_days} ${o.oldest_days === 1 ? "day" : "days"}`;
  const what = o.overdue_invoices === 1 ? `1 invoice overdue by ${days}` : `${o.overdue_invoices} invoices overdue, the oldest by ${days}`;
  return `${buyer || "This buyer"} has ${what}${o.amount != null ? ` (${money(o.amount)})` : ""}. Check with Accounts before confirming this order.`;
}

// Days an incoming PO may wait before it is flagged as not yet added as an order.
export const PO_WAIT_DAYS = 2;
// Whole days an incoming PO has waited, or 0 while it is still within PO_WAIT_DAYS.
export function poWaitDays(receivedAt: string, now: number): number {
  const d = Math.floor((now - Date.parse(receivedAt)) / 86_400_000);
  return d >= PO_WAIT_DAYS ? d : 0;
}
