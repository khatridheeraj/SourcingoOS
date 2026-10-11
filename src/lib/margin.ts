// Margin is what the buyer pays less what the factory charges, before GST and freight.
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
