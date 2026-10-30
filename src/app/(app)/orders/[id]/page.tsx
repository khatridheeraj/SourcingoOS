import type { LinePrice } from "@/lib/margin";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { canEditOrders, canEnterDone, canRecordQc, getMe } from "@/lib/auth";
import { fetchAll } from "@/lib/fetch-all";
import { day, dayAt, dayAtNear, dayNear, money, moneyShort, qty, qtyTotal, qtyU, unitOf, unitOfAll, SHIP_QC, stageReached, STATUS, TNA_STEPS, todayIST } from "@/lib/format";
import { areaOf, journey, shipClock } from "@/lib/journey";
import { fileNamesStyle, styleKey } from "@/lib/po-match";
import { Outlook, PhotoStack, ShipClock } from "@/components/order-ui";
import { OrderJourney } from "./order-journey";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "../order-form";
import { FactoryUpdates, type PendingUpdate } from "./factory-updates";
import { OrderDispatch, type Dispatch, type DispatchFactory, type TallyBills } from "./order-dispatch";
import { OrderHistory } from "./order-history";
import { OrderMargin } from "./order-margin";
import { OrderProduction } from "./order-production";
import { OrderQc, type QcCheck } from "./order-qc";
import { OrderStyles, type Baseline, type ExtraStep, type FactoryGroup, type StepQc } from "./order-styles";
import { forecast, paceLookup } from "@/lib/progress";
import { loadPace, loadTeam, loadTerms, personName } from "@/lib/data";
import { isFinance } from "../../payments/load";
import { PHOTO_BUCKET } from "@/lib/storage";
import { OrderSections, type SectionTab } from "./order-sections";
import { ShareUpdate, type ShareOption } from "./share-update";
import { formOptions } from "../options";
import { SheetButton } from "@/components/order-sheet";
import type { LineFileKind } from "../actions";
import { loadShipProgress, orderShip } from "@/lib/shipments";
import { loadSampleThreads } from "@/lib/samples-server";
import { SampleThreadCard } from "../../samples/sample-thread";
import { PO_BUCKET, type StoredFile } from "@/lib/po-files";
import { BuyerPo, type FoundPo, type PoDoc } from "./buyer-po";
import { DeletePo } from "./delete-po";
import { OrderFloor, type FloorUpdate } from "./order-floor";
import { floorLine, floorStatus } from "@/lib/floor";
import { BuyerLink } from "../../buyers/buyer-link";

