import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers } from "@/lib/data";
import { nowMs, qty } from "@/lib/format";
import { poWaitDays, PO_WAIT_DAYS } from "@/lib/order-checks";
import type { PoReading } from "@/lib/po-inbox";
import { comparePo, poNoKey } from "@/lib/po-match";
import { createClient } from "@/lib/supabase/server";
import { AddPo } from "./add-po";
import { AiKey } from "./ai-key";
import { STATE } from "./state";

// Two lists: what still needs checking, and what is done with (made into an order, or set aside). Mail from
// unknown senders is the owner's alone and only shows when there is some.
const ALL_TABS = [
  { key: "to_check", label: "To check", statuses: ["receiving", "reading", "to_check", "failed"] },
  { key: "held", label: "Unknown sender", statuses: ["held"] },
  { key: "done", label: "Done", statuses: ["added", "not_po"] },
];

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// The colour bar on each row: what needs a person first.
const SEV: Record<string, string> = { failed: "bad", to_check: "warn", held: "warn", added: "ok" };

export default async function IncomingPosPage({ searchParams }: PageProps<"/pos">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  // Mail from unknown senders is private: only the owner has that tab.
  const owner = me.role === "owner";
  const shown = sp.show === "added" || sp.show === "not_po" ? "done" : sp.show;
  const tab = ALL_TABS.some((t) => t.key === shown && (t.key !== "held" || owner)) ? String(shown) : "to_check";
  const supabase = await createClient();
  // Each tab reads its own rows and count, so an old PO still to check never drops off behind newer set-aside mail.
  const statuses = (k: string) => ALL_TABS.find((t) => t.key === k)!.statuses;
  const [{ data, error }, buyers, { data: aiKey }, ...counts] = await Promise.all([
    supabase.from("incoming_pos")
      .select("id, source, email_from, email_subject, received_at, files, status, read, read_error, buyer_id, buyer_po, matched_order_id, order_id, created_by, orders!incoming_pos_order_fkey(order_no), matched:orders!incoming_pos_matched_fkey(order_no, buyer_po, order_lines(style, removed_at))")
      .eq("company_id", me.companyId).in("status", statuses(tab)).order("received_at", { ascending: false }).limit(300),
    loadBuyers(),
    supabase.rpc("ai_key_status"),
    ...ALL_TABS.map((t) => supabase.from("incoming_pos").select("id", { count: "exact", head: true }).eq("company_id", me.companyId).in("status", statuses(t.key))),
  ]);
  const nameOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const now = nowMs();
  // Red first: on the To check tab a PO waiting past the flag comes before newer mail.
  const rows = (data ?? []).map((r, i) => ({ r, i, w: tab === "to_check" ? poWaitDays(r.received_at, now) : 0 }))
    .sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.r);
  const count = (k: string) => counts[ALL_TABS.findIndex((t) => t.key === k)]?.count ?? 0;
  const TABS = ALL_TABS.filter((t) => t.key !== "held" || (owner && (count("held") > 0 || tab === "held")));
  const late = tab === "to_check" ? rows.filter((r) => poWaitDays(r.received_at, now) > 0).length : 0;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Buyer POs</h1>
          <p>
            New POs from email land here by themselves. Check each one against its file and it becomes an order.{" "}
            {late > 0 && <b className="text-bad">{late} waiting over {PO_WAIT_DAYS} days.</b>}
          </p>
        </div>
        <div className="head-acts items-start">
          <AddPo companyId={me.companyId} />
        </div>
      </div>

      <section className="card" aria-labelledby="po-h">
        <header className="card-h">
          <h2 id="po-h" className="min-w-0">{tab === "to_check" ? (count("to_check") ? `${count("to_check")} to check` : "Nothing to check") : TABS.find((x) => x.key === tab)?.label}</h2>
          <nav className="seg" aria-label="Show">
            {TABS.map((x) => (
              <Link key={x.key} href={x.key === "to_check" ? "/pos" : `/pos?show=${x.key}`} aria-current={tab === x.key ? "page" : undefined} scroll={false}>
                {x.label} <span>{count(x.key)}</span>
              </Link>
            ))}
          </nav>
        </header>

        {error && <div className="errbox m-4">{error.message}</div>}

        {rows.length === 0 ? (
          <p className="card-empty">
            {tab === "to_check" ? "All checked. New buyer POs from email show up here on their own." : "Nothing here yet."}
            {tab === "to_check" && <> No file for a PO? <Link href="/orders/new" className="link">Type it in as a new order</Link>.</>}
          </p>
        ) : (
          <ul className="todo">
            {rows.map((r) => {
              const read = (r.read ?? {}) as Partial<PoReading>;
              const lines = read.lines ?? [];
              const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as { order_no: string } | null;
              const m = (Array.isArray(r.matched) ? r.matched[0] : r.matched) as { order_no: string; buyer_po: string; order_lines: { style: string; removed_at: string | null }[] | null } | null;
              // The order with this PO number when it was read, if it still has it. Only a shared style makes it the same PO.
              const matched = m && poNoKey(m.buyer_po) === poNoKey(r.buyer_po) ? {
                order_no: m.order_no,
                verdict: comparePo(lines.map((l) => l.style), (m.order_lines ?? []).filter((l) => !l.removed_at).map((l) => l.style)).verdict,
              } : null;
              const s = STATE[r.status];
              const busy = r.status === "reading" || r.status === "receiving";
              const waited = r.status !== "added" && r.status !== "not_po" && r.status !== "held" ? poWaitDays(r.received_at, now) : 0;
              const doubts = r.status === "to_check" ? read.doubts?.length ?? 0 : 0;
              const buyer = r.buyer_id ? nameOf.get(r.buyer_id) : read.po_number !== undefined ? "Buyer not recognised" : "";
              return (
                <li key={r.id}>
                  <span className={`sev ${waited ? "bad" : SEV[r.status] ?? ""}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/pos/${r.id}`} className="todo-title" aria-label={`Buyer PO ${r.buyer_po ?? r.email_subject ?? ""}`}>
                      {r.status === "held" ? <span className="muted">Not read yet · </span>
                        : r.buyer_po ? <span className="code">PO {r.buyer_po}</span> : <span className="muted">{busy ? "Reading… " : "PO number not found · "}</span>}
                      {buyer && <span className={r.buyer_id ? "" : "text-bad"}>{buyer}</span>}
                    </Link>
                    <div className="todo-detail truncate">
                      {[
                        lines.length > 0 ? `${lines.length} ${lines.length === 1 ? "style" : "styles"} · ${qty(lines.reduce((n, l) => n + (l.qty || 0), 0))} pcs` : "",
                        `${r.source === "email" ? `Email from ${r.email_from ?? "unknown"}` : "Added from a file"}, ${when.format(new Date(r.received_at))}`,
                      ].filter(Boolean).join(" · ")}
                    </div>
                    {(order || matched || doubts > 0 || r.status === "failed" || waited > 0) && (
                      <div className="todo-links">
                        {waited > 0 && <span className="chip bad">Waiting {waited} days</span>}
                        {order && <span className="chip ok code">Order {order.order_no}</span>}
                        {matched && r.status === "to_check" && (matched.verdict === "same"
                          ? <span className="chip bad">Already order {matched.order_no}</span>
                          : <span className="chip warn">PO no. also on {matched.order_no}{matched.verdict === "different" ? ", other style" : ""}</span>)}
                        {doubts > 0 && <span className="chip warn">{doubts} {doubts === 1 ? "point" : "points"} to check</span>}
                        {r.status === "failed" && <span className="text-[12.5px] text-bad">{r.read_error}</span>}
                      </div>
                    )}
                  </div>
                  {/* On the To check tab "To check" says nothing new; only reading and failed rows need their state shown. */}
                  {/* Only states worth noticing get a chip: still reading, couldn't read, or set aside. */}
                  <div className="todo-chip">{["reading", "receiving", "failed", "not_po"].includes(r.status) && <span className={s?.cls}>{s?.label}</span>}</div>
                  {/* Like Home's To do: only red rows (waiting too long, or couldn't be read) get the primary button. */}
                  <div className="todo-acts">
                    <Link href={`/pos/${r.id}`} className={`btn sm todo-act ${(r.status === "to_check" && waited > 0) || r.status === "failed" ? "primary" : ""}`}>
                      {r.status === "to_check" || r.status === "failed" ? "Check" : r.status === "held" ? "Accept or ignore" : "Open"}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AiKey owner={me.role === "owner"} status={(aiKey ?? { set: false }) as { set: boolean; last4?: string; set_at?: string }} />
    </>
  );
}
