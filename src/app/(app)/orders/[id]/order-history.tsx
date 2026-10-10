import { loadFactories, loadTeam } from "@/lib/data";
import { day, qcKindLabel, stageLabel, STATUS, TNA_STEPS } from "@/lib/format";
import { personName } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";

type Row = { id: number; table_name: string; action: string; actor: string | null; at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

const ORDER_FIELDS: Record<string, string> = {
  buyer_po: "buyer PO", po_date: "PO date", ship_date: "ship date", status: "status", merchandiser_id: "merchandiser", notes: "notes", buyer_id: "buyer",
  stage: "stage", revised_ship_date: "new ship date", delay_reason: "reason for delay",
};
const LINE_FIELDS: Record<string, string> = {
  style: "style", description: "description", colour: "colour", qty: "quantity", buyer_rate: "buyer rate", factory_id: "factory", factory_rate: "factory rate",
};

const time = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Every change to this order and its styles, newest first, from the permanent history.
export async function OrderHistory({ orderId }: { orderId: string }) {
  const supabase = await createClient();
  const [{ data }, team, factories, { data: styleRows }] = await Promise.all([
    supabase
      .from("history")
      .select("id, table_name, action, actor, at, before, after")
      .or(`and(table_name.eq.orders,row_id.eq.${orderId}),after->>order_id.eq.${orderId},before->>order_id.eq.${orderId}`)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
    loadTeam(),
    loadFactories(),
    supabase.from("order_lines").select("id, style").eq("order_id", orderId),
  ]);
  const styleName = new Map((styleRows ?? []).map((l) => [l.id, l.style]));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));

  const show = (k: string, v: unknown) => {
    if (k === "stage") return stageLabel(v == null ? null : String(v));
    if (v == null || v === "") return "blank";
    if (k === "factory_id") return factoryName.get(String(v)) ?? "a factory";
    if (k === "merchandiser_id") return people.get(String(v)) ?? "someone";
    if (k === "status") return STATUS[String(v)]?.label ?? String(v);
    if (k.endsWith("_date")) return day(String(v));
    return String(v);
  };

  const describe = (r: Row) => {
    if (r.table_name === "qc_checks") {
      const c = (r.after ?? r.before) as { kind?: string; result?: string; cancel_reason?: string };
      const what = `${qcKindLabel(c.kind ?? "").toLowerCase()} QC`;
      if (r.action === "insert") return `Recorded ${what}: ${c.result === "pass" ? "Pass" : "Fail"}`;
      if (r.after?.cancelled_at && !r.before?.cancelled_at) return `Cancelled a ${what} (${c.cancel_reason})`;
      return null;
    }
    if (r.table_name === "line_stages") {
      const b = r.before ?? {}, a = r.after ?? {};
      const step = TNA_STEPS.find((s) => s.key === a.stage)?.label ?? String(a.stage);
      const what = `${styleName.get(String(a.line_id)) ?? "a style"} ${step.toLowerCase()}`;
      if (a.not_needed && !b.not_needed) return `Marked ${what} not needed`;
      const parts = [["planned_on", "plan"], ["done_on", "done"]]
        .filter(([k]) => (b[k] ?? null) !== (a[k] ?? null))
        .map(([k, label]) => `${label} ${a[k] ? day(String(a[k])) : "cleared"}`);
      return parts.length ? `Set ${what}: ${parts.join(", ")}` : null;
    }
    if (r.table_name === "factory_pos") {
      const b = r.before ?? {}, a = r.after ?? {};
      const factory = factoryName.get(String(a.factory_id)) ?? "a factory";
      if (a.released_at && !b.released_at) return a.note ? `${factory}'s PO counted as released (${a.note})` : `Released the PO to ${factory}`;
      if (a.plan_requested_on && a.plan_requested_on !== b.plan_requested_on) return `Asked ${factory} for its plan`;
      return null;
    }
    const isOrder = r.table_name === "orders";
    const style = String((r.after ?? r.before)?.style ?? "");
    if (r.action === "insert") return isOrder ? "Entered the order" : `Added style ${style}`;
    if (r.action === "delete") return isOrder ? "Deleted the order" : `Removed style ${style}`;
    if (!isOrder && r.after?.removed_at && !r.before?.removed_at) return `Removed style ${style}`;
    if (!isOrder && r.after?.photo_path !== r.before?.photo_path) return `${r.before?.photo_path ? "Changed" : "Added"} the photo of ${style}`;
    const fields = isOrder ? ORDER_FIELDS : LINE_FIELDS;
    const changes = Object.entries(fields)
      .filter(([k]) => JSON.stringify(r.before?.[k] ?? null) !== JSON.stringify(r.after?.[k] ?? null))
      .map(([k, label]) => `${label} from ${show(k, r.before?.[k])} to ${show(k, r.after?.[k])}`);
    if (!changes.length) return null;
    return `${isOrder ? "Changed" : `Changed ${style}:`} ${changes.join("; ")}`;
  };

  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, text: describe(r) })).filter((r) => r.text);
  if (!rows.length) return null;

  return (
    <details className="panel">
      <summary className="cursor-pointer font-bold">Change history ({rows.length})</summary>
      <ul className="mt-3 flex flex-col gap-2 text-[13px]">
        {rows.map((r) => (
          <li key={r.id} className="border-l-2 border-line pl-3">
            <span className="muted text-xs">{time.format(new Date(r.at))} · {r.actor ? people.get(r.actor) ?? "Someone" : "System"}</span>
            <div>{r.text}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}
