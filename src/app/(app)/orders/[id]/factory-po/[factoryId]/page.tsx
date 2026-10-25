import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { loadTeam, personName } from "@/lib/data";
import { FactoryPoDoc } from "@/components/factory-po-doc";
import { dayAt, todayIST } from "@/lib/format";
import type { LinePrice } from "@/lib/margin";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { PoDetailsForm } from "./po-details";
import { PoPhotoSlot, PoSend } from "./po-send";
import { PrintPo } from "./print-po";

type Line = { id: string; style: string; description: string | null; colour: string | null; qty: number; fabric: string | null; sizes: Record<string, number> | null; factory_id: string | null; position: number; photo_path: string | null; product: string };

// The steps a factory is held to, shown on its PO.
const KEY_STEPS = [
  { key: "fit_sample", label: "Fit sample" },
  { key: "pp_sample", label: "PP sample" },
  { key: "size_set", label: "Size set" },
  { key: "final_qc", label: "Final QC" },
  { key: "ex_factory", label: "Ex-factory" },
];
// A fabric style has no garment samples: the strike off is what the factory is held to before bulk.
const FABRIC_KEY_STEPS = [
  { key: "greige", label: "Greige" },
  { key: "strike_off", label: "Strike off" },
  { key: "final_qc", label: "Final QC" },
  { key: "ex_factory", label: "Ex-factory" },
];
const keySteps = (l: Line) => (l.product === "fabric" ? FABRIC_KEY_STEPS : KEY_STEPS);

// Dates on the PO read the way the team writes them by hand: 15/11/26.
const istDay = (ts: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ts));
const short = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "");

