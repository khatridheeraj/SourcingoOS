import type { LinePrice } from "@/lib/margin";
import Link from "next/link";
import { canEditOrders, getMe } from "@/lib/auth";
import { fetchAll } from "@/lib/fetch-all";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { day, daysBetween, dueDate, nowMs, planDueAt, PLAN_HOURS, qcKindLabel, qty, SHIP_QC, stageReached, TNA_STEPS, todayIST } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";
import { MarkShipped } from "./mark-shipped";

type Sev = "bad" | "warn" | "ok" | "";
// One line of the to-do list: what it is, why, and the one button that deals with it.
type Item = {
  key: string; href: string; sev: Sev; code?: string; title: string; detail: string;
  chip?: { text: string; cls: Sev }; action: string; links?: { href: string; text: string }[]; sort: string;
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

// Where a style is, by the furthest standard step it has done.
const PHASES = [
  { label: "No targets yet", upTo: -2 },
  { label: "Planned, not started", upTo: -1 },
  { label: "Samples and fabric", upTo: TNA_STEPS.findIndex((s) => s.key === "size_set") },
  { label: "Cutting and stitching", upTo: TNA_STEPS.findIndex((s) => s.key === "midline") },
  { label: "Finishing and final QC", upTo: TNA_STEPS.findIndex((s) => s.key === "final_qc") },
  { label: "Left the factory", upTo: TNA_STEPS.length },
];

const TABS = [
  { key: "now", label: "Now", hint: "Late, overdue or blocking work. Red first." },
  { key: "soon", label: "Coming up", hint: "Steps due in the next 7 days, dispatch, GRNs, and shipments without a passed final QC." },
  { key: "waiting", label: "Waiting on others", hint: `Factories asked for their TNA (they have ${PLAN_HOURS} hours).` },
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

  const [{ data: orders }, buyers, factories] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id, stage, order_lines(id, style, qty, factory_id)")
      .eq("company_id", companyId)
      .eq("status", "open")
      .is("order_lines.removed_at", null),
    loadBuyers(),
    loadFactories(),
  ]);
  const mineCount = (orders ?? []).filter((o) => o.merchandiser_id === me?.id).length;
  // Merchandisers see their own orders first; anyone can switch to everyone's.
  const who = sp.who === "all" || sp.who === "mine" ? sp.who : me?.role === "merchandiser" && mineCount ? "mine" : "all";
  const open = (orders ?? []).filter((o) => who === "all" || o.merchandiser_id === me?.id);
  const ids = open.map((o) => o.id);

  const [{ data: pos }, { data: stages }, { data: checks }] = ids.length
    ? await Promise.all([
        supabase.from("factory_pos").select("order_id, factory_id, plan_requested_on, plan_requested_at, factory_sent_at, released_at, buffer_days").in("order_id", ids),
        fetchAll((a, z) => supabase.from("line_stages").select("order_id, line_id, stage, label, planned_on, done_on, not_needed, factory_on").in("order_id", ids).order("id").range(a, z)),
        fetchAll((a, z) => supabase.from("qc_checks").select("line_id, kind, result, checked_on").in("order_id", ids).is("cancelled_at", null)
          .order("checked_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(a, z)),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const extraLabel = new Map((stages ?? []).filter((s) => s.label).map((s) => [s.stage, String(s.label)]));
  const stepLabel = (k: string) => TNA_STEPS.find((s) => s.key === k)?.label ?? extraLabel.get(k) ?? k;
  const stepIndex = (k: string) => { const i = TNA_STEPS.findIndex((s) => s.key === k); return i < 0 ? TNA_STEPS.length : i; };
  const stageOf = new Map((stages ?? []).map((s) => [`${s.line_id}:${s.stage}`, s]));
  const liveLine = new Set(open.flatMap((o) => (o.order_lines ?? []).map((l) => l.id)));
  // Steps that count: on a style still on the order and not marked not needed.
  const live = (stages ?? []).filter((s) => liveLine.has(s.line_id) && !s.not_needed);
  const latest = (lineId: string, kinds: string[]) => (checks ?? []).find((c) => c.line_id === lineId && kinds.includes(c.kind));
  const finalPassed = (o: (typeof open)[number]) => (o.order_lines ?? []).length > 0 && (o.order_lines ?? []).every((l) => latest(l.id, SHIP_QC)?.result === "pass");

  // Orders that shipped long ago but were never closed: 30+ days past the ship date and packed or further.
  const stale = open.filter((o) => { const d = dueDate(o); return !!d && d < addDays(today, -30) && stageReached(o.stage, "packed"); });
  const staleIds = new Set(stale.map((o) => o.id));
  const active = open.filter((o) => !staleIds.has(o.id));
  const base = (o: (typeof open)[number]) => ({ code: o.order_no, title: `${buyerOf.get(o.buyer_id) ?? ""}${o.buyer_po ? ` · PO ${o.buyer_po}` : ""}` });

  // Factory POs: ask for the plan, chase it, release it. A factory that hasn't sent its TNA within 24 hours is critical.
  const now = nowMs();
  // Factory rates come separately: the database gives them only to the orders team and Accounts.
  const { data: rates } = team && ids.length ? await supabase.rpc("line_prices", { p_orders: ids }) : { data: [] };
  const priceOf = new Map(((rates ?? []) as LinePrice[]).map((r) => [r.id, r]));
  const now_: Item[] = [];
  const soon: Item[] = [];
  const waiting: Item[] = [];
  const noTargets: { o: (typeof open)[number]; n: number }[] = [];
  // Factory plans and POs are the orders team's work; Quality doesn't see them.
  for (const o of team ? active : []) {
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
      // Nothing planned yet for this factory: gathered into one line below.
      if (noTarget === rows.length && !po?.plan_requested_at && !po?.plan_requested_on) {
        noTargets.push({ o, n: noTarget });
        continue;
      }
      // The PO target date: delivery less the buffer. Targets after it block the release, as on the order page.
      const due = dueDate(o);
      const target = due && po?.buffer_days != null ? addDays(due, -po.buffer_days) : "";
      const gaps = fl.filter((l) => priceOf.get(l.id)?.factory_rate == null).length + noTarget
        + rows.filter((r) => !r.factory_on || (r.planned_on && r.factory_on > r.planned_on)).length
        + (target ? rows.filter((r) => r.planned_on && r.planned_on > target).length : 0);
      const dueAt = po?.plan_requested_at ? planDueAt(po.plan_requested_at) : null;
      const item = { key: `po:${o.id}:${f}`, href, ...base(o), sort: o.order_no };
      if (dueAt && !po?.factory_sent_at && dueAt.getTime() < now) {
        const hours = Math.floor((now - dueAt.getTime()) / 3_600_000);
        now_.push({ ...item, sev: "bad", detail: `${fname} hasn't sent its TNA within ${PLAN_HOURS} hours. Chase them, or move the styles to another factory.`,
          chip: { text: hours ? `${plural(hours, "hour")} past deadline` : "Just past deadline", cls: "bad" }, action: "Chase factory", sort: dueAt.toISOString() });
      } else if (!gaps) {
        soon.push({ ...item, sev: "ok", detail: `${fname} · plan is complete`, action: "Release PO" });
      } else if (!po?.plan_requested_at && !po?.plan_requested_on) {
        now_.push({ ...item, sev: "bad", detail: `${fname} · ${plural(gaps, "item")} missing before the PO can be released`, action: noTarget ? `Set ${plural(noTarget, "target")}` : "Ask the factory" });
      } else if (po?.factory_sent_at) {
        soon.push({ ...item, sev: "warn", detail: `${fname} sent its TNA · ${plural(gaps, "item")} to sort before release`, action: "Review TNA" });
      } else {
        waiting.push({ ...item, sev: "", detail: `${fname} asked for its TNA${po?.plan_requested_at ? ` ${at.format(new Date(po.plan_requested_at))}` : ` on ${day(po?.plan_requested_on)}`}`,
          chip: dueAt ? { text: `Due ${at.format(dueAt)}`, cls: "warn" } : undefined, action: "Open" });
      }
    }
    if (lines.some((l) => !l.factory_id)) {
      now_.push({ key: `nof:${o.id}`, href: `/orders/${o.id}#details`, sev: "bad", ...base(o), detail: "Some styles have no factory yet", action: "Choose factory", sort: o.order_no });
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

  // Overdue TNA steps, one line per order.
  const overdueBy = new Map<string, typeof live>();
  for (const s of live) if (!s.done_on && s.planned_on && s.planned_on < today) overdueBy.set(s.order_id, [...(overdueBy.get(s.order_id) ?? []), s]);
  for (const o of active) {
    const late = overdueBy.get(o.id);
    if (!late) continue;
    const due = dueDate(o);
    const labels = [...new Set(late.sort((a, b) => stepIndex(a.stage) - stepIndex(b.stage)).map((s) => stepLabel(s.stage)))];
    const styles = new Set(late.map((s) => s.line_id)).size;
    const lines = (o.order_lines ?? []).length;
    now_.push({
      key: `late:${o.id}`, href: due || !team ? `/orders/${o.id}#tna` : `/orders/${o.id}#details`, sev: "bad", ...base(o),
      detail: `${plural(late.length, "step")} overdue: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""}`
        + `${lines > 1 ? ` · ${styles === lines ? `all ${lines} styles` : `${styles} of ${lines} styles`}` : ""}${due ? ` · ships ${dm(due)}` : ""}`,
      chip: !due ? { text: "No ship date", cls: "bad" } : due < today ? { text: `${plural(daysBetween(due, today), "day")} late`, cls: "bad" } : { text: "Behind plan", cls: "bad" },
      action: !team ? "Enter done dates" : due ? "Update TNA" : "Set ship date", sort: due ?? "",
    });
  }

  // Steps due this week, one line per order.
  const weekBy = new Map<string, typeof live>();
  for (const s of live) if (!s.done_on && s.planned_on && s.planned_on >= today && s.planned_on <= week) weekBy.set(s.order_id, [...(weekBy.get(s.order_id) ?? []), s]);
  for (const o of active) {
    const due = weekBy.get(o.id);
    if (!due) continue;
    const first = due.reduce((m, s) => (s.planned_on! < m ? s.planned_on! : m), due[0].planned_on!);
    const steps = [...new Map(due.sort((a, b) => a.planned_on!.localeCompare(b.planned_on!)).map((s) => [s.stage, s.planned_on!])).entries()];
    const chip = when(first, today);
    // Quality's own work: the QC checks among these steps that no style has passed yet.
    const qcDue = steps.flatMap(([k]) => {
      const kinds = TNA_STEPS.find((s) => s.key === k)?.qc;
      return kinds && due.some((s) => s.stage === k && latest(s.line_id, kinds)?.result !== "pass") ? [qcKindLabel(kinds[0])] : [];
    });
    if (me?.role === "quality" && !qcDue.length) continue;
    soon.push({
      key: `week:${o.id}`, href: me?.role === "quality" ? `/orders/${o.id}#qc` : `/orders/${o.id}#tna`, sev: chip.cls, ...base(o),
      detail: me?.role === "quality" ? `${qcDue.join(", ")} QC · planned ${dm(first)}`
        : steps.slice(0, 4).map(([k, d]) => `${stepLabel(k)} ${dm(d)}`).join(", ") + (steps.length > 4 ? ` and ${steps.length - 4} more` : "") + (qcDue.length ? " · QC needed" : ""),
      chip, action: me?.role === "quality" ? "Record QC" : "Open TNA", sort: first + o.order_no,
    });
  }

  // Shipping within two weeks without a passed final QC.
  for (const o of active) {
    const due = dueDate(o);
    const notPassed = (o.order_lines ?? []).filter((l) => latest(l.id, SHIP_QC)?.result !== "pass");
    if (!due || due < today || due > addDays(today, 14) || !notPassed.length) continue;
    const chip = when(due, today);
    soon.push({ key: `ship:${o.id}`, href: `/orders/${o.id}#qc`, sev: chip.cls, ...base(o),
      detail: `Ships ${dm(due)} · final QC not passed for ${notPassed.length === (o.order_lines ?? []).length ? "any style" : notPassed.map((l) => l.style).join(", ")}`,
      chip: { text: `Ships in ${plural(daysBetween(today, due), "day")}`, cls: chip.cls }, action: me?.role === "quality" ? "Record final QC" : "Plan final QC", sort: due + o.order_no });
  }

  // Buyer POs picked up from email or added from a file, waiting to be checked and added as orders.
  const { data: incoming } = team
    ? await supabase.from("incoming_pos").select("id, buyer_id, buyer_po, email_subject, status, received_at")
        .eq("company_id", companyId).in("status", ["to_check", "failed"]).order("received_at")
    : { data: [] };
  if (incoming?.length) {
    const failed = incoming.filter((p) => p.status === "failed").length;
    now_.push({
      key: "incoming", href: incoming.length === 1 ? `/pos/${incoming[0].id}` : "/pos", sev: failed ? "bad" : "warn",
      title: incoming.length === 1 ? "1 new buyer PO to check" : `${incoming.length} new buyer POs to check`,
      detail: `${incoming.slice(0, 3).map((p) => `${p.buyer_id ? `${buyerOf.get(p.buyer_id) ?? ""} ` : ""}PO ${p.buyer_po ?? p.email_subject ?? ""}`.trim()).join(", ")}${incoming.length > 3 ? ` and ${incoming.length - 3} more` : ""}`
        + `${failed ? ` · ${failed} couldn't be read` : ""}`,
      action: "Check POs", sort: incoming[0].received_at,
    });
  }

  // Dispatch: invoice within 4 hours of the purchase (an emergency after that), then e-way bill and shipping, then the GRN.
  // Dispatches of every order, shipped ones too: an order marked shipped still waits for the buyer's GRN.
  const { data: disp } = team
    ? await supabase.from("dispatches").select("id, order_id, purchase_bill_no, invoice_due_at, invoiced_at, eway_at, shipped_at, grn_due_on, grn_at")
        .eq("company_id", companyId).is("cancelled_at", null).is("grn_at", null)
    : { data: [] };
  const shippedIds = [...new Set((disp ?? []).map((d) => d.order_id))].filter((id) => !(orders ?? []).some((o) => o.id === id));
  const { data: shipped } = shippedIds.length
    ? await supabase.from("orders").select("id, order_no, buyer_id, buyer_po, merchandiser_id").in("id", shippedIds)
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

  // Numbers on top.
  const late = active.filter((o) => { const d = dueDate(o); return !!d && d < today; });
  const shipSoon = active.filter((o) => { const d = dueDate(o); return !!d && d >= today && d <= addDays(today, 14); });
  const pcs = (os: typeof open) => os.reduce((s, o) => s + (o.order_lines ?? []).reduce((t, l) => t + l.qty, 0), 0);
  const allLines = open.flatMap((o) => o.order_lines ?? []);
  const book = allLines.reduce((s, l) => s + l.qty * Number(priceOf.get(l.id)?.buyer_rate ?? 0), 0);
  const unpriced = allLines.filter((l) => priceOf.get(l.id)?.buyer_rate == null).length;

  // Shipping next: each open order's progress against its plan, by ship date.
  const progress = (o: (typeof open)[number]) => {
    const rows = live.filter((s) => s.order_id === o.id && (s.planned_on || s.done_on));
    return { total: rows.length, done: rows.filter((s) => s.done_on).length, behind: overdueBy.has(o.id) };
  };
  const shipping = [...active].sort((a, b) => (dueDate(a) ?? "9999").localeCompare(dueDate(b) ?? "9999") || a.order_no.localeCompare(b.order_no)).slice(0, 7);

  // Where the styles are, counted per style (each style has its own TNA).
  const phaseCount = PHASES.map(() => 0);
  for (const l of active.flatMap((o) => o.order_lines ?? [])) {
    const rows = live.filter((s) => s.line_id === l.id && TNA_STEPS.some((t) => t.key === s.stage));
    const doneIdx = Math.max(-1, ...rows.filter((s) => s.done_on).map((s) => stepIndex(s.stage)));
    const at_ = !rows.some((s) => s.planned_on || s.done_on) ? -2 : doneIdx;
    phaseCount[PHASES.findIndex((p) => at_ <= p.upTo)]++;
  }
  const styleTotal = phaseCount.reduce((s, n) => s + n, 0);

  const hour = Number(hourIST.format(new Date()));
  const first = (me?.fullName ?? me?.email.split("@")[0] ?? "").split(" ")[0];
  const nowCount = lists.now.length;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Good {hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}{first && `, ${first}`}</h1>
          <p>
            {longDay.format(ist(today))}.{" "}
            {nowCount ? <b className="text-bad">{plural(nowCount, "thing")} {nowCount === 1 ? "needs" : "need"} you now.</b> : <b className="text-ok">Nothing urgent.</b>}
            {shipSoon.length > 0 && ` ${plural(shipSoon.length, "order")} ${shipSoon.length === 1 ? "ships" : "ship"} in the next two weeks.`}
          </p>
        </div>
        {mineCount > 0 && (
          <div className="filters">
            <Link className="pill" href="/today?who=mine" aria-current={who === "mine" ? "page" : undefined}>My orders {mineCount}</Link>
            <Link className="pill" href="/today?who=all" aria-current={who === "all" ? "page" : undefined}>Everyone&apos;s {(orders ?? []).length}</Link>
          </div>
        )}
      </div>

      <div className="kpis">
        <Link href={qs("now")} className={`tile ${nowCount ? "alarm" : ""}`}><span>Needs you now</span><b>{nowCount}</b><small>{nowCount ? "late, overdue or blocking" : "all clear"}</small></Link>
        <Link href={team ? "/?status=late" : qs("now")} className={`tile ${late.length ? "alarm" : ""}`}><span>Late orders</span><b>{late.length}</b>
          <small>{stale.length ? `past ship date · ${stale.length} more look shipped` : "past ship date"}</small></Link>
        <Link href={qs("soon")} className="tile"><span>Ship in 14 days</span><b>{shipSoon.length}</b>
          <small>{shipSoon.length ? `${qty(pcs(shipSoon))} pcs · ${shipSoon.filter((o) => !finalPassed(o)).length} without final QC` : "nothing ships soon"}</small></Link>
        {team && book > 0 ? (
          <Link href="/" className="tile"><span>Open order book</span><b>{lakh(book)}</b>
            <small>{plural(open.length, "order")} · {plural(allLines.length, "style")} · {qty(pcs(open))} pcs{unpriced ? ` · ${unpriced} without a rate` : ""}</small></Link>
        ) : (
          <Link href="/" className="tile"><span>Open orders</span><b>{open.length}</b><small>{plural(allLines.length, "style")} · {qty(pcs(open))} pcs</small></Link>
        )}
      </div>

      <div className="home">
        <section className="panel" aria-labelledby="todo-h">
          <div className="row mb-1">
            <h2 id="todo-h" className="grow font-bold text-base">To do</h2>
            <div className="filters">
              {TABS.filter((t) => t.key !== "waiting" || lists.waiting.length || tab === "waiting").map((t) => (
                <Link key={t.key} className="pill" href={qs(t.key)} aria-current={tab === t.key ? "page" : undefined} scroll={false}>{t.label} {lists[t.key].length}</Link>
              ))}
            </div>
          </div>
          <p className="muted mb-2 text-[13px]">{TABS.find((t) => t.key === tab)?.hint}</p>
          {lists[tab].length === 0 ? (
            <p className="py-3 text-[13px] font-semibold text-ok">
              {tab === "now" ? "Nothing is late or blocked." : tab === "soon" ? "Nothing due in the next 7 days." : "Not waiting on any factory."}
            </p>
          ) : (
            <ul className="todo">
              {lists[tab].map((i) => (
                <li key={i.key}>
                  <span className={`sev ${i.sev}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={i.href} className="font-semibold hover:underline">
                      {i.code && <span className="code mr-1.5 text-accent">{i.code}</span>}{i.title}
                    </Link>
                    <div className="muted text-[13px]">{i.detail}</div>
                    {i.links && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {i.links.map((l) => <Link key={l.href} href={l.href} className="chip code hover:underline">{l.text}</Link>)}
                      </div>
                    )}
                  </div>
                  <div className="todo-end">
                    {i.chip && <span className={`chip ${i.chip.cls}`}>{i.chip.text}</span>}
                    <Link href={i.href} className={`btn sm ${i.sev === "bad" ? "primary" : ""}`}>{i.action}</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-[18px]">
          {team && stale.length > 0 && (
            <section className="warnbox flex flex-col gap-2.5" aria-labelledby="tidy-h">
              <h2 id="tidy-h" className="font-bold">Tidy up</h2>
              <p className="text-foreground">These shipped long ago but are still open, so they count as late.</p>
              {stale.map((o) => (
                <div key={o.id} className="row justify-between">
                  <Link href={`/orders/${o.id}`} className="min-w-0 text-foreground hover:underline">
                    <b className="code">{o.order_no}</b> {buyerOf.get(o.buyer_id)} · ship date {dm(dueDate(o)!)}
                  </Link>
                  <MarkShipped orderId={o.id} orderNo={o.order_no} />
                </div>
              ))}
            </section>
          )}

          <section className="panel" aria-labelledby="ship-h">
            <div className="row mb-3"><h2 id="ship-h" className="grow font-bold text-base">Shipping next</h2><Link href="/" className="link text-[13px]">All orders</Link></div>
            {shipping.length === 0 ? <p className="muted text-[13px]">No open orders.</p> : (
              <ul className="flex flex-col gap-3">
                {shipping.map((o) => {
                  const d = dueDate(o);
                  const p = progress(o);
                  const passed = finalPassed(o);
                  const lateBy = d && d < today ? daysBetween(d, today) : 0;
                  const state = !d ? { text: "No ship date", cls: "text-bad" } : lateBy ? { text: `${plural(lateBy, "day")} late`, cls: "text-bad" }
                    : passed ? { text: "Final QC passed", cls: "text-ok" } : !p.total ? { text: "No targets set", cls: "text-warn" }
                    : p.behind ? { text: "Behind plan", cls: "text-bad" } : { text: "On plan", cls: "text-ok" };
                  return (
                    <li key={o.id}>
                      <Link href={`/orders/${o.id}`} className="ship-row">
                        <span className={`date ${!d || lateBy ? "late" : ""}`}>
                          {d ? <><b>{Number(d.slice(8, 10))}</b><span>{MONTHS[Number(d.slice(5, 7)) - 1]}</span></> : <><b>?</b><span>date</span></>}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold"><span className="code mr-1.5 text-accent">{o.order_no}</span>{buyerOf.get(o.buyer_id)}</span>
                          <span className="bar"><i className={state.cls === "text-bad" ? "bad" : state.cls === "text-ok" ? "ok" : ""} style={{ width: `${p.total ? Math.max(3, (100 * p.done) / p.total) : 0}%` }} /></span>
                          <span className="muted mt-1 flex flex-wrap justify-between gap-x-2 text-xs">
                            <span>{p.total ? `${p.done} of ${p.total} steps done` : "No steps planned"} · {qty(pcs([o]))} pcs</span>
                            <span className={`font-semibold ${state.cls}`}>{state.text}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="pipe-h">
            <div className="row mb-3"><h2 id="pipe-h" className="grow font-bold text-base">Where the styles are</h2><span className="chip">{plural(styleTotal, "style")}</span></div>
            <ul className="flex flex-col gap-2">
              {PHASES.map((p, i) => (
                <li key={p.label} className="pipe-row">
                  <span>{p.label}</span>
                  <span className="track"><i className={i < 2 ? "dim" : i === PHASES.length - 1 ? "ok" : ""} style={{ width: `${styleTotal ? (100 * phaseCount[i]) / styleTotal : 0}%` }} /></span>
                  <b className="num">{phaseCount[i]}</b>
                </li>
              ))}
            </ul>
            <p className="muted mt-3 text-xs">Each style counts by the furthest step it has done, since every style has its own TNA.</p>
          </section>
        </div>
      </div>
    </>
  );
}
