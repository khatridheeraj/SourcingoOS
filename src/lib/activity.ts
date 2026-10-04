// The activity log in plain words. Every change in the database lands in
// audit_log (migration 0020); this turns entries into sentences people read.
import { fmtDateTime } from "@/lib/format";
import { CONDITION_LABEL, DC_LABEL, fmtDay, GRN_LABEL, SAMPLE_LABEL, SO_LABEL, TNA_LABEL, type World } from "@/lib/model";
import { CHEQUE_LABEL } from "@/lib/payments";
import { roleLabel, type Role } from "@/lib/roles";

type Data = Record<string, unknown>;
export type Entry = {
  id: number; at: string; table_name: string; row_id: string | null; action: string;
  old_data: Data | null; new_data: Data | null; actor: string | null; actor_name: string | null; actor_role: string | null;
  source: string | null; changed: string[] | null; refs: string[]; owners: string[]; txid: number | null;
};
export const ENTRY_COLUMNS = "id, at, table_name, row_id, action, old_data, new_data, actor, actor_name, actor_role, source, changed, refs, owners, txid";

// What each table is called, how to name one of its rows, and where it opens.
type TableInfo = { label: string; name?: (d: Data, w: World) => string | undefined; href?: (id: string) => string; quiet?: boolean };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const clip = (s: string | undefined, n = 60) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
const styleName = (d: Data) => [str(d.name), str(d.colour)].filter(Boolean).join(" · ") || undefined;

export const TABLES: Record<string, TableInfo> = {
  sales_orders: { label: "Sales order", name: (d) => [str(d.id), d.buyer_po_number ? `#${d.buyer_po_number}` : ""].filter(Boolean).join(" · "), href: (id) => `/orders/${id}` },
  so_styles: { label: "Style", name: styleName },
  tna_checkpoints: { label: "TNA checkpoint", name: (d) => str(d.name) },
  tna_status_history: { label: "TNA status", quiet: true },
  inquiries: { label: "Inquiry", name: (d) => [str(d.id), str(d.product_type)].filter(Boolean).join(" · "), href: (id) => `/history/inquiries/${id}` },
  inquiry_followups: { label: "Inquiry follow-up", name: (d) => clip(str(d.note)) },
  samples: { label: "Sample", name: (d) => [str(d.id), clip(str(d.description), 40)].filter(Boolean).join(" · "), href: (id) => `/samples/${id}` },
  sample_events: { label: "Sample note", name: (d) => clip(str(d.note) ?? str(d.kind)) },
  received_pos: { label: "Buyer PO", name: (d) => [str(d.id), d.po_number ? `#${d.po_number}` : ""].filter(Boolean).join(" · "), href: (id) => `/pos/${id}` },
  grns: { label: "GRN", name: (d) => str(d.id), href: (id) => `/grn/${id}` },
  grn_lines: { label: "GRN line", name: (d, w) => lineName(d, w) },
  delivery_challans: { label: "Delivery challan", name: (d) => str(d.id), href: (id) => `/dc/${id}` },
  dc_lines: { label: "Challan line", name: (d, w) => lineName(d, w) },
  files: { label: "File", name: (d) => str(d.file_name) },
  invoices: { label: "Invoice", name: (d) => str(d.invoice_no), href: (id) => `/payments/invoices/${id}` },
  credit_notes: { label: "Credit note", name: (d) => str(d.credit_note_no) },
  cheques: { label: "Cheque", name: (d) => (d.cheque_no ? `no. ${d.cheque_no}` : undefined), href: (id) => `/payments/cheques/${id}` },
  cheque_allocations: { label: "Cheque split", name: (d) => (d.amount != null ? `₹${Number(d.amount).toLocaleString("en-IN")}` : undefined) },
  buyers: { label: "Buyer", name: (d) => str(d.code) },
  buyer_registry: { label: "Buyer's real name", name: (d, w) => w.buyerCode(str(d.buyer_id)) },
  factories: { label: "Factory", name: (d) => str(d.name) },
  profiles: { label: "Person", name: (d) => str(d.full_name) ?? str(d.email) },
  reports: { label: "Report" },
};

