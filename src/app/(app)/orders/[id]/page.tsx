import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCode, Chip, Empty } from "@/components/bits";
import { DcCard, GrnCard } from "@/components/doc-cards";
import { LiveStatus, MarkShippedButton, UnlockButton } from "@/components/order-actions";
import { OrderTimeline } from "@/components/order-timeline";
import { TemplatePicker } from "@/app/(app)/cleanup/parts";
import { IssueButton } from "@/app/(app)/fpos/buttons";
import { TnaStyles } from "@/components/tna-styles";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { loadFiles } from "@/lib/files";
import { fmtDateTime } from "@/lib/format";
import { buyerStage, fmtDay, FPO_LABEL, FPO_TONE, grnQty, money, nf, orderValue, projectedFinish, QC_KIND_LABEL, QC_RESULT_LABEL, QC_TONE, STAGES, toDraft, unitOf } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { loadTemplates } from "@/lib/tna";
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
  const files = await loadFiles("style", o.styles.map((s) => s.id), w.personName);
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
        files={Object.fromEntries(files)}
        isOwner={isOwner}
        today={w.today}
        options={{
          buyers: w.buyers.map((b) => ({ id: b.id, label: b.real_name ? `${b.code} · ${b.real_name}` : b.code, terms: b.default_payment_terms ?? "", address: b.default_address ?? "" })),
          factories: w.factories.filter((f) => f.active || f.id === o.factory_id).map((f) => ({ id: f.id, label: f.city ? `${f.name} · ${f.city}` : f.name })),
          merchandisers: keep(opt(["merchandiser", "manager", "owner"]), o.merchandiser_id),
          managers: keep(opt(["manager", "owner"]), o.manager_id),
          people: keep(keep(opt(), o.fabric_poc_id), o.quality_poc_id),
          templates: await loadTemplates(),
        }}
      />
    );
  }

  const grns = w.grns.filter((g) => g.so_id === o.id);
  const dcs = w.dcs.filter((d) => d.so_id === o.id);
  const received = grns.filter((g) => g.status !== "rejected").reduce((a, g) => a + grnQty(g), 0);
  const locked = o.status === "locked" || o.status === "shipped";
  const po = w.fpoFor(o.id);
  const qcs = w.qcs.filter((q) => q.so_id === o.id);
  const noTna = o.status === "locked" && o.styles.some((s) => !s.checkpoints.length);
  const templates = noTna && ops ? await loadTemplates() : [];
  const end = o.status === "locked" ? projectedFinish(o, w.today) : null;
  const risk = end && o.buyer_date && end > o.buyer_date
    ? { bad: true, text: `At today's pace production ends ${fmtDay(end)}, after the buyer's date (${fmtDay(o.buyer_date)}). Talk to the factory or the buyer now.` }
    : end && o.factory_date && end > o.factory_date
      ? { bad: false, text: `Running late: production now looks like ending ${fmtDay(end)}, not ${fmtDay(o.factory_date)}.` }
      : null;

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
        <a className="btn" href={`/print/order/${o.id}`} target="_blank" rel="noreferrer">Print</a>
        {ops && <Link className="btn" href={`/buyer-view?buyer=${o.buyer_id}`}>Preview as buyer</Link>}
        {ops && o.status === "locked" && <Link className="btn" href={`/qc/new?so=${o.id}`}>+ QC</Link>}
        {ops && o.status === "locked" && <Link className="btn" href={`/grn/new?so=${o.id}`}>+ GRN</Link>}
        {(isOwner || me?.role === "manager") && o.status === "locked" && <MarkShippedButton id={o.id} />}
        {isOwner && o.status === "locked" && <UnlockButton id={o.id} />}
      </div>
      {risk && <p className={risk.bad ? "errbox" : "warnbox"}>{risk.text}</p>}
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
      {noTna && ops && (
        <section className="panel" id="plan">
          <h3>Add the TNA</h3>
          <p className="-mt-2 mb-3 text-[13px] text-muted">This order is running without steps, so nobody is warned before it slips. Pick a template; dates are worked back from the factory delivery date.</p>
          <TemplatePicker soId={o.id} factoryDate={o.factory_date} templates={templates.filter((t) => t.order_type === o.order_type)} />
        </section>
      )}
      {locked && (
        <div className="two">
          <section className="panel">
            <h3>Factory PO</h3>
            {po ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row">
                  <Link className="code text-accent" href={`/fpos/${po.id}`}>{po.id}</Link>
                  {po.revision > 1 && <span className="text-xs text-muted">revision {po.revision}</span>}
                  <span className={`chip ${FPO_TONE[po.status]}`}>{FPO_LABEL[po.status]}</span>
                </div>
                <span className="text-[13px] text-muted">{nf(po.total_qty)} {unitOf(o)} · {po.total_value != null ? money(po.total_value, po.currency) : "rate missing"} · deliver by {fmtDay(po.delivery_date)}</span>
                {po.response_note && <span className="text-[13px]">“{po.response_note}”</span>}
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <p className="text-[13px] text-muted">{o.factory_id ? "No PO sent to the factory yet." : "Choose the factory first."}</p>
                {ops && o.status === "locked" && o.factory_id && <div><IssueButton soId={o.id} /></div>}
              </div>
            )}
          </section>
          <section className="panel">
            <h3>QC</h3>
            {qcs.length ? (
              <div className="list-rows">
                {qcs.slice(0, 6).map((q) => {
                  const st = w.styleById.get(q.style_id);
                  return (
                    <div key={q.id}>
                      <Link className="code text-accent" href={`/qc/${q.id}`}>{q.id}</Link>
                      <span className="grow text-[13px]">{QC_KIND_LABEL[q.kind]} · {st?.name} ({st?.colour}) · {fmtDay(q.inspected_on)}</span>
                      <span className={`chip ${QC_TONE[q.result]}`}>{QC_RESULT_LABEL[q.result]}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-[13px] text-muted">No inspections yet.{ops && o.status === "locked" && <> <Link className="link" href={`/qc/new?so=${o.id}&kind=inline`}>Record the first one</Link>.</>}</p>}
          </section>
        </div>
      )}
      {o.styles.length ? <TnaStyles w={w} o={o} canEdit={ops} files={files} /> : <Empty title="No styles yet" />}
      {(grns.length > 0 || dcs.length > 0) && (
        <section className="panel">
          <h3>Warehouse</h3>
          <div className="cards">
            {grns.map((g) => <GrnCard key={g.id} w={w} g={g} />)}
            {dcs.map((d) => <DcCard key={d.id} w={w} d={d} />)}
          </div>
        </section>
      )}
      <OrderTimeline soId={o.id} w={w} />
    </div>
  );
}