const str = (v: unknown) => (v == null ? "" : String(v));

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("orders")
    .select("id, company_id, order_no, edit_no, buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes, buyer_terms, stage, stage_at, revised_ship_date, delay_reason, closed_short_at, closed_short_by, short_reason, created_at, updated_at, order_lines(id, style, description, colour, qty, factory_id, position, photo_path, fabric, sizes, product)")
    .eq("id", id)
    .is("order_lines.removed_at", null)
    .maybeSingle();
  if (!o) notFound();

  // Rates come separately: the database gives them only to the orders team and Accounts.
  const { data: prices } = await supabase.rpc("line_prices", { p_orders: [id] });
  const priceOf = new Map(((prices ?? []) as LinePrice[]).map((p) => [p.id, p]));
  const lines = [...(o.order_lines ?? [])].sort((a, b) => a.position - b.position)
    .map((l) => ({ ...l, buyer_rate: priceOf.get(l.id)?.buyer_rate ?? null, factory_rate: priceOf.get(l.id)?.factory_rate ?? null }));
  // How late each factory usually runs, for the forecast; read alongside everything else.
  const paceP = loadPace();
  const [{ data: qc }, team, me, { data: lineStages }, { data: factoryPos }, { data: stepUps }, { data: lineFiles }, { data: shipRows }, { data: floorRows }] = await Promise.all([
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
    supabase.from("factory_pos").select("factory_id, plan_requested_on, plan_requested_at, buffer_days, factory_sent_at, released_at, plan_entered_by, lock_requested_at, lock_requested_by, lock_note, lock_note_at, mailed_at, reply_at, last_mailed_at, accepted_at").eq("order_id", id),
    // Steps factories marked done in their panel, waiting for the team to confirm.
    supabase.from("step_updates").select("id, line_id, factory_id, stage, done_on, note, photos, created_at").eq("order_id", id).eq("status", "pending").order("created_at"),
    // Each style's tech pack, cutting program and other files.
    supabase.from("line_files").select("id, line_id, kind, path, file_name").eq("order_id", id).is("removed_at", null).order("created_at"),
    // Each style's pieces bought, billed and shipped across the order's dispatches.
    loadShipProgress(supabase, [id]),
    // What Quality saw on its factory visits, newest first.
    supabase.from("floor_updates").select("id, line_id, stage, status, qty_done, expected_on, note, photos, created_by, created_at").eq("order_id", id)
      .order("created_at", { ascending: false }).limit(60),
  ]);
  const ship = orderShip(shipRows);
  const canEdit = canEditOrders(me?.role);
  // Each style's fit, strike off, PP and size-set samples, with every round.
  const samples = await loadSampleThreads(id);
  const samplesToAct = samples.threads.filter((t) => t.state === "with_team").length;
  // The buyer's own PO: the files its email (or Buyer POs) brought, and any the team added by hand.
  const poDocsP = canEdit ? loadPoDocs(supabase, id, new Map(team.map((m) => [m.user_id, personName(m)]))) : Promise.resolve([]);
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
  const poDocs = await poDocsP;
  const foundPos = canEdit && !poDocs.length && o.buyer_id ? await loadFoundPos(supabase, o.buyer_id, lines.map((l) => l.style)) : [];
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
  const allPaths = [...(photoRows ?? []).map((p) => p.path), ...stylePaths, ...dispatchPaths, ...(stepUps ?? []).flatMap((u) => u.photos as string[]), ...(lineFiles ?? []).map((f) => f.path),
    ...(floorRows ?? []).flatMap((u) => u.photos as string[])];
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
        poMail: po?.accepted_at ? "accepted" : po?.reply_at && (!po.last_mailed_at || po.reply_at > po.last_mailed_at) ? "replied" : po?.mailed_at ? "waiting" : "",
        lockRequestedAt: str(po?.lock_requested_at),
        lockRequestedBy: po?.lock_requested_by ? people.get(po.lock_requested_by) ?? "the orders team" : "",
        lockNote: str(po?.lock_note),
        lockNoteAt: str(po?.lock_note_at),
        lines: [],
      };
      groups.push(g);
    }
    g.lines.push({ id: l.id, style: l.style, colour: str(l.colour), qty: l.qty, photoUrl: (l.photo_path && urlByPath.get(l.photo_path)) || null, hasRate: l.factory_rate != null,
      fabricOrder: l.product === "fabric",
      detail: {
        fabric: str(l.fabric), sizes: (l.sizes ?? {}) as Record<string, number>,
        files: (lineFiles ?? []).filter((f) => f.line_id === l.id).map((f) => ({ id: f.id, kind: f.kind as LineFileKind, name: f.file_name || "File", url: urlByPath.get(f.path) ?? null })),
      } });
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
  const stepName = (lineId: string, stage: string) => TNA_STEPS.find((t) => t.key === stage)?.label
    || str((lineStages ?? []).find((r) => r.line_id === lineId && r.stage === stage)?.label) || "Extra step";
  const floor: FloorUpdate[] = (floorRows ?? []).filter((u) => lines.some((l) => l.id === u.line_id)).map((u) => {
    const l = lines.find((x) => x.id === u.line_id)!;
    return {
      id: u.id, style: l.style, step: stepName(u.line_id, u.stage), status: u.status, qtyDone: u.qty_done, total: qtyU(l.qty, l.product), expectedOn: u.expected_on,
      note: str(u.note), at: u.created_at, by: (u.created_by && people.get(u.created_by)) || "Quality",
      photos: (u.photos as string[]).map((p) => urlByPath.get(p)).filter((x): x is string => !!x),
    };
  });
  // Each style's latest word from the floor, while its step is still open (a problem stays: a failed Inline can follow its done date).
  const floorByStyle: Record<string, { text: string; cls: string }> = {};
  const seenFloor = new Set<string>();
  for (const u of floorRows ?? []) {
    if (seenFloor.has(u.line_id)) continue;
    seenFloor.add(u.line_id);
    const l = lines.find((x) => x.id === u.line_id);
    if (!l || (lineStages ?? []).some((r) => r.line_id === u.line_id && r.stage === u.stage && r.done_on && u.status !== "done" && u.status !== "issue")) continue;
    floorByStyle[u.line_id] = { text: `${dayAtNear(u.created_at)}: ${floorLine(u, stepName(u.line_id, u.stage), qtyU(l.qty, l.product), (d) => dayNear(d))}`, cls: floorStatus(u.status).tone };
  }
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
        return `• ${l.style}${l.colour ? ` (${l.colour})` : ""}, ${qtyU(l.qty, l.product)}: `
          + (at < 0 ? `not started${next ? `, first step ${next.label}${by}` : ""}` : `${st[at].label} done${next ? `, next ${next.label}${by}` : ""}`)
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
        return `• ${l.style}${l.colour ? ` (${l.colour})` : ""}, ${qtyU(l.qty, l.fabricOrder ? "fabric" : "garment")}: `
          + (over.length ? `${over[0].label} was due ${dm(over[0].row!.planned_on!)}${over.length > 1 ? ` (+${over.length - 1} more late)` : ""}`
            : next ? `next ${next.label}${next.row?.planned_on ? ` by ${dm(next.row.planned_on)}` : ""}` : "all steps done");
      }),
      g.target ? `\nEverything must be ready by ${day(g.target)}.` : "",
    ].filter((x, i, a) => x !== "" || (a[i - 1] ?? "") !== "").join("\n"),
  })) : [])];
  // A style counts as late, or is forecast, only once its production has started: before that its targets are a draft.
  const started = (lineId: string) => !!groups.find((g) => g.factoryId === (lines.find((l) => l.id === lineId)?.factory_id ?? null))?.releasedAt;
  const behind = o.status !== "open" ? 0 : lines.filter((l) => started(l.id) && styleSteps(l.id).some((x) => !x.row?.done_on && x.row?.planned_on && x.row.planned_on < today)).length;
  // Where the order is heading: its latest style, with every late step pushing the steps after it back.
  const fc = o.status === "open"
    ? forecast(lines, stageRows, due, today, paceLookup(await paceP, lines, (fid) => opts.factories.find((f) => f.id === fid)?.name || "This factory"), started)
    : null;
  // When the order's money moves: the factory is paid its days after the goods come, the buyer its credit days after they ship.
  // Owner and Accounts only: factory terms are theirs.
  const terms = isFinance(me?.role) && o.status === "open" && due ? await loadTerms() : null;
  const shipsOn = terms ? [today, due!, fc?.finish ?? due!].sort().at(-1)! : null;
  const cash = terms && shipsOn ? {
    ships: shipsOn, buyerDays: terms.buyerDays(o.buyer_id),
    factoryDays: Math.min(...lines.map((l) => terms.factoryDays(l.factory_id ?? null))),
  } : null;
  const outlook = fc ? { level: (fc.daysLate > 0 ? "risk" : fc.slip > 0 ? "behind" : "ok") as "ok" | "behind" | "risk", daysLate: fc.daysLate } : null;
  // The road from buyer PO to shipped, and the one next step on it.
  const lineIds = new Set(lines.map((l) => l.id));
  const j = journey({
    status: o.status, role: me?.role,
    lines: lines.map((l) => ({ factoryId: l.factory_id ?? null, hasRate: l.factory_rate != null })),
    groups: groups.map((g) => ({ factoryId: g.factoryId, released: !!g.releasedAt, lockRequested: !!g.lockRequestedAt })),
    hasBuyerPo: canEdit ? poDocs.length > 0 : null,
    steps: stageRows.filter((r) => lineIds.has(r.line_id) && !r.not_needed).map((r) => ({ stage: r.stage, planned: r.planned_on, done: r.done_on })),
    packedAll: stageReached(o.stage, "packed") || (lines.length > 0 && lines.every((l) => stageRows.some((r) => r.line_id === l.id && r.stage === "packed" && r.done_on))),
    finalPassed,
    samplesToAct,
    pendingUpdates: pendingUpdates.length,
    dispatch: canEdit ? {
      count: dispatches.length,
      uninvoiced: dispatches.filter((d) => !d.invoicedAt).length,
      unshipped: dispatches.filter((d) => !d.shippedAt).length,
      billedAll: !!o.closed_short_at || lines.every((l) => (shipRows.find((x) => x.line_id === l.id)?.billed ?? 0) >= l.qty),
    } : null,
    due: due ?? null,
    riskDays: outlook?.level === "risk" ? outlook.daysLate : 0,
    today,
  });
  const tabs: SectionTab[] = [
    { id: "tna", label: "Styles", count: pendingUpdates.length || behind || undefined, tone: pendingUpdates.length ? "info" : outlook?.level === "risk" ? "bad" : "warn" },
    { id: "samples", label: "Samples", count: samplesToAct || undefined, tone: "warn" },
    { id: "qc", label: "QC" },
    ...(canEdit ? [{ id: "dispatch", label: "Dispatch" }] : []),
    { id: "details", label: "Details" },
    { id: "history", label: "History" },
  ];

  // What the owner is told before deleting this PO: who already has it, or why it can't go.
  const shortName = (fid: string) => opts.factories.find((f) => f.id === fid)?.name || factoryLabel(fid);
  const deleteWarnings = (factoryPos ?? []).flatMap((p) => p.accepted_at ? [`${shortName(p.factory_id)} already accepted this PO. Tell them it is off.`]
    : p.mailed_at || p.last_mailed_at ? [`This PO was emailed to ${shortName(p.factory_id)}. Tell them it is off.`]
    : p.released_at ? [`${shortName(p.factory_id)} sees this PO in its panel. It goes from there too.`] : []);
  const deleteBlocked = o.status === "shipped" ? "This order is shipped, so it can't be deleted."
    : dispatches.length ? "Goods are already bought on this order, so it can't be deleted. Cancel its dispatches first, or close the order short." : null;

  return (
    <>
      <header className="oh">
        <div className="oh-main">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Orders</Link><span aria-hidden>/</span><span>{o.order_no}</span></nav>
          <h1>{buyerLabel || "Order"}</h1>
          <p className="oh-sub">
            <span>PO {o.buyer_po}</span>
            {groups.some((g) => g.factoryId) && <span>{groups.filter((g) => g.factoryId).map((g) => g.factoryShort || g.factoryName).join(", ")}</span>}
            {o.merchandiser_id && people.get(o.merchandiser_id) && <span className="hide-phone">{people.get(o.merchandiser_id)}</span>}
          </p>
          <div className="oh-facts">
            {lines.some((l) => l.photo_path && urlByPath.get(l.photo_path)) && (
              <PhotoStack photos={lines.map((l) => ({ url: (l.photo_path && urlByPath.get(l.photo_path)) || null, alt: l.style }))} total={lines.length} />
            )}
            <span><b className="num">{lines.length}</b> {lines.length === 1 ? "style" : "styles"}</span>
            <span>{qtyTotal(lines).split(" + ").map((t, i) => { const [n, u] = t.split(" "); return <Fragment key={u}>{i > 0 && " + "}<b className="num">{n}</b> {u}</Fragment>; })}</span>
            {canEdit && lines.length > 0 && lines.every((l) => l.buyer_rate != null) && (
              <span title={money(lines.reduce((t, l) => t + l.qty * Number(l.buyer_rate), 0))}><b className="num">{moneyShort(lines.reduce((t, l) => t + l.qty * Number(l.buyer_rate), 0))}</b> value</span>
            )}
          </div>
          <p className="oh-chips">
            {o.status !== "open" && <span className={STATUS[o.status]?.cls}>{STATUS[o.status]?.label}</span>}
            {canEdit && (poDocs[0]?.url ? <a href={poDocs[0].url} target="_blank" rel="noreferrer" className="chip po-chip" title={`Open ${poDocs[0].name}`}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden><path d="M4 1.75h5.5L12.25 4.5v9.75H4z" /><path d="M9.25 1.75V4.75h3" /></svg>
              {poDocs[0].ext === "pdf" ? "Buyer PO PDF" : "Buyer PO file"}{poDocs.length > 1 ? ` · ${poDocs.length} files` : ""}</a>
              : <a href="#details-po" className="chip warn" title="A factory PO is locked only once the buyer's PO is on file">No buyer PO yet</a>)}
            {ship.part && o.status === "open" && <a href="#dispatch" className="chip info">Part shipped · {qty(ship.shipped)} of {qty(ship.ordered)} {unitOfAll(lines)}</a>}
            {o.closed_short_at && <span className="chip warn" title={o.short_reason ?? undefined}>Closed short · {qty(ship.billed)} of {qty(ship.ordered)} {unitOfAll(lines)}</span>}
          </p>
          {!ship.part && fc && <Outlook f={fc} due={due ?? null} styles={lines.length} />}
        </div>
        <ShipClock c={shipClock(due ?? null, today, o.status)} date={due ? `${o.revised_ship_date && o.revised_ship_date !== o.ship_date ? "New date " : ""}${dayNear(due, today).replaceAll(" ", "\u00a0")}` : undefined} />
      </header>
      <OrderJourney orderId={o.id} orderNo={o.order_no} j={j} canEdit={canEdit} canRecordQc={canRecordQc(me?.role)} shipBlocker={shipBlocker as string | null}>
        {/* The journey card carries the main next step; these stay for any time. */}
        {o.status === "open" && canEnterDone(me?.role) && groups.some((g) => g.releasedAt) && j.next.action.kind !== "update" && (
          <SheetButton orderId={o.id} mode="update" className="btn">Update progress</SheetButton>
        )}
        {/* Keyed like the styles below, so the message is worded afresh after every save. */}
        {canEdit && o.status === "open" && <BuyerLink buyerId={o.buyer_id} name={buyerLabel || "the buyer"} size="md" />}
        <ShareUpdate key={`${(lineStages ?? []).length}:${(lineStages ?? []).reduce((a, r) => (r.updated_at > a ? r.updated_at : a), "")}`} options={share} />
      </OrderJourney>
      {saved && <div className="okbox">Order saved as {o.order_no}.</div>}
      <OrderSections tabs={tabs} start={areaOf(j.stage, canEdit)}>
      <div data-sec="tna">
      <FactoryUpdates orderId={o.id} updates={pendingUpdates} canReview={canEnterDone(me?.role) && o.status === "open"} />
      <OrderFloor orderId={o.id} updates={floor} canPost={canEnterDone(me?.role) && o.status === "open"} />
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
        floor={floorByStyle}
        hasBuyerPo={poDocs.length > 0}
      />
      </div>
      <div data-sec="samples">
        <section className="panel scroll-mt-20" id="samples" aria-labelledby="osmp-h">
          <div className="row mb-1">
            <h2 id="osmp-h" className="font-bold text-base">Samples</h2>
            {samplesToAct > 0 && <span className="chip warn">{samplesToAct} to check</span>}
            <Link href="/samples" className="link ml-auto text-[13px]">All samples</Link>
          </div>
          <p className="muted mb-3 text-[13px]">Each style&apos;s fit, strike off, PP and size-set samples. The buyer&apos;s approval marks the TNA step done.</p>
          {samples.error && <div className="errbox">Couldn&apos;t load the samples. Reload to try again. ({samples.error})</div>}
          {samples.threads.length === 0 ? (
            <p className="card-empty">Samples start once a factory PO is released. The factory then sends them from its panel.</p>
          ) : (
            <div className="smp-list">
              {samples.threads.map((t) => <SampleThreadCard key={t.key} t={t} today={todayIST()} showOrder={false} readOnly={!canEdit || o.status !== "open"} />)}
            </div>
          )}
        </section>
      </div>
      <div data-sec="qc">
      <OrderQc orderId={o.id} companyId={o.company_id} open={o.status === "open"} canRecord={canRecordQc(me?.role)} today={todayIST()} checks={checks} finalPassed={finalPassed}
        styles={lines.map((l) => ({ id: l.id, style: l.style, colour: str(l.colour), qty: l.qty, product: l.product }))} />
      </div>
      {canEdit && (
        <div data-sec="dispatch"><OrderDispatch orderId={o.id} orderNo={o.order_no} companyId={o.company_id} open={o.status === "open"} owner={me?.role === "owner"} factories={dispatchFactories}
          ship={lines.map((l) => {
            const r = shipRows.find((x) => x.line_id === l.id);
            return { id: l.id, style: l.style, colour: str(l.colour), ordered: l.qty, bought: r?.bought ?? 0, billed: r?.billed ?? 0, shipped: r?.shipped ?? 0, unit: unitOf(l.product) };
          })}
          closedShort={o.closed_short_at ? { at: o.closed_short_at, reason: str(o.short_reason), by: (o.closed_short_by && people.get(o.closed_short_by)) || "the orders team" } : null}
          dispatches={dispatches} tally={tallyBills} now={Date.parse(new Date().toISOString())} today={todayIST()} /></div>
      )}
      {canEdit && (
        <div data-sec="dispatch"><OrderMargin
          styles={lines.map((l) => ({
            id: l.id, style: l.style, colour: str(l.colour), qty: l.qty, product: l.product,
            buyerRate: l.buyer_rate == null ? null : Number(l.buyer_rate), factoryRate: l.factory_rate == null ? null : Number(l.factory_rate),
          }))}
          dispatches={dispatches} cash={cash}
        /></div>
      )}
      <div data-sec="details">{canEdit && <BuyerPo orderId={o.id} companyId={o.company_id} docs={poDocs} found={foundPos} canEdit={canEdit} />}{canEdit ? <OrderForm
        key={o.updated_at}
        initial={{
          id: o.id, edit_no: o.edit_no, buyer_id: o.buyer_id, buyer_po: o.buyer_po, po_date: str(o.po_date), ship_date: str(o.ship_date),
          status: o.status, merchandiser_id: str(o.merchandiser_id), notes: str(o.notes), buyer_terms: str(o.buyer_terms),
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
              <thead><tr><th>Style</th><th>Colour</th><th>Description</th><th className="r">Quantity</th><th>Factory</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="code">{l.style}</td><td>{l.colour}</td><td>{l.description}</td>
                    <td className="r num">{qtyU(l.qty, l.product)}</td><td>{opts.factories.find((f) => f.id === l.factory_id)?.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.ship_date && <p className="muted mt-3 text-[13px]">Buyer&apos;s ship date {day(o.ship_date)}{o.revised_ship_date && `, now ${day(o.revised_ship_date)}`}.</p>}
          {o.buyer_terms && <p className="mt-3 whitespace-pre-line text-[13px]"><b>Buyer&apos;s terms:</b> {o.buyer_terms}</p>}
        </section>
      )}</div>
      <div data-sec="details"><OrderProduction
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
      {me?.role === "owner" && (
        <div data-sec="details"><DeletePo orderId={o.id} orderNo={o.order_no} buyerPo={o.buyer_po} warnings={deleteWarnings} blocked={deleteBlocked} /></div>
      )}
      <div data-sec="history"><OrderHistory orderId={o.id} /></div>
      </OrderSections>
    </>
  );
}

