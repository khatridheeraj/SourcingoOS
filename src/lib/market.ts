// Styles open to factories ("Shop orders"), from the orders team's side: the quotes on each, ranked so the best one
// is on top, and what each would leave as margin against the buyer's price.

export type MarketQuote = {
  id: string; factory_id: string; factory: string; city: string | null; rate: number; ready_on: string; note: string | null;
  created_at: string; updated_at: string; withdrawn_at: string | null;
  // Styles this factory has made or is making with us (any order, not removed).
  styles_with_us: number;
  // The factory's record with us in one line (from factoryRecord/recordLine); watch marks a record the team should watch.
  record?: { line: string; watch: boolean } | null;
};

export type QuoteRow = MarketQuote & { margin: number | null; marginPct: number | null; daysLate: number; best: boolean };

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Live quotes only, on time first, then cheapest, then the factory we know better, then whoever quoted first.
// "best" marks the top one, so the merchandiser sees a suggestion without being told what to do.
export function rankQuotes(quotes: MarketQuote[], readyBy: string, buyerRate: number | null): QuoteRow[] {
  const rows = quotes.filter((q) => !q.withdrawn_at).map((q) => {
    const margin = buyerRate != null ? Math.round((buyerRate - q.rate) * 100) / 100 : null;
    return {
      ...q, margin, marginPct: margin != null && buyerRate ? Math.round((margin / buyerRate) * 1000) / 10 : null,
      daysLate: Math.max(0, dayDiff(readyBy, q.ready_on)), best: false,
    };
  });
  rows.sort((a, b) => (a.daysLate > 0 ? 1 : 0) - (b.daysLate > 0 ? 1 : 0) || a.rate - b.rate || b.styles_with_us - a.styles_with_us || a.created_at.localeCompare(b.created_at));
  if (rows.length) rows[0].best = true;
  return rows;
}

// The default dates when a style is opened: ready by the factory target (ship less the buffer), quotes close in
// 3 days, or sooner when the ready-by date is close.
export function openDefaults(ship: string | null, fabric: boolean, today: string): { readyBy: string; closesOn: string } {
  const add = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
  const readyBy = ship ? add(ship, fabric ? -2 : -7) : add(today, 30);
  const closesOn = [add(today, 3), readyBy].sort()[0];
  return { readyBy, closesOn: closesOn < today ? today : closesOn };
}
