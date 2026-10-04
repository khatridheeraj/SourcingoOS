import { notFound } from "next/navigation";
import { FpoLines, FpoSchedule } from "@/components/fpo-view";
import { Letterhead, loadCompany, Signatures } from "@/components/print-bits";
import { getMe } from "@/lib/auth";
import { fmtDay, type Fpo, isoIST, money, nf } from "@/lib/model";
import { isInternal } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/print/fpo/[id]">) {
  return { title: `${(await params).id} · Purchase order` };
}

type FactoryInfo = { name: string; city: string | null; address?: string | null; gstin?: string | null; contact?: string | null; phone?: string | null; state?: string | null };

// The purchase order as the factory receives it. Factories print their own.
export default async function PrintFpo({ params }: PageProps<"/print/fpo/[id]">) {
  const { id } = await params;
  const me = await getMe();
  const supabase = await createClient();
  const internal = isInternal(me?.role);
  const { data } = internal
    ? await supabase.from("factory_pos").select("*, sales_orders(order_type, buyer_id, buyers(code))").eq("id", id).maybeSingle()
    : await supabase.from("portal_factory_pos").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = data as Fpo & { sales_orders?: any; buyer_code?: string };
  const buyer = internal ? p.sales_orders?.buyers?.code : p.buyer_code;
  const fac = (internal
    ? (await supabase.from("factories").select("name, city, address, gstin, contact, phone, state").eq("id", p.factory_id).maybeSingle()).data
    : (await supabase.from("portal_factory_profile").select("name, city").maybeSingle()).data) as FactoryInfo | null;
  const c = await loadCompany();
  const unit = p.sales_orders?.order_type === "fabric" ? "m" : "pcs";

  return (
    <>
      <Letterhead c={c} title="Purchase order" number={`${p.id}${p.revision > 1 ? ` · rev ${p.revision}` : ""}`} sub={<div>Date {fmtDay(isoIST(p.issued_at))}</div>} />
      {(p.status === "superseded" || p.status === "cancelled") && <p className="errbox mb-3">This PO is {p.status === "superseded" ? "replaced by a newer revision" : "withdrawn"}. Do not use it.</p>}
      <div className="pgrid">
        <div>
          <h4>To (factory)</h4>
          <b>{fac?.name ?? "—"}</b>
          {fac?.address && <div className="whitespace-pre-line">{fac.address}</div>}
          <div>{[fac?.city, fac?.state].filter(Boolean).join(", ")}</div>
          {fac?.gstin && <div>GSTIN {fac.gstin}</div>}
          {(fac?.contact || fac?.phone) && <div>{[fac?.contact, fac?.phone].filter(Boolean).join(" · ")}</div>}
        </div>
        <div>
          <h4>Order</h4>
          <div>Our order <b className="code">{p.so_id}</b> · buyer <b className="code">{buyer ?? "—"}</b></div>
          <div>Deliver to Sourcingo by <b>{fmtDay(p.delivery_date)}</b></div>
          <div>Payment terms <b>{p.payment_terms || "As agreed"}</b></div>
          <div>Status <b>{p.status === "accepted" ? `Accepted ${p.responded_at ? fmtDay(isoIST(p.responded_at)) : ""}` : p.status === "issued" ? "Awaiting acceptance" : p.status}</b></div>
        </div>
      </div>
      <FpoLines lines={p.lines} currency={p.currency} unit={unit} />
      <div className="ptotal"><span>Total {nf(p.total_qty)} {unit}</span><span>{p.total_value != null ? money(p.total_value, p.currency) : ""}</span></div>
      <h4 className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-widest text-[#666]">Step dates</h4>
      <FpoSchedule lines={p.lines} />
      {p.terms && <div className="pterms"><b>Terms</b>{"\n"}{p.terms}</div>}
      <Signatures left={`For ${c.trade_name}`} right={`Accepted by ${fac?.name ?? "factory"}`} />
    </>
  );
}
