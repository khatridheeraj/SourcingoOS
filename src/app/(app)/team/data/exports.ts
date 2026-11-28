import { can, canEditOrders, type Me } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { stageLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Cell, Sheet } from "@/lib/xlsx";

// What can be downloaded from Team > Data, each a sheet in Excel. Everything is read as the person downloading,
// so the database's own rules decide what goes in (Money only with the Money switch, prices only for the orders team).
export type ExportKey = "orders" | "tna" | "factory-pos" | "qc" | "buyers" | "factories" | "inquiries" | "money";
// money: needs the Money switch; buyers: needs Buyer details.
export const EXPORTS: { key: ExportKey; label: string; hint: string; money?: boolean; buyers?: boolean }[] = [
  { key: "orders", label: "Orders and styles", hint: "One row per style: buyer, PO, dates, pieces, factory and rates" },
  { key: "tna", label: "TNA steps", hint: "Every step of every style: target, factory date, done" },
  { key: "factory-pos", label: "Factory POs", hint: "Sent, approved and accepted, per order and factory" },
  { key: "qc", label: "QC checks", hint: "Inline, mid-line and final checks with results and defects" },
  { key: "buyers", label: "Buyers", hint: "Codes, names, cities and payment days", buyers: true },
  { key: "factories", label: "Factories", hint: "Contacts, cities, GSTIN and Tally ledgers" },
  { key: "inquiries", label: "Inquiries", hint: "Every costing request with its status and follow-up", buyers: true },
  { key: "money", label: "Money", hint: "Invoices, credit notes and cheques", money: true },
];

type Row = Record<string, unknown>;
const s = (v: unknown): Cell => (v == null ? null : typeof v === "number" || typeof v === "boolean" ? v : String(v));
const n = (v: unknown): Cell => (v == null || v === "" ? null : Number(v));
const d = (v: unknown): Cell => (typeof v === "string" ? v.slice(0, 10) : null);
const priceCells = (r: { buyer_rate: number | null; factory_rate: number | null } | undefined, qty: unknown): Cell[] =>
  [n(r?.buyer_rate), n(r?.factory_rate), r?.buyer_rate != null && qty != null ? Number(r.buyer_rate) * Number(qty) : null];
const human = (v: unknown) => (typeof v === "string" ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : null);

