import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers } from "@/lib/data";
import { nowMs, qty } from "@/lib/format";
import { poWaitDays, PO_WAIT_DAYS } from "@/lib/order-checks";
import type { PoReading } from "@/lib/po-inbox";
import { createClient } from "@/lib/supabase/server";
import { AddPo } from "./add-po";
import { AiKey } from "./ai-key";
import { STATE } from "./state";

const ALL_TABS = [
  { key: "to_check", label: "To check", hint: `Read into drafts. Check each against its file and add it as an order. A PO not added within ${PO_WAIT_DAYS} days is flagged.` },
  { key: "held", label: "Unknown sender", hint: "Emails from senders no buyer is known by. Only you see these. Accept or ignore each one." },
  { key: "added", label: "Added", hint: "POs that became orders." },
  { key: "not_po", label: "Set aside", hint: "Emails with no new buyer PO, or set aside by the team. Put one back if it is a PO." },
];

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// The colour bar on each row: what needs a person first.
const SEV: Record<string, string> = { failed: "bad", to_check: "warn", held: "warn", added: "ok" };

export default async function IncomingPosPage({ searchParams }: PageProps<"/pos">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  // Mail from unknown senders is private: only the owner has that tab.
  const TABS = ALL_TABS.filter((t) => t.key !== "held" || me.role === "owner");
  const tab = TABS.some((t) => t.key === sp.show) ? String(sp.show) : "to_check";
  const supabase = await createClient();
  // Each tab reads its own rows and count, so an old PO still to check never drops off behind newer set-aside mail.
  const statuses = (k: string) => (k === "to_check" ? ["receiving", "reading", "to_check", "failed"] : [k]);
  const [{ data, error }, buyers, { data: aiKey }, ...counts] = await Promise.all([
    supabase.from("incoming_pos")
      .select("id, source, email_from, email_subject, received_at, files, status, read, read_error, buyer_id, buyer_po, matched_order_id, order_id, created_by, orders!incoming_pos_order_fkey(order_no), matched:orders!incoming_pos_matched_fkey(order_no)")
      .eq("company_id", me.companyId).in("status", statuses(tab)).order("received_at", { ascending: false }).limit(300),
    loadBuyers(),
    supabase.rpc("ai_key_status"),
    ...TABS.map((t) => supabase.from("incoming_pos").select("id", { count: "exact", head: true }).eq("company_id", me.companyId).in("status", statuses(t.key))),
  ]);
  const nameOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const rows = data ?? [];
  const count = (k: string) => counts[TABS.findIndex((t) => t.key === k)]?.count ?? 0;
  const t = TABS.find((x) => x.key === tab)!;
  const now = nowMs();
  const late = tab === "to_check" ? rows.filter((r) => poWaitDays(r.received_at, now) > 0).length : 0;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Incoming POs</h1>
          <p>
            Buyer POs picked up from email or added from a file.{" "}
            {count("to_check") ? <b className="text-warn">{count("to_check")} to check</b> : <b className="text-ok">Nothing to check</b>}
            {late > 0 && <> · <b className="text-bad">{late} waiting over {PO_WAIT_DAYS} days</b></>}
            {count("held") > 0 && <> · <Link href="/pos?show=held" className="link font-semibold">{count("held")} from unknown senders</Link></>}
          </p>
        </div>
        <div className="row items-start">
          <Link href="/orders/new" className="btn" title="Type in a PO that has no file: it becomes an order with its own PO PDF">Create PO</Link>
          <AddPo companyId={me.companyId} />
        </div>
      </div>

      <section className="card" aria-labelledby="po-h">
        <header className="card-h">
          <div className="min-w-0">
            <h2 id="po-h">{t.label}</h2>
            <p>{t.hint}</p>
          </div>
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
            {tab === "to_check" ? "Nothing to check. New buyer POs from email show up here on their own; add one from WhatsApp with Add PO from a file." : "Nothing here yet."}
          </p>
        ) : (
          <ul className="todo">
            {rows.map((r) => {
              const read = (r.read ?? {}) as Partial<PoReading>;
              const lines = read.lines ?? [];
              const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as { order_no: string } | null;
              const matched = (Array.isArray(r.matched) ? r.matched[0] : r.matched) as { order_no: string } | null;
              const s = STATE[r.status];
              const busy = r.status === "reading" || r.status === "receiving";
              const waited = r.status !== "added" && r.status !== "not_po" && r.status !== "held" ? poWaitDays(r.received_at, now) : 0;
              const doubts = r.status === "to_check" ? read.doubts?.length ?? 0 : 0;
              const buyer = r.buyer_id ? nameOf.get(r.buyer_id) : read.po_number !== undefined ? "Buyer not recognised" : "";
              return (
                <li key={r.id}>
                  <span className={`sev ${waited ? "bad" : SEV[r.status] ?? ""}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/pos/${r.id}`} className="todo-title" aria-label={`Incoming PO ${r.buyer_po ?? r.email_subject ?? ""}`}>
                      {r.status === "held" ? <span className="muted">Not read yet · </span>
                        : r.buyer_po ? <span className="code">PO {r.buyer_po}</span> : <span className="muted">{busy ? "Reading… " : "PO number not found · "}</span>}
                      {buyer && <span className={r.buyer_id ? "" : "text-bad"}>{buyer}</span>}
                    </Link>
                    <div className="todo-detail truncate">
                      {r.source === "email" ? `Email from ${r.email_from ?? "unknown"}` : "Added from a file"} · {when.format(new Date(r.received_at))}
                      {r.email_subject && <> · {r.email_subject}</>}
                    </div>
                    {(lines.length > 0 || order || matched || doubts > 0 || r.status === "failed" || waited > 0) && (
                      <div className="todo-links">
                        {waited > 0 && <span className="chip bad">Waiting {waited} days</span>}
                        {lines.length > 0 && <span className="chip">{lines.length} {lines.length === 1 ? "style" : "styles"} · {qty(lines.reduce((n, l) => n + (l.qty || 0), 0))} pcs</span>}
                        {order && <span className="chip ok code">{order.order_no}</span>}
                        {matched && r.status === "to_check" && <span className="chip bad">Already order {matched.order_no}</span>}
                        {doubts > 0 && <span className="chip warn">{doubts} {doubts === 1 ? "point" : "points"} to check</span>}
                        {r.status === "failed" && <span className="text-[12.5px] text-bad">{r.read_error}</span>}
                      </div>
                    )}
                  </div>
                  <div className="todo-chip"><span className={s?.cls}>{s?.label}</span></div>
                  <Link href={`/pos/${r.id}`} className="btn sm todo-act">
                    {r.status === "to_check" || r.status === "failed" ? "Check and add" : r.status === "held" ? "Accept or ignore" : "Open"}
                  </Link>
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
