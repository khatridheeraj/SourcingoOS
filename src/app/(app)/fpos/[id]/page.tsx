import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCode } from "@/components/bits";
import { FpoLines, FpoSchedule } from "@/components/fpo-view";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { fmtDay, FPO_LABEL, FPO_TONE, money, nf, unitOf } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { IssueButton, RecordAnswer } from "../buttons";

export async function generateMetadata({ params }: PageProps<"/fpos/[id]">) {
  return { title: `${(await params).id} · Sourcingo OS` };
}

export default async function FactoryPo({ params }: PageProps<"/fpos/[id]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const p = w.fpos.find((x) => x.id === id);
  if (!p) notFound();
  const o = w.orderById.get(p.so_id);
  const ops = isOps(me?.role);
  const revisions = w.fpos.filter((x) => x.so_id === p.so_id).sort((a, b) => b.revision - a.revision);
  const live = p.status === "issued" || p.status === "accepted";
  const changed = o && live && (o.styles.length !== p.lines.length || o.styles.some((s) => {
    const l = p.lines.find((x) => x.style_id === s.id);
    return !l || Number(l.qty) !== Number(s.qty) || (l.rate ?? null) !== (s.factory_rate ?? null) ||
      JSON.stringify(l.steps.map((x) => [x.name, x.due_date])) !== JSON.stringify(s.checkpoints.map((c) => [c.name, c.due_date]));
  }));

  return (
    <div className="stack">
      <div className="crumbs">Production › <Link className="link" href="/fpos">Factory POs</Link> › {p.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{p.id}{p.revision > 1 && ` · revision ${p.revision}`} <span className={`chip ${FPO_TONE[p.status]}`}>{FPO_LABEL[p.status]}</span></h1>
          <p>
            For <Link className="link" href={`/orders/${p.so_id}`}>{p.so_id}</Link> · sent {fmtDateTime(p.issued_at)} by {w.personName(p.issued_by)}
            {p.responded_at && <> · {p.status === "declined" ? "declined" : "accepted"} {fmtDateTime(p.responded_at)} by {w.personName(p.responded_by)}</>}
          </p>
        </div>
        <a className="btn" href={`/print/fpo/${p.id}`} target="_blank" rel="noreferrer">Print / PDF</a>
        {ops && o?.status === "locked" && (live || p.status === "declined") && <IssueButton soId={p.so_id} label="Send new revision" reissue />}
      </div>
      {p.status === "declined" && <p className="errbox"><b>The factory declined this PO.</b> {p.response_note ? `“${p.response_note}”` : ""} Sort it out with them, change the order if needed, then send a new revision.</p>}
      {changed && <p className="warnbox">The order has changed since this PO was sent (rates, quantities or dates). Send a new revision so the factory works from the right numbers.</p>}
      <section className="panel">
        <div className="dl">
          <div><span>Factory</span><b>{w.factoryName(p.factory_id)}</b></div>
          <div><span>Buyer</span><b><BuyerCode buyer={w.buyerById.get(o?.buyer_id ?? "")} /></b></div>
          <div><span>Deliver to Sourcingo by</span><b>{fmtDay(p.delivery_date)}</b></div>
          <div><span>Total quantity</span><b className="num">{nf(p.total_qty)} {o ? unitOf(o) : ""}</b></div>
          <div><span>Total value</span><b className="num">{p.total_value != null ? money(p.total_value, p.currency) : "Rate missing"}</b></div>
          <div><span>Payment terms</span><b>{p.payment_terms || "—"}</b></div>
        </div>
      </section>
      <FpoLines lines={p.lines} currency={p.currency} unit={o ? unitOf(o) : "pcs"} />
      <section className="panel">
        <h3>Step dates</h3>
        <FpoSchedule lines={p.lines} />
      </section>
      {p.terms && <section className="panel"><h3>Terms</h3><p className="whitespace-pre-line text-[13px]">{p.terms}</p></section>}
      {ops && p.status === "issued" && <section className="panel"><h3>Factory&apos;s answer</h3><RecordAnswer id={p.id} /></section>}
      {revisions.length > 1 && (
        <section className="panel">
          <h3>All revisions</h3>
          <div className="list-rows">
            {revisions.map((r) => (
              <div key={r.id}>
                <Link className="code text-accent" href={`/fpos/${r.id}`}>{r.id}</Link>
                <span className="grow text-muted">rev {r.revision} · {fmtDateTime(r.issued_at)} · {nf(r.total_qty)} · {r.total_value != null ? money(r.total_value, r.currency) : "rate missing"}</span>
                <span className={`chip ${FPO_TONE[r.status]}`}>{FPO_LABEL[r.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
