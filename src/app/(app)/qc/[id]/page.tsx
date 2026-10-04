import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Attachments } from "@/components/attachments";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { loadFiles } from "@/lib/files";
import { CATEGORIES_FOR } from "@/lib/file-kinds";
import { fmtDay, nf, QC_KIND_LABEL, QC_RESULT_LABEL, qcAccept } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { DeleteQc } from "./delete";

export async function generateMetadata({ params }: PageProps<"/qc/[id]">) {
  return { title: `${(await params).id} · Sourcingo OS` };
}

export default async function QcPage({ params, searchParams }: PageProps<"/qc/[id]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const { world: w } = await loadWorld();
  const q = w.qcs.find((x) => x.id === id);
  if (!q) notFound();
  const s = w.styleById.get(q.style_id);
  const o = w.orderById.get(q.so_id);
  const files = await loadFiles("qc", [q.id], w.personName);
  const ops = isOps(me?.role);
  const others = w.qcFor(q.style_id).filter((x) => x.id !== q.id);

  return (
    <div className="stack">
      <div className="crumbs">Production › <Link className="link" href="/qc">QC</Link> › {q.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{QC_KIND_LABEL[q.kind]} inspection · {s?.name} ({s?.colour})</h1>
          <p>{q.id} · {fmtDay(q.inspected_on)} by {w.personName(q.inspector_id)} · <Link className="link" href={`/orders/${q.so_id}`}>{q.so_id}</Link> · {w.factoryName(o?.factory_id)} · {w.buyerCode(o?.buyer_id)}</p>
        </div>
        {ops && <Link className="btn" href={`/qc/new?so=${q.so_id}&style=${q.style_id}&kind=${q.kind}`}>Re-inspect</Link>}
        {(me?.role === "owner" || me?.role === "manager") && <DeleteQc id={q.id} />}
      </div>
      <div className={`verdict ${q.result}`}>
        {QC_RESULT_LABEL[q.result]}
        <span className="ml-2 font-normal">
          {q.result === "fail" ? (q.critical ? "Critical defect found." : "Defects over the AQL limit.") : q.result === "hold" ? "Defects within limits, but measurements or packing need fixing." : "Within AQL limits."}
        </span>
      </div>
      {sp.new && <p className="okbox">Saved. Add photos of the defects below so the factory sees exactly what to fix.</p>}
      <section className="panel">
        <div className="dl">
          <div><span>Lot</span><b className="num">{nf(q.lot_qty)} pcs</b></div>
          <div><span>Sample checked</span><b className="num">{nf(q.sample_size)} pcs</b></div>
          <div><span>Critical</span><b className="num">{q.critical} (allowed 0)</b></div>
          <div><span>Major (AQL {q.aql_major})</span><b className="num">{q.major} (allowed {qcAccept(q.sample_size, q.aql_major)})</b></div>
          <div><span>Minor (AQL {q.aql_minor})</span><b className="num">{q.minor} (allowed {qcAccept(q.sample_size, q.aql_minor)})</b></div>
          <div><span>Measurements</span><b>{q.measurements_ok == null ? "Not checked" : q.measurements_ok ? "OK" : "Not OK"}</b></div>
          <div><span>Packing</span><b>{q.packing_ok == null ? "Not checked" : q.packing_ok ? "OK" : "Not OK"}</b></div>
        </div>
        {q.defects.length > 0 && (
          <div className="mt-3 row" style={{ gap: 6 }}>
            {q.defects.map((d, i) => <span key={i} className={`chip ${d.severity === "critical" ? "bad" : d.severity === "major" ? "warn" : ""}`}>{d.name} × {d.count} · {d.severity}</span>)}
          </div>
        )}
        {q.notes && <p className="mt-3 whitespace-pre-line text-[13px]"><b>Notes:</b> {q.notes}</p>}
      </section>
      <section className="panel">
        <Attachments target="qc" id={q.id} files={files.get(q.id) ?? []} upload={ops ? CATEGORIES_FOR.qc : []} canDeleteAll={ops}
          title="Photos & report" hint="The factory sees defect photos and QC reports. “Other” stays internal." empty="No photos yet." />
      </section>
      {others.length > 0 && (
        <section className="panel">
          <h3>Other inspections of this style</h3>
          <div className="list-rows">
            {others.map((x) => (
              <div key={x.id}>
                <Link className="code text-accent" href={`/qc/${x.id}`}>{x.id}</Link>
                <span className="grow text-muted">{QC_KIND_LABEL[x.kind]} · {fmtDay(x.inspected_on)} · {x.critical}/{x.major}/{x.minor}</span>
                <span className={`chip ${x.result === "pass" ? "ok" : x.result === "fail" ? "bad" : "warn"}`}>{QC_RESULT_LABEL[x.result]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
