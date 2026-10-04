import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCode, Chip, Empty } from "@/components/bits";
import { DcCard, GrnCard } from "@/components/doc-cards";
import { LiveStatus, UnlockButton } from "@/components/order-actions";
import { TnaStyles } from "@/components/tna-styles";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { buyerStage, fmtDay, grnQty, money, nf, orderValue, STAGES, toDraft, unitOf } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { Editor } from "./editor";

export async function generateMetadata({ params }: PageProps<"/orders/[id]">) {
  return { title: `${(await params).id} · Sourcingo OS` };
}

const ROLE_NAME: Record<string, string> = { owner: "Owner", manager: "Manager", merchandiser: "Merchandiser", qc: "QC", accounts: "Accounts" };

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const o = w.orderById.get(id);
  if (!o) notFound();
  const ops = isOps(me?.role);
  const isOwner = me?.role === "owner";

  if (ops && (o.status === "draft" || o.status === "tna_review")) {
    const people = w.people.filter((p) => p.active && p.role && ROLE_NAME[p.role]);
    const opt = (roles?: string[]) =>
      people.filter((p) => !roles || roles.includes(p.role!)).map((p) => ({ id: p.id, label: `${p.full_name || p.email} · ${ROLE_NAME[p.role!]}` }));
    // Keep a person who was picked earlier visible even if their role changed since.
    const keep = (list: { id: string; label: string }[], pid: string | null) =>
      pid && !list.some((x) => x.id === pid) ? [...list, { id: pid, label: w.personName(pid) }] : list;
    return (
      <Editor
        key={o.id + o.status}
        initial={toDraft(o)}
        isOwner={isOwner}
        today={w.today}
        options={{
          buyers: w.buyers.map((b) => ({ id: b.id, label: b.real_name ? `${b.code} · ${b.real_name}` : b.code, terms: b.default_payment_terms ?? "", address: b.default_address ?? "" })),
          factories: w.factories.filter((f) => f.active || f.id === o.factory_id).map((f) => ({ id: f.id, label: f.city ? `${f.name} · ${f.city}` : f.name })),
          merchandisers: keep(opt(["merchandiser", "manager", "owner"]), o.merchandiser_id),
          managers: keep(opt(["manager", "owner"]), o.manager_id),
          people: keep(keep(opt(), o.fabric_poc_id), o.quality_poc_id),
        }}
      />
    );
  }

  const grns = w.grns.filter((g) => g.so_id === o.id);
  const dcs = w.dcs.filter((d) => d.so_id === o.id);
  const received = grns.filter((g) => g.status !== "rejected").reduce((a, g) => a + grnQty(g), 0);
  const locked = o.status === "locked" || o.status === "shipped";

  return (
    <div className="stack">
      <div className="crumbs">Sales › <Link className="link" href="/orders">Sales orders</Link> › {o.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{o.id} · #{o.buyer_po_number} <Chip status={o.status} /></h1>
          <p>
            {locked
              ? <>TNA locked {o.locked_at ? fmtDateTime(o.locked_at) : ""} by {w.personName(o.locked_by)}. The factory can update checkpoint status only.</>
              : "Not locked yet. Merchandisers are still preparing this order."}
          </p>
        </div>
        {ops && o.status === "locked" && <Link className="btn" href={`/grn/new?so=${o.id}`}>+ GRN</Link>}
        {isOwner && o.status === "locked" && <UnlockButton id={o.id} />}
      </div>
      <section className="panel">
        <div className="dl">
          <div><span>Customer</span><b><BuyerCode buyer={w.buyerById.get(o.buyer_id)} /></b></div>
          <div><span>Factory</span><b>{w.factoryName(o.factory_id)}</b></div>
          <div><span>Order type</span><b>{o.order_type === "fabric" ? "Fabric (meters)" : "Garment (pieces)"}</b></div>
          <div><span>Order value</span><b className="num">{money(orderValue(o), o.currency)}</b></div>
          <div><span>SO date</span><b>{fmtDay(o.so_date)}</b></div>
          <div><span>Buyer delivery</span><b>{fmtDay(o.buyer_date)}</b></div>
          <div><span>Factory delivery</span><b>{fmtDay(o.factory_date)}</b></div>
          <div><span>Merchandiser predicted</span><b>{fmtDay(o.merch_date)}</b></div>
          <div><span>Payment terms</span><b>{o.payment_terms || "—"}</b></div>
          <div><span>Demand POC</span><b>{w.personName(o.merchandiser_id)}</b></div>
          <div><span>Manager</span><b>{w.personName(o.manager_id)}</b></div>
          <div><span>Fabric POC</span><b>{w.personName(o.fabric_poc_id)}</b></div>
          <div><span>Quality POC</span><b>{w.personName(o.quality_poc_id)}</b></div>
          <div><span>Order source</span><b>{o.order_source || "—"}</b></div>
          <div><span>Received / dispatched</span><b className="num">{nf(received)} / {nf(w.dispatchedFor(o.id))} {unitOf(o)}</b></div>
          <div><span>Buyer milestone</span><b>{STAGES[buyerStage(o)]}</b></div>
          {o.inquiry_id && <div><span>Inquiry</span><b className="code">{o.inquiry_id}</b></div>}
          {o.tags.length > 0 && <div><span>Tags</span><b>{o.tags.join(", ")}</b></div>}
        </div>
        {o.delivery_address && <p className="mt-3.5 text-[12.5px]"><b>Delivery address:</b> {o.delivery_address}</p>}
        {o.terms && <p className="mt-2 text-[12.5px]"><b>T&amp;Cs / inspection:</b> {o.terms}</p>}
        {!ops && o.remarks && <p className="mt-2 text-[12.5px]"><b>Status remarks:</b> {o.remarks}</p>}
      </section>
      {ops && o.status === "locked" && <LiveStatus id={o.id} merchDate={o.merch_date ?? ""} remarks={o.remarks ?? ""} />}
      {o.styles.length ? <TnaStyles w={w} o={o} canEdit={ops} /> : <Empty title="No styles yet" />}
      {(grns.length > 0 || dcs.length > 0) && (
        <section className="panel">
          <h3>Warehouse</h3>
          <div className="cards">
            {grns.map((g) => <GrnCard key={g.id} w={w} g={g} />)}
            {dcs.map((d) => <DcCard key={d.id} w={w} d={d} />)}
          </div>
        </section>
      )}
    </div>
  );
}
