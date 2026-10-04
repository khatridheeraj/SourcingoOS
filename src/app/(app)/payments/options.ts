import type { World } from "@/lib/model";
import type { Books } from "@/lib/payments";
import type { BuyerOpt, OpenInvoice } from "./forms";

export const buyerOptions = (w: World, b: Books): BuyerOpt[] =>
  w.buyers.map((x) => ({ id: x.id, label: x.real_name ? `${x.code} · ${x.real_name}` : x.code, creditDays: b.buyerById.get(x.id)?.credit_days ?? null }));

export const orderOptions = (w: World) =>
  w.orders.map((o) => ({ id: o.id, buyer_id: o.buyer_id, label: `${o.id} · #${o.buyer_po_number}` }));

// Invoices a cheque can pay. For an existing cheque, what it already pays counts as room.
export function openInvoices(b: Books, chequeId: string | null): OpenInvoice[] {
  return b.invoices
    .filter((i) => i.net != null)
    .map((i) => {
      const mine = i.cheques.filter((c) => c.cheque.id === chequeId && c.cheque.status !== "bounced" && c.cheque.status !== "cancelled").reduce((a, c) => a + c.amount, 0);
      return { id: i.id, buyer_id: i.buyer_id, invoice_no: i.invoice_no, invoice_date: i.invoice_date, due: i.due, net: i.net!, left: Math.max(0, i.net! - i.covered + mine) };
    });
}
