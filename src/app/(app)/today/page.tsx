import type { LinePrice } from "@/lib/margin";
import Link from "next/link";
import { canEditOrders, getMe } from "@/lib/auth";
import { fetchAll } from "@/lib/fetch-all";
import { loadBuyers, loadFactories } from "@/lib/data";
import { day, daysBetween, dueDate, nowMs, planDueAt, PLAN_HOURS, qcKindLabel, SHIP_QC, TNA_STEPS, todayIST } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";

type Item = { key: string; orderId: string; href?: string; title: string; detail: string; chip: { text: string; cls: string }; sort: string };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const when = (date: string, today: string) => {
  const n = daysBetween(today, date);
  return n < 0 ? { text: `Overdue ${plural(-n, "day")}`, cls: "bad" } : n === 0 ? { text: "Due today", cls: "warn" } : { text: `Due in ${plural(n, "day")}`, cls: n <= 2 ? "warn" : "" };
};

// One list of what needs doing across all open orders: factory plans and POs, TNA steps due, QC coming up, shipments without a final QC.
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  const sp = await searchParams;
  const me = await getMe();
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const today = todayIST();
  const week = addDays(today, 7);

  const [{ data: orders }, buyers, factories] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id, order_lines(id, style, factory_id)")
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
        supabase.from("qc_checks").select("order_id, kind, result, checked_on").in("order_id", ids).is("cancelled_at", null)
          .order("checked_on", { ascending: false }).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const buyerCode = new Map(buyers.map((b) => [b.id, b.code]));
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const label = (o: Pick<(typeof open)[number], "order_no" | "buyer_id" | "buyer_po">) => `${o.order_no} · ${buyerCode.get(o.buyer_id) ?? ""} ${o.buyer_po}`.trim();
  const extraLabel = new Map((stages ?? []).filter((s) => s.label).map((s) => [s.stage, String(s.label)]));
  const stepLabel = (k: string) => TNA_STEPS.find((s) => s.key === k)?.label ?? extraLabel.get(k) ?? k;
  const stageOf = new Map((stages ?? []).map((s) => [`${s.line_id}:${s.stage}`, s]));

  // Factory POs: ask for the plan, chase it, release it. A factory that hasn't sent its TNA within 24 hours is critical.
  const now = nowMs();
  // Factory rates come separately: the database gives them only to the orders team and Accounts.
  const { data: rates } = canEditOrders(me?.role) && ids.length ? await supabase.rpc("line_prices", { p_orders: ids }) : { data: [] };
  const hasRate = new Set(((rates ?? []) as LinePrice[]).filter((r) => r.factory_rate != null).map((r) => r.id));
  const poItems: Item[] = [];
  const critical: Item[] = [];
  for (const o of open) {
    const lines = o.order_lines ?? [];
    for (const f of [...new Set(lines.map((l) => l.factory_id).filter(Boolean))] as string[]) {
      const po = (pos ?? []).find((p) => p.order_id === o.id && p.factory_id === f);
      const fl = lines.filter((l) => l.factory_id === f);
      // Each style's steps: standard ones not marked not needed, plus its extra steps.
      const rows = fl.flatMap((l) => [
        ...TNA_STEPS.map((s) => stageOf.get(`${l.id}:${s.key}`) ?? { planned_on: null, factory_on: null, not_needed: false, done_on: null }),
        ...(stages ?? []).filter((s) => s.line_id === l.id && s.stage.startsWith("extra_")),
      ]).filter((r) => !r.not_needed);
      const noTarget = rows.filter((r) => !r.planned_on).length;
      if (po?.released_at) {
        // A released PO's steps without a target can't show as late, so ask for the missing targets.
        const untracked = rows.filter((r) => !r.planned_on && !r.done_on).length;
        if (untracked) {
          poItems.push({
            key: `${o.id}:${f}`, orderId: o.id, title: `${label(o)} · ${factoryName.get(f) ?? "Factory"}`,
            detail: `PO released, but ${plural(untracked, "step")} across ${plural(fl.length, "style")} ${untracked === 1 ? "has" : "have"} no target date, so ${untracked === 1 ? "it isn't" : "they aren't"} tracked for delays`,
            chip: { text: `Set ${plural(untracked, "target")}`, cls: "bad" }, sort: `1${o.order_no}`,
          });
        }
        continue;
      }
      // The PO target date: delivery less the buffer. Targets after it block the release, as on the order page.
      const due = o.revised_ship_date || o.ship_date;
      const target = due && po?.buffer_days != null ? addDays(due, -po.buffer_days) : "";
      const gaps = fl.filter((l) => !hasRate.has(l.id)).length + noTarget
        + rows.filter((r) => !r.factory_on || (r.planned_on && r.factory_on > r.planned_on)).length
        + (target ? rows.filter((r) => r.planned_on && r.planned_on > target).length : 0);
      const dueAt = po?.plan_requested_at ? planDueAt(po.plan_requested_at) : null;
      if (dueAt && !po?.factory_sent_at && dueAt.getTime() < now) {
        const hours = Math.floor((now - dueAt.getTime()) / 3_600_000);
        critical.push({
          key: `crit:${o.id}:${f}`, orderId: o.id, title: `${label(o)} · ${factoryName.get(f) ?? "Factory"}`,
          detail: `No TNA within ${PLAN_HOURS} hours. Chase the factory, or move the styles to another factory.`,
          chip: { text: hours ? `${plural(hours, "hour")} past deadline` : "Just past deadline", cls: "bad" }, sort: dueAt.toISOString(),
        });
        continue;
      }
      const chip = !gaps ? { text: "Ready to release", cls: "ok" }
        : !po?.plan_requested_at && !po?.plan_requested_on ? (noTarget ? { text: `Set ${plural(noTarget, "target")}`, cls: "bad" } : { text: "Ask the factory", cls: "bad" })
        : !po?.factory_sent_at && dueAt ? { text: `Factory TNA due ${at.format(dueAt)}`, cls: "warn" }
        : po?.factory_sent_at ? { text: "Factory sent TNA, review it", cls: "warn" }
        : { text: `Plan asked ${day(po?.plan_requested_on)}`, cls: "warn" };
      poItems.push({
        key: `${o.id}:${f}`, orderId: o.id, title: `${label(o)} · ${factoryName.get(f) ?? "Factory"}`,
        detail: gaps ? `${plural(gaps, "item")} missing before the PO can be released` : "Plan is complete. Release the PO on the order.",
        chip, sort: `${!gaps ? 0 : !po?.plan_requested_at && !po?.plan_requested_on ? 1 : 2}${o.order_no}`,
      });
    }
    if (lines.some((l) => !l.factory_id)) {
      poItems.push({ key: `${o.id}:none`, orderId: o.id, title: label(o), detail: "Some styles have no factory yet", chip: { text: "Choose factory", cls: "bad" }, sort: `1${o.order_no}` });
    }
  }
  poItems.sort((a, b) => a.sort.localeCompare(b.sort));

  // TNA steps not done, by order and step: overdue first, then this week.
  const steps = new Map<string, { o: (typeof open)[number]; stage: string; date: string; styles: string[] }>();
  for (const s of stages ?? []) {
    if (s.done_on || s.not_needed || !s.planned_on || s.planned_on > week) continue;
    const o = open.find((x) => x.id === s.order_id);
    const line = o?.order_lines?.find((l) => l.id === s.line_id);
    if (!o || !line) continue;
    const k = `${o.id}:${s.stage}`;
    const cur = steps.get(k) ?? { o, stage: s.stage, date: s.planned_on, styles: [] as string[] };
    cur.styles.push(line.style);
    if (s.planned_on < cur.date) cur.date = s.planned_on;
    steps.set(k, cur);
  }
  const stepItems: Item[] = [...steps.entries()].map(([k, v]) => ({
    key: k, orderId: v.o.id, title: `${label(v.o)} · ${stepLabel(v.stage)}`,
    detail: `${v.styles.join(", ")} · plan ${day(v.date)}`, chip: when(v.date, today), sort: v.date + v.o.order_no,
  })).sort((a, b) => a.sort.localeCompare(b.sort));
  const overdue = stepItems.filter((i) => i.chip.cls === "bad");
  const thisWeek = stepItems.filter((i) => i.chip.cls !== "bad");

  // QC coming up: a TNA step Quality checks, planned within a week, with no passed check of that kind yet.
  const latest = (orderId: string, kinds: string[]) => (checks ?? []).find((c) => c.order_id === orderId && kinds.includes(c.kind));
  const qcItems: Item[] = [];
  for (const [k, v] of steps) {
    const kinds = TNA_STEPS.find((s) => s.key === v.stage)?.qc;
    if (!kinds) continue;
    const last = latest(v.o.id, kinds);
    if (last?.result === "pass") continue;
    qcItems.push({
      key: `qc:${k}`, orderId: v.o.id, title: `${label(v.o)} · ${kinds.map(qcKindLabel).join(" or ")} QC`,
      detail: `${v.styles.join(", ")} · ${stepLabel(v.stage).toLowerCase()} planned ${day(v.date)}${last ? ` · last check failed ${day(last.checked_on)}` : ""}`,
      chip: when(v.date, today), sort: v.date + v.o.order_no,
    });
  }
  qcItems.sort((a, b) => a.sort.localeCompare(b.sort));

  // Shipping within two weeks without a passed final QC.
  const shipItems: Item[] = open.flatMap((o) => {
    const due = dueDate(o);
    if (!due || due > addDays(today, 14) || latest(o.id, SHIP_QC)?.result === "pass") return [];
    return [{ key: `ship:${o.id}`, orderId: o.id, title: label(o), detail: `Ships ${day(due)}, final QC not passed yet`, chip: when(due, today), sort: due + o.order_no }];
  }).sort((a, b) => a.sort.localeCompare(b.sort));

  const team = canEditOrders(me?.role);
  // Buyer POs picked up from email or added from a file, waiting to be checked and added as orders.
  const { data: incoming } = team
    ? await supabase.from("incoming_pos").select("id, buyer_id, buyer_po, email_subject, source, email_from, received_at, status")
        .eq("company_id", companyId).in("status", ["to_check", "failed"]).order("received_at")
    : { data: [] };
  const incomingItems: Item[] = (incoming ?? []).map((p) => ({
    key: `in:${p.id}`, orderId: "", href: `/pos/${p.id}`,
    title: `${p.buyer_po ?? p.email_subject ?? "PO"}${p.buyer_id ? ` · ${buyerCode.get(p.buyer_id) ?? ""}` : ""}`,
    detail: `${p.source === "email" ? `Email from ${p.email_from ?? "unknown"}` : "Added from a file"} · received ${at.format(new Date(p.received_at))}`,
    chip: p.status === "failed" ? { text: "Couldn't read", cls: "bad" } : { text: "Check and add", cls: "warn" }, sort: p.received_at,
  }));
  // Dispatch: invoice within 4 hours of the purchase (an emergency after that), then e-way bill and shipping, then the GRN.
  // Dispatches of every order, shipped ones too: an order marked shipped still waits for the buyer's GRN.
  const { data: disp } = team
    ? await supabase.from("dispatches").select("id, order_id, purchase_bill_no, invoice_due_at, invoiced_at, eway_at, shipped_at, grn_due_on, grn_at")
        .eq("company_id", companyId).is("cancelled_at", null).is("grn_at", null)
    : { data: [] };
  const shippedIds = [...new Set((disp ?? []).map((d) => d.order_id))].filter((id) => !(orders ?? []).some((o) => o.id === id));
  const { data: shipped } = shippedIds.length
    ? await supabase.from("orders").select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id").in("id", shippedIds)
    : { data: [] };
  const orderOf = new Map<string, Pick<(typeof open)[number], "id" | "order_no" | "buyer_id" | "buyer_po">>(
    [...open, ...(shipped ?? []).filter((o) => who === "all" || o.merchandiser_id === me?.id)].map((o) => [o.id, o]));
  const emergency: Item[] = [];
  const dispatchItems: Item[] = [];
  const grnItems: Item[] = [];
  for (const d of disp ?? []) {
    const o = orderOf.get(d.order_id);
    if (!o) continue;
    const base = { orderId: o.id, href: `/orders/${o.id}#dispatch` };
    if (!d.invoiced_at) {
      const late = Date.parse(d.invoice_due_at) < now;
      (late ? emergency : dispatchItems).push({ ...base, key: `inv:${d.id}`, title: `${label(o)} · invoice for bill ${d.purchase_bill_no}`,
        detail: `${late ? "Was due" : "Due"} ${at.format(new Date(d.invoice_due_at))}`,
        chip: late ? { text: "Emergency", cls: "bad" } : { text: "Invoice within 4 hours", cls: "warn" }, sort: d.invoice_due_at });
    } else if (!d.eway_at || !d.shipped_at) {
      dispatchItems.push({ ...base, key: `ship:${d.id}`, title: `${label(o)} · bill ${d.purchase_bill_no}`,
        detail: !d.eway_at ? "Invoiced; add the e-way bill" : "E-way bill in; add goods photos and the LR",
        chip: { text: !d.eway_at ? "E-way bill" : "Photos and LR", cls: "warn" }, sort: d.invoiced_at });
    } else if (d.grn_due_on && d.grn_due_on <= addDays(today, 3)) {
      grnItems.push({ ...base, key: `grn:${d.id}`, title: `${label(o)} · GRN for bill ${d.purchase_bill_no}`,
        detail: `Shipped; buyer's GRN due ${day(d.grn_due_on)}`, chip: when(d.grn_due_on, today), sort: d.grn_due_on });
    }
  }
  for (const list of [emergency, dispatchItems, grnItems]) list.sort((a, b) => a.sort.localeCompare(b.sort));

  const sections = [
    ...(team ? [
      { id: "emergency", title: "Emergency: invoice overdue", hint: "Goods purchased more than 4 hours ago and the buyer isn't invoiced yet.", items: emergency, empty: "Every purchase is invoiced in time." },
      { id: "critical", title: "Critical: factory TNA overdue", hint: `Factories that haven't sent their TNA within ${PLAN_HOURS} hours of being asked.`, items: critical, empty: "No factory is past its deadline." },
      { id: "incoming", title: "New buyer POs to check", hint: "Picked up from email or added from a file. Check the AI's reading and add each as an order.", items: incomingItems, empty: "No new buyer POs waiting." },
      { id: "dispatch", title: "Dispatch to finish", hint: "Invoices due within 4 hours, then the e-way bill, goods photos and LR for each invoice.", items: dispatchItems, empty: "Nothing waiting to dispatch." },
      { id: "grn", title: "GRN due", hint: "Shipped goods whose buyer GRN is due within 3 days or overdue.", items: grnItems, empty: "No GRN due." },
      { id: "pos", title: "Factory plans and POs", hint: `Set each style's steps and targets, ask the factory for its TNA (it has ${PLAN_HOURS} hours), and release the PO once its dates are in and on target. Released POs show here too while any step has no target date.`, items: poItems, empty: "Every factory PO is released and every step has a target." },
    ] : []),
    { id: "overdue", title: "Overdue TNA steps", hint: "Planned date has passed and no done date is entered.", items: overdue, empty: "Nothing is overdue." },
    { id: "week", title: "Due in the next 7 days", hint: "TNA steps planned for this week.", items: thisWeek, empty: "Nothing planned this week." },
    { id: "qc", title: "QC coming up", hint: "Steps Quality checks, planned within a week, without a passed check yet.", items: qcItems, empty: "No QC due this week." },
    { id: "ship", title: "Shipping soon without final QC", hint: "Ship date within 14 days and the final QC hasn't passed.", items: shipItems, empty: "Nothing ships in the next 14 days without a passed final QC." },
  ];
  // Quality starts with its own list.
  if (me?.role === "quality") sections.unshift(...sections.splice(sections.findIndex((s) => s.id === "qc"), 1));

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Today</h1>
          <p>What needs doing across open orders, {day(today)}.</p>
        </div>
        {mineCount > 0 && (
          <div className="filters">
            <Link className="pill" href="/today?who=mine" aria-current={who === "mine" ? "page" : undefined}>My orders {mineCount}</Link>
            <Link className="pill" href="/today?who=all" aria-current={who === "all" ? "page" : undefined}>Everyone&apos;s {(orders ?? []).length}</Link>
          </div>
        )}
      </div>

      <div className="tiles">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={`tile ${s.items.some((i) => i.chip.cls === "bad") ? "alarm" : ""}`}>
            <span>{s.title}</span><b>{s.items.length}</b>
          </a>
        ))}
      </div>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="panel scroll-mt-20">
          <h2 className="font-bold text-base">{s.title} <span className="muted font-normal">({s.items.length})</span></h2>
          <p className="muted mb-2 text-[13px]">{s.hint}</p>
          {s.items.length === 0 ? (
            <p className="text-[13px] text-ok font-semibold">{s.empty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {s.items.map((i) => (
                <li key={i.key}>
                  <Link href={i.href ?? `/orders/${i.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-surface-2">
                    <div className="min-w-0 grow">
                      <div className="font-semibold">{i.title}</div>
                      <div className="muted text-[13px]">{i.detail}</div>
                    </div>
                    <span className={`chip ${i.chip.cls}`}>{i.chip.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
