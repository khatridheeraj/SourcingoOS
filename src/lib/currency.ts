// Buyer currencies (0114_money_views.sql). The books stay in rupees, as in Tally; a buyer invoiced in another currency
// sees each invoice at the rate locked on it the day it went out, so the amount never moves with the market.

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SAR", "AUD", "CAD", "SGD", "HKD", "JPY", "CHF", "SEK", "NZD", "ZAR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_NAME: Record<Currency, string> = {
  INR: "Indian rupee", USD: "US dollar", EUR: "Euro", GBP: "British pound", AED: "UAE dirham", SAR: "Saudi riyal", AUD: "Australian dollar",
  CAD: "Canadian dollar", SGD: "Singapore dollar", HKD: "Hong Kong dollar", JPY: "Japanese yen", CHF: "Swiss franc", SEK: "Swedish krona",
  NZD: "New Zealand dollar", ZAR: "South African rand",
};
export const isCurrency = (c: unknown): c is Currency => typeof c === "string" && (CURRENCIES as readonly string[]).includes(c);

// Rupees in the buyer's currency at a locked rate (rupees for one unit), to the cent; null without a rate.
export function inCurrency(rupees: number, rate: number | string | null | undefined): number | null {
  const r = Number(rate);
  if (rate == null || !(r > 0)) return null;
  return Math.round((Number(rupees) / r) * 100) / 100;
}

// "$1,234.50", "€980.00", "AED 4,500.00".
export function fmtCurrency(n: number, c: Currency | string): string {
  const yen = c === "JPY";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: c, minimumFractionDigits: yen ? 0 : 2, maximumFractionDigits: yen ? 0 : 2 }).format(n);
  } catch {
    return `${c} ${n.toFixed(2)}`;
  }
}

// Totals in the buyer's currency for a set of invoices: only when every one has a rate, else null (never a half sum).
export function totalIn(rows: { rupees: number; rate: number | string | null | undefined }[]): number | null {
  let t = 0;
  for (const r of rows) {
    const v = inCurrency(r.rupees, r.rate);
    if (v == null) return null;
    t += v;
  }
  return Math.round(t * 100) / 100;
}
