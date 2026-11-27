// Lead-time promise: the days from PO to shipment we have really delivered, not a number someone hopes for.
// The database works out the days for every finished order (lead_times() in supabase/migrations/0108_factory_certs_capacity.sql):
// `mid` is the middle order, `slow` the 80th percentile, the date we can promise with confidence.

export type LeadRow = { factory_id: string | null; product: string; orders: number; mid: number; slow: number };
export type Lead = { orders: number; mid: number; slow: number; scope: "factory" | "company" };

// Below this many orders a factory's own number is luck; the whole company's record stands in for it.
export const MIN_LEAD_ORDERS = 3;

// The promise for a factory and kind of goods: its own record when it has enough, else ours across every factory.
export function leadFor(rows: LeadRow[], factoryId: string | null, product: string): Lead | null {
  const own = factoryId ? rows.find((r) => r.factory_id === factoryId && r.product === product) : undefined;
  if (own && own.orders >= MIN_LEAD_ORDERS) return { orders: own.orders, mid: own.mid, slow: own.slow, scope: "factory" };
  const all = rows.find((r) => r.factory_id == null && r.product === product);
  if (all && all.orders >= MIN_LEAD_ORDERS) return { orders: all.orders, mid: all.mid, slow: all.slow, scope: "company" };
  return null;
}

// "Usually ships 38 days after the PO, 45 at the latest, across 6 orders" (or "…across 9 of our orders").
export function leadLine(l: Lead | null, product = "garment"): string {
  if (!l) return `Not enough ${product === "fabric" ? "fabric" : "garment"} orders shipped yet to promise a lead time`;
  const range = l.slow > l.mid ? `, ${l.slow} at the latest` : "";
  return `Usually ships ${l.mid} days after the PO${range}, across ${l.orders} ${l.scope === "company" ? "of our orders" : "orders"}`;
}

// Whether a quoted ready date beats what this factory has really taken: days from the PO (or today) to the date,
// against its slow number. A quote faster than anything it has delivered is worth a phone call.
export function quoteVsLead(l: Lead | null, poDate: string, readyOn: string): "fast" | "usual" | null {
  if (!l || l.scope !== "factory") return null;
  const days = Math.round((Date.parse(`${readyOn}T00:00:00Z`) - Date.parse(`${poDate}T00:00:00Z`)) / 86_400_000);
  return days < l.mid * 0.75 ? "fast" : "usual";
}
