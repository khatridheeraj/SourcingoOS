import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Attachments } from "@/components/attachments";
import { BuyerCode, Chip, HoldChip } from "@/components/bits";
import { DcCard } from "@/components/doc-cards";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { CATEGORIES_FOR } from "@/lib/file-kinds";
import { loadFiles } from "@/lib/files";
import { fmtDateTime } from "@/lib/format";
import { CONDITION_LABEL, money, nf } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { GrnForm } from "../grn-form";
import { grnOrderOptions, receiverOptions } from "../options";
import { GrnDecision } from "./decision";

export async function generateMetadata({ params }: PageProps<"/grn/[id]">) {
  return { title: `${(await params).id} · Sourcingo OS` };
}

export default async function GrnPage({ params }: PageProps<"/grn/[id]">) {
  const me = await getMe();
  if (!me || !isInternal(me.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const g = w.grnById.get(id);
  if (!g) notFound();
  const ops = isOps(me.role);
  const files = (await loadFiles("grn", [g.id], w.personName)).get(g.id) ?? [];

  if (g.status === "draft" && ops) {
    return (
      <GrnForm
        key={g.id}
        id={g.id}
        orders={grnOrderOptions(w, g.id, g.so_id)}
        people={receiverOptions(w)}
        isOwner={me.role === "owner"}
        files={files}
        initial={{
          so_id: g.so_id, received_at: g.received_at, received_by: g.received_by ?? "", qc_checked: g.qc_checked, qc_note: g.qc_note ?? "", notes: g.notes ?? "",
          lines: Object.fromEntries(g.lines.map((l) => [l.style_id, { qty: String(l.qty), condition: l.condition }])),
        }}
      />
    );
  }

  const o = w.orderById.get(g.so_id);
  const cur = w.currencyOf(g.so_id);
  const dcs = w.dcs.filter((d) => d.grn_id === g.id);
  const avail = w.grnAvail(g);

  return (
    <div className="stack">
      <div className="crumbs">Warehouse › <Link className="link" href="/grn">GRN</Link> › {g.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{g.id} <Chip status={g.status} /> <HoldChip w={w} g={g} /></h1>
          <p>
            Received {fmtDateTime(g.received_at)} by {w.personName(g.received_by)} · created by {w.personName(g.created_by)}
            {g.approved_by && ` · ${g.status === "rejected" ? "rejected" : "approved"} by ${w.personName(g.approved_by)} ${g.approved_at ? fmtDateTime(g.approved_at) : ""}`}
          </p>
        </div>
        <a className="btn" href={`/print/grn/${g.id}`} target="_blank" rel="noreferrer">Print</a>
        {me.role === "owner" && g.status === "pending_approval" && <GrnDecision id={g.id} hasDcs={dcs.length > 0} />}
        {ops && avail > 0 && <Link className="btn primary" href={`/dc/new?grn=${g.id}`}>Create delivery challan</Link>}
      </div>
      {g.status === "draft" && <p className="warnbox">This GRN is still a draft. Someone who runs orders needs to submit it before the goods can be dispatched.</p>}
      <section className="panel">
        <div className="dl">
          <div><span>Sales order</span><b><Link className="link" href={`/orders/${g.so_id}`}>{g.so_id}</Link> · #{o?.buyer_po_number}</b></div>
          <div><span>Customer</span><b><BuyerCode buyer={w.buyerById.get(o?.buyer_id ?? "")} /></b></div>
          <div><span>Vendor</span><b>{w.factoryName(o?.factory_id)}</b></div>
          <div><span>Value</span><b>{money(w.grnValue(g), cur)}</b></div>
          <div><span>QC</span><b>{g.qc_checked ? "Passed" : "Not confirmed"}</b></div>
          <div><span>Still held</span><b>{nf(w.grnHeld(g))} units</b></div>
        </div>
        {g.qc_note && <p className="mt-3 text-[12.5px]"><b>QC note:</b> {g.qc_note}</p>}
        {g.notes && <p className="mt-1.5 text-[12.5px]"><b>Notes:</b> {g.notes}</p>}
      </section>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Style</th><th>Colour</th><th>Ordered</th><th>Received</th><th>Condition</th><th>Dispatched</th><th>Value</th></tr></thead>
          <tbody>
            {g.lines.map((l) => {
              const s = w.styleById.get(l.style_id);
              return (
                <tr key={l.id}>
                  <td><b>{s?.name ?? "Style"}</b><br /><span className="code text-muted">{s?.code}</span></td>
                  <td>{s?.colour}</td>
                  <td className="num">{nf(s?.qty)}</td>
                  <td className="num">{nf(l.qty)}</td>
                  <td>{l.condition === "good" ? "Good" : <span className="chip warn">{CONDITION_LABEL[l.condition]}</span>}</td>
                  <td className="num">{nf(w.dcQtyFor(g.id, l.style_id, null, true))}</td>
                  <td className="num">{money(l.qty * w.rate(l.style_id), cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section className="panel">
        <Attachments target="grn" id={g.id} files={files} upload={ops && g.status !== "rejected" ? CATEGORIES_FOR.grn : []} canDeleteAll={ops}
          title="Goods photos & QC report" empty="No photos or QC report attached." />
      </section>
      {dcs.length > 0 && (
        <section className="panel">
          <h3>Delivery challans</h3>
          <div className="cards">{dcs.map((d) => <DcCard key={d.id} w={w} d={d} />)}</div>
        </section>
      )}
    </div>
  );
}
