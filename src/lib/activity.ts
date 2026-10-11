import { day, money } from "@/lib/format";

// One entry of the permanent history (public.history).
export type Entry = {
  id: number; table_name: string; row_id: string; action: "insert" | "update" | "delete"; actor: string | null; source: string; at: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};
export const ENTRY_COLUMNS = "id, table_name, row_id, action, actor, source, at, before, after";

// Names for the ids an entry carries, so it reads in words.
export type Names = { people: Map<string, string>; buyers: Map<string, string>; factories: Map<string, string>; orders: Map<string, string> };

export const AREAS: Record<string, { label: string; tables: string[] }> = {
  orders: { label: "Orders and TNA", tables: ["orders", "order_lines", "line_stages", "factory_pos"] },
  quality: { label: "Quality checks", tables: ["qc_checks", "qc_photos", "qc_comments"] },
  dispatch: { label: "Dispatch", tables: ["dispatches", "dispatch_lines", "dispatch_photos"] },
  pos: { label: "Incoming POs", tables: ["incoming_pos"] },
  payments: { label: "Payments", tables: ["invoices", "credit_notes", "cheques", "cheque_allocations"] },
  masters: { label: "Buyers and factories", tables: ["buyers", "buyer_names", "factories"] },
  team: { label: "Team and settings", tables: ["companies", "profiles", "members", "invites", "inbound_keys", "ai_keys"] },
  tally: { label: "Tally", tables: ["tally_settings", "tally_vouchers"] },
};
const KNOWN = Object.values(AREAS).flatMap((a) => a.tables);
export const OTHER_AREA = { key: "other", label: "Anything else", known: KNOWN };

const TABLE: Record<string, string> = {
  orders: "order", order_lines: "style", line_stages: "TNA step", factory_pos: "factory PO",
  qc_checks: "QC check", qc_photos: "QC photo", qc_comments: "QC comment",
  dispatches: "dispatch", dispatch_lines: "dispatch quantity", dispatch_photos: "dispatch photo",
  incoming_pos: "incoming PO", invoices: "invoice", credit_notes: "credit note", cheques: "cheque", cheque_allocations: "cheque against invoice",
  buyers: "buyer", buyer_names: "buyer's real name", factories: "factory",
  companies: "company", profiles: "person's details", members: "team member", invites: "invite", inbound_keys: "PO pickup key", ai_keys: "AI key",
  tally_settings: "Tally settings", tally_vouchers: "Tally voucher",
};
export const tableLabel = (t: string) => TABLE[t] ?? t.replace(/_/g, " ");

// Where a change came from, when it wasn't a person using the app.
export function sourceLabel(e: Pick<Entry, "source" | "table_name">) {
  if (e.source === "app") return null;
  if (e.source === "key") return e.table_name.startsWith("tally_") ? "Tally reader" : e.table_name === "incoming_pos" ? "PO pickup" : "Access key";
  if (e.source === "server") return e.table_name === "incoming_pos" ? "PO reader" : "Automatic job";
  if (e.source === "database") return "Admin or import";
  return e.source.charAt(0).toUpperCase() + e.source.slice(1);
}

export function who(e: Entry, n: Names) {
  if (e.actor) return n.people.get(e.actor) ?? "Former member";
  return sourceLabel(e) ?? "System";
}

// Columns that are bookkeeping, not something a person changed.
const QUIET = new Set(["id", "company_id", "created_at", "updated_at", "created_by", "seen_at", "agent_seen_at", "agent_info", "snapshot_at", "snapshot_counts", "position"]);

