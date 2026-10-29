// Cash ahead: when money comes in from buyers and goes out to factories, week by week, so the owner sees a squeeze
// before it happens. Three sources: buyer invoices still open (in), factory bills still open in Tally (out), and
// open orders not billed yet, expected from their likely ship date plus each side's credit days.
// Pure: the page reads the rows, this adds them up.

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const diff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export type CashItem = { amount: number; on: string; label: string; href?: string; kind: "invoice" | "bill" | "order" };
export type OpenOrder = { id: string; orderNo: string; buyer: string; sale: number; cost: number; ships: string; buyerDays: number; factoryDays: number };
export type Week = { start: string; end: string; in: number; out: number; net: number; balance: number; items: CashItem[] };
export type CashAhead = { overdueIn: number; overdueOut: number; weeks: Week[]; expectedIn: number; expectedOut: number; lowest: Week | null; later: { in: number; out: number } };

// The Monday on or before a day, so weeks line up with how the office plans.
export function monday(d: string): string {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((wd + 6) % 7));
}

// When an open order's money moves: the buyer pays its credit days after shipping, the factory is paid its days
// after its bill, which comes with the goods.
export function orderCash(o: OpenOrder): CashItem[] {
  return [
    { amount: o.sale, on: addDays(o.ships, o.buyerDays), label: `${o.orderNo} · ${o.buyer}`, href: `/orders/${o.id}`, kind: "order" },
    { amount: -o.cost, on: addDays(o.ships, o.factoryDays), label: `${o.orderNo} · factory`, href: `/orders/${o.id}`, kind: "order" },
  ];
}

// Days the business carries an order: from paying the factory to the buyer paying. Negative when the buyer pays first.
export const carryDays = (o: Pick<OpenOrder, "buyerDays" | "factoryDays">) => o.buyerDays - o.factoryDays;

export function cashAhead({ invoices, bills, orders, today, weeks = 12 }: {
  invoices: { amount: number; due: string; label: string; href?: string }[];
  bills: { amount: number; due: string; label: string; href?: string }[];
  orders: OpenOrder[];
  today: string;
  weeks?: number;
}): CashAhead {
  const items: CashItem[] = [
    ...invoices.filter((i) => i.amount > 0).map((i) => ({ amount: i.amount, on: i.due, label: i.label, href: i.href, kind: "invoice" as const })),
    ...bills.filter((b) => b.amount > 0).map((b) => ({ amount: -b.amount, on: b.due, label: b.label, href: b.href, kind: "bill" as const })),
    ...orders.flatMap(orderCash).filter((x) => x.amount !== 0),
  ];
  const first = monday(today);
  const out: Week[] = Array.from({ length: weeks }, (_, i) => ({ start: addDays(first, i * 7), end: addDays(first, i * 7 + 6), in: 0, out: 0, net: 0, balance: 0, items: [] }));
  let overdueIn = 0, overdueOut = 0, laterIn = 0, laterOut = 0;
  for (const x of items) {
    // What was due before today is still owed: it is shown apart, as it can land any day.
    if (x.on < today) { if (x.amount > 0) overdueIn += x.amount; else overdueOut -= x.amount; continue; }
    const w = out[Math.floor(diff(first, x.on) / 7)];
    if (!w) { if (x.amount > 0) laterIn += x.amount; else laterOut -= x.amount; continue; }
    if (x.amount > 0) w.in += x.amount; else w.out -= x.amount;
    w.items.push(x);
  }
  let run = 0;
  for (const w of out) {
    w.net = w.in - w.out;
    run += w.net;
    w.balance = run;
    w.items.sort((a, b) => a.on.localeCompare(b.on) || b.amount - a.amount);
  }
  const lowest = out.reduce<Week | null>((m, w) => (w.balance < 0 && (!m || w.balance < m.balance) ? w : m), null);
  const expected = orders.flatMap(orderCash);
  return {
    overdueIn, overdueOut, weeks: out, lowest, later: { in: laterIn, out: laterOut },
    expectedIn: expected.filter((x) => x.amount > 0).reduce((t, x) => t + x.amount, 0),
    expectedOut: -expected.filter((x) => x.amount < 0).reduce((t, x) => t + x.amount, 0),
  };
}