const sizeOf = (n: unknown) => (typeof n === "number" ? n : Number(n) || 0);

// The buyer's PO files on an order, newest hand-added first after the ones that came with the PO itself.
async function loadPoDocs(supabase: Awaited<ReturnType<typeof createClient>>, orderId: string, people: Map<string, string>): Promise<PoDoc[]> {
  const [{ data: incoming }, { data: added }] = await Promise.all([
    supabase.from("incoming_pos").select("id, source, email_from, received_at, files, off_order").eq("order_id", orderId).order("received_at"),
    supabase.from("order_po_files").select("id, path, file_name, file_type, size_bytes, created_by, created_at").eq("order_id", orderId).is("removed_at", null).order("created_at"),
  ]);
  const docs: (Omit<PoDoc, "url" | "download"> & { path: string })[] = [
    ...(incoming ?? []).flatMap((i) => ((i.files ?? []) as StoredFile[]).filter((f) => !(i.off_order ?? []).includes(f.path)).map((f) => ({
      key: f.path, id: null, incomingId: i.id as string, path: f.path, name: f.name || "PO", ext: (f.path.split(".").pop() ?? "").toLowerCase(), size: sizeOf(f.size),
      from: i.source === "email" ? `Came by email${i.email_from ? ` from ${i.email_from.replace(/\s*<.*>$/, "")}` : ""} · ${dayAt(i.received_at)}` : `Added on Buyer POs · ${dayAt(i.received_at)}`,
    }))),
    ...(added ?? []).map((f) => ({
      key: f.id, id: f.id, incomingId: null, path: f.path, name: f.file_name, ext: (f.path.split(".").pop() ?? "").toLowerCase(), size: f.size_bytes,
      from: `Added by ${(f.created_by && people.get(f.created_by)) || "the team"} · ${dayAt(f.created_at)}`,
    })),
  ];
  if (!docs.length) return [];
  // Links work for an hour: one opens the file in the browser, the other saves it under its own name.
  const store = supabase.storage.from(PO_BUCKET);
  const [{ data: views }, downloads] = await Promise.all([
    store.createSignedUrls(docs.map((d) => d.path), 3600),
    Promise.all(docs.map((d) => store.createSignedUrl(d.path, 3600, { download: d.name }))),
  ]);
  const viewOf = new Map((views ?? []).filter((v) => v.signedUrl).map((v) => [v.path, v.signedUrl]));
  // PDFs and photos come first: they are what people open to read the PO.
  const rank = (ext: string) => (ext === "pdf" ? 0 : ["jpg", "jpeg", "png", "webp"].includes(ext) ? 1 : 2);
  return docs
    .map((d, i) => ({ ...d, url: viewOf.get(d.path) ?? null, download: downloads[i].data?.signedUrl ?? null }))
    .sort((a, b) => rank(a.ext) - rank(b.ext));
}