const FIELD: Record<string, string> = {
  order_no: "order no.", buyer_po: "buyer PO", po_date: "PO date", ship_date: "ship date", revised_ship_date: "new ship date", delay_reason: "reason for delay",
  merchandiser_id: "merchandiser", buyer_id: "buyer", factory_id: "factory", order_id: "order", line_id: "style", user_id: "person",
  qty: "quantity", buyer_rate: "buyer rate", factory_rate: "factory rate", purchase_rate: "purchase rate", sale_rate: "sale rate",
  real_name: "real name", full_name: "name", current_company_id: "company in use", grn_days: "GRN days", credit_days: "credit days",
  planned_on: "target", done_on: "done", factory_on: "factory date", not_needed: "not needed", removed_at: "removed", cancelled_at: "cancelled",
  cancel_reason: "reason for cancelling", api_key: "key", key_hash: "key", closed_at: "closed", closed_by: "closed by", set_by: "set by",
  email_from: "email from", email_subject: "email subject", email_body: "email text", matched_order_id: "matched order", vdate: "voucher date",
};
export const fieldLabel = (k: string) => FIELD[k] ?? k.replace(/_id$/, "").replace(/_/g, " ");

export function fmtValue(k: string, v: unknown, n: Names): string {
  if (v == null || v === "") return "blank";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (k === "buyer_id") return n.buyers.get(s) ?? "a buyer";
  if (k === "factory_id") return n.factories.get(s) ?? "a factory";
  if (k === "order_id" || k === "matched_order_id") return n.orders.get(s) ?? "an order";
  if (k === "merchandiser_id" || k === "user_id" || k === "closed_by" || k === "set_by" || k === "actor") return n.people.get(s) ?? "someone";
  if (/(^|_)(rate|amount|value|balance)$/.test(k) && !isNaN(Number(v))) return money(Number(v));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return day(s);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return when(s);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

const stamp = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const when = (at: string) => stamp.format(new Date(at));

// What the record is called: its number or name where it has one.
export function recordName(e: Entry, n: Names) {
  const r = (e.after ?? e.before ?? {}) as Record<string, unknown>;
  for (const k of ["order_no", "invoice_no", "credit_note_no", "cheque_no", "number", "code", "style", "name", "full_name", "email", "label", "email_subject"]) {
    if (r[k]) return String(r[k]);
  }
  if (r.order_id && n.orders.has(String(r.order_id))) return n.orders.get(String(r.order_id))!;
  if (r.buyer_id && n.buyers.has(String(r.buyer_id))) return n.buyers.get(String(r.buyer_id))!;
  if (r.user_id && n.people.has(String(r.user_id))) return n.people.get(String(r.user_id))!;
  return "";
}

export function hrefFor(e: Entry) {
  const r = (e.after ?? e.before ?? {}) as Record<string, unknown>;
  if (e.table_name === "orders") return `/orders/${e.row_id}`;
  if (r.order_id) return `/orders/${r.order_id}`;
  if (e.table_name === "invoices") return `/payments/invoices/${e.row_id}`;
  if (e.table_name === "cheques") return `/payments/cheques/${e.row_id}`;
  if (e.table_name === "incoming_pos") return `/pos/${e.row_id}`;
  return null;
}

export type Change = { field: string; label: string; from: string; to: string };

export function describe(e: Entry, n: Names) {
  const a = (e.after ?? {}) as Record<string, unknown>;
  const b = (e.before ?? {}) as Record<string, unknown>;
  const thing = tableLabel(e.table_name);
  const name = recordName(e, n);
  const verb = e.action === "insert" ? "Added" : e.action === "delete" ? "Deleted"
    : a.cancelled_at && !b.cancelled_at ? "Cancelled" : a.removed_at && !b.removed_at ? "Removed" : "Changed";
  const changes: Change[] = e.action === "update"
    ? Object.keys({ ...b, ...a })
        .filter((k) => !QUIET.has(k) && JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
        .map((k) => ({ field: k, label: fieldLabel(k), from: fmtValue(k, b[k], n), to: fmtValue(k, a[k], n) }))
    : [];
  const fields = e.action === "update" ? [] : Object.entries(e.after ?? e.before ?? {})
    .filter(([k, v]) => !QUIET.has(k) && v != null && v !== "")
    .map(([k, v]) => ({ label: fieldLabel(k), value: fmtValue(k, v, n) }));
  return { text: `${verb} ${thing}${name ? ` ${name}` : ""}`, changes, fields };
}
