import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { loadBuyers } from "@/lib/data";
import { qty } from "@/lib/format";
import type { PoReading } from "@/lib/po-reader";
import { createClient } from "@/lib/supabase/server";
import { AddPo } from "./add-po";
import { STATE } from "./state";

// Reading files can take a minute or two after an upload.
export const maxDuration = 300;

const TABS = [
  { key: "to_check", label: "To check" },
  { key: "added", label: "Added" },
  { key: "not_po", label: "Set aside" },
];


const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function IncomingPosPage({ searchParams }: PageProps<"/pos">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.show) ? String(sp.show) : "to_check";
  const supabase = await createClient();
  const [{ data, error }, buyers] = await Promise.all([
    supabase.from("incoming_pos")
      .select("id, source, email_from, email_subject, received_at, files, status, read, read_error, buyer_id, buyer_po, matched_order_id, order_id, created_by, orders!incoming_pos_order_fkey(order_no), matched:orders!incoming_pos_matched_fkey(order_no)")
      .eq("company_id", me.companyId).order("received_at", { ascending: false }).limit(300),
    loadBuyers(),
  ]);
  const code = new Map(buyers.map((b) => [b.id, b.code]));
  const all = data ?? [];
  const inTab = (s: string) => (tab === "to_check" ? ["receiving", "reading", "to_check", "failed"].includes(s) : s === tab);
  const rows = all.filter((r) => inTab(r.status));
  const count = (k: string) => all.filter((r) => (k === "to_check" ? ["receiving", "reading", "to_check", "failed"].includes(r.status) : r.status === k)).length;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Incoming POs</h1>
          <p>Buyer POs picked up from email, or added from a file. The AI reads each one into a draft; check it and add it as an order.</p>
        </div>
      </div>

      {!(process.env.SUPABASE_SECRET_KEY && (process.env.ANTHROPIC_API_KEY || process.env.PO_READER_MOCK === "1")) && (
        <div className="errbox">PO reading isn&apos;t switched on yet: the app&apos;s server key and AI key still need to be added. Files you add wait here until then.</div>
      )}

      <AddPo companyId={me.companyId} />

      <div className="filters">
        {TABS.map((t) => (
          <Link key={t.key} className="pill" href={t.key === "to_check" ? "/pos" : `/pos?show=${t.key}`} aria-current={tab === t.key ? "page" : undefined}>
            {t.label} {count(t.key)}
          </Link>
        ))}
      </div>

      {error && <div className="errbox">{error.message}</div>}

      {rows.length === 0 ? (
        <div className="empty">
          <b>{tab === "to_check" ? "Nothing to check" : "Nothing here yet"}</b>
          {tab === "to_check" && "New buyer POs from email show up here on their own. Add one from WhatsApp with Choose PO file."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const read = (r.read ?? {}) as Partial<PoReading>;
            const lines = read.lines ?? [];
            const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as { order_no: string } | null;
            const matched = (Array.isArray(r.matched) ? r.matched[0] : r.matched) as { order_no: string } | null;
            const s = STATE[r.status];
            return (
              <li key={r.id}>
                <Link href={`/pos/${r.id}`} className="panel flex flex-col gap-1 !p-3.5" aria-label={`Incoming PO ${r.buyer_po ?? r.email_subject ?? ""}`}>
                  <div className="row justify-between">
                    <b>{r.buyer_po ?? (r.status === "reading" || r.status === "receiving" ? "Reading…" : "PO number not found")}
                      {" "}<span className="code muted font-normal">{r.buyer_id ? code.get(r.buyer_id) : read.po_number !== undefined ? "Buyer not recognised" : ""}</span></b>
                    <span className={s?.cls}>{s?.label}</span>
                  </div>
                  <div className="muted text-[13px]">
                    {r.source === "email" ? `Email from ${r.email_from ?? "unknown"}` : "Added from a file"} · {when.format(new Date(r.received_at))}
                    {r.email_subject && <> · {r.email_subject}</>}
                  </div>
                  {lines.length > 0 && (
                    <div className="text-[13px]">{lines.length} {lines.length === 1 ? "style" : "styles"} · {qty(lines.reduce((t, l) => t + (l.qty || 0), 0))} pcs</div>
                  )}
                  <div className="row text-[13px]">
                    {order && <span className="chip ok">Order {order.order_no}</span>}
                    {matched && r.status === "to_check" && <span className="chip warn">Already in the system as {matched.order_no}</span>}
                    {(read.doubts?.length ?? 0) > 0 && r.status === "to_check" && <span className="chip warn">{read.doubts!.length} to check</span>}
                    {r.status === "failed" && <span className="text-bad">{r.read_error}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
