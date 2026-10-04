import { notFound, redirect } from "next/navigation";
import { Letterhead, loadCompany, Signatures } from "@/components/print-bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDay, money, nf, orderQty, orderValue, SIZES, unitOf } from "@/lib/model";
import { isInternal } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/print/order/[id]">) {
  return { title: `${(await params).id} · Sales order` };
}

// Order confirmation for the buyer. Staff prints carry the buyer code; only
// the owner's print carries the buyer's real name.
export default async function PrintOrder({ params }: PageProps<"/print/order/[id]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const o = w.orderById.get(id);
  if (!o) notFound();
  const c = await loadCompany();
  const supabase = await createClient();
  const { data: terms } = await supabase.from("company_profile").select("so_terms").maybeSingle();
  const b = w.buyerById.get(o.buyer_id);
  const unit = unitOf(o);

  return (
    <>
      <Letterhead c={c} title="Sales order" number={o.id} sub={<div>Date {fmtDay(o.so_date)}</div>} />
      <div className="pgrid">
        <div>
          <h4>Buyer</h4>
          <b>{b?.real_name ?? b?.code}</b>
          {b?.real_name && <div className="code">{b.code}</div>}
          {o.delivery_address && <div className="whitespace-pre-line">{o.delivery_address}</div>}
        </div>
        <div>
          <h4>Order</h4>
          <div>Your PO <b>{o.buyer_po_number}</b></div>
          <div>Delivery <b>{fmtDay(o.buyer_date)}</b></div>
          <div>Payment terms <b>{o.payment_terms || "As agreed"}</b></div>
          <div>Currency <b>{o.currency}</b></div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Style</th><th>Fabric · colour</th><th>Qty</th><th>Rate</th><th>Value</th></tr></thead>
          <tbody>
            {o.styles.map((s, i) => (
              <tr key={s.id}>
                <td>{i + 1}</td>
                <td><b>{s.name}</b><br /><span className="code">{s.code}</span></td>
                <td>{s.fabric}<br />{s.colour}</td>
                <td className="num">{nf(s.qty)} {unit}{s.use_sizes && <span className="block text-xs">{SIZES.filter((z) => Number(s.sizes?.[z])).map((z) => `${z} ${s.sizes[z]}`).join(", ")}</span>}</td>
                <td className="num">{money(s.buyer_rate, o.currency)}</td>
                <td className="num">{money(s.qty * s.buyer_rate, o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ptotal"><span>Total {nf(orderQty(o))} {unit}</span><span>{money(orderValue(o), o.currency)}</span></div>
      {(o.terms || terms?.so_terms) && <div className="pterms"><b>Terms</b>{"\n"}{[o.terms, terms?.so_terms].filter(Boolean).join("\n\n")}</div>}
      <Signatures left={`For ${c.trade_name}`} right="Buyer's acceptance" />
    </>
  );
}