export async function exportSheets(me: Me, keys: ExportKey[]): Promise<{ sheets: Sheet[]; error: string | null }> {
  const company = me.companyId!;
  const supabase = await createClient();
  const prices = canEditOrders(me.role);
  const [buyers, factories, team] = await Promise.all([loadBuyers(), loadFactories(), loadTeam()]);
  const buyer = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factory = new Map(factories.map((f) => [f.id, f.name]));
  const person = new Map(team.map((m) => [m.user_id, personName(m)]));
  const ordersQ = await fetchAll<Row>((a, z) => supabase.from("orders")
    .select("id, order_no, buyer_id, buyer_po, po_date, ship_date, revised_ship_date, status, stage, merchandiser_id, created_at")
    .eq("company_id", company).is("removed_at", null).order("order_no").order("id").range(a, z));
  if (ordersQ.error) return { sheets: [], error: ordersQ.error.message };
  const orders = new Map(ordersQ.data.map((o) => [o.id as string, o]));
  const orderNo = (id: unknown) => (orders.get(id as string)?.order_no as string | undefined) ?? null;
  const sheets: Sheet[] = [];
  let error: string | null = null;
  const fail = (e: { message: string } | null) => { if (e && !error) error = e.message; };

  for (const key of keys) {
    if (key === "orders" || key === "tna") {
      const lines = await fetchAll<Row>((a, z) => supabase.from("order_lines")
        .select("id, order_id, position, style, description, colour, fabric, product, qty, factory_id")
        .eq("company_id", company).is("removed_at", null).order("order_id").order("position").order("id").range(a, z));
      fail(lines.error);
      const live = lines.data.filter((l) => orders.has(l.order_id as string));
      // Rates come only through line_prices(), which answers the orders team and Accounts.
      const rates = new Map<string, { buyer_rate: number | null; factory_rate: number | null }>();
      if (key === "orders" && prices) {
        const { data: lp, error: e } = await supabase.rpc("line_prices", { p_orders: [...orders.keys()] });
        fail(e);
        for (const r of (lp ?? []) as { id: string; buyer_rate: number | null; factory_rate: number | null }[]) rates.set(r.id, r);
      }
      if (key === "orders") {
        sheets.push({ name: "Orders and styles", rows: [
          ["Order", "Buyer", "Buyer PO", "PO date", "Ship date", "New ship date", "Status", "Stage", "Merchandiser", "Style", "Description", "Colour",
            "Fabric", "Product", "Pieces", "Factory", ...(prices ? ["Buyer rate", "Factory rate", "Value at buyer rate"] : [])],
          ...live.map((l) => {
            const o = orders.get(l.order_id as string)!;
            return [s(o.order_no), buyer.get(o.buyer_id as string) ?? null, s(o.buyer_po), d(o.po_date), d(o.ship_date), d(o.revised_ship_date), human(o.status),
              human(o.stage), person.get(o.merchandiser_id as string) ?? null, s(l.style), s(l.description), s(l.colour), s(l.fabric), s(l.product), n(l.qty),
              factory.get(l.factory_id as string) ?? null,
              ...(prices ? priceCells(rates.get(l.id as string), l.qty) : [])];
          }),
        ] });
      } else {
        const style = new Map(live.map((l) => [l.id as string, l]));
        const steps = await fetchAll<Row>((a, z) => supabase.from("line_stages")
          .select("id, order_id, line_id, stage, label, planned_on, factory_on, done_on, not_needed")
          .eq("company_id", company).order("order_id").order("line_id").order("planned_on", { nullsFirst: false }).order("id").range(a, z));
        fail(steps.error);
        sheets.push({ name: "TNA steps", rows: [
          ["Order", "Style", "Step", "Target", "Factory date", "Done", "Not needed"],
          ...steps.data.filter((r) => style.has(r.line_id as string)).map((r) => [orderNo(r.order_id), s(style.get(r.line_id as string)?.style),
            s(r.label) ?? (stageLabel(r.stage as string) === "No step done yet" ? s(r.stage) : stageLabel(r.stage as string)),
            d(r.planned_on), d(r.factory_on), d(r.done_on), r.not_needed ? "Yes" : null]),
        ] });
      }
    } else if (key === "factory-pos") {
      const { data, error: e } = await supabase.from("factory_pos")
        .select("order_id, factory_id, po_no, lock_requested_at, released_at, mailed_at, follow_ups, accepted_at, accepted_via").eq("company_id", company).order("created_at");
      fail(e);
      sheets.push({ name: "Factory POs", rows: [
        ["Order", "Factory", "PO no.", "Sent for approval", "Approved", "Emailed", "Reminders", "Accepted", "Accepted by"],
        ...(data ?? []).filter((r) => orders.has(r.order_id)).map((r) => [orderNo(r.order_id), factory.get(r.factory_id) ?? null, s(r.po_no), d(r.lock_requested_at),
          d(r.released_at), d(r.mailed_at), n(r.follow_ups), d(r.accepted_at), human(r.accepted_via)]),
      ] });
    } else if (key === "qc") {
      const { data, error: e } = await supabase.from("qc_checks")
        .select("order_id, kind, checked_on, result, pieces_checked, defects, notes, checked_by").eq("company_id", company).is("cancelled_at", null).order("checked_on");
      fail(e);
      sheets.push({ name: "QC checks", rows: [
        ["Order", "Check", "Checked on", "Result", "Pieces checked", "Defects", "Checked by", "Notes"],
        ...(data ?? []).filter((r) => orders.has(r.order_id)).map((r) => [orderNo(r.order_id), human(r.kind), d(r.checked_on), human(r.result), n(r.pieces_checked),
          n(r.defects), person.get(r.checked_by) ?? null, s(r.notes)]),
      ] });
    } else if (key === "buyers") {
      sheets.push({ name: "Buyers", rows: [
        ["Code", "Name", "City", "Active", "GRN days", "Notes"],
        ...buyers.map((b) => [b.code, b.realName, b.city, b.active ? "Yes" : "No", b.grn_days ?? null, b.notes]),
      ] });
    } else if (key === "factories") {
      const { data, error: e } = await supabase.from("factories")
        .select("name, city, contact_name, phone, email, address, gstin, tally_ledger, active, notes").eq("company_id", company).order("name");
      fail(e);
      sheets.push({ name: "Factories", rows: [
        ["Factory", "City", "Contact", "Phone", "Email", "Address", "GSTIN", "Tally ledger", "Active", "Notes"],
        ...(data ?? []).map((f) => [s(f.name), s(f.city), s(f.contact_name), s(f.phone), s(f.email), s(f.address), s(f.gstin), s(f.tally_ledger), f.active ? "Yes" : "No", s(f.notes)]),
      ] });
    } else if (key === "inquiries") {
      const { data, error: e } = await supabase.from("inquiries")
        .select("inquiry_no, buyer_id, prospect, contact_name, contact, country, product, est_qty, unit, target_price, quoted_price, status, lost_reason, next_follow_up, merchandiser_id, created_at, from_site")
        .eq("company_id", company).order("created_at");
      fail(e);
      sheets.push({ name: "Inquiries", rows: [
        ["No.", "Buyer", "Contact", "Email or phone", "Country", "Product", "Quantity", "Unit", ...(prices ? ["Target price", "Quoted price"] : []),
          "Status", "Lost because", "Next follow-up", "Merchandiser", "Came in", "From the website"],
        ...(data ?? []).map((i) => [s(i.inquiry_no), buyer.get(i.buyer_id) ?? s(i.prospect), s(i.contact_name), s(i.contact), s(i.country), s(i.product), n(i.est_qty), s(i.unit),
          ...(prices ? [n(i.target_price), n(i.quoted_price)] : []), human(i.status), s(i.lost_reason), d(i.next_follow_up), person.get(i.merchandiser_id) ?? null,
          d(i.created_at), i.from_site ? "Yes" : null]),
      ] });
    } else if (key === "money" && can(me, "money")) {
      const [inv, cn, chq] = await Promise.all([
        fetchAll<Row>((a, z) => supabase.from("invoices").select("id, invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes, cancelled_at")
          .eq("company_id", company).order("invoice_date").order("id").range(a, z)),
        fetchAll<Row>((a, z) => supabase.from("credit_notes").select("credit_note_no, invoice_id, note_date, amount, notes, cancelled_at")
          .eq("company_id", company).order("note_date").order("id").range(a, z)),
        fetchAll<Row>((a, z) => supabase.from("cheques").select("cheque_no, buyer_id, bank, cheque_date, amount, status, received_on, deposited_on, cleared_on, bounced_on, notes")
          .eq("company_id", company).order("cheque_date").order("id").range(a, z)),
      ]);
      fail(inv.error); fail(cn.error); fail(chq.error);
      const invNo = new Map(inv.data.map((i) => [i.id as string, i.invoice_no as string]));
      sheets.push({ name: "Invoices", rows: [
        ["Invoice", "Buyer", "Date", "Amount", "Due", "Order", "Cancelled", "Notes"],
        ...inv.data.map((i) => [s(i.invoice_no), buyer.get(i.buyer_id as string) ?? null, d(i.invoice_date), n(i.amount), d(i.due_date), orderNo(i.order_id), d(i.cancelled_at), s(i.notes)]),
      ] });
      sheets.push({ name: "Credit notes", rows: [
        ["Credit note", "Against invoice", "Date", "Amount", "Cancelled", "Notes"],
        ...cn.data.map((c) => [s(c.credit_note_no), invNo.get(c.invoice_id as string) ?? null, d(c.note_date), n(c.amount), d(c.cancelled_at), s(c.notes)]),
      ] });
      sheets.push({ name: "Cheques", rows: [
        ["Cheque", "Buyer", "Bank", "Cheque date", "Amount", "Status", "Received", "Deposited", "Cleared", "Bounced", "Notes"],
        ...chq.data.map((c) => [s(c.cheque_no), buyer.get(c.buyer_id as string) ?? null, s(c.bank), d(c.cheque_date), n(c.amount), human(c.status), d(c.received_on),
          d(c.deposited_on), d(c.cleared_on), d(c.bounced_on), s(c.notes)]),
      ] });
    }
  }
  return { sheets, error };
}