// With no PO on file, PO files from this buyer's emails that name one of the order's styles: some buyers
// send one PDF per style, and an order typed in by hand never gets tied to that email on its own.
async function loadFoundPos(supabase: Awaited<ReturnType<typeof createClient>>, buyerId: string, styles: string[]): Promise<FoundPo[]> {
  const named = styles.filter((s) => styleKey(s).length >= 3);
  if (!named.length) return [];
  const { data } = await supabase.from("incoming_pos").select("id, email_from, received_at, files, off_order").eq("buyer_id", buyerId)
    .order("received_at", { ascending: false }).limit(30);
  const found = (data ?? []).flatMap((i) => ((i.files ?? []) as StoredFile[])
    .filter((f) => !(i.off_order ?? []).includes(f.path) && named.some((s) => fileNamesStyle(f.name ?? "", s)))
    .map((f) => ({
      key: f.path, incomingId: i.id as string, path: f.path, name: f.name || "PO", ext: (f.path.split(".").pop() ?? "").toLowerCase(), size: sizeOf(f.size),
      from: `Email${i.email_from ? ` from ${i.email_from.replace(/\s*<.*>$/, "")}` : ""} · ${dayAt(i.received_at)}`,
    }))).slice(0, 8);
  if (!found.length) return [];
  const { data: views } = await supabase.storage.from(PO_BUCKET).createSignedUrls(found.map((f) => f.path), 3600);
  const viewOf = new Map((views ?? []).filter((v) => v.signedUrl).map((v) => [v.path, v.signedUrl]));
  return found.map((f) => ({ ...f, url: viewOf.get(f.path) ?? null }));
}
