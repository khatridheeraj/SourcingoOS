import type { LinePrice } from "@/lib/margin";
import Link from "next/link";
import { canEditOrders, canRecordQc, getMe } from "@/lib/auth";
import { fetchAll } from "@/lib/fetch-all";
import { buyerName, loadBuyers, loadFactories, loadPace } from "@/lib/data";
import { day, dayNear, daysBetween, money, riskLate, dueDate, nowMs, planDueAt, PLAN_HOURS, qcKindLabel, qty, qtyTotal, SHIP_QC, stageReached, TNA_STEPS, todayIST, unitOfAll } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { poWaitDays, PO_WAIT_DAYS } from "@/lib/order-checks";
import { forecast, paceLookup } from "@/lib/progress";
import { HOLD_HOURS, heldHours, heldText } from "@/lib/goods";
import { createClient } from "@/lib/supabase/server";
import { loadShipProgress, orderShip, partText } from "@/lib/shipments";
import { Icon } from "@/components/nav";
import { ChaseLink, SheetButton } from "@/components/order-sheet";
import { chaseText, panelLine, waLink, type QStyle } from "@/lib/quick";
import { buildUpdates } from "@/lib/updates";
import { appOrigin } from "@/lib/origin";
import { QcButton } from "@/components/qc-sheet";
import { VisitButton } from "@/components/visit-sheet";
import { FRESH_DAYS, floorLine, VISIT_DAYS, visitedText } from "@/lib/floor";
import { Ring } from "@/components/order-ui";
import { WhatsNew } from "@/components/whats-new";
import { MarkShipped } from "../orders/mark-shipped";
import { sampleLabel, type SampleStatus } from "@/lib/samples";
import { isFinance, loadBooks } from "../payments/load";
import { paymentTodos } from "@/lib/payments";
import { loadPayables } from "../payables/load";
import { bySupplier, dueOf, lakh as rupees, totals } from "@/lib/payables";
import { PageTabs } from "@/components/page-tabs";
import { HOME_TABS } from "@/lib/page-groups";

type Sev = "bad" | "warn" | "ok" | "";
// One line of the to-do list: what it is, why, and the one button that deals with it.
type Item = {
  key: string; href: string; sev: Sev; code?: string; title: string; detail: string;
  chip?: { text: string; cls: Sev }; action: string; links?: { href: string; text: string }[]; sort: string;
  // The action opens the order's quick sheet instead of the order page.
  sheet?: { orderId: string; mode: "update" | "start"; factoryId?: string };
  // A WhatsApp chase to the factory, with the message written.
  chase?: { href: string; factoryId: string; orderId: string; chased: boolean };
  // The action opens the quick QC sheet for this check.
  qc?: { orderId: string; kind: string };
  // The action starts a factory visit.
  visit?: { factoryId: string };
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const longDay = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
const hourIST = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "10 Sep" from a YYYY-MM-DD date.
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const ist = (d: string) => new Date(`${d}T00:00:00+05:30`);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const when = (date: string, today: string): { text: string; cls: Sev } => {
  const n = daysBetween(today, date);
  return n < 0 ? { text: `Overdue ${plural(-n, "day")}`, cls: "bad" } : n === 0 ? { text: "Due today", cls: "warn" } : { text: `Due in ${plural(n, "day")}`, cls: n <= 2 ? "warn" : "" };
};
// Order values in lakh and crore, as the team says them.
const lakh = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);
const rank = (s: Sev) => ({ bad: 0, warn: 1, ok: 2, "": 3 })[s];
const bySev = (a: Item, b: Item) => rank(a.sev) - rank(b.sev) || a.sort.localeCompare(b.sort);

const TABS = [
  { key: "now", label: "Now", hint: "Late, overdue or blocking work. Red first." },
  { key: "soon", label: "This week", hint: "Steps due in the next 7 days, dispatch, GRNs, and shipments without a passed final QC." },
  { key: "waiting", label: "Waiting", hint: `Factories asked for their TNA (they have ${PLAN_HOURS} hours), samples with buyers, and changes factories are making.` },
] as const;

