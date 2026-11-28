// Margin is what the buyer pays less what the factory charges, before GST and freight.
// A line's rates, from line_prices() (only the orders team and Accounts get them).
export type LinePrice = { id: string; buyer_rate: number | null; factory_rate: number | null };
export type MarginLine = { qty: number; buyer_rate: number | string | null; factory_rate: number | string | null };
export type Margin = { sale: number; cost: number; margin: number; pct: number | null; missing: number };

const num = (v: number | string | null) => (v == null || v === "" ? null : Number(v));

// Planned margin from the order's rates. Styles missing either rate are left out and counted in `missing`.
export function planMargin(lines: MarginLine[]): Margin {
  let sale = 0, cost = 0, missing = 0;
  for (const l of lines) {
    const b = num(l.buyer_rate), f = num(l.factory_rate);
    if (b == null || f == null) { missing++; continue; }
    sale += l.qty * b;
    cost += l.qty * f;
  }
  return { sale, cost, margin: sale - cost, pct: sale > 0 ? ((sale - cost) / sale) * 100 : null, missing };
}

export const pct = (p: number | null) => (p == null ? "" : `${p.toFixed(1)}%`);
// Below this the margin is shown as thin.
export const THIN_MARGIN_PCT = 10;
export const marginCls = (p: number | null) => (p == null ? "" : p < 0 ? "text-bad" : p < THIN_MARGIN_PCT ? "text-warn" : "text-ok");

// The margin view (order_margins() in 0114): per order, what its rates plan and what was billed both ways.
export type MarginFactory = { factory_id: string; name: string; sale: number; cost: number; billed_sale: number; billed_cost: number };
export type MarginRow = {
  id: string; order_no: string; buyer_po: string | null; buyer_id: string; status: string; ship_date: string | null; shipped_on: string | null;
  missing: number; refunds: number; recovered: number; factories: MarginFactory[];
};
export type OrderMargin = {
  row: MarginRow; plan: Margin; billed: { sale: number; cost: number } | null;
  // What the order earns: from the bills once anything is billed (plus the plan for what is still to bill), less refunds
  // agreed to the buyer, plus claims passed to factories.
  sale: number; cost: number; margin: number; pct: number | null; slip: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function orderMargin(row: MarginRow): OrderMargin {
  const sum = (k: keyof MarginFactory) => row.factories.reduce((n, f) => n + Number(f[k] ?? 0), 0);
  const planSale = sum("sale"), planCost = sum("cost");
  const plan: Margin = { sale: planSale, cost: planCost, margin: planSale - planCost, pct: planSale > 0 ? ((planSale - planCost) / planSale) * 100 : null, missing: Number(row.missing) };
  const bs = sum("billed_sale"), bc = sum("billed_cost");
  const billed = bs > 0 || bc > 0 ? { sale: bs, cost: bc } : null;
  // A shipped order is what was billed; an open one is billed so far plus the plan for each factory not billed yet.
  let sale = planSale, cost = planCost;
  if (billed) {
    sale = 0; cost = 0;
    for (const f of row.factories) {
      const done = Number(f.billed_sale) > 0 || Number(f.billed_cost) > 0;
      const useBill = done || row.status === "shipped";
      sale += useBill ? Number(f.billed_sale) : Number(f.sale);
      cost += useBill ? Number(f.billed_cost) : Number(f.cost);
    }
  }
  const margin = r2(sale - cost - Number(row.refunds) + Number(row.recovered));
  const pct = sale > 0 ? (margin / sale) * 100 : null;
  return { row, plan, billed, sale: r2(sale), cost: r2(cost), margin, pct, slip: pct != null && plan.pct != null && billed ? pct - plan.pct : null };
}

export type MarginGroup = { key: string; name: string; orders: number; sale: number; cost: number; margin: number; pct: number | null };

// Margin added up by buyer or by factory. A factory's share leaves out buyer refunds and claims, which are per order.
export function marginBy(list: OrderMargin[], by: "buyer" | "factory", nameOf: (id: string) => string): MarginGroup[] {
  const map = new Map<string, MarginGroup>();
  const add = (key: string, name: string, sale: number, cost: number, margin: number) => {
    const g = map.get(key) ?? { key, name, orders: 0, sale: 0, cost: 0, margin: 0, pct: null };
    g.orders++; g.sale += sale; g.cost += cost; g.margin += margin;
    map.set(key, g);
  };
  for (const m of list) {
    if (by === "buyer") add(m.row.buyer_id, nameOf(m.row.buyer_id), m.sale, m.cost, m.margin);
    else for (const f of m.row.factories) {
      const billed = Number(f.billed_sale) > 0 || Number(f.billed_cost) > 0 || m.row.status === "shipped";
      const s = Number(billed ? f.billed_sale : f.sale), c = Number(billed ? f.billed_cost : f.cost);
      if (s || c) add(f.factory_id, f.name, s, c, s - c);
    }
  }
  return [...map.values()].map((g) => ({ ...g, pct: g.sale > 0 ? (g.margin / g.sale) * 100 : null })).sort((a, z) => z.margin - a.margin);
}
