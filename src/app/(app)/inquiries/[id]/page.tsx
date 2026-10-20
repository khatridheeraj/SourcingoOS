import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadTeam, personName } from "@/lib/data";
import { day, dayAt, daysBetween, money, qty, todayIST } from "@/lib/format";
import { INQUIRY_COLUMNS, INQUIRY_STATUS, isOpenInquiry, sourceLabel, type Inquiry } from "@/lib/inquiries";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { InquiryActions } from "./inquiry-actions";

const at = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function InquiryPage({ params }: PageProps<"/inquiries/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const [{ data: i }, { data: notes }, buyers, team] = await Promise.all([
    supabase.from("inquiries").select(INQUIRY_COLUMNS).eq("id", id).maybeSingle<Inquiry>(),
    supabase.from("inquiry_notes").select("id, body, created_by, created_at").eq("inquiry_id", id).order("created_at", { ascending: false }),
    loadBuyers(),
    loadTeam(),
  ]);
  if (!i) notFound();
  const { data: order } = i.order_id ? await supabase.from("orders").select("id, order_no, status").eq("id", i.order_id).maybeSingle() : { data: null };
  const { data: signed } = i.photos.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(i.photos, 3600) : { data: [] };
  const photos = (signed ?? []).flatMap((s) => (s.signedUrl && s.path ? [{ path: s.path, url: s.signedUrl }] : []));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const buyer = i.buyer_id ? buyers.find((b) => b.id === i.buyer_id) : null;
  const who = buyer ? buyerName(buyer) : i.prospect ?? "";
  const today = todayIST();
  const open = isOpenInquiry(i.status);
  const due = open && !!i.next_follow_up && i.next_follow_up <= today;
  const s = INQUIRY_STATUS[i.status];
  const unit = i.unit === "m" ? "metre" : "piece";

  // The timeline: follow-up notes, with when it was logged and how it ended.
  const events = [
    ...(notes ?? []).map((n) => ({ key: n.id, at: n.created_at, by: (n.created_by && people.get(n.created_by)) || "Someone", text: n.body, sys: false })),
    { key: "logged", at: i.created_at, by: (i.created_by && people.get(i.created_by)) || "Someone", text: `Logged from ${sourceLabel(i.source).toLowerCase()}`, sys: true },
    ...(i.status !== "new" ? [{ key: "status", at: i.status_at, by: "", sys: true,
      text: i.status === "quoted" ? `Quoted ${money(i.quoted_price)} a ${unit}` : i.status === "converted" ? `Became order ${order?.order_no ?? ""}` : `Lost: ${i.lost_reason}` }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/inquiries">Inquiries</Link></nav>
          <h1 className="row !gap-2.5"><span className="code text-muted">{i.inquiry_no}</span>{i.product}</h1>
          <p className="row !gap-2">
            <span className={s?.cls}>{s?.label}</span>
            <span>{who}{!i.buyer_id && " (new buyer)"}</span>
            {due && <span className="chip bad">{i.next_follow_up! < today ? `Follow-up ${daysBetween(i.next_follow_up!, today)} days late` : "Follow up today"}</span>}
          </p>
        </div>
        {open && <Link href={`/inquiries/${i.id}/edit`} className="btn">Edit details</Link>}
      </div>

      {order && (
        <div className="okbox">This inquiry became <Link href={`/orders/${order.id}`} className="link code">{order.order_no}</Link>. Plan its TNA and track it there.</div>
      )}

      <InquiryActions
        id={i.id}
        companyId={me.companyId}
        status={i.status}
        hasBuyer={!!i.buyer_id}
        prospect={i.prospect ?? ""}
        isOwner={me.role === "owner"}
        quotedPrice={i.quoted_price != null ? String(i.quoted_price) : i.target_price != null ? String(i.target_price) : ""}
        nextFollowUp={i.next_follow_up ?? ""}
        today={today}
        photos={photos}
        allPhotos={i.photos}
      />

      <div className="panel">
        <h2>Details</h2>
        <dl className="facts">
          <div><dt>Buyer</dt><dd>{who}</dd></div>
          <div><dt>Contact</dt><dd>{[i.contact_name, i.contact].filter(Boolean).join(" · ") || "—"}</dd></div>
          <div><dt>Quantity</dt><dd>{i.est_qty ? `${qty(i.est_qty)} ${i.unit}` : "—"}</dd></div>
          <div><dt>Buyer&apos;s target</dt><dd>{i.target_price != null ? `${money(i.target_price)} a ${unit}` : "—"}</dd></div>
          <div><dt>We quoted</dt><dd>{i.quoted_price != null ? `${money(i.quoted_price)} a ${unit}` : "—"}</dd></div>
          {i.quoted_price != null && i.est_qty ? <div><dt>Quote value</dt><dd>{money(Math.round(i.quoted_price * i.est_qty))}</dd></div> : null}
          <div><dt>Merchandiser</dt><dd>{(i.merchandiser_id && people.get(i.merchandiser_id)) || "Not assigned"}</dd></div>
          <div><dt>Next follow-up</dt><dd className={due ? "text-bad" : ""}>{open ? day(i.next_follow_up) || "Not set" : "—"}</dd></div>
          <div><dt>Came by</dt><dd>{sourceLabel(i.source)} · {dayAt(i.created_at)}</dd></div>
        </dl>
        {i.notes && <p className="mt-4 whitespace-pre-line text-[14px]">{i.notes}</p>}
      </div>

      <div className="panel">
        <h2>Follow-ups</h2>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.key} className={e.sys ? "sys" : ""}>
              <time>{at.format(new Date(e.at))}{e.by && ` · ${e.by}`}</time>
              <p>{e.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
