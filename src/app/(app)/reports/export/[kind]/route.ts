import { getMe } from "@/lib/auth";
import { loadBooks, loadWorld } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { CONDITION_LABEL, DC_LABEL, GRN_LABEL, SAMPLE_LABEL, sampleOnTime, sampleTypeLabel, SO_LABEL, unitOf } from "@/lib/model";
import { CHEQUE_LABEL, INVOICE_LABEL } from "@/lib/payments";
import { isFinance, isInternal } from "@/lib/roles";

// Excel-friendly CSV. Cells that look like formulas are neutralised.
function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export async function GET(_req: Request, ctx: RouteContext<"/reports/export/[kind]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) return new Response("Not allowed", { status: 403 });
  const { kind } = await ctx.params;
  const { world: w } = await loadWorld();
  const stamp = w.today;
  const file = (name: string, body: string, type = "text/csv; charset=utf-8") =>
    new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename="sourcingo-${name}-${stamp}.${type.startsWith("text/csv") ? "csv" : "json"}"`, "cache-control": "no-store" } });

  if (kind === "sales-orders") {
    return file("sales-orders", csv([
      ["SO", "Buyer PO", "Buyer code", "Status", "SO date", "Order type", "Currency", "Factory", "Payment terms", "Buyer delivery", "Factory delivery",
        "Merchandiser predicted", "Merchandiser", "Manager", "Style", "Code", "Fabric", "Colour", "Qty", "Unit", "Buyer rate", "Value", "Factory rate", "Tags"],
      ...w.orders.flatMap((o) => (o.styles.length ? o.styles : [null]).map((s) => [
        o.id, o.buyer_po_number, w.buyerCode(o.buyer_id), SO_LABEL[o.status], o.so_date, o.order_type, o.currency, w.factoryName(o.factory_id),
        o.payment_terms, o.buyer_date, o.factory_date, o.merch_date, w.personName(o.merchandiser_id), w.personName(o.manager_id),
        s?.name, s?.code, s?.fabric, s?.colour, s?.qty, unitOf(o), s?.buyer_rate, s ? s.qty * s.buyer_rate : "", s?.factory_rate, o.tags.join("; "),
      ])),
    ]));
  }
  if (kind === "grns") {
    return file("grns", csv([
      ["GRN", "SO", "Buyer PO", "Buyer code", "Factory", "Received at", "Received by", "Style", "Code", "Colour", "Ordered", "Received", "Condition",
        "Rate", "Value", "Currency", "QC", "Status", "Units still held"],
      ...w.grns.flatMap((g) => {
        const o = w.orderById.get(g.so_id);
        return g.lines.map((l) => {
          const s = w.styleById.get(l.style_id);
          return [g.id, g.so_id, o?.buyer_po_number, w.buyerCode(o?.buyer_id), w.factoryName(o?.factory_id), fmtDateTime(g.received_at), w.personName(g.received_by),
            s?.name, s?.code, s?.colour, s?.qty, l.qty, CONDITION_LABEL[l.condition], w.rate(l.style_id), l.qty * w.rate(l.style_id), w.currencyOf(g.so_id),
            g.qc_checked ? "Passed" : "Not confirmed", GRN_LABEL[g.status], w.grnHeld(g)];
        });
      }),
    ]));
  }
  if (kind === "delivery-challans") {
    return file("delivery-challans", csv([
      ["DC", "GRN", "SO", "Buyer code", "Status", "Dispatched at", "Courier", "Tracking", "Invoice no", "Invoice date", "Style", "Code", "Colour", "Qty",
        "Rate", "Value", "Currency", "Address"],
      ...w.dcs.flatMap((d) => d.lines.map((l) => {
        const s = w.styleById.get(l.style_id);
        return [d.id, d.grn_id, d.so_id, w.buyerCode(w.orderById.get(d.so_id)?.buyer_id), DC_LABEL[d.status], d.dispatched_at ? fmtDateTime(d.dispatched_at) : "",
          d.courier, d.tracking, d.invoice_no, d.invoice_date, s?.name, s?.code, s?.colour, l.qty, w.rate(l.style_id), l.qty * w.rate(l.style_id),
          w.currencyOf(d.so_id), d.address];
      })),
    ]));
  }
  if (kind === "payments" && isFinance(me?.role)) {
    const { books: b } = await loadBooks();
    return file("payments", csv([
      ["Invoice", "Buyer code", "Invoice date", "Due date", "Amount", "Credit notes", "To collect", "Cleared", "Left to collect", "Invoice status", "Overdue",
        "Cheque", "Bank", "Cheque date", "Cheque amount", "Against this invoice", "Cheque status", "Deposited", "Cleared on", "Sales order", "DC", "Notes"],
      ...b.invoices.flatMap((i) => (i.cheques.length ? i.cheques : [null]).map((c) => [
        i.invoice_no, w.buyerCode(i.buyer_id), i.invoice_date, i.due, i.amount, i.credit || "", i.net, i.received, i.outstanding, INVOICE_LABEL[i.state], i.overdue ? "Yes" : "",
        c?.cheque.cheque_no, c?.cheque.bank, c?.cheque.cheque_date, c?.cheque.amount, c?.amount, c ? CHEQUE_LABEL[c.cheque.status] : "", c?.cheque.deposited_on,
        c?.cheque.cleared_on, i.so_id, i.dc_id, i.notes,
      ])),
    ]));
  }
  if (kind === "samples") {
    return file("samples", csv([
      ["Sample", "Buyer code", "What", "Fabric", "Buyer ref", "Type", "Pieces", "Vendor", "Status", "Round", "Received", "Due to buyer",
        "Given to vendor", "Vendor return by", "Back from vendor", "Sent to buyer", "On time", "Courier", "Tracking", "Merchandiser", "Feedback", "Remarks"],
      ...w.samples.map((s) => {
        const ok = sampleOnTime(s);
        return [s.id, w.buyerCode(s.buyer_id), s.description, s.fabric, s.buyer_ref, sampleTypeLabel(s.sample_type), s.qty, s.factory_id ? w.factoryName(s.factory_id) : "",
          SAMPLE_LABEL[s.status], s.round, s.received_on, s.due_date, s.issued_on, s.vendor_due, s.ready_on, s.dispatched_on, ok === null ? "" : ok ? "Yes" : "No",
          s.courier, s.tracking, s.merchandiser_id ? w.personName(s.merchandiser_id) : "", s.feedback, s.remarks];
      }),
    ]));
  }
  if (kind === "backup" && me?.role === "owner") {
    // Codes only: real buyer names stay in the private registry.
    const buyers = w.buyers.map((b) => ({ id: b.id, code: b.code, default_payment_terms: b.default_payment_terms, default_address: b.default_address }));
    const { books: b } = await loadBooks();
    const omit = <T extends object>(o: T, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
    const payments = { invoices: b.invoices.map((i) => omit(i, "cheques")), credit_notes: b.creditNotes, cheques: b.cheques.map((c) => omit(c, "invoices")), cheque_allocations: b.allocations };
    const body = { exported_at: new Date(w.now).toISOString(), buyers, factories: w.factories, orders: w.orders, grns: w.grns, delivery_challans: w.dcs, inquiries: w.inquiries, samples: w.samples, payments };
    return file("backup", JSON.stringify(body, null, 2), "application/json");
  }
  return new Response("Unknown export", { status: 404 });
}
