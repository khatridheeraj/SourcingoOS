import type { Books } from "@/lib/payments";
import type { BuyerOpt, OpenInvoice } from "./forms";

export const buyerOptions = (b: Books, label: (id: string) => string): BuyerOpt[] =>
  [...b.buyerById.values()].map((x) => ({ id: x.id, label: label(x.id), creditDays: x.credit_days }));

// Invoices a cheque can pay. For an existing cheque, what it already pays counts as room.
export function openInvoices(b: Books, chequeId: string | null): OpenInvoice[] {
  return b.invoices
    .filter((i) => i.state !== "cancelled")
    .map((i) => {
      const mine = i.cheques.filter((c) => c.cheque.id === chequeId && c.cheque.status !== "bounced" && c.cheque.status !== "cancelled").reduce((a, c) => a + c.amount, 0);
      return { id: i.id, buyer_id: i.buyer_id, invoice_no: i.invoice_no, invoice_date: i.invoice_date, due: i.due, net: i.net, left: Math.max(0, i.net - i.covered + mine) };
    });
}