function lineName(d: Data, w: World) {
  const s = w.styleById.get(String(d.style_id ?? ""));
  return [s ? styleName(s as unknown as Data) : undefined, d.qty != null ? `${Number(d.qty).toLocaleString("en-IN")} units` : undefined].filter(Boolean).join(" · ") || undefined;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "Sales order" → "sales order", but "GRN" and "TNA checkpoint" keep their capitals.
export const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const humanize = (s: string) => {
  const t = s.replace(/_id$/, "").replace(/[_-]/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export const tableLabel = (t: string) => TABLES[t]?.label ?? (t.startsWith("tally_") ? `Tally ${lower(humanize(t.slice(6)))}` : humanize(t));

const FIELDS: Record<string, string> = {
  buyer_po_number: "Buyer PO", so_date: "SO date", buyer_date: "Buyer delivery date", factory_date: "Factory delivery date",
  merch_date: "Merchandiser predicted date", merchandiser_id: "Merchandiser", manager_id: "Manager", fabric_poc_id: "Fabric POC",
  quality_poc_id: "Quality POC", qc_checked: "QC passed", qc_note: "QC note", qty: "Quantity", est_qty: "Estimated quantity",
  budget_inr: "Budget (₹)", so_id: "Sales order", grn_id: "GRN", dc_id: "Delivery challan", style_id: "Style", internal_note: "Internal note",
  sizes: "Size split", use_sizes: "Uses size split", terms: "T&Cs / inspection", real_name: "Real name", next_follow_up: "Next follow-up",
  received_by: "Received by", approved_by: "Approved by", locked_by: "Locked by", created_by: "Created by", uploaded_by: "Uploaded by",
  status_updated_by: "Status updated by", tracking: "Tracking / LR", invoice_no: "Invoice no.", cheque_no: "Cheque no.", po_number: "PO number",
};
export const fieldLabel = (f: string) => FIELDS[f] ?? humanize(f);

const STATUS: Record<string, Record<string, string>> = {
  sales_orders: SO_LABEL, tna_checkpoints: TNA_LABEL, grns: GRN_LABEL, delivery_challans: DC_LABEL, samples: SAMPLE_LABEL, cheques: CHEQUE_LABEL,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Fields not worth a line of their own.
const SKIP = new Set(["id", "created_at", "updated_at", "created_by", "position", "status_updated_at", "tally_guid"]);

// One value, the way the rest of the app shows it. Buyers appear as codes.
export function fmtValue(table: string, field: string, v: unknown, w: World): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtValue(table, field, x, w)).join(", ") : "none";
  if (typeof v === "object") {
    const e = Object.entries(v as Data);
    if (e.length && e.every(([, x]) => typeof x === "number")) return e.map(([k, x]) => `${k} ${(x as number).toLocaleString("en-IN")}`).join(" · ");
    return clip(JSON.stringify(v), 140) ?? "";
  }
  const s = String(v);
  if (field === "status") return STATUS[table]?.[s] ?? humanize(s);
  if (field === "condition") return CONDITION_LABEL[s as keyof typeof CONDITION_LABEL] ?? s;
  if (UUID.test(s)) {
    if (field === "buyer_id" || w.buyerById.has(s)) return w.buyerCode(s);
    if (field === "factory_id" || w.factoryById.has(s)) return w.factoryName(s);
    if (w.personById.has(s)) return w.personName(s);
    const st = w.styleById.get(s);
    if (st) return styleName(st as unknown as Data) ?? "a style";
    return "…" + s.slice(-6);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDay(s);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return fmtDateTime(s);
  return clip(s, 140) ?? "";
}

export type Change = { field: string; label: string; from: string; to: string };
export type Described = { text: string; changes: Change[]; fields: { label: string; value: string }[] };

export function describe(e: Entry, w: World): Described {
  const t = e.table_name;
  const info = TABLES[t];
  const d = (e.new_data ?? e.old_data ?? {}) as Data;
  const label = tableLabel(t);
  const name = info?.name?.(d, w) ?? (e.row_id && !UUID.test(e.row_id) ? e.row_id : undefined);
  const what = `${lower(label)}${name ? ` “${name}”` : ""}`;
  const fields = Object.entries(d)
    .filter(([k, v]) => !SKIP.has(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => ({ label: fieldLabel(k), value: fmtValue(t, k, v, w) }));
  const changes: Change[] = (e.changed ?? []).filter((f) => f !== "updated_at").map((f) => ({
    field: f, label: fieldLabel(f), from: fmtValue(t, f, e.old_data?.[f], w), to: fmtValue(t, f, e.new_data?.[f], w),
  }));

  switch (e.action) {
    case "INSERT": return { text: `Added ${what}`, changes: [], fields };
    case "DELETE": return { text: `Deleted ${what}`, changes: [], fields };
    case "SIGN_IN": return { text: "Signed in", changes: [], fields: [] };
    case "EXPORT": return { text: `Downloaded the ${humanize(e.row_id ?? "").toLowerCase() || "data"} export`, changes: [], fields: [] };
    case "DOWNLOAD": return { text: `Downloaded ${name ?? "a file"}`, changes: [], fields: [] };
    case "PRINT": return { text: `Printed ${what}`, changes: [], fields: [] };
    case "DROP TABLE": return { text: `Removed the ${lower(label)} table from the database`, changes: [], fields: [] };
    case "UPDATE": {
      // A status move leads; the fields that moved with it follow.
      const st = changes.find((c) => c.field === "status");
      if (st) return { text: `${capital(what)}: ${st.from} → ${st.to}`, changes: changes.filter((c) => c !== st), fields };
      return { text: `Changed ${what}`, changes, fields };
    }
    default: return { text: `${humanize(e.action)} ${what}`, changes, fields };
  }
}

const SOURCES: Record<string, string> = {
  app: "In the app", api: "Tally bridge / API key", server: "Automatic job", database: "Database (import or admin)",
};
export const sourceLabel = (s: string | null) => (s ? SOURCES[s] ?? capital(s) : "Unknown");

// Who did it, as they were named at the time.
export function who(e: Entry, w: World) {
  if (!e.actor) return sourceLabel(e.source);
  const name = e.actor === w.meId ? "You" : e.actor_name || w.personName(e.actor);
  return e.actor_role ? `${name} · ${roleLabel(e.actor_role as Role)}` : name;
}

// The screen an entry belongs on: the record itself, else the record it is part of.
export function hrefFor(e: Entry): string | null {
  const direct = e.row_id && TABLES[e.table_name]?.href;
  if (direct && e.action !== "DELETE") return direct(e.row_id!);
  for (const k of [...e.owners, ...e.refs]) {
    const i = k.indexOf(":");
    const t = k.slice(0, i);
    const h = TABLES[t]?.href;
    if (h && t !== "buyers") return h(k.slice(i + 1));
  }
  return e.row_id && TABLES[e.table_name] ? `/history/${e.table_name}/${encodeURIComponent(e.row_id)}` : null;
}

// One save often touches several rows (an order and its styles): show them together.
export type Group = { key: string; at: string; entries: Entry[] };
export function groupEntries(entries: Entry[]): Group[] {
  const out: Group[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    const same = last && e.txid != null && last.entries[0].txid === e.txid && last.entries[0].actor === e.actor && last.entries[0].source === e.source;
    if (same) last.entries.push(e);
    else out.push({ key: String(e.id), at: e.at, entries: [e] });
  }
  // A mirror row (the TNA status history behind a checkpoint change) adds nothing next to the change itself.
  for (const g of out) {
    const loud = g.entries.filter((e) => !TABLES[e.table_name]?.quiet);
    if (loud.length) g.entries = loud;
  }
  return out;
}

export const ACTIONS: Record<string, string> = {
  INSERT: "Added", UPDATE: "Changed", DELETE: "Deleted", SIGN_IN: "Signed in", EXPORT: "Downloaded",
};

// Areas for filtering the activity screen.
export const AREAS: Record<string, { label: string; tables: string[] }> = {
  orders: { label: "Sales orders & TNA", tables: ["sales_orders", "so_styles", "tna_checkpoints", "tna_status_history"] },
  inquiries: { label: "Inquiries", tables: ["inquiries", "inquiry_followups"] },
  samples: { label: "Samples", tables: ["samples", "sample_events"] },
  pos: { label: "POs received", tables: ["received_pos"] },
  warehouse: { label: "GRN & challans", tables: ["grns", "grn_lines", "delivery_challans", "dc_lines"] },
  payments: { label: "Payments", tables: ["invoices", "credit_notes", "cheques", "cheque_allocations"] },
  masters: { label: "Buyers & factories", tables: ["buyers", "buyer_registry", "factories"] },
  people: { label: "People & sign-ins", tables: ["profiles"] },
  files: { label: "Files", tables: ["files"] },
  reports: { label: "Exports", tables: ["reports", "audit_log"] },
};
