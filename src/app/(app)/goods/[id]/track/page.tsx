import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TrackLine } from "@/components/order-ui";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers } from "@/lib/data";
import { istDate, dayNear, qty, todayIST } from "@/lib/format";
import { MODE_LABEL, nextStage, stageLabel, trackLink, trackState, trackSteps, type Mode, type Stage, type Tracking } from "@/lib/tracking";
import { createClient } from "@/lib/supabase/server";
import { AddUpdate, TakeBackUpdate, TrackDetails } from "./track-forms";

// Door to door for one shipped part: how it travels, each stage it has passed, and an update at the next one.
// The buyer sees the same journey on its page (never the factory).
export default async function TrackPage({ params }: PageProps<"/goods/[id]/track">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const { data: d } = await supabase.from("dispatches")
    .select("id, order_id, shipped_at, lr_no, lr_date, transporter, cartons, invoice_no, grn_at, cancelled_at, track_mode, track_carrier, track_no, track_to, track_eta, track_delivered_on")
    .eq("id", id).maybeSingle();
  if (!d || d.cancelled_at) notFound();
  const [{ data: o }, { data: events }, { data: dl }, buyers] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_id, buyer_po").eq("id", d.order_id).maybeSingle(),
    supabase.from("shipment_events").select("id, stage, happened_on, place, note, created_at").eq("dispatch_id", id).is("cancelled_at", null).order("happened_on").order("created_at"),
    supabase.from("dispatch_lines").select("qty").eq("dispatch_id", id),
    loadBuyers(),
  ]);
  if (!o) notFound();
  const today = todayIST();
  const buyer = buyers.find((b) => b.id === o.buyer_id);
  const pieces = (dl ?? []).reduce((n, l) => n + Number(l.qty), 0);

  if (!d.shipped_at) {
    return (
      <>
        <div className="head"><div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/goods">Goods</Link> / {o.order_no}</nav>
          <h1>Tracking</h1>
        </div></div>
        <div className="warnbox">This lot hasn&apos;t left yet. Tracking starts once its LR is added in the order&apos;s Dispatch.</div>
        <Link className="btn" href={`/orders/${o.id}#dispatch`}>Open the order</Link>
      </>
    );
  }

  const mode = (d.track_mode ?? null) as Mode | null;
  const shippedOn = d.lr_date ?? istDate(d.shipped_at);
  const t: Tracking = {
    mode, carrier: d.track_carrier, track_no: d.track_no, to: d.track_to, eta: d.track_eta, delivered_on: d.track_delivered_on, shipped_on: shippedOn,
    events: (events ?? []).map((e) => ({ id: e.id, stage: e.stage as Stage, on: e.happened_on, place: e.place, note: e.note })),
  };
  const steps = trackSteps(t);
  const state = trackState(t, today);
  const link = trackLink(d.track_carrier, d.track_no);
  const delivered = steps.at(-1)!.done;

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/goods?show=on-way">Goods</Link> / <Link href={`/orders/${o.id}#dispatch`}>{o.order_no}</Link></nav>
          <h1>{delivered ? "Delivered" : state.text.split(" · ")[0]}</h1>
          <p>
            {[buyer ? buyerName(buyer) : "", o.buyer_po ? `PO ${o.buyer_po}` : "", pieces ? `${qty(pieces)} pcs` : "", d.cartons ? `${d.cartons} cartons` : "",
              `left ${dayNear(shippedOn, today)}`, d.track_to ? `to ${d.track_to}` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        {state.tone === "warn" && <span className="chip warn">{state.text.split(" · ")[1]}</span>}
        {delivered && <span className="chip ok">Delivered {dayNear(steps.at(-1)!.on, today)}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card" aria-labelledby="trk-journey">
          <div className="card-h">
            <div>
              <h2 id="trk-journey">Journey</h2>
              <p>{d.track_eta && !delivered ? `Expected ${dayNear(d.track_eta, today)}.` : delivered ? "Door to door, done." : "Add the arrival date below."} The buyer sees this on its page.</p>
            </div>
          </div>
          <div className="px-5 pt-3 pb-2"><TrackLine steps={steps} eta={d.track_eta} today={today} /></div>
          {!delivered && (
            <div className="border-t border-line px-5 py-4">
              <h3 className="font-semibold text-[14px] mb-2">Add an update</h3>
              <AddUpdate id={id} mode={mode} next={nextStage(t)} today={today} shippedOn={shippedOn} />
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="trk-how">
          <div className="card-h">
            <div>
              <h2 id="trk-how">How it travels</h2>
              <p>{mode ? [MODE_LABEL[mode], d.track_carrier].filter(Boolean).join(" · ") : "Not set yet: road, sea, air or courier."}</p>
            </div>
            {mode && <TrackDetails id={id} mode={mode} carrier={d.track_carrier} no={d.track_no} to={d.track_to} eta={d.track_eta} shippedOn={shippedOn} />}
          </div>
          <div className="px-5 py-4 stack">
            {!mode && <TrackDetails id={id} mode={mode} carrier={d.track_carrier} no={d.track_no} to={d.track_to} eta={d.track_eta} shippedOn={shippedOn} />}
            {mode && (
              <dl className="trk-grid text-[14px]">
                <div><dt className="muted text-[12px]">Number</dt><dd className="code">{d.track_no ?? "—"}</dd></div>
                <div><dt className="muted text-[12px]">Going to</dt><dd>{d.track_to ?? "—"}</dd></div>
                <div><dt className="muted text-[12px]">Expected</dt><dd>{d.track_eta ? dayNear(d.track_eta, today) : "—"}</dd></div>
                <div><dt className="muted text-[12px]">LR</dt><dd>{[d.transporter, d.lr_no].filter(Boolean).join(" · ") || "—"}</dd></div>
              </dl>
            )}
            {link && <a className="btn" href={link} target="_blank" rel="noreferrer">Track on {d.track_carrier}&apos;s site</a>}
          </div>
          {(events ?? []).length > 0 && (
            <details className="border-t border-line px-5 py-3">
              <summary className="text-[13px] muted cursor-pointer">Updates recorded ({events!.length})</summary>
              <ul className="trk-hist">
                {events!.map((e) => (
                  <li key={e.id}>
                    <span>{stageLabel(e.stage as Stage, mode)} · {dayNear(e.happened_on, today)}{e.place ? ` · ${e.place}` : ""}</span>
                    <TakeBackUpdate id={id} eventId={e.id} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>

      <details className="howto">
        <summary>How tracking works</summary>
        <p>Each part that leaves gets its journey: for sea and air, the port, sailing or flight, arrival, customs and delivery; for road and courier, on the road, out for delivery and delivered. Add an update at each stage with the day.</p>
        <p>Past its expected arrival without delivery, or 10 days without an update, it shows amber on Goods. &ldquo;Delivered&rdquo; counts for the Guarantee&apos;s delivery milestone; the buyer&apos;s GRN is still asked for as before.</p>
      </details>
    </>
  );
}
