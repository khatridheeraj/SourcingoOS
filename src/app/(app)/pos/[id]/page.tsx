import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { day, money, nowMs, qty } from "@/lib/format";
import { PO_BUCKET, type StoredFile } from "@/lib/po-files";
import type { PoReading } from "@/lib/po-reader";
import { createClient } from "@/lib/supabase/server";
import type { LineInput } from "../../orders/actions";
import { OrderForm } from "../../orders/order-form";
import { formOptions } from "../../orders/options";
import { STATE } from "../state";
import { PoActions } from "./po-actions";

// Reading again runs after the click and can take a minute or two.
export const maxDuration = 300;

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function IncomingPoPage({ params }: PageProps<"/pos/[id]">) {
  const { id } = await params;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const supabase = await createClient();
  const { data: po } = await supabase.from("incoming_pos")
    .select("id, source, email_from, email_subject, email_body, received_at, files, status, read, read_error, read_at, updated_at, buyer_id, buyer_po, matched_order_id, order_id, orders!incoming_pos_order_fkey(order_no), matched:orders!incoming_pos_matched_fkey(order_no)")
    .eq("id", id).maybeSingle();
  if (!po) notFound();

  const files = (po.files ?? []) as StoredFile[];
  const owner = me?.role === "owner";
  const [{ data: signed }, o, { data: buyerName }] = await Promise.all([
    files.length ? supabase.storage.from(PO_BUCKET).createSignedUrls(files.map((f) => f.path), 3600) : Promise.resolve({ data: [] }),
    formOptions({ buyerId: po.buyer_id ?? undefined }),
    owner ? supabase.rpc("incoming_po_buyer_name", { p_id: id }) : Promise.resolve({ data: null }),
  ]);
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

  return (
    <>
      <div className="head">
        <div className="grow">
          <Link href="/pos" className="link text-xs">← Incoming POs</Link>
          <h1>{po.buyer_po ?? po.email_subject ?? "Incoming PO"} <span className={s?.cls}>{s?.label}</span></h1>
          <p>{po.source === "email" ? `Email from ${po.email_from ?? "unknown"}` : "Added from a file"} · {when.format(new Date(po.received_at))}</p>
        </div>
      </div>

      <div className="panel">
        <div className="row justify-between">
          <h2>What came in</h2>
          <PoActions id={po.id} status={po.status} canReread={canReread} />
        </div>
        {po.email_subject && <p className="text-[13px]"><b>Subject:</b> {po.email_subject}</p>}
        {po.email_body && <p className="muted mt-1 whitespace-pre-line text-[13px] line-clamp-6">{po.email_body}</p>}
        <div className="row mt-2">
          {files.map((f) => (
            <a key={f.path} href={urlOf.get(f.path) ?? "#"} target="_blank" rel="noreferrer" className="btn sm">{f.name}</a>
          ))}
          {files.length === 0 && <span className="muted text-[13px]">No files.</span>}
        </div>
      </div>

      {(po.status === "reading" || po.status === "receiving") && (
        <div className="empty"><b>The AI is reading this PO</b>{stuck ? "This is taking too long. Use Read again." : "Reload in a minute."}</div>
      )}
      {po.status === "failed" && <div className="errbox">Couldn&apos;t read this PO: {po.read_error} You can still type it in below, or use Read again.</div>}
      {po.status === "added" && order && (
        <div className="panel"><b>Added as order <Link href={`/orders/${po.order_id}`} className="link code">{order.order_no}</Link>.</b></div>
      )}
      {po.status === "not_po" && <div className="empty"><b>Set aside</b>The AI found no new buyer PO here, or someone set it aside. Put it back if it is one.</div>}

      {checking && (read.notes || (read.doubts?.length ?? 0) > 0 || !po.buyer_id || matched) && (
        <div className="panel">
          <h2>Check before adding</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
            {matched && (
              <li className="text-bad">This PO number is already order <Link href={`/orders/${po.matched_order_id}`} className="link code">{matched.order_no}</Link>. If this is a revision, update that order, then set this one aside.</li>
            )}
            {!po.buyer_id && po.status === "to_check" && (
              <li className="text-bad">
                Buyer not recognised{owner && buyerName ? `: the PO says "${buyerName}"` : ""}. {owner ? "Add the buyer in Buyers, or pick the right one below." : "Pick the buyer below, or ask the owner to add a new buyer."}
              </li>
            )}
            {(read.doubts ?? []).map((d, i) => <li key={i} className="text-warn">{d}</li>)}
            {read.notes && <li>Notes on the PO: {read.notes}</li>}
          </ul>
          {lines.length > 0 && (
            <p className="muted mt-2 text-[13px]">
              The AI read {lines.length} {lines.length === 1 ? "style" : "styles"}, {qty(lines.reduce((t, l) => t + (l.qty || 0), 0))} pcs
              {lines.every((l) => l.rate != null) && <>, worth {money(lines.reduce((t, l) => t + l.qty * (l.rate ?? 0), 0))}</>}
              {read.ship_date && <>, shipping {day(read.ship_date)}</>}. Check each line against the file.
            </p>
          )}
        </div>
      )}

      {checking && !matched && (
        o.buyers.length === 0 ? (
          <div className="empty"><b>No buyers yet</b>Add buyers first in <Link href="/buyers" className="link">Buyers</Link>.</div>
        ) : (
          <OrderForm
            incomingId={po.id}
            initial={{
              buyer_id: po.buyer_id ?? "", buyer_po: po.buyer_po ?? "", po_date: read.po_date ?? "", ship_date: read.ship_date ?? "",
              status: "open", merchandiser_id: o.meId, notes: read.notes ?? "",
            }}
            initialLines={initialLines}
            buyers={o.buyers}
            factories={o.factories}
            team={o.team}
          />
        )
      )}
    </>
  );
}
