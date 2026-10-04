import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head, Pills } from "@/components/bits";
import { ClickRow } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDay, FPO_LABEL, FPO_TONE, isoIST, money, nf } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { IssueButton } from "./buttons";

export const metadata = { title: "Factory POs · Sourcingo OS" };

const FILTERS = [["open", "Waiting"], ["accepted", "Accepted"], ["closed", "Replaced or withdrawn"], ["all", "All"]] as const;

export default async function FactoryPos({ searchParams }: PageProps<"/fpos">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const sp = await searchParams;
  const f = FILTERS.some(([k]) => k === sp.status) ? String(sp.status) : "open";
  const { world: w } = await loadWorld();
  const list = w.fpos.filter((p) =>
    f === "all" ? true : f === "open" ? p.status === "issued" || p.status === "declined" : f === "accepted" ? p.status === "accepted" : p.status === "superseded" || p.status === "cancelled");
  // Running orders that never got a PO (locked before this existed, or no factory then).
  const missing = w.orders.filter((o) => o.status === "locked" && o.factory_id && !w.fpos.some((p) => p.so_id === o.id && (p.status === "issued" || p.status === "accepted")));
  const count = (k: string) => w.fpos.filter((p) => (k === "open" ? p.status === "issued" || p.status === "declined" : k === "accepted" ? p.status === "accepted" : false)).length;

  return (
    <>
      <Head crumbs="Production › Factory POs" title="Factory POs" sub="The purchase order each factory gets when a TNA is locked: styles, quantities, rates and step dates. The factory accepts it in its portal." />
      <Pills current={f} items={FILTERS.map(([k, l]) => ({ key: k, label: l, href: `/fpos?status=${k}`, n: k === "open" ? count("open") : undefined }))} />
      {list.length ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>PO</th><th>Order</th><th>Factory</th><th>Deliver by</th><th>Qty</th><th>Value</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const o = w.orderById.get(p.so_id);
                return (
                  <ClickRow key={p.id} href={`/fpos/${p.id}`}>
                    <td className="code"><Link className="text-accent" href={`/fpos/${p.id}`}>{p.id}</Link>{p.revision > 1 && <span className="text-muted"> rev {p.revision}</span>}<br /><span className="text-xs text-muted">sent {fmtDay(isoIST(p.issued_at))}</span></td>
                    <td className="code">{p.so_id}<br /><span className="text-muted">{w.buyerCode(o?.buyer_id)}</span></td>
                    <td>{w.factoryName(p.factory_id)}</td>
                    <td className="num whitespace-nowrap">{fmtDay(p.delivery_date)}</td>
                    <td className="num">{nf(p.total_qty)}</td>
                    <td className="num whitespace-nowrap">{p.total_value != null ? money(p.total_value, p.currency) : <span className="text-warn">Rate missing</span>}</td>
                    <td><span className={`chip ${FPO_TONE[p.status]}`}>{FPO_LABEL[p.status]}</span>{p.response_note && <span className="block text-xs text-muted">“{p.response_note}”</span>}</td>
                  </ClickRow>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={f === "open" ? "Nothing waiting" : "No factory POs here"}>{f === "open" ? "Every PO sent has been accepted." : "POs appear when the owner locks a TNA."}</Empty>
      )}
      {isOps(me?.role) && missing.length > 0 && (
        <section className="panel">
          <h3>Running orders without a factory PO ({missing.length})</h3>
          <p className="mb-3 text-[13px] text-muted">These were locked before factory POs existed, or before the factory was chosen. Fill in the factory rates and TNA first (Fix my data), then send the PO.</p>
          <div className="list-rows">
            {missing.slice(0, 80).map((o) => {
              const noRate = o.styles.filter((s) => s.factory_rate == null).length;
              const noTna = o.styles.some((s) => !s.checkpoints.length);
              return (
                <div key={o.id}>
                  <span className="grow"><Link className="code text-accent" href={`/orders/${o.id}`}>{o.id}</Link> <span className="text-muted">#{o.buyer_po_number} · {w.buyerCode(o.buyer_id)} · {w.factoryName(o.factory_id)}</span>
                    {(noRate > 0 || noTna) && <span className="block text-xs text-warn">{[noRate && `${noRate} style${noRate === 1 ? "" : "s"} without a rate`, noTna && "no TNA yet"].filter(Boolean).join(" · ")}</span>}
                  </span>
                  <IssueButton soId={o.id} />
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
