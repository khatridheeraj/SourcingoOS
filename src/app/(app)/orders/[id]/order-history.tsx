import { loadFactories, loadTeam } from "@/lib/data";
import { day, STATUS } from "@/lib/format";
import { personName } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";

type Row = { id: number; table_name: string; action: string; actor: string | null; at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

const ORDER_FIELDS: Record<string, string> = {
  buyer_po: "buyer PO", po_date: "PO date", ship_date: "ship date", status: "status", merchandiser_id: "merchandiser", notes: "notes", buyer_id: "buyer",
};
const LINE_FIELDS: Record<string, string> = {
  style: "style", description: "description", colour: "colour", qty: "quantity", buyer_rate: "buyer rate", factory_id: "factory", factory_rate: "factory rate",
};

const time = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Every change to this order and its styles, newest first, from the permanent history.
export async function OrderHistory({ orderId }: { orderId: string }) {
  const supabase = await createClient();
  const [{ data }, team, factories] = await Promise.all([
    supabase
      .from("history")
      .select("id, table_name, action, actor, at, before, after")
      .or(`and(table_name.eq.orders,row_id.eq.${orderId}),after->>order_id.eq.${orderId},before->>order_id.eq.${orderId}`)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
    loadTeam(),
    loadFactories(),
  ]);
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));

  const show = (k: string, v: unknown) => {
    if (v == null || v === "") return "blank";
    if (k === "factory_id") return factoryName.get(String(v)) ?? "a factory";
    if (k === "merchandiser_id") return people.get(String(v)) ?? "someone";
    if (k === "status") return STATUS[String(v)]?.label ?? String(v);
    if (k.endsWith("_date")) return day(String(v));
    return String(v);
  };

  const describe = (r: Row) => {
    const isOrder = r.table_name === "orders";
    const style = String((r.after ?? r.before)?.style ?? "");
    if (r.action === "insert") return isOrder ? "Entered the order" : `Added style ${style}`;
    if (r.action === "delete") return isOrder ? "Deleted the order" : `Removed style ${style}`;
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
