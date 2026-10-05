import Link from "next/link";
import { notFound } from "next/navigation";
import { day } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "../order-form";
import { OrderHistory } from "./order-history";
import { formOptions } from "../options";

const str = (v: unknown) => (v == null ? "" : String(v));

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("orders")
    .select("id, order_no, buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes, created_at, updated_at, order_lines(id, style, description, colour, qty, buyer_rate, factory_id, factory_rate, position)")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();

  const lines = [...(o.order_lines ?? [])].sort((a, b) => a.position - b.position);
  const opts = await formOptions({ buyerId: o.buyer_id, factoryIds: lines.map((l) => l.factory_id).filter(Boolean) as string[] });

  return (
    <>
      <div className="head">
        <div className="grow">
          <Link href="/" className="link text-xs">← Orders</Link>
          <h1><span className="code text-[19px]">{o.order_no}</span> · {o.buyer_po}</h1>
          <p>Entered {day(o.created_at.slice(0, 10))}{o.updated_at.slice(0, 16) !== o.created_at.slice(0, 16) && `, last changed ${day(o.updated_at.slice(0, 10))}`}</p>
        </div>
      </div>
      {saved && <div className="okbox">Order saved as {o.order_no}.</div>}
      <OrderForm
        key={o.updated_at}
        orderNo={o.order_no}
        initial={{
          id: o.id, buyer_id: o.buyer_id, buyer_po: o.buyer_po, po_date: str(o.po_date), ship_date: str(o.ship_date),
          status: o.status, merchandiser_id: str(o.merchandiser_id), notes: str(o.notes),
        }}
        initialLines={lines.map((l) => ({
          id: l.id, style: l.style, description: str(l.description), colour: str(l.colour), qty: str(l.qty),
          buyer_rate: str(l.buyer_rate), factory_id: str(l.factory_id), factory_rate: str(l.factory_rate),
        }))}
        buyers={opts.buyers}
        factories={opts.factories}
        team={opts.team}
        canDelete={opts.canDelete}
      />
      <OrderHistory orderId={o.id} />
    </>
  );
}
