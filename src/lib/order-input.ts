// The checks an order must pass before it is saved, shared by the order form (so the field is marked and focused
// before anything is sent) and saveOrder (so a save can't skip them).
// field names the box to mark: "buyer_id", "buyer_po", "ship_date", "buyer_terms", "lines" (no style at all), or
// "line-<i>-<key>" for a style row, where i counts every row on screen from 0 and "Line <i + 1>" is the same row,
// blank rows included, so the message points at the row the person sees.

export type OrderHead = { buyer_id: string; buyer_po: string; po_date: string; ship_date: string; buyer_terms?: string };
export type OrderLine = { style: string; qty: string; buyer_rate: string; factory_rate: string };
export type OrderProblem = { field: string; msg: string };

const num = (s: string) => s.replace(/[,₹\s]/g, "");

// A row counts once its style number or quantity is filled in; fully blank rows are left out of the save.
export const isFilled = (l: OrderLine) => !!(l.style.trim() || l.qty.trim());

export function orderProblem(order: OrderHead, lines: OrderLine[]): OrderProblem | null {
  if (!order.buyer_id) return { field: "buyer_id", msg: "Pick the buyer." };
  if (!order.buyer_po.trim()) return { field: "buyer_po", msg: "Enter the buyer's PO number." };
  if (order.po_date && order.ship_date && order.ship_date < order.po_date) return { field: "ship_date", msg: "The ship date can't be before the PO date." };
  if (!lines.some(isFilled)) return { field: "line-0-style", msg: "Add at least one style." };
  for (const [i, l] of lines.entries()) {
    if (!isFilled(l)) continue;
    const n = i + 1;
    if (!l.style.trim()) return { field: `line-${i}-style`, msg: `Line ${n}: enter the style number.` };
    const q = Number(num(l.qty));
    if (!Number.isInteger(q) || q <= 0) return { field: `line-${i}-qty`, msg: `Line ${n}: quantity must be a whole number above zero.` };
    for (const [k, label] of [["buyer_rate", "buyer rate"], ["factory_rate", "factory rate"]] as const) {
      const r = Number(num(l[k]));
      if (l[k].trim() && Number.isNaN(r)) return { field: `line-${i}-${k}`, msg: `Line ${n}: the ${label} must be a number.` };
      if (l[k].trim() && r < 0) return { field: `line-${i}-${k}`, msg: `Line ${n}: the ${label} can't be below zero.` };
    }
  }
  if ((order.buyer_terms ?? "").length > 2000) return { field: "buyer_terms", msg: "Keep the buyer's terms under 2000 letters." };
  return null;
}
