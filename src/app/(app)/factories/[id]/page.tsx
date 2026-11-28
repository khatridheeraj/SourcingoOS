import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEnterDone, getMe } from "@/lib/auth";
import { BUYER_SHOWS, buyerLine, factoryRecord, LEVEL_WORDS, MIN_CHECKS, MIN_SHIPMENTS, MIN_STEPS, type RecordFacts } from "@/lib/factory-record";
import { day, money, qty, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CapacityWeeks } from "@/components/capacity-weeks";
import { type CertRow, FactoryCerts } from "@/components/factory-certs";
import type { FactoryCap } from "@/lib/capacity";
import { leadFor, leadLine, type LeadRow, MIN_LEAD_ORDERS } from "@/lib/lead-time";
import { PHOTO_BUCKET } from "@/lib/storage";
import type { DefectStats } from "@/lib/defects";
import { checkCert, removeCert, saveCapacity, saveCert } from "./actions";
import { VisitForm } from "./visit-form";

// One factory's record: what it has earned on its orders with us, and what our own visit confirmed.
// The same numbers drive its panel and the line buyers read under their PO, so this page is the one place they're explained.
export default async function FactoryRecordPage({ params }: PageProps<"/factories/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEnterDone(me?.role)) redirect("/");
  const supabase = await createClient();
  const [{ data }, { data: certRows }, { data: capRows }, { data: leadRows }, { data: kinds }, { data: defRow }, { data: rateRows }] = await Promise.all([
    supabase.rpc("factory_records", { p_factory: id }),
    supabase.from("factory_certificates").select("id, name, cert_no, valid_until, path, file_name, status, status_note, from_factory")
      .eq("factory_id", id).is("removed_at", null).order("name").order("created_at"),
    supabase.rpc("factory_capacity", { p_factory: id, p_weeks: 8 }),
    supabase.rpc("lead_times"),
    // What it mostly makes, so the lead time quoted is for the right kind of goods.
    supabase.from("order_lines").select("product").eq("factory_id", id).is("removed_at", null).limit(500),
    // The defects our checks find most on its styles, and how buyers rated the orders it made.
    supabase.rpc("defect_stats", { p_factory: id, p_days: 365 }),
    supabase.rpc("factory_ratings", { p_factory: id }),
  ]);
  const topDefects = ((defRow as DefectStats | null)?.top ?? []).slice(0, 5);
  const ratings = (rateRows ?? []) as { order_id: string; order_no: string; score: number; comment: string | null; created_at: string }[];
  const avgRating = ratings.length ? Math.round((ratings.reduce((a, r) => a + r.score, 0) / ratings.length) * 10) / 10 : null;
  const f = ((data ?? []) as RecordFacts[])[0];
  if (!f) notFound();
  const rawCerts = (certRows ?? []) as (Omit<CertRow, "url"> & { path: string | null })[];
  const paths = rawCerts.map((c) => c.path).filter((x): x is string => !!x);
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  const certs: CertRow[] = rawCerts.map(({ path, ...c }) => ({ ...c, url: path ? urlOf.get(path) ?? null : null }));
  const cap = ((capRows ?? []) as FactoryCap[])[0];
  const fabricCount = ((kinds ?? []) as { product: string }[]).filter((k) => k.product === "fabric").length;
  const product = fabricCount * 2 > (kinds ?? []).length ? "fabric" : "garment";
  const lead = leadFor((leadRows ?? []) as LeadRow[], id, product);
  const today = todayIST();
  const r = factoryRecord(f, today);
  const canVerify = ["owner", "manager", "merchandiser", "quality"].includes(me?.role ?? "");
  const folder = `${me?.companyId}/factory-files/${id}/certs`;
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

      <section className="panel stack" aria-labelledby="lead-h">
        <div>
          <h2 id="lead-h" className="font-bold">Lead time</h2>
          <p className="text-[14px] num">{leadLine(lead, product)}</p>
          {lead?.scope === "company" && (
            <small className="muted">Our record across every factory: this one has {f.lead_orders ? `only ${f.lead_orders} shipped` : "none shipped"} yet.</small>
          )}
          {!lead && <small className="muted">It shows once {MIN_LEAD_ORDERS} orders have shipped, counted from the PO date to the first shipment.</small>}
        </div>
      </section>

      {cap && <CapacityWeeks weeks={cap.weeks} mode="team" canEdit={!!me?.role} save={saveCapacity.bind(null, id)} />}

      <FactoryCerts rows={certs} today={today} folder={folder} mode="team" canEdit={canVerify}
        actions={{ save: saveCert.bind(null, id), remove: removeCert.bind(null, id), check: checkCert.bind(null, id) }} />

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
            <div><dt>Certificates seen</dt><dd>{f.verified?.certs.length ? f.verified.certs.map((c) => c.name).join(", ") : "None noted"}</dd></div>
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
          <div><dt>Buyers&apos; rating</dt><dd>{avgRating != null ? `${avgRating} of 5 · ${ratings.length} ${ratings.length === 1 ? "order" : "orders"}` : "Not rated yet"}</dd></div>
          <div><dt>Accepts a PO in</dt><dd>{f.accept_hours != null ? hours(Number(f.accept_hours)) : "No PO accepted in the app yet"}</dd></div>
        </dl>
        {topDefects.length > 0 && (
          <div className="mt-4">
            <span className="eyebrow">Defects we find most on its styles</span>
            <ul className="fixlist">{topDefects.map((t) => <li key={t.defect}><span>{t.defect}</span><span className="num muted">{qty(t.pieces)} pcs · {t.checks} {t.checks === 1 ? "check" : "checks"}</span></li>)}</ul>
          </div>
        )}
        {ratings.some((r) => r.comment) && (
          <div className="mt-4">
            <span className="eyebrow">What buyers said</span>
            <ul className="fixlist">{ratings.filter((r) => r.comment).slice(0, 5).map((r) => (
              <li key={r.order_id}><span>“{r.comment}”</span><span className="num muted">{r.score}/5 · <Link className="link" href={`/orders/${r.order_id}`}>{r.order_no}</Link></span></li>
            ))}</ul>
          </div>
        )}
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
        <p>Lead time: days from the PO date to the first shipment from this factory, on its own orders once it has {MIN_LEAD_ORDERS}, else across all our factories. The first number is the middle order; the later one is what 4 orders in 5 made, the date to promise a buyer.</p>
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
