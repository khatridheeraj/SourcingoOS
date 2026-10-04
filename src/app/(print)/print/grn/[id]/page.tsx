import { notFound, redirect } from "next/navigation";
import { Letterhead, loadCompany, Signatures } from "@/components/print-bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { CONDITION_LABEL, GRN_LABEL, grnQty, nf, unitOf } from "@/lib/model";
import { isInternal } from "@/lib/roles";

export async function generateMetadata({ params }: PageProps<"/print/grn/[id]">) {
  return { title: `${(await params).id} · Goods received note` };
}

export default async function PrintGrn({ params }: PageProps<"/print/grn/[id]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const g = w.grnById.get(id);
  if (!g) notFound();
  const o = w.orderById.get(g.so_id);
  const c = await loadCompany();
  const unit = o ? unitOf(o) : "pcs";
  return (
    <>
      <Letterhead c={c} title="Goods received note" number={g.id} sub={<div>{fmtDateTime(g.received_at)}</div>} />
      <div className="pgrid">
        <div>
          <h4>From (factory)</h4>
          <b>{w.factoryName(o?.factory_id)}</b>
          <div>Against our order <b className="code">{g.so_id}</b> · buyer <b className="code">{w.buyerCode(o?.buyer_id)}</b></div>
        </div>
        <div>
          <h4>Receipt</h4>
          <div>Received by <b>{w.personName(g.received_by)}</b></div>
          <div>Status <b>{GRN_LABEL[g.status]}</b>{g.approved_at && ` · approved by ${w.personName(g.approved_by)}`}</div>
          <div>QC checked <b>{g.qc_checked ? "Yes" : "No"}</b>{g.qc_note && ` · ${g.qc_note}`}</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Style</th><th>Colour</th><th>Qty</th><th>Condition</th></tr></thead>
          <tbody>
            {g.lines.map((l, i) => {
              const s = w.styleById.get(l.style_id);
              return (
                <tr key={l.id}><td>{i + 1}</td><td><b>{s?.name}</b> <span className="code">{s?.code}</span></td><td>{s?.colour}</td><td className="num">{nf(l.qty)} {unit}</td><td>{CONDITION_LABEL[l.condition]}</td></tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ptotal"><span>Total {nf(grnQty(g))} {unit}</span></div>
      {g.notes && <div className="pterms"><b>Notes</b>{"\n"}{g.notes}</div>}
      <Signatures left="Delivered by (factory)" right={`Received for ${c.trade_name}`} />
    </>
  );
}
