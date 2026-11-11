import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEnterDone, getMe } from "@/lib/auth";
import { BUYER_SHOWS, buyerLine, factoryRecord, LEVEL_WORDS, MIN_CHECKS, MIN_SHIPMENTS, MIN_STEPS, type RecordFacts } from "@/lib/factory-record";
import { day, money, qty, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { VisitForm } from "./visit-form";

// One factory's record: what it has earned on its orders with us, and what our own visit confirmed.
// The same numbers drive its panel and the line buyers read under their PO, so this page is the one place they're explained.
export default async function FactoryRecordPage({ params }: PageProps<"/factories/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEnterDone(me?.role)) redirect("/");
  const supabase = await createClient();
  const { data } = await supabase.rpc("factory_records", { p_factory: id });
  const f = ((data ?? []) as RecordFacts[])[0];
  if (!f) notFound();
  const today = todayIST();
  const r = factoryRecord(f, today);
  const canVerify = ["owner", "manager", "merchandiser", "quality"].includes(me?.role ?? "");
  const levelCls = r.level === "watch" ? "warn" : r.level === "strong" ? "ok" : "";
  const counted = f.steps_finished + f.steps_overdue;
  const forBuyer = buyerLine(f, r);
  const since = f.since ? day(f.since).replace(/^\d+ /, "") : null;

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Back"><Link href="/factories?view=list">Factories</Link><span aria-hidden>/</span><span>Record</span></nav>
          <div className="row">
            <h1>{f.name}</h1>
            {r.level !== "new" && <span className={`chip ${levelCls}`}>{LEVEL_WORDS[r.level]}</span>}
            {r.visit?.current && <span className="chip">Verified {day(r.visit.on)}</span>}
          </div>
          <p className="num">
            {[f.city, since && `with us since ${since}`, `${f.orders} ${f.orders === 1 ? "order" : "orders"}`,
              f.pieces_shipped ? `${qty(f.pieces_shipped)} pcs shipped` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {r.watch.length > 0 && (
        <div className="warnbox" role="status"><b>Watch this factory.</b> {r.watch.join(". ")}.</div>
      )}

      <section className="kpis" aria-label="Its record">
        <Kpi label="Steps on time" value={r.onTime} unit="%" tone={r.onTime != null && r.onTime < 70 ? "warn" : ""}
          detail={r.onTime != null ? `${f.steps_on_time} of ${counted}${f.steps_overdue ? ` · ${f.steps_overdue} open past target` : ""}` : `Shows after ${MIN_STEPS} steps (${counted} so far)`} />
        <Kpi label="Final QC passed first time" value={r.firstPass} unit="%" tone={r.firstPass != null && r.firstPass < 75 ? "warn" : ""}
          detail={r.firstPass != null ? `${f.final_first_pass} of ${f.final_firsts} styles` : `Shows after ${MIN_CHECKS} styles checked (${f.final_firsts} so far)`} />
        <Kpi label="Shipped by the ship date" value={r.shipOnTime} unit="%" tone={r.shipOnTime != null && r.shipOnTime < 80 ? "warn" : ""}
          detail={r.shipOnTime != null ? `${f.shipments_on_time} of ${f.shipments_dated} shipments` : `Shows after ${MIN_SHIPMENTS} shipments (${f.shipments_dated} so far)`} />
        <Kpi label="Defects at Final QC" value={r.defectRate} unit=" per 100"
          detail={r.defectRate != null ? `${qty(f.defects ?? 0)} in ${qty(f.pieces_checked ?? 0)} pcs checked` : "Shows after 100 pieces checked"} />
      </section>

      <section className="panel stack" aria-labelledby="ver-h">
        <div>
          <h2 id="ver-h" className="font-bold">Verified by Sourcingo</h2>
          <p className="muted text-[13px]">
            {r.visit ? (r.visit.current ? `Visited ${day(r.visit.on)}. Next visit due by ${day(r.visit.dueOn)}.` : `Last visit ${day(r.visit.on)}, over a year ago. Visit again to keep it verified.`)
              : "Not visited yet. A visit by our team is what lets buyers read “verified” next to this factory."}
          </p>
        </div>
        {r.visit && (
          <dl className="facts">
            <div><dt>GSTIN</dt><dd>{r.visit.gst ? "Checked, active" : "Not checked"}</dd></div>
            <div><dt>Udyam</dt><dd className="code">{r.visit.udyam ?? "Not seen"}</dd></div>
            <div>
              <dt>Certificates</dt>
              <dd>
                {r.certs.length ? (
                  <span className="row gap-1.5">
                    {r.certs.map((c) => (
                      <span key={c.name} className={`chip ${c.state === "expired" ? "bad" : c.state === "soon" ? "warn" : ""}`}>
                        {c.name}{c.until ? ` · ${c.state === "expired" ? "ran out" : "to"} ${day(c.until)}` : ""}
                      </span>
                    ))}
                  </span>
                ) : "None seen"}
              </dd>
            </div>
          </dl>
        )}
        {canVerify && <VisitForm factoryId={f.factory_id ?? id} today={today} hasVisit={!!r.visit?.current} lastId={f.verified?.id ?? null} />}
      </section>

      <section className="panel" aria-labelledby="more-h">
        <h2 id="more-h" className="font-bold">More from its work with us</h2>
        <dl className="facts">
          <div><dt>Pieces ordered</dt><dd>{qty(f.pieces_ordered ?? 0)}</dd></div>
          <div><dt>Claims raised</dt><dd>{f.claims ? `${f.claims} · ${money(f.claim_amount ?? 0)}` : "None"}</dd></div>
          <div><dt>Asked to move a date</dt><dd>{f.date_asks ? `${f.date_asks} ${f.date_asks === 1 ? "time" : "times"}${r.askRate != null ? ` · ${r.askRate}% of steps` : ""}` : "Never"}</dd></div>
          <div><dt>Accepts a PO in</dt><dd>{f.accept_hours != null ? hours(Number(f.accept_hours)) : "No PO accepted in the app yet"}</dd></div>
        </dl>
      </section>

      <section className="panel stack" aria-labelledby="see-h">
        <h2 id="see-h" className="font-bold">What others read</h2>
        <div>
          <span className="eyebrow">A buyer, under a PO this factory makes</span>
          <p className="text-[14px]">{forBuyer ?? `Nothing yet. Buyers see a line once the factory is verified, or once a measure reaches ${BUYER_SHOWS}%.`}</p>
          <small className="muted">Never the factory&apos;s name, rates, claims or Udyam, and only measures at {BUYER_SHOWS}% or better.</small>
        </div>
        <div>
          <span className="eyebrow">The factory, in its own panel</span>
          <p className="text-[14px]">The same numbers as above, so it knows what wins it the next order.</p>
        </div>
      </section>

      <details className="howto">
        <summary>How the record is worked out</summary>
        <p>Steps on time: steps finished on or before their target, out of every finished step with a target plus every step still open past its target on an open order. Steps the factory never had a target for, and steps marked not needed, don&apos;t count.</p>
        <p>Final QC first time: for each style, whether its first Final check passed. A check saved for a whole order counts for every factory on it. Cancelled checks don&apos;t count.</p>
        <p>Shipped by the ship date: shipments that left on or before the buyer&apos;s ship date. Defects: all defects found at Final QC, per 100 pieces checked.</p>
        <p>Strong record: at least 85% on time and 85% first-time QC, with no claims. Watch: under 70% on time, under 75% first-time QC, under 80% shipped by the date, or two claims or more.</p>
      </details>
    </>
  );
}

function Kpi({ label, value, unit, detail, tone = "" }: { label: string; value: number | null; unit: string; detail: string; tone?: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-label"><i />{label}</span>
      <b>{value == null ? "–" : `${value}${unit}`}</b>
      <small>{detail}</small>
    </div>
  );
}

function hours(h: number) {
  if (h < 1) return "under an hour";
  if (h < 48) return `${Math.round(h)} ${Math.round(h) === 1 ? "hour" : "hours"}`;
  return `${Math.round(h / 24)} days`;
}
