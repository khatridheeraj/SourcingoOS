import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { day, money, nowMs, qty } from "@/lib/format";
import { buyerOverdue, overdueText, poWaitDays } from "@/lib/order-checks";
import { PO_BUCKET, type StoredFile } from "@/lib/po-files";
import type { PoReading } from "@/lib/po-inbox";
import { createClient } from "@/lib/supabase/server";
import type { LineInput } from "../../orders/actions";
import { OrderForm } from "../../orders/order-form";
import { formOptions } from "../../orders/options";
import { STATE } from "../state";
import { HeldSender } from "./held-sender";
import { NewBuyer } from "./new-buyer";
import { PoActions } from "./po-actions";
import { ToInquiry } from "./to-inquiry";
import { suggestBuyerCode } from "@/lib/names";

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function IncomingPoPage({ params, searchParams }: PageProps<"/pos/[id]">) {
  const { id } = await params;
  const { buyer: added } = await searchParams;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const supabase = await createClient();
  const { data: po } = await supabase.from("incoming_pos")
    .select("id, source, email_from, email_subject, email_body, received_at, files, status, read, read_error, read_at, updated_at, buyer_id, buyer_po, matched_order_id, order_id, orders!incoming_pos_order_fkey(order_no), matched:orders!incoming_pos_matched_fkey(order_no)")
    .eq("id", id).maybeSingle();
  if (!po) notFound();

  const files = (po.files ?? []) as StoredFile[];
  const owner = me?.role === "owner";
  const [{ data: signed }, o, { data: buyerName }, { data: inquiry }] = await Promise.all([
    files.length ? supabase.storage.from(PO_BUCKET).createSignedUrls(files.map((f) => f.path), 3600) : Promise.resolve({ data: [] }),
    formOptions({ buyerId: po.buyer_id ?? undefined }),
    owner ? supabase.rpc("incoming_po_buyer_name", { p_id: id }) : Promise.resolve({ data: null }),
    supabase.from("inquiries").select("id, inquiry_no").eq("incoming_po_id", id).maybeSingle(),
  ]);
  const newBuyerId = typeof added === "string" && o.buyers.some((b) => b.id === added) ? added : "";
  const buyerId = po.buyer_id ?? newBuyerId;
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const read = (po.read ?? {}) as Partial<PoReading>;
  const lines = read.lines ?? [];
  const order = (Array.isArray(po.orders) ? po.orders[0] : po.orders) as { order_no: string } | null;
  const matched = (Array.isArray(po.matched) ? po.matched[0] : po.matched) as { order_no: string } | null;
  const s = STATE[po.status];
  const stuck = (po.status === "reading" || po.status === "receiving") && nowMs() - Date.parse(po.updated_at) > 5 * 60_000;
  const canReread = po.status === "failed" || po.status === "to_check" || po.status === "not_po" || stuck;
  const checking = po.status === "to_check" || po.status === "failed";

  const initialLines: LineInput[] = lines.map((l) => ({
    style: l.style,
    description: [l.description, l.sizes].filter(Boolean).join(" · "),
    colour: l.colour ?? "",
    qty: l.qty ? String(l.qty) : "",
    buyer_rate: l.rate != null ? String(l.rate) : "",
    factory_id: "",
    factory_rate: "",
  }));

  const pcs = lines.reduce((t, l) => t + (l.qty || 0), 0);
  const priced = lines.length > 0 && lines.every((l) => l.rate != null);
  const buyerLabel = buyerId ? o.buyers.find((b) => b.id === buyerId)?.label ?? "" : "";
  const overdue = checking && buyerId ? await buyerOverdue(supabase, buyerId) : null;
  const waited = checking || po.status === "reading" || po.status === "receiving" ? poWaitDays(po.received_at, nowMs()) : 0;
  const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const points = checking ? [
    ...(overdue ? [{ cls: "warn", body: <>{overdueText(buyerLabel, overdue)}</> }] : []),
    ...(matched ? [{ cls: "bad", body: <>This PO number is already order <Link href={`/orders/${po.matched_order_id}`} className="link code">{matched.order_no}</Link>. If this is a revision, update that order, then set this one aside.</> }] : []),
    ...(!buyerId && po.status === "to_check" ? [{
      cls: "bad", body: <>
        Buyer not recognised{owner && buyerName ? `: the PO says "${buyerName}"` : ""}. {owner ? "Pick the right one in the form, or add it as a new buyer." : "Pick the buyer in the form, or ask the owner to add a new buyer."}
        {owner && <div className="mt-2"><NewBuyer name={(buyerName as string | null) ?? ""} code={suggestBuyerCode((buyerName as string | null) ?? "", o.buyers.map((b) => b.code))} /></div>}
      </>,
    }] : []),
    ...(read.doubts ?? []).map((d) => ({ cls: "warn", body: <>{d}</> })),
    ...(read.notes ? [{ cls: "", body: <>Notes on the PO: {read.notes}</> }] : []),
  ] : [];

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/pos">Incoming POs</Link></nav>
          <h1>{po.buyer_po ? <>PO {po.buyer_po}</> : po.email_subject ?? "Incoming PO"}{buyerLabel && <span className="muted font-normal"> · {buyerLabel}</span>}</h1>
          <p className="row">
            <span className={s?.cls}>{s?.label}</span>
            <span>{po.source === "email" ? `Email from ${po.email_from ?? "unknown"}` : "Added from a file"} · {when.format(new Date(po.received_at))}</span>
            {waited > 0 && <span className="chip bad">Waiting {waited} days</span>}
          </p>
        </div>
        <div className="row">
          {!inquiry && po.source === "email" && po.status !== "added" && (po.status !== "held" || owner) && <ToInquiry id={po.id} />}
          {po.status !== "held" && <PoActions id={po.id} status={po.status} canReread={canReread} />}
        </div>
      </div>

      {inquiry && (
        <div className="okbox">This email is inquiry <Link href={`/inquiries/${inquiry.id}`} className="link code">{inquiry.inquiry_no}</Link>. Follow it up there.</div>
      )}

      {po.status === "held" && (
        <HeldSender id={po.id} from={po.email_from ?? ""} buyers={o.buyers.map((b) => ({ id: b.id, label: b.label }))} />
      )}

      {lines.length > 0 && (
        <div className="kpis">
          <div className="kpi"><span className="kpi-label"><i aria-hidden />Styles read</span><b className="num">{lines.length}</b><small>Check each line against the file</small></div>
          <div className="kpi"><span className="kpi-label"><i aria-hidden />Pieces</span><b className="num">{qty(pcs)}</b><small>{priced ? "Every line has a rate" : "Some lines have no rate"}</small></div>
          <div className="kpi"><span className="kpi-label"><i aria-hidden />Value</span><b className="num">{priced ? money(lines.reduce((t, l) => t + l.qty * (l.rate ?? 0), 0)) : "–"}</b><small>At the buyer&apos;s rates</small></div>
          <div className="kpi"><span className="kpi-label"><i aria-hidden />Ships</span><b className="num">{read.ship_date ? day(read.ship_date).replace(/ \d{4}$/, "") : "–"}</b>
            <small>{[read.ship_date?.slice(0, 4), read.po_date ? `PO dated ${day(read.po_date)}` : "No PO date found"].filter(Boolean).join(" · ")}</small></div>
        </div>
      )}

      {(po.status === "reading" || po.status === "receiving") && (
        <div className="empty"><b>Reading this PO</b>{stuck ? "This is taking too long. Use Read again." : "Reload in a minute."}</div>
      )}
      {po.status === "failed" && <div className="errbox">Couldn&apos;t read this PO: {po.read_error} You can still type it in below, or use Read again.</div>}
      {po.status === "added" && order && (
        <div className="okbox"><b>Added as order <Link href={`/orders/${po.order_id}`} className="link code">{order.order_no}</Link>.</b></div>
      )}
      {po.status === "not_po" && <div className="empty"><b>Set aside</b>No new buyer PO was found here, or someone set it aside. Put it back if it is one.</div>}

      <div className={points.length ? "home" : ""}>
        {points.length > 0 && (
          <section className="card" aria-labelledby="check-h">
            <header className="card-h">
              <div className="min-w-0">
                <h2 id="check-h">Check before adding</h2>
                <p>Sort these out in the form below, then add the order.</p>
              </div>
              <span className="chip warn">{points.length} {points.length === 1 ? "point" : "points"}</span>
            </header>
            <ul className="todo">
              {points.map((pt, i) => (
                <li key={i} className="!grid-cols-[3px_minmax(0,1fr)]">
                  <span className={`sev ${pt.cls}`} aria-hidden />
                  <div className={`text-[13.5px] ${pt.cls === "bad" ? "text-bad" : ""}`}>{pt.body}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="card" aria-labelledby="in-h">
          <header className="card-h">
            <div className="min-w-0">
              <h2 id="in-h">What came in</h2>
              {po.email_subject && <p>{po.email_subject}</p>}
            </div>
            <span className="chip">{files.length} {files.length === 1 ? "file" : "files"}</span>
          </header>
          <ul className="rows">
            {files.map((f) => (
              <li key={f.path} className="tidy-row">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-[13.5px]">{f.name}</div>
                  <div className="muted text-xs">{f.name.split(".").pop()?.toUpperCase()} · {size(f.size)}</div>
                </div>
                <a href={urlOf.get(f.path) ?? "#"} target="_blank" rel="noreferrer" className="btn sm">Open file</a>
              </li>
            ))}
            {files.length === 0 && <li className="tidy-row muted text-[13px]">No files.</li>}
          </ul>
          {po.email_body && (
            <details className="border-t border-line px-[18px] py-3">
              <summary className="cursor-pointer text-[12.5px] font-semibold text-accent">Email text</summary>
              <p className="muted mt-2 whitespace-pre-line text-[13px]">{po.email_body}</p>
            </details>
          )}
        </section>
      </div>

      {checking && !matched && (
        o.buyers.length === 0 ? (
          <div className="empty"><b>No buyers yet</b>Add buyers first in <Link href="/buyers" className="link">Buyers</Link>.</div>
        ) : (
          <OrderForm
            key={buyerId}
            incomingId={po.id}
            initial={{
              buyer_id: buyerId, buyer_po: po.buyer_po ?? "", po_date: read.po_date ?? "", ship_date: read.ship_date ?? "",
              status: "open", merchandiser_id: o.meId, notes: read.notes ?? "", buyer_terms: "",
            }}
            initialLines={initialLines}
            buyers={o.buyers}
            factories={o.factories}
            team={o.team}
            overdueShown={overdue ? buyerId : undefined}
          />
        )
      )}
    </>
  );
}
