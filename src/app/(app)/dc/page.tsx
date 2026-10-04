import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head, HoldChip, Pills, Tile } from "@/components/bits";
import { DcCard } from "@/components/doc-cards";
import { AutoForm, SearchParamInput } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { isoIST, nf, sumByCur } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";

export const metadata = { title: "Delivery challans · Sourcingo OS" };

const FILTERS = [{ key: "all", label: "All" }, { key: "draft", label: "Draft" }, { key: "dispatched", label: "Dispatched" }];

export default async function DcList({ searchParams }: PageProps<"/dc">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const ops = isOps(me?.role);
  const sp = await searchParams;
  const p = (k: string) => String(sp[k] ?? "").trim();
  const status = FILTERS.some((f) => f.key === p("status")) ? p("status") : "all";
  const q = p("q").toLowerCase();
  const { world: w } = await loadWorld();
  const disp = w.dcs.filter((d) => d.status === "dispatched" && d.dispatched_at && isoIST(d.dispatched_at) === w.today);
  const pend = w.grns.filter((g) => w.grnAvail(g) > 0);
  const late = w.lateGrns().length;
  const list = w.dcs
    .filter((d) => status === "all" || d.status === status)
    .filter((d) => !p("buyer") || w.orderById.get(d.so_id)?.buyer_id === p("buyer"))
    .filter((d) => {
      const day = isoIST(d.dispatched_at ?? d.created_at);
      return (!p("from") || day >= p("from")) && (!p("to") || day <= p("to"));
    })
    .filter((d) => !q || [d.id, d.grn_id, d.so_id, d.invoice_no, d.tracking, d.courier, w.buyerCode(w.orderById.get(d.so_id)?.buyer_id)].join(" ").toLowerCase().includes(q));
  const keep = new URLSearchParams(Object.entries({ q, from: p("from"), to: p("to"), buyer: p("buyer") }).filter(([, v]) => v));
  const href = (s: string) => `/dc?${new URLSearchParams({ ...Object.fromEntries(keep), status: s })}`;
  const filtered = !!(p("from") || p("to") || p("buyer"));

  return (
    <>
      <Head crumbs="Warehouse › Delivery challans" title="Delivery challans" sub="Invoice and dispatch to the buyer. Zero inventory: nothing stays with Sourcingo past 24 hours.">
        {ops && <Link className="btn primary" href="/dc/new">+ Create DC</Link>}
      </Head>
      <section className="stack">
        <span className="sub">Your today&apos;s summary</span>
        <div className="tiles">
          <Tile tone="blue" label="DCs created" value={w.dcs.filter((d) => isoIST(d.created_at) === w.today).length} note="Today" />
          <Tile tone="green" label="Dispatched" value={disp.length} note={`${sumByCur(disp.map((d) => [w.dcValue(d), w.currencyOf(d.so_id)]))} today`} />
          <Tile tone="yellow" label="GRNs waiting for DC" value={pend.length} note={`${nf(pend.reduce((a, g) => a + w.grnAvail(g), 0))} units`} />
          <Tile tone="pink" label="Draft DCs" value={w.dcs.filter((d) => d.status === "draft").length} note="Not yet dispatched" href={href("draft")} />
          <Tile alarm={late > 0} label="Held over 24h" value={late} note="Zero-inventory breaches" href="/grn?status=held" />
        </div>
      </section>
      <details className="panel" open={filtered}>
        <summary>Filter DCs</summary>
        <AutoForm className="fgrid mt-3">
          <input type="hidden" name="status" value={status} />
          {q && <input type="hidden" name="q" value={q} />}
          <label className="field"><span>From</span><input type="date" name="from" className="inp" defaultValue={p("from")} /></label>
          <label className="field"><span>To</span><input type="date" name="to" className="inp" defaultValue={p("to")} /></label>
          <label className="field"><span>Customer</span>
            <select name="buyer" className="inp" defaultValue={p("buyer")}>
              <option value="">All buyers</option>
              {w.buyers.map((b) => <option key={b.id} value={b.id}>{b.real_name ? `${b.code} · ${b.real_name}` : b.code}</option>)}
            </select>
          </label>
          <div className="field"><span>&nbsp;</span><Link className="btn" href="/dc">Clear filters</Link></div>
        </AutoForm>
      </details>
      <div className="row">
        <SearchParamInput placeholder="Search DC, GRN, sales order, invoice, tracking" />
        <Pills current={status} items={FILTERS.map((f) => ({ ...f, href: href(f.key) }))} />
      </div>
      <div className="cards">
        {status !== "dispatched" && pend.map((g) => (
          <article key={g.id} className="card doc-card" style={{ borderStyle: "dashed" }}>
            <div className="top"><b>{g.id}</b><HoldChip w={w} g={g} /></div>
            <div className="kv">
              <span>Doc</span><b>{g.so_id}</b>
              <span>Customer</span><b>{w.buyerCode(w.orderById.get(g.so_id)?.buyer_id)}</b>
              <span>Available</span><b>{nf(w.grnAvail(g))} units</b>
            </div>
            {ops && <div><Link className="btn sm primary" href={`/dc/new?grn=${g.id}`}>Create DC</Link></div>}
          </article>
        ))}
        {list.map((d) => <DcCard key={d.id} w={w} d={d} />)}
        {!list.length && !(status !== "dispatched" && pend.length) && (
          <Empty wide title={w.dcs.length ? "No DCs match" : "No delivery challans yet"}>
            {w.dcs.length ? "Try other filters." : "Create a DC from a GRN to invoice and dispatch to the buyer."}
          </Empty>
        )}
      </div>
    </>
  );
}
