import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadTeam, personName } from "@/lib/data";
import { day, dayAt, daysBetween, money, qty, todayIST } from "@/lib/format";
import { INQUIRY_COLUMNS, INQUIRY_STATUS, isOpenInquiry, sourceLabel, stageOf, type Inquiry } from "@/lib/inquiries";
import { suggestBuyerCode } from "@/lib/names";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { InquiryActions } from "./inquiry-actions";
import { ChaseButton, InquiryNext, StageBar, type StepInquiry } from "../inquiry-step";

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
  const [{ data: order }, { data: email }] = await Promise.all([
    i.order_id ? supabase.from("orders").select("id, order_no, status").eq("id", i.order_id).maybeSingle() : Promise.resolve({ data: null }),
    i.incoming_po_id ? supabase.from("incoming_pos").select("id, email_subject, received_at").eq("id", i.incoming_po_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
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
  const stage = stageOf(i);
  const step: StepInquiry = {
    id: i.id, no: i.inquiry_no, title: who, product: i.product, status: i.status, stage, hasBuyer: !!i.buyer_id,
    price: i.quoted_price != null ? String(i.quoted_price) : i.target_price != null ? String(i.target_price) : "", quoted: i.quoted_price,
    unit: i.unit, estQty: i.est_qty, sampleSentOn: i.sample_sent_on, contactName: i.contact_name ?? "", contact: i.contact ?? "", nextFollowUp: i.next_follow_up ?? "",
  };

  // The timeline: follow-up notes, with when it was logged and how it ended.
  const events = [
    ...(notes ?? []).map((n) => ({ key: n.id, at: n.created_at, by: (n.created_by && people.get(n.created_by)) || "Someone", text: n.body, sys: false })),
    { key: "logged", at: i.created_at, by: (i.created_by && people.get(i.created_by)) || "Someone", text: `Logged from ${sourceLabel(i.source).toLowerCase()}`, sys: true },
    ...(i.status !== "new" ? [{ key: "status", at: i.status_at, by: "", sys: true,
      text: i.status === "quoted" ? `Price sent: ${money(i.quoted_price)} a ${unit}` : i.status === "converted" ? `Became order ${order?.order_no ?? ""}` : `Lost: ${i.lost_reason}` }] : []),
    ...(i.sample_sent_on ? [{ key: "sample", at: `${i.sample_sent_on}T12:00:00+05:30`, by: "", sys: true, text: `Sample sent${i.sample_note ? `: ${i.sample_note}` : ""}` }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/inquiries">Inquiries</Link></nav>
          <p className="text-[13px] font-medium text-muted">{who}{!i.buyer_id && " · new buyer"} · <span className="code">{i.inquiry_no}</span></p>
          <h1>{i.product}</h1>
          <p className="row !gap-2">
            {!open && <span className={s?.cls}>{s?.label}</span>}
            {[i.est_qty ? `${qty(i.est_qty)} ${i.unit}` : "", i.quoted_price != null ? `${money(i.quoted_price)} a ${unit} quoted` : i.target_price != null ? `${money(i.target_price)} a ${unit} target` : ""]
              .filter(Boolean).map((t) => <span key={t}>{t}</span>)}
            {due && <span className="chip bad">{i.next_follow_up! < today ? (() => { const n = daysBetween(i.next_follow_up!, today); return `Follow-up ${n} ${n === 1 ? "day" : "days"} late`; })() : "Follow up today"}</span>}
            {open && !due && i.next_follow_up && <span className="chip">Follow up {day(i.next_follow_up).replace(/ \d{4}$/, "")}</span>}
          </p>
        </div>
        {open && <Link href={`/inquiries/${i.id}/edit`} className="btn sm">Edit details</Link>}
      </div>
      <StageBar stage={stage} lost={i.status === "lost"} />

      {order && (
        <div className="okbox">This inquiry became <Link href={`/orders/${order.id}`} className="link code">{order.order_no}</Link>. Plan its TNA and track it there.</div>
      )}

      {open && (
        <div className="panel">
          <div className="row !items-start">
            <h2 className="grow !mb-0">Next step</h2>
            <ChaseButton i={step} className="btn sm" />
          </div>
          <div className="mt-3"><InquiryNext i={step} today={today} /></div>
        </div>
      )}

      <InquiryActions
        id={i.id}
        companyId={me.companyId}
        status={i.status}
        hasBuyer={!!i.buyer_id}
        prospect={i.prospect ?? ""}
        newBuyerCode={i.buyer_id ? "" : suggestBuyerCode(i.prospect ?? "", buyers.map((b) => b.code))}
        isOwner={me.role === "owner"}
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
          <div><dt>We sent</dt><dd>{i.quoted_price != null ? `${money(i.quoted_price)} a ${unit}` : "—"}</dd></div>
          {i.quoted_price != null && i.est_qty ? <div><dt>Quote value</dt><dd>{money(Math.round(i.quoted_price * i.est_qty))}</dd></div> : null}
          <div><dt>Merchandiser</dt><dd>{(i.merchandiser_id && people.get(i.merchandiser_id)) || "Not assigned"}</dd></div>
          <div><dt>Next follow-up</dt><dd className={due ? "text-bad" : ""}>{open ? day(i.next_follow_up) || "Not set" : "—"}</dd></div>
          {i.sample_sent_on && <div><dt>Sample sent</dt><dd>{day(i.sample_sent_on)}{i.sample_note ? ` · ${i.sample_note}` : ""}</dd></div>}
          <div><dt>Came by</dt><dd>{sourceLabel(i.source)} · {dayAt(i.created_at)}</dd></div>
          {email && <div><dt>From the email</dt><dd><Link href={`/pos/${email.id}`} className="link">{email.email_subject || "Open the email"}</Link></dd></div>}
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
