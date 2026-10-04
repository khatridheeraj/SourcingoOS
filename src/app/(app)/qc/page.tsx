import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head, Pills } from "@/components/bits";
import { ClickRow } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDay, nf, QC_KIND_LABEL, QC_RESULT_LABEL, QC_TONE } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";

export const metadata = { title: "QC inspections · Sourcingo OS" };

const FILTERS = [["all", "All"], ["fail", "Failed"], ["hold", "On hold"], ["pass", "Passed"]] as const;

export default async function QcList({ searchParams }: PageProps<"/qc">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const sp = await searchParams;
  const f = FILTERS.some(([k]) => k === sp.result) ? String(sp.result) : "all";
  const { world: w } = await loadWorld();
  const list = w.qcs.filter((q) => f === "all" || q.result === f);
  const recent = w.qcs.filter((q) => q.inspected_on >= w.today.slice(0, 8) + "01");
  const passRate = recent.length ? Math.round((recent.filter((q) => q.result === "pass").length / recent.length) * 100) : null;

  return (
    <>
      <Head crumbs="Production › QC" title="QC inspections" sub={`Inline, mid-line and final checks, judged on AQL.${passRate != null ? ` ${passRate}% passed this month (${recent.length} inspections).` : ""}`}>
        {isOps(me?.role) && <Link className="btn primary" href="/qc/new">+ Record QC</Link>}
      </Head>
      <Pills current={f} items={FILTERS.map(([k, l]) => ({ key: k, label: l, href: `/qc?result=${k}`, n: k === "fail" ? w.qcs.filter((q) => q.result === "fail").length : undefined }))} />
      {list.length ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Inspection</th><th>Style</th><th>Order · factory</th><th>Kind</th><th>Sample</th><th>Defects (C/Ma/Mi)</th><th>Result</th></tr></thead>
            <tbody>
              {list.map((q) => {
                const s = w.styleById.get(q.style_id);
                const o = w.orderById.get(q.so_id);
                return (
                  <ClickRow key={q.id} href={`/qc/${q.id}`}>
                    <td className="code"><Link className="text-accent" href={`/qc/${q.id}`}>{q.id}</Link><br /><span className="text-xs text-muted">{fmtDay(q.inspected_on)} · {w.personName(q.inspector_id)}</span></td>
                    <td><b>{s?.name}</b><br /><span className="text-xs text-muted">{s?.colour}</span></td>
                    <td className="code">{q.so_id}<br /><span className="text-muted">{w.factoryName(o?.factory_id)}</span></td>
                    <td>{QC_KIND_LABEL[q.kind]}</td>
                    <td className="num">{nf(q.sample_size)} of {nf(q.lot_qty)}</td>
                    <td className="num">{q.critical} / {q.major} / {q.minor}</td>
                    <td><span className={`chip ${QC_TONE[q.result]}`}>{QC_RESULT_LABEL[q.result]}</span></td>
                  </ClickRow>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No inspections yet">{isOps(me?.role) ? <>Record one from the factory floor with <Link className="link" href="/qc/new">Record QC</Link>.</> : "Inspections show here once QC records them."}</Empty>
      )}
    </>
  );
}
