import type { LinePrice } from "@/lib/margin";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditOrders, canEnterDone, canRecordQc, getMe } from "@/lib/auth";
import { fetchAll } from "@/lib/fetch-all";
import { day, dayAt, daysBetween, qty, SHIP_QC, STATUS, TNA_STEPS, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "../order-form";
import { FactoryUpdates, type PendingUpdate } from "./factory-updates";
import { OrderDispatch, type Dispatch, type DispatchFactory, type TallyBills } from "./order-dispatch";
import { OrderHistory } from "./order-history";
import { OrderMargin } from "./order-margin";
import { OrderProduction } from "./order-production";
import { OrderQc, type QcCheck } from "./order-qc";
import { OrderStyles, type Baseline, type ExtraStep, type FactoryGroup, type StepQc } from "./order-styles";
import { project, shipRisk } from "@/lib/tna-plan";
import { loadTeam, personName } from "@/lib/data";
import { PHOTO_BUCKET } from "@/lib/storage";
import { MarkShipped } from "../mark-shipped";
import { OrderSections, type SectionTab } from "./order-sections";
import { ShareUpdate, type ShareOption } from "./share-update";
import { formOptions } from "../options";

const str = (v: unknown) => (v == null ? "" : String(v));

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("orders")
    .select("id, company_id, order_no, edit_no, buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes, stage, stage_at, revised_ship_date, delay_reason, created_at, updated_at, order_lines(id, style, description, colour, qty, factory_id, position, photo_path)")
    .eq("id", id)
    .is("order_lines.removed_at", null)
    .maybeSingle();
  if (!o) notFound();

  // Rates come separately: the database gives them only to the orders team and Accounts.
  const { data: prices } = await supabase.rpc("line_prices", { p_orders: [id] });
  const priceOf = new Map(((prices ?? []) as LinePrice[]).map((p) => [p.id, p]));
  const lines = [...(o.order_lines ?? [])].sort((a, b) => a.position - b.position)
    .map((l) => ({ ...l, buyer_rate: priceOf.get(l.id)?.buyer_rate ?? null, factory_rate: priceOf.get(l.id)?.factory_rate ?? null }));
  const [{ data: qc }, team, me, { data: lineStages }, { data: factoryPos }, { data: stepUps }] = await Promise.all([
    supabase
      .from("qc_checks")
      .select("id, line_id, kind, checked_on, result, pieces_checked, defects, notes, checked_by, cancelled_at, cancel_reason")
      .eq("order_id", id)
      .order("checked_on", { ascending: false })
      .order("created_at", { ascending: false }),
    loadTeam(),
    getMe(),
    // Every style has 15 or more steps, so an order with many styles passes the 1,000 rows one read returns.
    fetchAll((a, z) => supabase.from("line_stages").select("line_id, stage, planned_on, done_on, not_needed, factory_on, label, added_at, updated_at, baseline_on, target_note")
      .eq("order_id", id).order("added_at").order("id").range(a, z)),
    supabase.from("factory_pos").select("factory_id, plan_requested_on, plan_requested_at, buffer_days, factory_sent_at, released_at, plan_entered_by").eq("order_id", id),
    // Steps factories marked done in their panel, waiting for the team to confirm.
    supabase.from("step_updates").select("id, line_id, factory_id, stage, done_on, note, photos, created_at").eq("order_id", id).eq("status", "pending").order("created_at"),
  ]);
  const canEdit = canEditOrders(me?.role);
  // Dispatches (purchase to GRN) are for the orders team only.
  const [{ data: dRows }, { data: dLines }, { data: tallyRaw }, { data: shipBlocker }] = canEdit
    ? await Promise.all([
        supabase.from("dispatches").select("*").eq("order_id", id).is("cancelled_at", null).order("purchased_at"),
        supabase.from("dispatch_lines").select("dispatch_id, line_id, qty, purchase_rate, sale_rate").in("line_id", (o.order_lines ?? []).map((l) => l.id)),
        // Bills in Tally that no dispatch has taken yet, to check typed numbers against, and whether the buyer is in Tally.
        supabase.rpc("dispatch_tally_bills", { p_order: id }),
        // Why the order can't be marked shipped yet: its goods must be bought and billed in Dispatch first.
        supabase.rpc("ship_blocker", { p_order: id }),
      ])
    : [{ data: [] }, { data: [] }, { data: null }, { data: null }];
  const tallyBills: TallyBills = { purchases: tallyRaw?.purchases ?? [], sales: tallyRaw?.sales ?? [], buyerInTally: !!tallyRaw?.buyer_in_tally };
  // Only this order's photos: reading the whole company's list stopped at 1,000 rows and dropped the newest.
  const { data: dPhotos } = dRows?.length
    ? await supabase.from("dispatch_photos").select("dispatch_id, path").in("dispatch_id", dRows.map((d) => d.id)).order("created_at")
    : { data: [] };
  const dispatchPhotos = dPhotos ?? [];
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  // Photos come from private storage through links that work for an hour.
  const qcIds = (qc ?? []).map((c) => c.id);
  const [{ data: photoRows }, { data: commentRows }] = qcIds.length
    ? await Promise.all([
        supabase.from("qc_photos").select("id, qc_id, path, kind, file_name").in("qc_id", qcIds).is("removed_at", null).order("created_at"),
        supabase.from("qc_comments").select("id, qc_id, body, created_by, created_at").in("qc_id", qcIds).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];
  const stylePaths = lines.map((l) => l.photo_path).filter(Boolean) as string[];
  const dispatchPaths = [...(dRows ?? []).flatMap((d) => [d.bill_path, d.invoice_path, d.eway_path, d.lr_path, d.grn_path]), ...dispatchPhotos.map((p) => p.path)].filter(Boolean) as string[];
  const allPaths = [...(photoRows ?? []).map((p) => p.path), ...stylePaths, ...dispatchPaths, ...(stepUps ?? []).flatMap((u) => u.photos as string[])];
  const { data: signed } = allPaths.length
    ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(allPaths, 3600)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  const checks: QcCheck[] = (qc ?? []).map((c) => ({
    ...c,
    by: (c.checked_by && people.get(c.checked_by)) || "Someone",
    photos: (photoRows ?? []).filter((p) => p.qc_id === c.id && p.kind === "photo" && urlByPath.has(p.path)).map((p) => ({ id: p.id, url: urlByPath.get(p.path)! })),
    reports: (photoRows ?? []).filter((p) => p.qc_id === c.id && p.kind === "report" && urlByPath.has(p.path))
      .map((p) => ({ id: p.id, url: urlByPath.get(p.path)!, name: p.file_name || "Report" })),
    comments: (commentRows ?? []).filter((m) => m.qc_id === c.id)
      .map((m) => ({ id: m.id, body: m.body, at: m.created_at, by: (m.created_by && people.get(m.created_by)) || "Someone" })),
  }));
  // Each style passes or fails its own final QC; the order is ready to ship when all of them have passed.
  const finalPassed = lines.length > 0 && lines.every((l) => checks.find((c) => c.line_id === l.id && SHIP_QC.includes(c.kind) && !c.cancelled_at)?.result === "pass");
  const opts = await formOptions({ buyerId: o.buyer_id, merchandiserId: o.merchandiser_id ?? undefined, factoryIds: lines.map((l) => l.factory_id).filter(Boolean) as string[] });

  const due = o.revised_ship_date || o.ship_date;
  const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
  // Styles grouped by factory, each with its PO's plan request and release.
  const groups: FactoryGroup[] = [];
  for (const l of lines) {
    let g = groups.find((x) => x.factoryId === (l.factory_id ?? null));
    if (!g) {
      const po = (factoryPos ?? []).find((p) => p.factory_id === l.factory_id);
      g = {
        factoryId: l.factory_id ?? null,
        factoryName: l.factory_id ? opts.factories.find((f) => f.id === l.factory_id)?.label ?? "Factory" : "No factory yet",
        factoryShort: opts.factories.find((f) => f.id === l.factory_id)?.name ?? "",
        factoryPhone: opts.factories.find((f) => f.id === l.factory_id)?.phone ?? null,
        planRequestedOn: str(po?.plan_requested_on),
        planRequestedAt: str(po?.plan_requested_at),
        bufferDays: po?.buffer_days ?? null,
        target: po?.buffer_days != null && due ? addDays(due, -po.buffer_days) : "",
        factorySentAt: str(po?.factory_sent_at),
        planEnteredBy: po?.plan_entered_by ? people.get(po.plan_entered_by) ?? "the orders team" : "",
        releasedAt: str(po?.released_at),
        lines: [],
      };
      groups.push(g);
    }
    g.lines.push({ id: l.id, style: l.style, colour: str(l.colour), qty: l.qty, photoUrl: (l.photo_path && urlByPath.get(l.photo_path)) || null, hasRate: l.factory_rate != null });
  }
  const factoryLabel = (fid: string) => opts.factories.find((f) => f.id === fid)?.label ?? "Factory";
  const pendingUpdates: PendingUpdate[] = (stepUps ?? []).map((u) => {
    const row = (lineStages ?? []).find((r) => r.line_id === u.line_id && r.stage === u.stage);
    return {
      id: u.id, style: lines.find((l) => l.id === u.line_id)?.style ?? "Style", factory: factoryLabel(u.factory_id),
      step: str(row?.label) || TNA_STEPS.find((t) => t.key === u.stage)?.label || u.stage,
      doneOn: u.done_on, target: str(row?.planned_on), note: str(u.note), sentAt: u.created_at,
      photos: (u.photos as string[]).map((p) => urlByPath.get(p)).filter((x): x is string => !!x),
    };
  });
  const dispatchFactories: DispatchFactory[] = groups.filter((g) => g.factoryId).map((g) => ({
    id: g.factoryId!, name: g.factoryName,
    lines: lines.filter((l) => l.factory_id === g.factoryId).map((l) => ({
      id: l.id, style: l.style, colour: str(l.colour), qty: l.qty, factoryRate: str(l.factory_rate), buyerRate: str(l.buyer_rate),
    })),
  }));
  const styleOf = new Map(lines.map((l) => [l.id, l.style]));
  // Styles whose latest final QC (or re-check) hasn't passed: their goods can't ship (the owner can still ship them).
  const qcNotPassed = (lineId: string) => checks.find((c) => c.line_id === lineId && SHIP_QC.includes(c.kind) && !c.cancelled_at)?.result !== "pass";
  const url = (p: string | null) => (p && urlByPath.get(p)) || null;
  const dispatches: Dispatch[] = (dRows ?? []).map((d) => ({
    id: d.id, factoryName: factoryLabel(d.factory_id), billNo: d.purchase_bill_no, billDate: d.purchase_bill_date,
    purchaseTaxable: Number(d.purchase_taxable), purchaseGst: Number(d.purchase_gst),
    purchaseTallyAmount: d.purchase_tally_amount == null ? null : Number(d.purchase_tally_amount), billUrl: url(d.bill_path), invoiceUrl: url(d.invoice_path), purchasedAt: d.purchased_at, invoiceDueAt: d.invoice_due_at,
    invoiceNo: d.invoice_no, invoiceTaxable: d.invoice_taxable == null ? null : Number(d.invoice_taxable), invoiceGst: d.invoice_gst == null ? null : Number(d.invoice_gst),
    invoicedAt: d.invoiced_at, ewayNo: d.eway_bill_no, ewayDate: d.eway_bill_date, ewayValidUntil: d.eway_valid_until, ewayUrl: url(d.eway_path), ewayFromTally: !!d.eway_from_tally,
    transporter: d.transporter, vehicleNo: d.vehicle_no, lrNo: d.lr_no, lrDate: d.lr_date, lrUrl: url(d.lr_path), cartons: d.cartons,
    shippedAt: d.shipped_at, grnDueOn: d.grn_due_on, grnUrl: url(d.grn_path), grnQty: d.grn_received_qty, grnNotes: d.grn_notes, grnAt: d.grn_at,
    photoUrls: dispatchPhotos.filter((p) => p.dispatch_id === d.id).map((p) => url(p.path)).filter(Boolean) as string[],
    qcNotPassed: [...new Set((dLines ?? []).filter((l) => l.dispatch_id === d.id && qcNotPassed(l.line_id)).map((l) => styleOf.get(l.line_id) ?? ""))]
      .filter(Boolean).sort(),
    lines: (dLines ?? []).filter((l) => l.dispatch_id === d.id).map((l) => ({
      style: styleOf.get(l.line_id) ?? "", qty: l.qty, purchaseRate: Number(l.purchase_rate), saleRate: l.sale_rate == null ? null : Number(l.sale_rate),
    })),
  }));
  // Quality's latest result for each style's TNA steps it checks (checks are newest first).
  const stepQc: Record<string, StepQc> = {};
  for (const l of lines) {
    for (const s of TNA_STEPS) {
      const c = checks.find((x) => !x.cancelled_at && x.line_id === l.id && s.qc?.includes(x.kind));
      if (c) stepQc[`${l.id}:${s.key}`] = { result: c.result, checkedOn: c.checked_on, kind: c.kind };
    }
  }

  // Ready-to-send updates: one for the buyer (no factories, no prices) and one per factory to chase its styles.
  const today = todayIST();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
  const stageRows = lineStages ?? [];
  const styleSteps = (lineId: string) => [
    ...TNA_STEPS.map((t) => ({ key: t.key, label: t.label, row: stageRows.find((r) => r.line_id === lineId && r.stage === t.key) })),
    ...stageRows.filter((r) => r.line_id === lineId && r.stage.startsWith("extra_")).map((r) => ({ key: r.stage, label: str(r.label), row: r })),
  ].filter((x) => !x.row?.not_needed);
  const finalOk = (lineId: string) => checks.find((c) => c.line_id === lineId && SHIP_QC.includes(c.kind) && !c.cancelled_at)?.result === "pass";
  const buyerLabel = opts.buyers.find((b) => b.id === o.buyer_id)?.label ?? "";
  const share: ShareOption[] = [{
    key: "buyer", label: "Buyer",
    text: [
      `*${buyerLabel} · PO ${o.buyer_po}*`,
      `Order update, ${day(today)}`,
      due ? `Ship date: ${day(due)}` : "",
      "",
      ...lines.map((l) => {
        // Where the style has got to: its furthest step done, and the step after it.
        const st = styleSteps(l.id);
        const at = st.reduce((m, x, i) => (x.row?.done_on ? i : m), -1);
        const next = st.slice(at + 1).find((x) => !x.row?.done_on);
        // A target already passed isn't a promise to the buyer: say the step is under way instead.
        const by = next?.row?.planned_on && next.row.planned_on >= today ? ` by ${dm(next.row.planned_on)}` : next?.row?.planned_on ? " (in progress)" : "";
        return `• ${l.style}${l.colour ? ` (${l.colour})` : ""}, ${qty(l.qty)} pcs: `
          + (at < 0 ? `not started${next ? `, first step ${next.label}${by}` : ""}` : `at ${st[at].label}${next ? `, next ${next.label}${by}` : ""}`)
          + `${finalOk(l.id) ? " ✅ Final QC passed" : ""}`;
      }),
      "",
      "Sourcingo",
    ].filter((x, i, a) => x !== "" || (a[i - 1] ?? "") !== "").join("\n"),
  }, ...(canEdit ? groups.filter((g) => g.factoryId).map((g) => ({
    key: g.factoryId!, label: g.factoryName,
    text: [
      `*${o.order_no} · ${g.factoryName}*`,
      `Please share today's status and photos for these styles:`,
      "",
      ...g.lines.map((l) => {
        const st = styleSteps(l.id);
        const over = st.filter((x) => !x.row?.done_on && x.row?.planned_on && x.row.planned_on < today);
        const next = st.find((x) => !x.row?.done_on);
        return `• ${l.style}${l.colour ? ` (${l.colour})` : ""}, ${qty(l.qty)} pcs: `
          + (over.length ? `${over[0].label} was due ${dm(over[0].row!.planned_on!)}${over.length > 1 ? ` (+${over.length - 1} more late)` : ""}`
            : next ? `next ${next.label}${next.row?.planned_on ? ` by ${dm(next.row.planned_on)}` : ""}` : "all steps done");
      }),
      g.target ? `\nEverything must be ready by ${day(g.target)}.` : "",
    ].filter((x, i, a) => x !== "" || (a[i - 1] ?? "") !== "").join("\n"),
  })) : [])];
  const behind = o.status !== "open" ? 0 : lines.filter((l) => styleSteps(l.id).some((x) => !x.row?.done_on && x.row?.planned_on && x.row.planned_on < today)).length;
  // Where the order is heading: its latest style, with every late step pushing the steps after it back.
  const outlook = o.status === "open" ? lines.map((l) => shipRisk(project(styleSteps(l.id).map((x) => ({ planned_on: x.row?.planned_on, done_on: x.row?.done_on })), today), due))
    .reduce((w, r) => (r.daysLate > w.daysLate || (w.level === "ok" && r.level === "behind") ? r : w), { level: "ok" as "ok" | "behind" | "risk", daysLate: 0 }) : null;
  const tabs: SectionTab[] = [
    { id: "tna", label: "Styles", count: pendingUpdates.length || behind || undefined, tone: pendingUpdates.length ? "info" : "bad" },
    { id: "qc", label: "QC" },
    ...(canEdit ? [{ id: "dispatch", label: "Dispatch" }, { id: "money", label: "Margin" }] : []),
    { id: "ship", label: "Ship date" },
    { id: "details", label: "Details" },
    { id: "history", label: "History" },
  ];

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Orders</Link><span aria-hidden>/</span><span>{o.order_no}</span></nav>
          <h1>{opts.buyers.find((b) => b.id === o.buyer_id)?.label ?? "Order"} <span className="font-normal text-muted">PO {o.buyer_po}</span></h1>
          <p className="row">
            <span className={STATUS[o.status]?.cls}>{STATUS[o.status]?.label}</span>
            <span>{due ? `Ships ${day(due)}` : "No ship date yet"}{o.status === "open" && due && due < todayIST() && <b className="text-bad"> · {daysBetween(due, todayIST())} days late</b>}</span>
            <span>{lines.length} {lines.length === 1 ? "style" : "styles"} · {qty(lines.reduce((t, l) => t + l.qty, 0))} pcs</span>
            {outlook?.level === "risk" && <span className="chip bad" title="A late step pushes back every step after it">Ship date at risk · about {outlook.daysLate} {outlook.daysLate === 1 ? "day" : "days"} late</span>}
          </p>
          <p className="hide-phone text-xs">Entered {dayAt(o.created_at)}{o.updated_at.slice(0, 16) !== o.created_at.slice(0, 16) && `, last changed ${dayAt(o.updated_at)}`}</p>
        </div>
        {/* Closing an order: once every style is bought and billed in Dispatch, and (except for the owner) its final QC has passed. */}
        <div className="head-acts">
          {/* Keyed like the styles below, so the message is worded afresh after every save. */}
          <ShareUpdate key={`${(lineStages ?? []).length}:${(lineStages ?? []).reduce((a, r) => (r.updated_at > a ? r.updated_at : a), "")}`} options={share} />
          {canEdit && o.status === "open" && <MarkShipped orderId={o.id} orderNo={o.order_no} blocked={shipBlocker as string | null} />}
        </div>
      </div>
      {saved && <div className="okbox">Order saved as {o.order_no}.</div>}
      <OrderSections tabs={tabs}>
      <div data-sec="tna">
      <FactoryUpdates orderId={o.id} updates={pendingUpdates} canReview={canEnterDone(me?.role) && o.status === "open"} />
      <OrderStyles
        // Start again from the saved dates whenever anyone's save changes them, so stale dates on this screen can't
        // be saved over someone else's newer ones.
        key={`${(lineStages ?? []).length}:${(lineStages ?? []).reduce((a, r) => (r.updated_at > a ? r.updated_at : a), "")}`}
        orderId={o.id}
        orderNo={o.order_no}
        companyId={o.company_id}
        open={o.status === "open"}
        canEdit={canEdit}
        canDone={canEnterDone(me?.role)}
        isOwner={me?.role === "owner"}
        today={todayIST()}
        now={new Date().toISOString()}
        dueDate={due ?? ""}
        groups={groups}
        initialExtras={(lineStages ?? []).filter((r) => r.stage.startsWith("extra_")).reduce<Record<string, ExtraStep[]>>((acc, r) => {
          (acc[r.line_id] ??= []).push({ stage: r.stage, label: str(r.label) });
          return acc;
        }, {})}
        factoryDates={Object.fromEntries((lineStages ?? []).filter((r) => r.factory_on).map((r) => [`${r.line_id}:${r.stage}`, String(r.factory_on)]))}
        initial={Object.fromEntries((lineStages ?? []).map((r) => [`${r.line_id}:${r.stage}`, { planned_on: str(r.planned_on), done_on: str(r.done_on), not_needed: !!r.not_needed }]))}
        baselines={Object.fromEntries((lineStages ?? []).filter((r) => r.baseline_on).map((r): [string, Baseline] => [`${r.line_id}:${r.stage}`, { on: String(r.baseline_on), note: str(r.target_note) }]))}
        qc={stepQc}
      />
      </div>
      <div data-sec="qc">
      <OrderQc orderId={o.id} companyId={o.company_id} open={o.status === "open"} canRecord={canRecordQc(me?.role)} today={todayIST()} checks={checks} finalPassed={finalPassed}
        styles={lines.map((l) => ({ id: l.id, style: l.style, colour: str(l.colour), qty: l.qty }))} />
      </div>
      {canEdit && (
        <div data-sec="dispatch"><OrderDispatch orderId={o.id} companyId={o.company_id} open={o.status === "open"} owner={me?.role === "owner"} factories={dispatchFactories}
          dispatches={dispatches} tally={tallyBills} now={Date.parse(new Date().toISOString())} today={todayIST()} /></div>
      )}
      {canEdit && (
        <div data-sec="money"><OrderMargin
          styles={lines.map((l) => ({
            id: l.id, style: l.style, colour: str(l.colour), qty: l.qty,
            buyerRate: l.buyer_rate == null ? null : Number(l.buyer_rate), factoryRate: l.factory_rate == null ? null : Number(l.factory_rate),
          }))}
          dispatches={dispatches}
        /></div>
      )}
      <div data-sec="ship"><OrderProduction
        id={o.id}
        open={o.status === "open"}
        canEdit={canEdit}
        shipDate={str(o.ship_date)}
        today={todayIST()}
        stage={o.stage}
        stageAt={o.stage_at}
        riskDays={outlook?.level === "risk" ? outlook.daysLate : 0}
        initial={{ revised_ship_date: str(o.revised_ship_date), delay_reason: str(o.delay_reason) }}
      /></div>
      <div data-sec="details">{canEdit ? <OrderForm
        key={o.updated_at}
        initial={{
          id: o.id, edit_no: o.edit_no, buyer_id: o.buyer_id, buyer_po: o.buyer_po, po_date: str(o.po_date), ship_date: str(o.ship_date),
          status: o.status, merchandiser_id: str(o.merchandiser_id), notes: str(o.notes),
        }}
        initialLines={lines.map((l) => ({
          id: l.id, style: l.style, description: str(l.description), colour: str(l.colour), qty: str(l.qty),
          buyer_rate: str(l.buyer_rate), factory_id: str(l.factory_id), factory_rate: str(l.factory_rate),
        }))}
        buyers={opts.buyers}
        factories={opts.factories}
        team={opts.team}
      /> : (
        // Quality sees what is being made, without prices.
        <section className="panel scroll-mt-20" id="details">
          <h2 className="mb-3 font-bold text-base">Order details</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Style</th><th>Colour</th><th>Description</th><th className="r">Pieces</th><th>Factory</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="code">{l.style}</td><td>{l.colour}</td><td>{l.description}</td>
                    <td className="r num">{qty(l.qty)}</td><td>{opts.factories.find((f) => f.id === l.factory_id)?.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.ship_date && <p className="muted mt-3 text-[13px]">Buyer&apos;s ship date {day(o.ship_date)}{o.revised_ship_date && `, now ${day(o.revised_ship_date)}`}.</p>}
        </section>
      )}</div>
      <div data-sec="history"><OrderHistory orderId={o.id} /></div>
      </OrderSections>
    </>
  );
}
