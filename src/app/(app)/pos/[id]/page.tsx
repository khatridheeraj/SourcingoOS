import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { nowMs } from "@/lib/format";
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
import { comparePo, poNoKey } from "@/lib/po-match";
import { PoCompare, type CompareSide } from "./po-compare";

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function IncomingPoPage({ params, searchParams }: PageProps<"/pos/[id]">) {
  const { id } = await params;
  const { buyer: added } = await searchParams;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const supabase = await createClient();
  const { data: po } = await supabase.from("incoming_pos")
    .select("id, source, email_from, email_subject, email_body, received_at, files, status, read, read_error, read_at, updated_at, buyer_id, buyer_po, order_id, orders!incoming_pos_order_fkey(order_no)")
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

  const buyerLabel = buyerId ? o.buyers.find((b) => b.id === buyerId)?.label ?? "" : "";
  // The order that already has this buyer's PO number, looked up now (not when the PO was read), so fixing that
  // order's number clears it here. Its styles are compared with the PO's: the number alone can't say they are one PO.
  const clash = checking && buyerId && po.buyer_po ? await sameNumberOrder(supabase, buyerId, po.buyer_po) : null;
  const verdict = clash ? comparePo(lines.map((l) => l.style), clash.lines.map((l) => l.style)) : null;
  const thisSide: CompareSide = {
    title: "This PO file", po: po.buyer_po ?? "", poDate: read.po_date ?? null, shipDate: read.ship_date ?? null,
    lines: lines.map((l) => ({ style: l.style, description: l.description ?? "", qty: Number(l.qty) || 0, rate: l.rate ?? null })),
  };
  const overdue = checking && buyerId ? await buyerOverdue(supabase, buyerId) : null;
  const waited = checking || po.status === "reading" || po.status === "receiving" ? poWaitDays(po.received_at, nowMs()) : 0;
  const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const points = checking ? [
    ...(overdue ? [{ cls: "warn", body: <>{overdueText(buyerLabel, overdue)}</> }] : []),
    ...(clash && verdict ? [{ cls: "bad", body: <>{clashText(po.buyer_po ?? "", clash, verdict)}</> }] : []),
    ...(!buyerId && po.status === "to_check" ? [{
      cls: "bad", body: <>
        Buyer not recognised{owner && buyerName ? `: the PO says "${buyerName}"` : ""}. {owner ? "Pick the right one in the form, or add it as a new buyer." : "Pick the buyer in the form, or ask the owner to add a new buyer."}
        {owner && <div className="mt-2"><NewBuyer name={(buyerName as string | null) ?? ""} code={suggestBuyerCode((buyerName as string | null) ?? "", o.buyers.map((b) => b.code))} /></div>}
      </>,
    }] : []),
    ...(read.doubts ?? []).map((d) => ({ cls: "warn", body: <>{d}</> })),
    ...(read.notes ? [{ cls: "", body: <>Notes on the PO: {read.notes}</> }] : []),
  ] : [];

  const preview = files.find((f) => /pdf|image/.test(f.type));
  const notNew = po.status !== "added" && po.status !== "held";

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/pos">Buyer POs</Link></nav>
          <h1>{po.buyer_po ? <>PO {po.buyer_po}</> : po.email_subject ?? "Buyer PO"}{buyerLabel && <span className="muted font-normal"> · {buyerLabel}</span>}</h1>
          <p className="row">
            {!checking && <span className={s?.cls}>{s?.label}</span>}
            <span>{po.source === "email" ? `Email from ${po.email_from ?? "unknown"}` : "Added from a file"}, {when.format(new Date(po.received_at))}</span>
            {waited > 0 && <span className="chip bad">Waiting {waited} days</span>}
          </p>
        </div>
      </div>

      {inquiry && (
        <div className="okbox">This email is inquiry <Link href={`/inquiries/${inquiry.id}`} className="link code">{inquiry.inquiry_no}</Link>. Follow it up there.</div>
      )}

      {po.status === "held" && (
        <HeldSender id={po.id} from={po.email_from ?? ""} buyers={o.buyers.map((b) => ({ id: b.id, label: b.label }))} />
      )}

      {(po.status === "reading" || po.status === "receiving") && (
        <div className="empty"><b>Reading this PO</b>{stuck ? "This is taking too long. Use Read again below." : "Reload in a minute."}</div>
      )}
      {po.status === "failed" && <div className="errbox">Couldn&apos;t read this PO: {po.read_error} Type it in below from the file, or use Read again.</div>}
      {po.status === "added" && order && (
        <div className="okbox"><b>Done: this PO is order <Link href={`/orders/${po.order_id}`} className="link code">{order.order_no}</Link>.</b></div>
      )}
      {po.status === "not_po" && <div className="empty"><b>Set aside</b>No new buyer PO was found here, or someone set it aside. Put it back below if it is one.</div>}

      {/* The PO file beside the form, so each line can be checked against it without switching screens. */}
      <div className={`po-review ${checking ? "" : "solo"}`}>
        <div className="po-review-main">
          {points.length > 0 && (
            <section className="panel po-points" aria-label="Check before creating the order">
              <h2>Check before creating the order</h2>
              <ul>
                {points.map((pt, i) => <li key={i} className={pt.cls}>{pt.body}</li>)}
              </ul>
            </section>
          )}
          {clash && verdict && (
            <PoCompare
              verdict={verdict}
              left={thisSide}
              right={{ title: `Order ${clash.order_no}`, href: `/orders/${clash.id}`, po: clash.buyer_po, poDate: clash.po_date, shipDate: clash.ship_date, lines: clash.lines }}
              orderId={clash.id}
              orderNo={clash.order_no}
            />
          )}
          {checking && !clash && (
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
        </div>
        <aside className="po-file" aria-labelledby="in-h">
          <section className="panel">
            <div className="row mb-2">
              <h2 id="in-h">The PO</h2>
              <span className="muted ml-auto text-[12.5px]">{files.length} {files.length === 1 ? "file" : "files"}</span>
            </div>
            {preview && urlOf.get(preview.path) && (
              preview.type.includes("pdf")
                ? <iframe src={urlOf.get(preview.path)!} title={preview.name} className="po-frame hide-phone" />
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
                : <img src={urlOf.get(preview.path)!} alt={preview.name} className="po-img" />
            )}
            <ul className="po-files">
              {files.map((f) => (
                <li key={f.path}>
                  <span className="min-w-0"><b className="block truncate">{f.name}</b><small>{f.name.split(".").pop()?.toUpperCase()} · {size(f.size)}</small></span>
                  <a href={urlOf.get(f.path) ?? "#"} target="_blank" rel="noreferrer" className="btn sm">Open</a>
                </li>
              ))}
              {files.length === 0 && <li className="muted text-[13px]">No file came with it.{po.email_body ? " The PO is in the email text." : ""}</li>}
            </ul>
            {po.email_body && (
              <details className="mt-3" open={files.length === 0}>
                <summary className="cursor-pointer text-[12.5px] font-semibold text-accent">Email text</summary>
                <p className="muted mt-2 whitespace-pre-line text-[13px]">{po.email_body}</p>
              </details>
            )}
          </section>
        </aside>
      </div>

      {notNew && (
        <section className="po-other" aria-label="Not a new order">
          <span>{po.status === "not_po" ? "It is a PO after all?" : "Not a new order?"}</span>
          {!inquiry && po.source === "email" && (po.status !== "held" || owner) && <ToInquiry id={po.id} />}
          <PoActions id={po.id} status={po.status} canReread={canReread} />
        </section>
      )}
    </>
  );
}

type Clash = { id: string; order_no: string; buyer_po: string; po_date: string | null; ship_date: string | null; lines: CompareSide["lines"] };

// The buyer's order with exactly this PO number (the one orders_buyer_po_key would refuse a second of), with its styles.
async function sameNumberOrder(supabase: Awaited<ReturnType<typeof createClient>>, buyerId: string, buyerPo: string): Promise<Clash | null> {
  const key = poNoKey(buyerPo);
  if (!key) return null;
  const { data } = await supabase.from("orders")
    .select("id, order_no, buyer_po, po_date, ship_date, order_lines(style, description, qty, removed_at, position)")
    .eq("buyer_id", buyerId).ilike("buyer_po", `%${key.replace(/[\\%_]/g, "\\$&")}%`);
  const hit = (data ?? []).find((r) => poNoKey(r.buyer_po) === key);
  if (!hit) return null;
  // Buyer rates stay out: order_lines.buyer_rate is not readable column by column.
  const rows = ((hit.order_lines ?? []) as { style: string; description: string | null; qty: number; removed_at: string | null; position: number }[])
    .filter((l) => !l.removed_at).sort((a, b) => a.position - b.position);
  return {
    id: hit.id, order_no: hit.order_no, buyer_po: hit.buyer_po, po_date: hit.po_date, ship_date: hit.ship_date,
    lines: rows.map((l) => ({ style: l.style, description: l.description ?? "", qty: Number(l.qty) || 0, rate: null })),
  };
}

// What the PO number clash means, in words: a different style is another PO, a shared style is the same one.
function clashText(buyerPo: string, c: Clash, v: ReturnType<typeof comparePo>) {
  const link = <Link href={`/orders/${c.id}`} className="link code">{c.order_no}</Link>;
  const list = (s: string[]) => s.join(", ");
  if (v.verdict === "different") return <>
    PO number {buyerPo} is also on order {link}, but the styles don&apos;t match: this file is {list(v.onlyPo)}, {c.order_no} is {list(v.onlyOrder)}.
    So this is not the same PO. Compare the two below and choose what to do.
  </>;
  if (v.verdict === "same") return <>
    This is the same PO as order {link} ({list(v.shared)} on both). If the buyer revised it, update {c.order_no}, then set this one aside.
  </>;
  return <>PO number {buyerPo} is already on order {link}, and no styles were read from this file. Compare the two below before doing anything.</>;
}
