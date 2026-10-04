import { redirect } from "next/navigation";
import { Empty, Head } from "@/components/bits";
import { AutoForm } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { buyerStage, fmtDay, nf, STAGES, unitOf } from "@/lib/model";
import { isOps } from "@/lib/roles";

export const metadata = { title: "Buyer view · Sourcingo OS" };

export default async function BuyerView({ searchParams }: PageProps<"/buyer-view">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/");
  const { buyer } = await searchParams;
  const { world: w } = await loadWorld();
  const pick = w.buyers.find((b) => b.id === buyer) ?? w.buyers[0];
  // Buyers never see drafts (the portal hides them too).
  const list = pick ? w.orders.filter((o) => o.buyer_id === pick.id && o.status !== "draft") : [];

  return (
    <>
      <Head crumbs="Reports › Buyer view" title="Buyer view" sub="A preview of the buyer portal: milestones only, never factory activities, factory rates or internal notes.">
        <AutoForm>
          <label className="field" style={{ minWidth: 240 }}>
            <span>Buyer</span>
            <select name="buyer" className="inp" defaultValue={pick?.id ?? ""}>
              {w.buyers.length ? w.buyers.map((b) => <option key={b.id} value={b.id}>{b.real_name ? `${b.code} · ${b.real_name}` : b.code}</option>) : <option value="">No buyers yet</option>}
            </select>
          </label>
        </AutoForm>
      </Head>
      {list.length ? (
        <div className="stack">
          {list.map((o) => {
            const stg = buyerStage(o);
            const dcs = w.dcs.filter((d) => d.so_id === o.id && d.status === "dispatched");
            return (
              <article key={o.id} className="card">
                <div className="row">
                  <h3 className="flex-1 text-[15px] font-bold">PO #{o.buyer_po_number}</h3>
                  <span className="text-xs text-muted">Delivery by {fmtDay(o.buyer_date)}</span>
                </div>
                <div className="meta mt-1">
                  {o.styles.map((s) => <span key={s.id}>{s.name || "Style"} · {s.colour} · <b className="num">{nf(s.qty)} {unitOf(o)}</b></span>)}
                </div>
                <div className="steps">
                  {STAGES.map((s, k) => (
                    <div key={s} className={`step ${k < stg || (k === stg && stg === 5) ? "done" : ""} ${k === stg && stg !== 5 ? "now" : ""}`}>{s}</div>
                  ))}
                </div>
                {dcs.length > 0 && (
                  <p className="mt-2.5 text-[12.5px]">
                    {dcs.map((d) => <span key={d.id} className="block">Shipped {fmtDay(d.dispatched_at)} via {d.courier} · {d.tracking}</span>)}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title="No orders for this buyer yet">Orders appear here once they&apos;re sent for the TNA lock.</Empty>
      )}
    </>
  );
}
