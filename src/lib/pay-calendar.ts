// The factory payment calendar: every payment to a factory or supplier over the coming days, from three places.
//   bill: a bill booked in Tally with money left, on its due date.
//   guarantee: a factory's pay under the Guarantee (when it is on), within its days of the Final QC pass.
//   expected: an open order not billed yet, its factory cost on the likely ship date plus the factory's days.
export type PayItem = { on: string; amount: number; who: string; label: string; href?: string; kind: "bill" | "guarantee" | "expected"; msme?: boolean; key: string };
export type PayDay = { on: string; items: PayItem[]; total: number };
export type PayWeek = { start: string; total: number; bills: number; expected: number };
export type PayCalendar = { overdue: PayItem[]; overdueTotal: number; days: PayDay[]; weeks: PayWeek[]; later: number; total: number; expectedTotal: number };

const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekStart = (d: string) => plusDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

// Lays the items out day by day from today for `span` days (13 weeks by default); earlier ones are overdue.
export function payCalendar(items: PayItem[], today: string, span = 91): PayCalendar {
  const end = plusDays(today, span - 1);
  const overdue = items.filter((x) => x.on < today).sort((a, z) => a.on.localeCompare(z.on) || z.amount - a.amount);
  const inside = items.filter((x) => x.on >= today && x.on <= end);
  const byDay = new Map<string, PayItem[]>();
  for (const x of inside) byDay.set(x.on, [...(byDay.get(x.on) ?? []), x]);
  const days = [...byDay.entries()].sort(([a], [z]) => a.localeCompare(z))
    .map(([on, list]) => ({ on, items: list.sort((a, z) => z.amount - a.amount), total: list.reduce((n, x) => n + x.amount, 0) }));
  const weeks: PayWeek[] = [];
  for (let s = weekStart(today); s <= end; s = plusDays(s, 7)) weeks.push({ start: s, total: 0, bills: 0, expected: 0 });
  for (const x of inside) {
    const w = weeks[Math.floor((Date.parse(x.on) - Date.parse(weeks[0].start)) / (7 * 86_400_000))];
    if (!w) continue;
    w.total += x.amount;
    if (x.kind === "expected") w.expected += x.amount; else w.bills += x.amount;
  }
  return {
    overdue, overdueTotal: overdue.reduce((n, x) => n + x.amount, 0), days, weeks,
    later: items.filter((x) => x.on > end).reduce((n, x) => n + x.amount, 0),
    total: inside.reduce((n, x) => n + x.amount, 0),
    expectedTotal: inside.filter((x) => x.kind === "expected").reduce((n, x) => n + x.amount, 0),
  };
}
