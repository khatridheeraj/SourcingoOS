import Link from "next/link";
import { notFound } from "next/navigation";
import { day, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "../order-form";
import { OrderHistory } from "./order-history";
import { OrderProduction } from "./order-production";
import { OrderQc, type QcCheck } from "./order-qc";
import { loadTeam, personName } from "@/lib/data";
import { formOptions } from "../options";

const str = (v: unknown) => (v == null ? "" : String(v));

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("orders")
    .select("id, order_no, buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes, stage, stage_at, revised_ship_date, delay_reason, created_at, updated_at, order_lines(id, style, description, colour, qty, buyer_rate, factory_id, factory_rate, position)")
    .eq("id", id)
    .is("order_lines.removed_at", null)
    .maybeSingle();
  if (!o) notFound();

  const lines = [...(o.order_lines ?? [])].sort((a, b) => a.position - b.position);
  const [{ data: qc }, team] = await Promise.all([
    supabase
      .from("qc_checks")
      .select("id, kind, checked_on, result, pieces_checked, defects, notes, checked_by, cancelled_at, cancel_reason")
      .eq("order_id", id)
      .order("checked_on", { ascending: false })
      .order("created_at", { ascending: false }),
    loadTeam(),
  ]);
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const checks: QcCheck[] = (qc ?? []).map((c) => ({ ...c, by: (c.checked_by && people.get(c.checked_by)) || "Someone" }));
  const finalPassed = checks.find((c) => c.kind === "final" && !c.cancelled_at)?.result === "pass";
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
      <OrderProduction
        id={o.id}
        open={o.status === "open"}
        shipDate={str(o.ship_date)}
        today={todayIST()}
        stageAt={o.stage_at}
        initial={{ stage: str(o.stage), revised_ship_date: str(o.revised_ship_date), delay_reason: str(o.delay_reason) }}
      />
      <OrderQc orderId={o.id} open={o.status === "open"} today={todayIST()} checks={checks} finalPassed={finalPassed} />
      <OrderForm
        key={o.updated_at}
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
      />
      <OrderHistory orderId={o.id} />
    </>
  );
}
