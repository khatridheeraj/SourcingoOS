import { loadTeam, personName } from "@/lib/data";
import { day, money } from "@/lib/format";
import { CHEQUE_LABEL, type ChequeStatus } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

type Row = { id: number; table_name: string; row_id: string; action: string; actor: string | null; at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

const FIELDS: Record<string, Record<string, string>> = {
  invoices: { invoice_no: "number", invoice_date: "date", amount: "amount", due_date: "due date", notes: "notes", buyer_id: "buyer" },
  credit_notes: { credit_note_no: "number", note_date: "date", amount: "amount", notes: "reason" },
  cheques: { cheque_no: "number", cheque_date: "cheque date", amount: "amount", bank: "bank", received_on: "received date", notes: "notes" },
};
const time = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const show = (k: string, v: unknown) => {
  if (v == null || v === "") return "blank";
  if (k === "amount") return money(Number(v));
  if (k.endsWith("_date") || k.endsWith("_on")) return day(String(v));
  return String(v);
};

function describe(r: Row, view: "invoice" | "cheque") {
  const a = r.after ?? {};
  const b = r.before ?? {};
  if (r.table_name === "cheque_allocations") {
    const link = view === "invoice" ? "a cheque and this invoice" : "this cheque and an invoice";
    if (r.action === "insert") return `Set ${money(Number(a.amount))} between ${link}`;
    if (a.removed_at && !b.removed_at) return `Took ${money(Number(b.amount))} off between ${link}`;
    if (a.amount !== b.amount) return `Changed the amount between ${link} from ${money(Number(b.amount))} to ${money(Number(a.amount))}`;
    return null;
  }
  const what = r.table_name === "invoices" ? `invoice ${a.invoice_no ?? b.invoice_no}` : r.table_name === "credit_notes" ? `credit note ${a.credit_note_no ?? b.credit_note_no}` : `cheque ${a.cheque_no ?? b.cheque_no}`;
  if (r.action === "insert") return `Added ${what}${a.amount != null ? ` for ${money(Number(a.amount))}` : ""}`;
  if (a.cancelled_at && !b.cancelled_at) return `Cancelled ${what}`;
  const parts: string[] = [];
  if (r.table_name === "cheques" && a.status !== b.status) parts.push(`marked ${CHEQUE_LABEL[a.status as ChequeStatus].toLowerCase()}`);
  for (const [k, label] of Object.entries(FIELDS[r.table_name] ?? {})) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) parts.push(`${label} from ${show(k, b[k])} to ${show(k, a[k])}`);
  }
  return parts.length ? `Changed ${what}: ${parts.join("; ")}` : null;
}

// Every change to these payment records and the cheques set against them, newest first.
export async function PaymentHistory({ rowIds, view }: { rowIds: string[]; view: "invoice" | "cheque" }) {
  const supabase = await createClient();
  const ids = rowIds.join(",");
  const [{ data }, team] = await Promise.all([
    supabase
      .from("history")
      .select("id, table_name, row_id, action, actor, at, before, after")
      .in("table_name", ["invoices", "credit_notes", "cheques", "cheque_allocations"])
      .or(`row_id.in.(${ids}),after->>invoice_id.in.(${ids}),after->>cheque_id.in.(${ids})`)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
    loadTeam(),
  ]);
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, text: describe(r, view) })).filter((r) => r.text);
  if (!rows.length) return null;
  return (
    <details className="panel">
      <summary className="cursor-pointer font-bold">Change history ({rows.length})</summary>
      <ul className="mt-3 flex flex-col gap-2 text-[13px]">
        {rows.map((r) => (
          <li key={r.id} className="border-l-2 border-line pl-3">
            <span className="muted text-xs">{time.format(new Date(r.at))} · {r.actor ? people.get(r.actor) ?? "Someone" : "Brought over from the old app"}</span>
            <div>{r.text}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}
