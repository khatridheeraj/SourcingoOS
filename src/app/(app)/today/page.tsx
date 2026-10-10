import Link from "next/link";
import { canEditOrders, getMe } from "@/lib/auth";
import { loadBuyers, loadFactories } from "@/lib/data";
import { day, daysBetween, dueDate, PLAN_DUE_DAYS, qcKindLabel, SHIP_QC, TNA_STEPS, todayIST } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";

type Item = { key: string; orderId: string; title: string; detail: string; chip: { text: string; cls: string }; sort: string };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
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
      .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id, order_lines(id, style, factory_id, factory_rate)")
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
        supabase.from("factory_pos").select("order_id, factory_id, plan_requested_on, released_at").in("order_id", ids),
        supabase.from("line_stages").select("order_id, line_id, stage, planned_on, done_on, not_needed").in("order_id", ids),
        supabase.from("qc_checks").select("order_id, kind, result, checked_on").in("order_id", ids).is("cancelled_at", null)
          .order("checked_on", { ascending: false }).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const buyerCode = new Map(buyers.map((b) => [b.id, b.code]));
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const label = (o: (typeof open)[number]) => `${o.order_no} · ${buyerCode.get(o.buyer_id) ?? ""} ${o.buyer_po}`.trim();
  const stepLabel = (k: string) => TNA_STEPS.find((s) => s.key === k)?.label ?? k;
  const stageOf = new Map((stages ?? []).map((s) => [`${s.line_id}:${s.stage}`, s]));

  // Factory POs: ask for the plan, chase it, release it.
  const poItems: Item[] = [];
  for (const o of open) {
    const lines = o.order_lines ?? [];
    for (const f of [...new Set(lines.map((l) => l.factory_id).filter(Boolean))] as string[]) {
      const po = (pos ?? []).find((p) => p.order_id === o.id && p.factory_id === f);
      if (po?.released_at) continue;
      const fl = lines.filter((l) => l.factory_id === f);
      const gaps = fl.reduce((n, l) => n + (l.factory_rate == null ? 1 : 0)
        + TNA_STEPS.filter((s) => { const r = stageOf.get(`${l.id}:${s.key}`); return !r || (!r.planned_on && !r.not_needed); }).length, 0);
      const asked = po?.plan_requested_on;
      const chip = !gaps ? { text: "Ready to release", cls: "ok" }
        : !asked ? { text: "Ask for the plan", cls: "bad" }
        : daysBetween(asked, today) > PLAN_DUE_DAYS ? { text: `Plan late, asked ${plural(daysBetween(asked, today), "day")} ago`, cls: "bad" }
        : { text: `Plan asked ${day(asked)}`, cls: "warn" };
      poItems.push({
        key: `${o.id}:${f}`, orderId: o.id, title: `${label(o)} · ${factoryName.get(f) ?? "Factory"}`,
        detail: gaps ? `${plural(gaps, "item")} missing before the PO can be released` : "Plan is complete. Release the PO on the order.",
        chip, sort: `${!gaps ? 0 : !asked ? 1 : 2}${o.order_no}`,
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
  const sections = [
    ...(team ? [{ id: "pos", title: "Factory plans and POs", hint: `Ask each factory for its TNA plan, chase it after ${PLAN_DUE_DAYS} days, and release the PO once it's complete.`, items: poItems, empty: "Every factory PO is released." }] : []),
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
                  <Link href={`/orders/${i.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-surface-2">
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