// Our purchase order to one factory for its styles of an order, in Sourcingo's own PO format, with the vendor
// agreement summed up as its terms: printed, or saved as a PDF to send on WhatsApp. It never names the buyer.
export default async function FactoryPoPage({ params }: PageProps<"/orders/[id]/factory-po/[factoryId]">) {
  const { id, factoryId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(factoryId)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const [{ data: o }, { data: f }, { data: pos }, { data: co }, { data: prices }, { data: withPo }] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_po, ship_date, revised_ship_date, status, order_lines(id, style, description, colour, qty, fabric, sizes, factory_id, position, photo_path, product)")
      .eq("id", id).is("order_lines.removed_at", null).maybeSingle(),
    supabase.from("factories").select("id, name, city, contact_name, phone, tally_ledger, address, gstin, email").eq("id", factoryId).maybeSingle(),
    supabase.from("factory_pos").select("factory_id, released_at, buffer_days, created_at, po_no, delivery_note, lock_requested_at, lock_requested_by, lock_note, lock_note_at, mail_to, mail_cc, mail_requested_at, mailed_at, last_mailed_at, follow_ups, reply_at, reply_text, accepted_at, accepted_via, accept_note").eq("order_id", id).order("created_at"),
    supabase.from("companies").select("name, legal_name, address, ship_address, gstin, phone, email, po_mail_test_to").eq("id", me.companyId).maybeSingle(),
    supabase.rpc("line_prices", { p_orders: [id] }),
    supabase.rpc("orders_with_po_file", { p_orders: [id] }),
  ]);
  if (!o || !f) notFound();
  const hasBuyerPo = ((withPo ?? []) as string[]).includes(id);
  const lines = ((o.order_lines ?? []) as Line[]).filter((l) => l.factory_id === factoryId).sort((a, b) => a.position - b.position);
  if (!lines.length) notFound();
  const photoPaths = lines.map((l) => l.photo_path).filter(Boolean) as string[];
  const [{ data: stages }, { data: terms }, { data: signed }, { data: ledger }, { data: poNoRpc }, { data: blocker }, { data: token }, { data: relBlock }, { data: sendBlock }, team] = await Promise.all([
    supabase.from("line_stages").select("line_id, stage, planned_on, not_needed").in("line_id", lines.map((l) => l.id)).in("stage", [...new Set([...KEY_STEPS, ...FABRIC_KEY_STEPS].map((s) => s.key))]),
    // Payment terms are kept per Tally ledger and only Accounts and the owner can read them; everyone else sees the usual 60 days.
    f.tally_ledger ? supabase.from("supplier_terms").select("days").eq("ledger", f.tally_ledger).maybeSingle() : Promise.resolve({ data: null }),
    photoPaths.length ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(photoPaths, 3600) : Promise.resolve({ data: [] }),
    // Tally knows a factory's GSTIN when its ledger has one; what the team typed on the factory comes first.
    f.tally_ledger ? supabase.from("tally_ledgers").select("gstin").eq("name", f.tally_ledger).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("factory_po_no", { p_order: id, p_factory: factoryId }),
    supabase.rpc("po_mail_blocker", { p_order: id, p_factory: factoryId }),
    supabase.rpc("factory_po_link", { p_order: id, p_factory: factoryId }),
    // Before release: what stops the owner's approval, and what stops the PO from being emailed once approved.
    supabase.rpc("release_blocker", { p_order: id, p_factory: factoryId }),
    supabase.rpc("po_send_blocker", { p_order: id, p_factory: factoryId }),
    loadTeam(),
  ]);
  const photoOf = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));

  const po = (pos ?? []).find((p) => p.factory_id === factoryId);
  // The PO number comes from the database, so the PO link and the email carry the same one. Before the factory
  // is asked for its plan there is no PO row yet: the order's own number stands in.
  const poNo = (poNoRpc as string | null) || (/^SO\/\d+\/\d{4}$/i.test(o.buyer_po ?? "") ? o.buyer_po!.toUpperCase() : o.order_no);
  const due = o.revised_ship_date || o.ship_date;
  const readyBy = due && po?.buffer_days != null ? new Date(Date.parse(due) - po.buffer_days * 86_400_000).toISOString().slice(0, 10) : due;
  const rateOf = new Map(((prices ?? []) as LinePrice[]).map((p) => [p.id, p.factory_rate == null ? null : Number(p.factory_rate)]));
  const planned = (lineId: string, step: string) => {
    const s = (stages ?? []).find((x) => x.line_id === lineId && x.stage === step);
    return s?.not_needed ? "Not needed" : s?.planned_on ? short(s.planned_on) : "—";
  };
  const released = !!po?.released_at;
  const isOwner = me.role === "owner";
  const vendorGstin = f.gstin || ledger?.gstin || "";
  const noPhoto = lines.filter((l) => !l.photo_path || !photoOf.get(l.photo_path));
  const keyDates = (stages ?? []).some((s) => s.planned_on)
    ? lines.map((l) => `${lines.length > 1 ? `${l.style}: ` : ""}${keySteps(l).map((s) => `${s.label} ${planned(l.id, s.key)}`).join(" · ")}`).join("; ")
    : null;
  const owner = team.find((m) => m.role === "owner" && m.active);
  const nameOf = (uid: string | null | undefined) => (uid && team.find((m) => m.user_id === uid)) || null;
  const requester = nameOf(po?.lock_requested_by);
  const accepted = po?.accepted_at
    ? `${short(istDay(po.accepted_at))}${po.accepted_via === "email" ? " by email" : po.accepted_via === "link" ? " on the PO link" : ""}`
    : null;

  const missing = [
    !f.address && "factory address",
    !vendorGstin && "factory GSTIN",
    !f.phone && "factory mobile",
    // The PO is emailed once approved, so sending it for approval waits on this one.
    !f.email && "factory email",
    !(co?.address && co?.gstin) && (isOwner ? "our address and GSTIN" : null),
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href={`/orders/${o.id}`}>{o.order_no}</Link><span aria-hidden>/</span><span>Factory PO</span></nav>
          <h1>Purchase order to {f.name}</h1>
          <p>{released ? `Approved ${dayAt(po!.released_at)}. It is emailed to the factory to accept; you can also print it or save it as a PDF.`
            : "Draft: add any missing photos and details, then send it for approval. Once approved, it is emailed to the factory."}</p>
        </div>
        {(released || hasBuyerPo) && <PrintPo />}
      </div>
      {!released && !hasBuyerPo && (
        <div className="errbox no-print">
          <b>The buyer&apos;s PO isn&apos;t on file.</b> A factory PO is issued only against a PO received from the buyer.{" "}
          <Link href={`/orders/${o.id}#details-po`} className="link font-semibold">Add the buyer&apos;s PO</Link> first, then print this.
        </div>
      )}
      {noPhoto.length > 0 && (
        <div className="warnbox no-print">
          <b>{noPhoto.length === 1 ? `${noPhoto[0].style} has no photo.` : `${noPhoto.length} styles have no photo: ${noPhoto.map((l) => l.style).join(", ")}.`}</b>{" "}
          The factory works from the picture, so the PO can&apos;t be sent for approval or emailed until every style has one. Tap + Add photo on the style below.
        </div>
      )}
      <PoSend orderId={o.id} factoryId={factoryId} released={released} blocker={(blocker as string | null) ?? null} factoryEmail={f.email ?? ""}
        defaultCc={me.email} link={token ? `/po/${token}` : null} testTo={co?.po_mail_test_to ?? null}
        m={{ to: po?.mail_to ?? null, cc: po?.mail_cc ?? null, requestedAt: po?.mail_requested_at ?? null, mailedAt: po?.mailed_at ?? null, lastMailedAt: po?.last_mailed_at ?? null,
          followUps: po?.follow_ups ?? 0, replyAt: po?.reply_at ?? null, replyText: po?.reply_text ?? null, acceptedAt: po?.accepted_at ?? null, acceptedVia: po?.accepted_via ?? null, acceptNote: po?.accept_note ?? null }}
        approval={{ isOwner, ownerName: owner ? personName(owner).split(" ")[0] : "the owner", requestedAt: po?.lock_requested_at ?? null,
          requestedBy: requester ? personName(requester) : null, note: po?.lock_note ?? null, noteAt: po?.lock_note_at ?? null,
          releaseBlocker: (relBlock as string | null) ?? null, sendBlocker: (sendBlock as string | null) ?? null }} />
      <PoDetailsForm missing={missing} isOwner={isOwner} initial={{
        orderId: o.id, factoryId, hasPo: !!po, poNo: po?.po_no ?? "", deliveryNote: po?.delivery_note ?? "",
        factory: { address: f.address ?? "", gstin: vendorGstin, phone: f.phone ?? "", email: f.email ?? "" },
        company: isOwner ? { legalName: co?.legal_name ?? "", address: co?.address ?? "", shipAddress: co?.ship_address ?? "", gstin: co?.gstin ?? "", phone: co?.phone ?? "", email: co?.email ?? "" } : undefined,
      }} />

      <FactoryPoDoc
        photoSlot={(l) => <PoPhotoSlot orderId={o.id} companyId={me.companyId!} lineId={l.id} style={l.style} />}
        d={{
          poNo, draft: !released, date: short(released ? istDay(po!.released_at!) : todayIST()),
          company: { name: co?.legal_name || co?.name || "", address: co?.address ?? null, shipAddress: co?.ship_address ?? null, gstin: co?.gstin ?? null, phone: co?.phone ?? null, email: co?.email ?? null },
          factory: { name: f.name, address: f.address || f.city, gstin: vendorGstin || null, phone: f.phone, contact: f.contact_name, email: f.email },
          lines: lines.map((l) => ({ id: l.id, style: l.style, description: l.description, colour: l.colour, fabric: l.fabric, qty: l.qty, sizes: l.sizes, product: l.product,
            rate: rateOf.get(l.id) ?? null, photo: (l.photo_path && photoOf.get(l.photo_path)) || null })),
          paymentDays: terms?.days ?? 60, delivery: po?.delivery_note || (readyBy ? short(readyBy) : "As agreed"), keyDates, accepted,
        }} />
    </>
  );
}