// The home screen: what needs doing across open orders, one line per order, plus shipping and style progress.
export default async function HomePage({ searchParams }: PageProps<"/today">) {
  const sp = await searchParams;
  const me = await getMe();
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const today = todayIST();
  const week = addDays(today, 7);
  const team = canEditOrders(me?.role);
  // Bills to pay, for the owner and Accounts: read alongside everything else.
  const payP = isFinance(me?.role) ? loadPayables(supabase) : null;
  // Money to collect from buyers (cheques to deposit, Tally settlements, overdue invoices), for the same people.
  const booksP = isFinance(me?.role) ? loadBooks() : null;

  // Every read's error is kept: a list that failed to load must not show as "nothing to do".
  const errors: string[] = [];
  const keep = <R extends { error: { message: string } | null }>(r: R) => {
    if (r.error) errors.push(r.error.message);
    return r;
  };
  const [{ data: orders }, buyers, factories, pace] = await Promise.all([
    fetchAll((a, z) => supabase
      .from("orders")
      .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id, stage, order_lines(id, style, colour, qty, factory_id, product)")
      .eq("company_id", companyId)
      .eq("status", "open")
      .is("order_lines.removed_at", null)
      .order("id")
      .range(a, z)).then(keep),
    loadBuyers(),
    loadFactories(),
    loadPace(),
  ]);
  const mineCount = (orders ?? []).filter((o) => o.merchandiser_id === me?.id).length;
  // Merchandisers see their own orders first; anyone can switch to everyone's.
  const who = sp.who === "all" || sp.who === "mine" ? sp.who : me?.role === "merchandiser" && mineCount ? "mine" : "all";
  const open = (orders ?? []).filter((o) => who === "all" || o.merchandiser_id === me?.id);
  const ids = open.map((o) => o.id);

  // Everything below needs only the order ids, so it is all read at once: the page waits for the slowest read, not the sum.
  const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
  const none = Promise.resolve({ data: [], error: null });
  const ratesP = team && ids.length ? fetchAll<LinePrice>((a, z) => supabase.rpc("line_prices", { p_orders: ids }).order("id").range(a, z)) : none;
  // Orders whose buyer PO is on file: a factory PO goes out only against it, so the order page's next step
  // (journey) asks for it before production starts, and Home says the same.
  const withPoP = team && ids.length ? supabase.rpc("orders_with_po_file", { p_orders: ids }) : none;
  const chaseP = team
    ? Promise.all([
        supabase.from("factory_chases").select("factory_id, order_id").gte("chased_at", dayStart),
        // Each factory's own panel link, put at the end of a chase so the factory can answer with photos.
        Promise.all([supabase.from("factory_links").select("factory_id, secret"), appOrigin()]),
        // Steps this person marked done today, read from the activity log: a done date that wasn't there before.
        supabase.from("history").select("id", { count: "exact", head: true }).eq("table_name", "line_stages").eq("actor", me?.id ?? NO_COMPANY)
          .gte("at", dayStart).not("after->>done_on", "is", null).is("before->>done_on", null),
      ])
    : Promise.resolve([{ data: [] }, [{ data: [] }, ""], { count: 0 }] as const);
  // Updates Quality posted from the factory floor in the last month: when each factory was last visited, and the
  // latest word on each step.
  const floorP = ids.length
    ? fetchAll((a, z) => supabase.from("floor_updates").select("order_id, line_id, factory_id, stage, status, qty_done, expected_on, visited_on, created_by, created_at")
        .in("order_id", ids).gte("visited_on", addDays(today, -30)).order("created_at", { ascending: false }).order("id").range(a, z))
    : none;
  const upsP = ids.length
    ? fetchAll((a, z) => supabase.from("step_updates").select("order_id, line_id, stage, created_at").in("order_id", ids).eq("status", "pending").order("created_at").order("id").range(a, z))
    : none;
  const roundsP = team && ids.length
    ? fetchAll((a, z) => supabase.from("sample_rounds").select("order_id, line_id, stage, round, status, sent_at, forwarded_at, dispatched_on, answered_at")
        .in("order_id", ids).order("round").order("id").range(a, z))
    : none;
  const incomingP = team
    ? fetchAll((a, z) => supabase.from("incoming_pos").select("id, buyer_id, buyer_po, email_subject, email_from, status, received_at")
        .eq("company_id", companyId).in("status", ["to_check", "failed", "held"]).order("received_at").order("id").range(a, z))
    : none;
  const inqsP = team
    ? fetchAll((a, z) => supabase.from("inquiries").select("id, inquiry_no, buyer_id, prospect, product, next_follow_up, merchandiser_id, status, sample_sent_on")
        .eq("company_id", companyId).in("status", ["new", "quoted"]).lte("next_follow_up", today).order("next_follow_up").order("id").range(a, z))
    : none;
  // Dispatches of every order, shipped ones too: an order marked shipped still waits for the buyer's GRN.
  const dispP = team
    ? fetchAll((a, z) => supabase.from("dispatches").select("id, order_id, purchase_bill_no, purchased_at, invoice_due_at, invoiced_at, eway_at, shipped_at, grn_due_on, grn_at")
        .eq("company_id", companyId).is("cancelled_at", null).is("grn_at", null).order("id").range(a, z))
    : none;
  // Orders that shipped long ago but were never closed: 30+ days past the ship date and packed or further.
  const stale = open.filter((o) => { const d = dueDate(o); return !!d && d < addDays(today, -30) && stageReached(o.stage, "packed"); });
  // Why each can't be closed yet: its goods must be bought and billed in Dispatch first.
  const blockerP = team && stale.length
    ? Promise.all(stale.map(async (o) => [o.id, (await supabase.rpc("ship_blocker", { p_order: o.id })).data as string | null] as const))
    : Promise.resolve([]);

  const [{ data: pos }, { data: stages }, { data: checks }, { data: shipRows }] = ids.length
    ? await Promise.all([
        fetchAll((a, z) => supabase.from("factory_pos").select("order_id, factory_id, plan_requested_on, plan_requested_at, factory_sent_at, released_at, buffer_days, lock_requested_at, lock_note")
          .in("order_id", ids).order("id").range(a, z)).then(keep),
        fetchAll((a, z) => supabase.from("line_stages").select("order_id, line_id, stage, label, planned_on, done_on, not_needed, factory_on").in("order_id", ids).order("id").range(a, z)).then(keep),
        fetchAll((a, z) => supabase.from("qc_checks").select("line_id, kind, result, checked_on").in("order_id", ids).is("cancelled_at", null)
          .order("checked_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(a, z)).then(keep),
        // Pieces shipped so far, for orders sent in parts.
        loadShipProgress(supabase, ids).then(keep),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const shipOf = (o: { id: string }) => orderShip(shipRows ?? [], o.id);

  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const extraLabel = new Map((stages ?? []).filter((s) => s.label).map((s) => [s.stage, String(s.label)]));
  const stepLabel = (k: string) => TNA_STEPS.find((s) => s.key === k)?.label ?? extraLabel.get(k) ?? k;
  const stepIndex = (k: string) => { const i = TNA_STEPS.findIndex((s) => s.key === k); return i < 0 ? TNA_STEPS.length : i; };
  const stageOf = new Map((stages ?? []).map((s) => [`${s.line_id}:${s.stage}`, s]));
  // A style's steps as the quick sheet and the factory chase read them.
  const qStyle = (l: { id: string; style: string; colour: string | null; qty: number; factory_id: string | null; product?: string | null }): QStyle => ({
    id: l.id, style: l.style, colour: l.colour ?? "", qty: l.qty, hasRate: true, factoryId: l.factory_id, fabric: l.product === "fabric",
    steps: [
      ...TNA_STEPS.map((t) => { const r = stageOf.get(`${l.id}:${t.key}`); return { key: t.key, label: t.label, planned_on: r?.planned_on ?? "", done_on: r?.done_on ?? "", not_needed: !!r?.not_needed, extra: false }; }),
      ...(stages ?? []).filter((s) => s.line_id === l.id && s.stage.startsWith("extra_"))
        .map((s) => ({ key: s.stage, label: String(s.label ?? ""), planned_on: s.planned_on ?? "", done_on: s.done_on ?? "", not_needed: !!s.not_needed, extra: true })),
    ],
  });
  const liveLine = new Set(open.flatMap((o) => (o.order_lines ?? []).map((l) => l.id)));
  // Steps that count: on a style still on the order and not marked not needed.
  const live = (stages ?? []).filter((s) => liveLine.has(s.line_id) && !s.not_needed);
  const latest = (lineId: string, kinds: string[]) => (checks ?? []).find((c) => c.line_id === lineId && kinds.includes(c.kind));
  // Days the order's latest style will likely miss the ship date by: each late step pushes the later ones back.
  const riskDays = (o: (typeof open)[number]) =>
    forecast(o.order_lines ?? [], (stages ?? []).filter((s) => !s.not_needed), dueDate(o), today, paceLookup(pace, o.order_lines ?? [], (id) => factoryName.get(id) ?? "This factory"))?.daysLate ?? 0;

  const staleIds = new Set(stale.map((o) => o.id));
  const staleBlocker = new Map(await blockerP);
  const active = open.filter((o) => !staleIds.has(o.id));
  const base = (o: (typeof open)[number]) => ({ code: o.order_no, title: `${buyerOf.get(o.buyer_id) ?? ""}${o.buyer_po ? ` · PO ${o.buyer_po}` : ""}` });

  // Factory POs: ask for the plan, chase it, release it. A factory that hasn't sent its TNA within 24 hours is critical.
  const now = nowMs();
  // Factory rates come separately: the database gives them only to the orders team and Accounts.
  const { data: rates } = keep(await ratesP);
  const hasPo = new Set(((await withPoP).data ?? []) as string[]);
  const priceOf = new Map(((rates ?? []) as LinePrice[]).map((r) => [r.id, r]));
  // Factories chased on WhatsApp today, and what each step done today by this person adds up to.
  const [{ data: chases }, [{ data: links }, origin], { count: doneToday }] = await chaseP;
  const linkOf = new Map((links ?? []).map((l) => [l.factory_id, `${origin}/f/${l.secret}`]));
  const chasedToday = new Set((chases ?? []).map((c) => `${c.factory_id}:${c.order_id}`));
  const factoryPhone = new Map(factories.map((f) => [f.id, f.phone]));
  const lateSteps = (o: (typeof open)[number], f: string) => live.filter((s) => s.order_id === o.id && !s.done_on && s.planned_on && s.planned_on < today
    && (o.order_lines ?? []).some((l) => l.id === s.line_id && l.factory_id === f)).length;
  // A WhatsApp chase to the order's factory with the most late steps (or the one given), its message written from the plan.
  const chaseFor = (o: (typeof open)[number], only?: string, text?: string): Item["chase"] => {
    const lines = o.order_lines ?? [];
    const facs = only ? [only] : ([...new Set(lines.map((l) => l.factory_id).filter(Boolean))] as string[]).sort((a, b) => lateSteps(o, b) - lateSteps(o, a));
    const f = facs[0];
    if (!f || !team) return undefined;
    const po = (pos ?? []).find((p) => p.order_id === o.id && p.factory_id === f);
    const due = dueDate(o);
    const target = due && po?.buffer_days != null ? addDays(due, -po.buffer_days) : "";
    const msg = text ?? chaseText(o.order_no, o.buyer_po ?? "", factoryName.get(f) ?? "", lines.filter((l) => l.factory_id === f).map(qStyle), today, target, linkOf.get(f));
    return { href: waLink(factoryPhone.get(f), msg), factoryId: f, orderId: o.id, chased: chasedToday.has(`${f}:${o.id}`) };
  };
  // Factories behind plan, one WhatsApp each listing every late order.
  const chaseList = team
    ? buildUpdates({ orders: active, stages: stages ?? [], pos: pos ?? [], factories: factories.map((f) => ({ ...f, link: linkOf.get(f.id) })), buyerName: () => "", chased: new Set((chases ?? []).map((c) => c.factory_id)), today }).chases
    : [];
  const releasedFor = (o: { id: string }) => (pos ?? []).some((p) => p.order_id === o.id && p.released_at);
  const now_: Item[] = [];
  const soon: Item[] = [];
  const waiting: Item[] = [];
  const noTargets: { o: (typeof open)[number]; n: number }[] = [];
  // Factory plans and POs are the orders team's work; Quality doesn't see them.
  const noPoAsked = new Set<string>();
  const shipSoonChip = (due: string | null | undefined): Item["chip"] =>
    !due ? { text: "No ship date", cls: "bad" } : due < addDays(today, 30) ? { text: `Ships ${dm(due)}`, cls: "warn" } : undefined;
  // Past the ship date and not packed yet: a new date comes first, as on the order page (journey), so the order's
  // merchandiser sees it at the top of Home. Its plan and step lines wait until the date is real again.
  const pastDue = new Set<string>();
  for (const o of team ? active : []) {
    const due = dueDate(o);
    if (!due || due >= today || stageReached(o.stage, "packed")) continue;
    pastDue.add(o.id);
    now_.push({ key: `date:${o.id}`, href: `/orders/${o.id}#ship`, ...base(o), sev: "bad",
      detail: `Was due ${dm(due)}. Agree a new ship date with the buyer and the factory, and say why it moved.`,
      chip: { text: `${plural(daysBetween(due, today), "day")} late`, cls: "bad" }, action: "Set new ship date", sort: `0${due}` });
  }
  for (const o of team ? active.filter((x) => !pastDue.has(x.id)) : []) {
    const lines = o.order_lines ?? [];
    const href = `/orders/${o.id}#tna`;
    for (const f of [...new Set(lines.map((l) => l.factory_id).filter(Boolean))] as string[]) {
      const po = (pos ?? []).find((p) => p.order_id === o.id && p.factory_id === f);
      const fl = lines.filter((l) => l.factory_id === f);
      const fname = factoryName.get(f) ?? "Factory";
      // Each style's steps: standard ones not marked not needed, plus its extra steps.
      const rows = fl.flatMap((l) => [
        ...TNA_STEPS.map((s) => stageOf.get(`${l.id}:${s.key}`) ?? { planned_on: null, factory_on: null, not_needed: false, done_on: null }),
        ...(stages ?? []).filter((s) => s.line_id === l.id && s.stage.startsWith("extra_")),
      ]).filter((r) => !r.not_needed);
      const noTarget = rows.filter((r) => !r.planned_on).length;
      if (po?.released_at) {
        // A released PO's steps without a target can't show as late, so ask for the missing targets.
        const untracked = rows.filter((r) => !r.planned_on && !r.done_on).length;
        if (untracked) noTargets.push({ o, n: untracked });
        continue;
      }
      // Factory and rates are in but no buyer PO on file yet: that comes next, as on the order page, before a plan is set or sent.
      if (!hasPo.has(o.id) && lines.every((l) => l.factory_id && priceOf.get(l.id)?.factory_rate != null) && !po?.lock_requested_at && !po?.plan_requested_at && !po?.plan_requested_on) {
        if (!noPoAsked.has(o.id)) {
          noPoAsked.add(o.id);
          now_.push({ key: `nopo:${o.id}`, href: `/orders/${o.id}#details-po`, ...base(o), sev: "warn",
            detail: "Add the buyer's PO first: a factory PO goes out only against it. Then start production.",
            chip: shipSoonChip(dueDate(o)), action: "Add buyer PO", sort: `1${dueDate(o) ?? "9999"}` });
        }
        continue;
      }
      // Nothing planned yet for this factory: one line that starts its production from a sheet.
      if (noTarget === rows.length && !po?.plan_requested_at && !po?.plan_requested_on) {
        const due = dueDate(o);
        now_.push({ key: `start:${o.id}:${f}`, href, ...base(o), sev: "warn", sheet: { orderId: o.id, mode: "start", factoryId: f },
          // A ship date a month or more away is no reason for a chip; it reads as part of the detail.
          detail: `${fname} · ${plural(fl.length, "style")} · not started yet${due && due >= addDays(today, 30) ? ` · ships ${dm(due)}` : ""}. Set the whole plan in one go.`,
          chip: shipSoonChip(due),
          action: "Start production", sort: `1${due ?? "9999"}` });
        continue;
      }
      // The PO target date: delivery less the buffer. Targets after it block the release, as on the order page.
      const due = dueDate(o);
      const target = due && po?.buffer_days != null ? addDays(due, -po.buffer_days) : "";
      const gaps = fl.filter((l) => priceOf.get(l.id)?.factory_rate == null).length + noTarget
        + rows.filter((r) => !r.factory_on || (r.planned_on && r.factory_on > r.planned_on)).length
        + (target ? rows.filter((r) => r.planned_on && r.planned_on > target).length : 0);
      const dueAt = po?.plan_requested_at ? planDueAt(po.plan_requested_at) : null;
      // A plan sent before the team asked again doesn't answer the new request.
      const sent = !!po?.factory_sent_at && (!po.plan_requested_at || po.factory_sent_at >= po.plan_requested_at);
      const item = { key: `po:${o.id}:${f}`, href, ...base(o), sort: o.order_no, sheet: { orderId: o.id, mode: "start" as const, factoryId: f } };
      if (dueAt && !sent && dueAt.getTime() < now) {
        const hours = Math.floor((now - dueAt.getTime()) / 3_600_000);
        now_.push({ ...item, sev: "bad", detail: `${fname} hasn't sent its dates within ${PLAN_HOURS} hours. Chase them, or tap Factory agreed if they said yes on the phone.`,
          chip: { text: hours ? `${plural(hours, "hour")} past deadline` : "Just past deadline", cls: "bad" }, action: "Factory agreed", sort: dueAt.toISOString(),
          chase: chaseFor(o, f, `*${o.order_no}${o.buyer_po ? ` · PO ${o.buyer_po}` : ""} · ${fname}*\nPlease send your dates for these styles today, or tell us you agree to ours: ${fl.map((l) => l.style).join(", ")}.${linkOf.get(f) ? `\n\n${panelLine(linkOf.get(f))}` : ""}`) });
      } else if (!gaps && po?.lock_requested_at) {
        // Every factory PO waits for the owner's lock (Dheeraj, 20 Oct 2026); the owner sees these first.
        if (me?.role === "owner") now_.push({ ...item, sev: "warn", detail: `${fname} · PO sent for your approval ${at.format(new Date(po.lock_requested_at))}. Approving emails it to the factory.`,
          chip: { text: "Waiting for your approval", cls: "warn" }, action: "Check and approve", sort: `0${po.lock_requested_at}` });
        else waiting.push({ ...item, sev: "", detail: `${fname} · sent for approval ${at.format(new Date(po.lock_requested_at))}`, action: "See plan" });
      } else if (!gaps && po?.lock_note && me?.role !== "owner") {
        now_.push({ ...item, sev: "warn", detail: `${fname} · the owner sent the PO back: ${po.lock_note}`, action: "Fix and send again" });
      } else if (!gaps) {
        soon.push({ ...item, sev: "ok", detail: `${fname} · plan is complete`, action: me?.role === "owner" ? "Approve and send" : "Send for approval" });
      } else if (!po?.plan_requested_at && !po?.plan_requested_on) {
        now_.push({ ...item, sev: "warn", detail: `${fname} · part planned. Finish the plan and start production in one go.`, action: "Start production" });
      } else if (sent) {
        soon.push({ ...item, sheet: undefined, sev: "warn", detail: `${fname} sent its TNA · ${plural(gaps, "item")} to sort before release`, action: "Review TNA" });
      } else {
        waiting.push({ ...item, sev: "", detail: `${fname} asked for its TNA${po?.plan_requested_at ? ` ${at.format(new Date(po.plan_requested_at))}` : ` on ${day(po?.plan_requested_on)}`}`,
          chip: dueAt ? { text: `Due ${at.format(dueAt)}`, cls: "warn" } : undefined, action: "Factory agreed" });
      }
    }
    if (lines.some((l) => !l.factory_id)) {
      now_.push({ key: `nof:${o.id}`, href: `/orders/${o.id}#details`, sev: "warn", ...base(o), sheet: { orderId: o.id, mode: "start", factoryId: "" },
        detail: `${plural(lines.filter((l) => !l.factory_id).length, "style")} with no factory yet. Pick it and start production.`, action: "Start production", sort: `1${dueDate(o) ?? "9999"}` });
    }
  }
  // Steps without a target date can't show as late: one line for every order that has them.
  if (noTargets.length) {
    const missing = new Map<string, { o: (typeof open)[number]; n: number }>();
    for (const x of noTargets) missing.set(x.o.id, { o: x.o, n: (missing.get(x.o.id)?.n ?? 0) + x.n });
    const list = [...missing.values()].sort((a, b) => a.o.order_no.localeCompare(b.o.order_no));
    const steps = list.reduce((t, x) => t + x.n, 0);
    now_.push({
      key: "notargets", href: `/orders/${list[0].o.id}#tna`, sev: "warn",
      title: list.length === 1 ? `${list[0].o.order_no} has ${plural(steps, "step")} without a target date` : `${list.length} orders have steps without a target date`,
      detail: `${plural(steps, "step")} in all. Delays can't show until every step has a target; then ask the factory for its TNA.`,
      action: "Set targets", links: list.map((x) => ({ href: `/orders/${x.o.id}#tna`, text: `${x.o.order_no} · ${plural(x.n, "step")}` })), sort: "",
    });
  }

  // What Quality last saw on the floor: fresh news on a late step is shown with it, and isn't asked for again.
  const { data: floorRows } = keep(await floorP);
  const floorRecent = (floorRows ?? []) as { order_id: string; line_id: string; factory_id: string; stage: string; status: string; qty_done: number | null; expected_on: string | null; visited_on: string; created_by: string | null; created_at: string }[];
  const freshFrom = addDays(today, -FRESH_DAYS);
  const heard = new Set(floorRecent.filter((u) => u.visited_on >= freshFrom).map((u) => `${u.line_id}:${u.stage}`));
  const floorNews = (o: (typeof open)[number]) => {
    const u = floorRecent.find((x) => x.order_id === o.id && x.visited_on >= freshFrom && x.status !== "done");
    const l = u && (o.order_lines ?? []).find((x) => x.id === u.line_id);
    return u && l ? ` · From the floor ${dm(u.visited_on)}: ${l.style} ${floorLine(u, stepLabel(u.stage), `${qty(l.qty)} ${l.product === "fabric" ? "m" : "pcs"}`, dm)}` : "";
  };

  // Steps past their target with no Done date, one line per order. Red only when the ship date is at risk;
  // otherwise it is most likely done and not marked yet, so it asks for an update in amber.
  const quality = me?.role === "quality";
  // Quality's own work among them: an inspection (inline, mid-line, final) no style has passed yet.
  const qcOpen = (s: (typeof live)[number]) => {
    const kinds = TNA_STEPS.find((t) => t.key === s.stage)?.qc;
    return !!kinds && ["inline", "midline", "final_qc"].includes(s.stage) && latest(s.line_id, kinds)?.result !== "pass";
  };
  const overdueBy = new Map<string, typeof live>();
  for (const s of live) if (!s.done_on && s.planned_on && s.planned_on < today && (!quality || qcOpen(s))) overdueBy.set(s.order_id, [...(overdueBy.get(s.order_id) ?? []), s]);
  for (const o of active) {
    const late = overdueBy.get(o.id);
    if (!late || pastDue.has(o.id)) continue;
    // Targets past on a plan that isn't locked yet: the Start production line above covers them.
    if (team && !releasedFor(o)) continue;
    const due = dueDate(o);
    const labels = [...new Set(late.sort((a, b) => stepIndex(a.stage) - stepIndex(b.stage)).map((s) => stepLabel(s.stage)))];
    const styles = new Set(late.map((s) => s.line_id)).size;
    const lines = (o.order_lines ?? []).length;
    const facts = `${lines > 1 ? ` · ${styles === lines ? `all ${lines} styles` : `${styles} of ${lines} styles`}` : ""}${due ? ` · ships ${dm(due)}` : ""}`;
    if (quality) {
      // Inspections are Quality's to record: the oldest one first, opened straight in the QC sheet.
      const first = late.reduce((m, s) => (s.planned_on! < m.planned_on! ? s : m), late[0]);
      const kind = TNA_STEPS.find((t) => t.key === first.stage)!.qc![0];
      now_.push({ key: `late:${o.id}`, href: `/orders/${o.id}#qc`, sev: "bad", ...base(o),
        detail: `Not recorded yet: ${labels.join(", ")} · first planned ${dm(first.planned_on!)}${facts}`,
        chip: { text: `${plural(daysBetween(first.planned_on!, today), "day")} overdue`, cls: "bad" },
        action: "Record QC", sort: first.planned_on!, qc: { orderId: o.id, kind } });
      continue;
    }
    const risk = !due || due < today || riskDays(o) > 0;
    now_.push({
      key: `late:${o.id}`, href: due || !team ? `/orders/${o.id}#tna` : `/orders/${o.id}#details`, sev: risk ? "bad" : "warn", ...base(o),
      detail: `${plural(late.length, "step")} past target with no Done date: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""}${floorNews(o)}${facts}`,
      chip: !due ? { text: "No ship date", cls: "bad" } : due < today ? { text: `${plural(daysBetween(due, today), "day")} late`, cls: "bad" }
        : riskDays(o) ? { text: riskLate(riskDays(o)), cls: "bad" } : { text: "Needs update", cls: "warn" },
      action: due ? "Update" : "Set ship date", sort: due ?? "",
      ...(due ? { sheet: { orderId: o.id, mode: "update" as const } } : {}), chase: chaseFor(o),
    });
  }

  // Steps due this week, one line per order.
  const weekBy = new Map<string, typeof live>();
  for (const s of live) if (!s.done_on && s.planned_on && s.planned_on >= today && s.planned_on <= week) weekBy.set(s.order_id, [...(weekBy.get(s.order_id) ?? []), s]);
  for (const o of active) {
    const due = weekBy.get(o.id);
    if (!due || pastDue.has(o.id)) continue;
    const first = due.reduce((m, s) => (s.planned_on! < m ? s.planned_on! : m), due[0].planned_on!);
    const steps = [...new Map(due.sort((a, b) => a.planned_on!.localeCompare(b.planned_on!)).map((s) => [s.stage, s.planned_on!])).entries()];
    const chip = when(first, today);
    // Quality's own work: the QC checks among these steps that no style has passed yet.
    const qcKinds = steps.flatMap(([k]) => {
      const kinds = TNA_STEPS.find((s) => s.key === k)?.qc;
      return kinds && due.some((s) => s.stage === k && latest(s.line_id, kinds)?.result !== "pass") ? [kinds[0]] : [];
    });
    const qcDue = qcKinds.map(qcKindLabel);
    if (me?.role === "quality" && !qcDue.length) continue;
    soon.push({
      key: `week:${o.id}`, href: me?.role === "quality" ? `/orders/${o.id}#qc` : `/orders/${o.id}#tna`, sev: chip.cls, ...base(o),
      detail: me?.role === "quality" ? `${qcDue.join(", ")} QC · planned ${dm(first)}`
        : steps.slice(0, 4).map(([k, d]) => `${stepLabel(k)} ${dm(d)}`).join(", ") + (steps.length > 4 ? ` and ${steps.length - 4} more` : "") + (qcDue.length ? " · QC needed" : ""),
      chip, action: me?.role === "quality" ? "Record QC" : "Update", sort: first + o.order_no,
      ...(me?.role === "quality" ? { qc: { orderId: o.id, kind: qcKinds[0] } } : { sheet: { orderId: o.id, mode: "update" as const } }),
    });
  }

  // Quality's factory visits (Dheeraj, 26 Oct 2026): every factory with production running is visited at least every
  // VISIT_DAYS days, and sooner when a step is late with no word from the floor. One line per factory, red first.
  if (quality) {
    const lastVisit = new Map<string, string>();
    for (const u of floorRecent) if (!lastVisit.has(u.factory_id) || u.visited_on > lastVisit.get(u.factory_id)!) lastVisit.set(u.factory_id, u.visited_on);
    const byFactory = new Map<string, { o: (typeof active)[number]; l: NonNullable<(typeof active)[number]["order_lines"]>[number] }[]>();
    for (const o of active) {
      for (const l of o.order_lines ?? []) {
        if (!l.factory_id || !(pos ?? []).some((p) => p.order_id === o.id && p.factory_id === l.factory_id && p.released_at)) continue;
        if (!live.some((s) => s.line_id === l.id && !s.done_on)) continue;
        byFactory.set(l.factory_id, [...(byFactory.get(l.factory_id) ?? []), { o, l }]);
      }
    }
    const soonTo = addDays(today, VISIT_DAYS);
    for (const [f, rows] of byFactory) {
      const lineIds = new Set(rows.map((r) => r.l.id));
      const open_ = live.filter((s) => lineIds.has(s.line_id) && !s.done_on && s.planned_on);
      const stale = open_.filter((s) => s.planned_on! < today && !heard.has(`${s.line_id}:${s.stage}`)).sort((a, b) => a.planned_on!.localeCompare(b.planned_on!));
      const dueSoon = open_.filter((s) => s.planned_on! >= today && s.planned_on! <= soonTo).sort((a, b) => a.planned_on!.localeCompare(b.planned_on!));
      const last = lastVisit.get(f) ?? null;
      const visitDue = !last || daysBetween(last, today) >= VISIT_DAYS;
      if (!stale.length && !dueSoon.length && !visitDue) continue;
      const orderNos = [...new Set(rows.map((r) => r.o.order_no))];
      const named = (ss: typeof open_) => [...new Set(ss.map((s) => stepLabel(s.stage)))].slice(0, 3).join(", ");
      now_.push({
        key: `visit:${f}`, href: `/orders/${rows[0].o.id}#floor`, sev: stale.length ? "bad" : "warn",
        title: factoryName.get(f) ?? "Factory",
        // The chip says what is wrong; the detail adds when it was last visited unless the chip already says so.
        detail: (stale.length || !visitDue ? `${visitedText(last, today)} · ` : "")
          + (stale.length ? `no word yet on ${named(stale)}` : dueSoon.length ? `${named(dueSoon)} due by ${dm(dueSoon[dueSoon.length - 1].planned_on!)}` : "production running")
          + ` · ${orderNos.slice(0, 3).join(", ")}${orderNos.length > 3 ? ` and ${orderNos.length - 3} more` : ""}, ${plural(lineIds.size, "style")}`,
        chip: stale.length ? { text: `${plural(stale.length, "step")} late`, cls: "bad" } : visitDue ? { text: visitedText(last, today), cls: "warn" } : { text: `Due by ${dm(dueSoon[0].planned_on!)}`, cls: "warn" },
        action: "Start visit", sort: stale[0]?.planned_on ?? last ?? "", visit: { factoryId: f },
      });
    }
  }

  // Shipping within two weeks without a passed final QC.
  for (const o of active) {
    const due = dueDate(o);
    const notPassed = (o.order_lines ?? []).filter((l) => latest(l.id, SHIP_QC)?.result !== "pass");
    if (!due || due < today || due > addDays(today, 14) || !notPassed.length) continue;
    const chip = when(due, today);
    soon.push({ key: `ship:${o.id}`, href: `/orders/${o.id}#qc`, sev: chip.cls, ...base(o),
      detail: `Ships ${dm(due)} · final QC not passed for ${notPassed.length === (o.order_lines ?? []).length ? "any style" : notPassed.map((l) => l.style).join(", ")}`,
      chip: { text: `Ships in ${plural(daysBetween(today, due), "day")}`, cls: chip.cls }, action: me?.role === "quality" ? "Record final QC" : "Plan final QC", sort: due + o.order_no,
      ...(canRecordQc(me?.role) ? { qc: { orderId: o.id, kind: "final" } } : {}) });
  }

  // Steps factories marked done with photos in their panel, waiting for the orders team or Quality to confirm.
  const { data: ups } = keep(await upsP);
  for (const o of open) {
    const mine = (ups ?? []).filter((u) => u.order_id === o.id);
    if (!mine.length) continue;
    const styleOf = new Map((o.order_lines ?? []).map((l) => [l.id, l.style]));
    now_.push({ key: `upd:${o.id}`, href: `/orders/${o.id}#tna`, sev: "warn", ...base(o),
      detail: `Factory marked ${mine.length === 1 ? "a step" : `${mine.length} steps`} done, with photos: ${mine.slice(0, 3).map((u) => `${styleOf.get(u.line_id) ?? ""} ${stepLabel(u.stage)}`.trim()).join(", ")}${mine.length > 3 ? ` and ${mine.length - 3} more` : ""}`,
      action: "Check and confirm", sort: mine[0].created_at });
  }

  // Samples (Fit, strike off, PP, size set): each style's latest round decides. Sent by the factory: check and send on.
  // With the buyer: a reminder after 5 days. Changes asked: the factory is making the next round.
  const { data: rounds } = keep(await roundsP);
  const latestRound = new Map<string, { order_id: string; line_id: string; stage: string; round: number; status: SampleStatus; sent_at: string; forwarded_at: string | null; dispatched_on: string | null; answered_at: string | null }>();
  for (const r of rounds ?? []) latestRound.set(`${r.line_id}:${r.stage}`, r);
  for (const o of open) {
    const styleOf = new Map((o.order_lines ?? []).map((l) => [l.id, l.style]));
    const mine = [...latestRound.values()].filter((r) => r.order_id === o.id && styleOf.has(r.line_id) && !stageOf.get(`${r.line_id}:${r.stage}`)?.done_on);
    const named = (rs: typeof mine) => `${rs.slice(0, 3).map((r) => `${styleOf.get(r.line_id)} ${sampleLabel(r.stage)}${r.round > 1 ? ` (round ${r.round})` : ""}`).join(", ")}${rs.length > 3 ? ` and ${rs.length - 3} more` : ""}`;
    const href = `/orders/${o.id}#samples`;
    const toCheck = mine.filter((r) => r.status === "with_team");
    if (toCheck.length) {
      now_.push({ key: `smp:${o.id}`, href, sev: "warn", ...base(o), detail: `Factory sent ${toCheck.length === 1 ? "a sample" : `${toCheck.length} samples`} to check and send to the buyer: ${named(toCheck)}`,
        chip: { text: "Sample to send", cls: "warn" }, action: "Check samples", sort: toCheck[0].sent_at });
    }
    const withBuyer = mine.filter((r) => r.status === "with_buyer");
    const days = (r: (typeof mine)[number]) => daysBetween(r.dispatched_on ?? (r.forwarded_at ?? r.sent_at).slice(0, 10), today);
    const slow = withBuyer.filter((r) => days(r) >= 5);
    if (slow.length) {
      soon.push({ key: `smpb:${o.id}`, href, sev: "warn", ...base(o), detail: `Sample with the buyer ${plural(Math.max(...slow.map(days)), "day")}, no answer yet: ${named(slow)}`,
        chip: { text: "Buyer to answer", cls: "warn" }, action: "Remind buyer", sort: slow[0].forwarded_at ?? "" });
    }
    if (withBuyer.length > slow.length) {
      const rest = withBuyer.filter((r) => !slow.includes(r));
      waiting.push({ key: `smpw:${o.id}`, href, sev: "", ...base(o), detail: `With the buyer for approval: ${named(rest)}`, action: "Open", sort: rest[0].forwarded_at ?? "" });
    }
    const changes = mine.filter((r) => r.status === "changes" || r.status === "returned");
    if (changes.length) {
      waiting.push({ key: `smpc:${o.id}`, href, sev: "", ...base(o), detail: `Changes asked, factory making the next round: ${named(changes)}`,
        chip: { text: "With factory", cls: "" }, action: "Open", sort: changes[0].answered_at ?? "" });
    }
  }

  // Buyer POs picked up from email or added from a file, latePos to be checked and added as orders.
  // One not added within PO_WAIT_DAYS gets its own red line. Emails from unknown senders reach only the owner.
  const { data: incoming } = keep(await incomingP);
  const poLabel = (p: { buyer_id: string | null; buyer_po: string | null; email_subject: string | null }) =>
    `${p.buyer_id ? `${buyerOf.get(p.buyer_id) ?? ""} ` : ""}PO ${p.buyer_po ?? p.email_subject ?? ""}`.trim();
  const listed = (ps: { buyer_id: string | null; buyer_po: string | null; email_subject: string | null }[]) =>
    `${ps.slice(0, 3).map(poLabel).join(", ")}${ps.length > 3 ? ` and ${ps.length - 3} more` : ""}`;
  const toCheck = (incoming ?? []).filter((p) => p.status !== "held");
  const latePos = toCheck.filter((p) => poWaitDays(p.received_at, nowMs()) > 0);
  const fresh = toCheck.filter((p) => !latePos.includes(p));
  if (latePos.length) {
    const oldest = poWaitDays(latePos[0].received_at, nowMs());
    now_.push({
      key: "incoming-late", href: latePos.length === 1 ? `/pos/${latePos[0].id}` : "/pos", sev: "bad",
      title: latePos.length === 1 ? `1 buyer PO not added as an order after ${PO_WAIT_DAYS} days` : `${latePos.length} buyer POs not added as orders after ${PO_WAIT_DAYS} days`,
      detail: listed(latePos), chip: { text: `Oldest ${plural(oldest, "day")}`, cls: "bad" },
      action: "Add as orders", sort: latePos[0].received_at,
    });
  }
  if (fresh.length) {
    const failed = fresh.filter((p) => p.status === "failed").length;
    now_.push({
      key: "incoming", href: fresh.length === 1 ? `/pos/${fresh[0].id}` : "/pos", sev: failed ? "bad" : "warn",
      title: fresh.length === 1 ? "1 new buyer PO to check" : `${fresh.length} new buyer POs to check`,
      detail: `${listed(fresh)}${failed ? ` · ${failed} couldn't be read` : ""}`,
      action: "Check POs", sort: fresh[0].received_at,
    });
  }
  const held = (incoming ?? []).filter((p) => p.status === "held");
  if (held.length) {
    now_.push({
      key: "incoming-held", href: held.length === 1 ? `/pos/${held[0].id}` : "/pos?show=held", sev: "warn",
      title: held.length === 1 ? "1 email from an unknown sender" : `${held.length} emails from unknown senders`,
      detail: `Not read as POs until you accept them. ${held.slice(0, 3).map((p) => p.email_from ?? p.email_subject ?? "").join(", ")}${held.length > 3 ? ` and ${held.length - 3} more` : ""}`,
      action: "Accept or ignore", sort: held[0].received_at,
    });
  }

  // Buyer inquiries whose follow-up is due: today's in Soon, late ones in Now.
  const { data: inqs } = keep(await inqsP);
  for (const i of (inqs ?? []).filter((x) => who === "all" || x.merchandiser_id === me?.id)) {
    const late = i.next_follow_up! < today;
    (late ? now_ : soon).push({
      key: `inq:${i.id}`, href: `/inquiries/${i.id}`, sev: late ? "bad" : "warn", code: i.inquiry_no,
      title: `${(i.buyer_id && buyerOf.get(i.buyer_id)) || i.prospect || ""} · ${i.product}`,
      detail: `${i.sample_sent_on ? "Sample with the buyer; ask for comments" : i.status === "quoted" ? "Price sent; ask the buyer for a decision" : "Inquiry to answer"} · follow-up ${late ? `was due ${dm(i.next_follow_up!)}` : "due today"}`,
      chip: late ? { text: `${plural(daysBetween(i.next_follow_up!, today), "day")} late`, cls: "bad" } : { text: "Today", cls: "warn" },
      action: "Follow up", sort: i.next_follow_up!,
    });
  }

  // Orders sent in parts: the rest still to send (late once the ship date has passed), and orders whose every
  // piece has shipped but which are still open.
  for (const o of team ? open : []) {
    const sh = shipOf(o);
    const due = dueDate(o);
    const href = `/orders/${o.id}#dispatch`;
    if (sh.part) {
      const late = !!due && due < today;
      (late ? now_ : soon).push({ key: `part:${o.id}`, href, sev: late ? "bad" : "warn", ...base(o),
        detail: `${partText(sh, unitOfAll(o.order_lines ?? []))}${due ? ` · ship date ${dm(due)}` : ""}. Record the next part, or close the order short if the rest won't go.`,
        chip: late ? { text: `Part shipped · ${plural(daysBetween(due!, today), "day")} late`, cls: "bad" } : { text: "Part shipped", cls: "warn" },
        action: "Next part", sort: due ?? "" });
    } else if (sh.shipped > 0 && sh.toShip === 0) {
      soon.push({ key: `allshipped:${o.id}`, href, sev: "ok", ...base(o), detail: `All ${qty(sh.ordered)} ${unitOfAll(o.order_lines ?? [])} have shipped. Mark the order shipped to close it.`,
        chip: { text: "All shipped", cls: "ok" }, action: "Close order", sort: due ?? "" });
    }
  }

  // Dispatch: invoice within 4 hours of the purchase (an emergency after that), then e-way bill and shipping, then the GRN.
  const { data: disp } = keep(await dispP);
  const shippedIds = [...new Set((disp ?? []).map((d) => d.order_id))].filter((id) => !(orders ?? []).some((o) => o.id === id));
  const { data: shipped } = shippedIds.length
    ? keep(await fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, buyer_po, merchandiser_id").in("id", shippedIds).order("id").range(a, z)))
    : { data: [] };
  const orderOf = new Map<string, { id: string; order_no: string; buyer_id: string; buyer_po: string }>(
    [...open, ...(shipped ?? []).filter((o) => who === "all" || o.merchandiser_id === me?.id)].map((o) => [o.id, o]));
  for (const d of disp ?? []) {
    const o = orderOf.get(d.order_id);
    if (!o) continue;
    const item = { href: `/orders/${o.id}#dispatch`, code: o.order_no, title: `${buyerOf.get(o.buyer_id) ?? ""} · bill ${d.purchase_bill_no}` };
    if (!d.invoiced_at) {
      const late = Date.parse(d.invoice_due_at) < now;
      (late ? now_ : soon).push({ ...item, key: `inv:${d.id}`, sev: late ? "bad" : "warn",
        detail: `Buyer invoice ${late ? "was due" : "due"} ${at.format(new Date(d.invoice_due_at))} (within 4 hours of the purchase)`,
        chip: late ? { text: "Emergency", cls: "bad" } : { text: "Invoice within 4 hours", cls: "warn" }, action: "Make invoice", sort: d.invoice_due_at });
    } else if ((!d.eway_at || !d.shipped_at) && heldHours(d.purchased_at, now) >= HOLD_HOURS) {
      // Goods bought should leave within a day; past that they are held up with us.
      now_.push({ ...item, key: `held:${d.id}`, sev: "bad", detail: `${heldText(heldHours(d.purchased_at, now))}, not shipped. ${!d.eway_at ? "Add the e-way bill" : "Add goods photos and the LR"} and send them today.`,
        chip: { text: `Held over ${HOLD_HOURS} hours`, cls: "bad" }, action: !d.eway_at ? "Add e-way bill" : "Add photos and LR", sort: d.purchased_at });
    } else if (!d.eway_at || !d.shipped_at) {
      soon.push({ ...item, key: `disp:${d.id}`, sev: "warn", detail: !d.eway_at ? "Invoiced; add the e-way bill" : "E-way bill in; add goods photos and the LR",
        action: !d.eway_at ? "Add e-way bill" : "Add photos and LR", sort: d.invoiced_at });
    } else if (d.grn_due_on && d.grn_due_on <= addDays(today, 3)) {
      const chip = when(d.grn_due_on, today);
      soon.push({ ...item, key: `grn:${d.id}`, sev: chip.cls, detail: `Shipped; buyer's GRN due ${dm(d.grn_due_on)}`, chip, action: "Add GRN", sort: d.grn_due_on });
    }
  }

  const lists = { now: now_.sort(bySev), soon: soon.sort(bySev), waiting: waiting.sort(bySev) };
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as keyof typeof lists) : lists.now.length || !lists.soon.length ? "now" : "soon";
  const qs = (t: string) => `/today?${new URLSearchParams({ ...(sp.who ? { who: String(sp.who) } : {}), tab: t })}`;

  // The day in numbers, for the header line.
  const late = active.filter((o) => { const d = dueDate(o); return !!d && d < today; });
  const shipSoon = active.filter((o) => { const d = dueDate(o); return !!d && d >= today && d <= addDays(today, 14); });
  const allLines = open.flatMap((o) => o.order_lines ?? []);
  const book = allLines.reduce((s, l) => s + l.qty * Number(priceOf.get(l.id)?.buyer_rate ?? 0), 0);

  const pay = payP ? await payP : null;
  if (pay?.error) errors.push(pay.error.message);
  const payT = pay ? totals(pay.bills, today) : null;
  // Suppliers with bills overdue or due this week, the most overdue first.
  const books = booksP ? await booksP : null;
  if (books?.error) errors.push(books.error.message);
  const collect = books ? paymentTodos(books.books, books.buyerLabel, money, (d) => dayNear(d, books.books.today), books.advice) : [];
  const payDue = pay ? bySupplier(pay.bills.filter((b) => ["overdue", "week"].includes(dueOf(b, today).key)), today).slice(0, 4) : [];

  // Quality's ring counts the updates it posted from the floor today.
  const doneNow = quality ? floorRecent.filter((u) => u.created_by === me?.id && u.created_at >= dayStart).length : doneToday ?? 0;
  const hour = Number(hourIST.format(new Date()));
  const first = (me?.fullName ?? me?.email.split("@")[0] ?? "").split(" ")[0];
  const nowCount = lists.now.length;
  // The greeting counts money jobs that can't wait too, for the owner and Accounts.
  const headCount = nowCount + collect.filter((a) => a.sev === "bad").length;
  const toChase = chaseList.filter((f) => !f.chased).length;

  // One block per order: everything an order needs sits together under its name, worst first, so the same order
  // never shows up three times down the list. Work that isn't about one order (buyer POs, inquiries) stands alone.
  const groups: { key: string; head?: { code?: string; title: string; href: string }; items: Item[] }[] = [];
  for (const i of lists[tab]) {
    const order = i.code && /^\/orders\/([^/#?]+)/.exec(i.href)?.[1];
    const g = order ? groups.find((x) => x.key === order) : undefined;
    if (g) g.items.push(i);
    else groups.push({ key: order || i.key, head: order ? { code: i.code, title: i.title.split(" · bill ")[0], href: `/orders/${order}` } : undefined, items: [i] });
  }

  const urgent = collect.filter((a) => a.sev === "bad").length;
  // Money is Accounts' daily work, so it leads their Home; for the owner it leads only when something can't wait.
  const moneyFirst = me?.role === "accounts" || urgent > 0;
  const moneyCards = (
    <>
      {collect.length > 0 && (
        <section className="card money-card" aria-labelledby="collect-h">
          <header className="card-h">
            <div className="min-w-0">
              <h2 id="collect-h">Money to collect</h2>
              <p>{urgent ? <b className="text-bad">{plural(urgent, "urgent job")}</b> : "Nothing urgent"}{collect.length > 4 && ` · ${collect.length} jobs in all, the first 4 here`}</p>
            </div>
            <Link href="/payments" className="btn sm">Payments</Link>
          </header>
          <ul className="tasks">
            {collect.slice(0, 4).map((a) => (
              <li key={a.title} className="task">
                <span className={`sev ${a.sev === "info" ? "" : a.sev}`} aria-hidden />
                <Link href={a.href} className="task-text">
                  <b>{a.title}</b>
                  <span>{a.detail}</span>
                </Link>
                <div className="task-acts">
                  <Link href={a.href} className="btn sm">{a.href.endsWith("#tally-settle") ? "Check" : "Open"}</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {payT && (payT.overdue > 0 || payT.week > 0) && (
        <section className="card money-card" aria-labelledby="pay-h">
          <header className="card-h">
            <div className="min-w-0">
              <h2 id="pay-h">Factory bills to pay</h2>
              <p>
                {payT.overdue > 0 ? <b className="text-bad">{rupees(payT.overdue)} overdue</b> : "Nothing overdue"}
                {payT.week > 0 && ` · ${rupees(payT.week)} due in 7 days`}
                {payT.msmeLate > 0 && <> · <b className="text-bad">{payT.msmeLate} MSME {payT.msmeLate === 1 ? "bill" : "bills"} past 45 days</b></>}
              </p>
            </div>
            <Link href="/payables" className="btn sm">Plan</Link>
          </header>
          <ul className="tasks">
            {payDue.map((s) => (
              <li key={s.ledger} className="task">
                <span className={`sev ${s.overdue ? "bad" : "warn"}`} aria-hidden />
                <Link href={`/payables?s=${encodeURIComponent(s.ledger)}`} className="task-text">
                  <b>{s.name}</b>
                  <span><em className={`why ${s.worst.tone}`}>{s.worst.text}</em> · {s.bills.length} {s.bills.length === 1 ? "bill" : "bills"} · {rupees(s.bills.reduce((a, b) => a + b.open, 0))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  return (
    <>
      {team && <PageTabs tabs={HOME_TABS} label="Home" />}
      <section className="day" aria-label="Your day">
        <div className="day-main">
          <span className="day-date">{longDay.format(ist(today))}</span>
          <h1>Good {hour >= 4 && hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}{first && `, ${first}`}</h1>
          <p>
            {headCount ? <b className="text-bad">{plural(headCount, "thing")} {headCount === 1 ? "needs" : "need"} you now</b> : <b className="text-ok">Nothing urgent</b>}
            {late.length > 0 && ` · ${plural(late.length, "order")} late`}
            {shipSoon.length > 0 && ` · ${shipSoon.length} ${shipSoon.length === 1 ? "ships" : "ship"} in 14 days`}
            {me?.role === "owner" && book > 0 && ` · ${lakh(book)} open`}
          </p>
        </div>
        {/* Today's progress: things done today against what still needs doing now. */}
        <div className="day-ring">
          <Ring done={doneNow} total={doneNow + headCount} size={64}>
            <b>{doneNow}</b>
          </Ring>
          <span>{quality ? "posted today" : "done today"}</span>
        </div>
      </section>

      {me?.role && <WhatsNew role={me.role} />}

      {moneyFirst && moneyCards}

      {errors.length > 0 && (
        <div className="errbox">Some lists couldn&apos;t load, so this page may be missing work. Reload to try again. ({[...new Set(errors)].join("; ")})</div>
      )}

      <section className="card inbox" aria-label="To do">
        <header className="inbox-h">
          <nav className="seg" aria-label="When">
            {TABS.filter((t) => t.key !== "waiting" || lists.waiting.length || tab === "waiting").map((t) => (
              <Link key={t.key} href={qs(t.key)} aria-current={tab === t.key ? "page" : undefined} scroll={false}>{t.label} <span>{lists[t.key].length}</span></Link>
            ))}
          </nav>
          {mineCount > 0 && (
            <nav className="seg" aria-label="Whose orders">
              <Link href={`/today?${new URLSearchParams({ who: "mine", ...(sp.tab ? { tab: String(sp.tab) } : {}) })}`} aria-current={who === "mine" ? "page" : undefined}>Mine</Link>
              <Link href={`/today?${new URLSearchParams({ who: "all", ...(sp.tab ? { tab: String(sp.tab) } : {}) })}`} aria-current={who === "all" ? "page" : undefined}>All</Link>
            </nav>
          )}
        </header>
        {tab === "now" && toChase > 0 && (
          <Link href="/updates" className="inbox-chase">
            <Icon name="share" size={18} />
            <span className="grow"><b>{toChase} {toChase === 1 ? "factory is" : "factories are"} behind plan.</b> One WhatsApp each lists every late step.</span>
            <span className="link">Chase</span>
          </Link>
        )}
        {groups.length === 0 && tab === "now" && !errors.length ? (
          <div className="all-clear">
            <span className="all-clear-ic" aria-hidden><Icon name="check" size={28} /></span>
            <b>All caught up</b>
            <p>{doneNow ? `${plural(doneNow, quality ? "update" : "step")} ${quality ? "posted" : "done"} today. ` : ""}Nothing is late or waiting on you{lists.soon.length ? `. ${plural(lists.soon.length, "thing")} coming up this week.` : "."}</p>
          </div>
        ) : groups.length === 0 ? (
          <p className="card-empty">
            {errors.length ? "Couldn't load this list. Reload to try again." : tab === "soon" ? "Nothing due in the next 7 days." : "Not waiting on any factory or buyer."}
          </p>
        ) : (
          <ul className="groups">
            {groups.map((g) => (
              <li key={g.key} className="group">
                {g.head && (
                  <Link href={g.head.href} className="group-h">
                    <span className="code">{g.head.code}</span><b>{g.head.title}</b>
                  </Link>
                )}
                <ul className="tasks">
                  {g.items.map((i) => {
                    // A dispatch line names its bill, as one order can have several.
                    const sub = g.head && i.title.includes(" · bill ") ? `Bill ${i.title.split(" · bill ")[1]}` : "";
                    return (
                      <li key={i.key} className="task">
                        <span className={`sev ${i.sev}`} aria-hidden />
                        <div className="task-text">
                          {!g.head && <Link href={i.href} className="task-title">{i.code && <span className="code">{i.code}</span>}{i.title}</Link>}
                          {sub && <b>{sub}</b>}
                          <span>{i.chip && <em className={`why ${i.chip.cls}`}>{i.chip.text}</em>}{i.chip && " · "}{i.detail}</span>
                          {i.links && (
                            <span className="task-links">
                              {i.links.slice(0, 6).map((l) => <Link key={l.href} href={l.href} className="chip code">{l.text}</Link>)}
                              {i.links.length > 6 && <Link href={i.href} className="chip">+{i.links.length - 6} more</Link>}
                            </span>
                          )}
                        </div>
                        <div className="task-acts">
                          {i.chase && <ChaseLink {...i.chase} compact />}
                          {i.visit
                            ? <VisitButton factoryId={i.visit.factoryId} className="btn sm">{i.action}</VisitButton>
                            : i.qc
                            ? <QcButton orderId={i.qc.orderId} kind={i.qc.kind} className="btn sm">{i.action}</QcButton>
                            : i.sheet
                            ? <SheetButton {...i.sheet} className="btn sm">{i.action}</SheetButton>
                            : <Link href={i.href} className="btn sm">{i.action}</Link>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!moneyFirst && moneyCards}

      {team && stale.length > 0 && (
        <section className="card" aria-labelledby="tidy-h">
          <header className="card-h">
            <div className="min-w-0">
              <h2 id="tidy-h">Tidy up</h2>
              <p>Shipped long ago but still open, so they count as late.</p>
            </div>
          </header>
          <ul className="rows">
            {stale.map((o) => (
              <li key={o.id} className="tidy-row">
                <Link href={`/orders/${o.id}`} className="min-w-0">
                  <span className="todo-title"><span className="code">{o.order_no}</span>{buyerOf.get(o.buyer_id)}</span>
                  <span className="todo-detail block">Ship date {dm(dueDate(o)!)} · {qtyTotal(o.order_lines ?? [])}</span>
                </Link>
                <MarkShipped orderId={o.id} orderNo={o.order_no} blocked={staleBlocker.get(o.id)} old={!!staleBlocker.get(o.id)?.startsWith("Nothing is in Dispatch")} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
