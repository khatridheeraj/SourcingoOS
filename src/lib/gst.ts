// GST on garments: 5% on a piece sold for ₹2,500 or less, 18% above it (rates from 22 Sep 2025).
// The database works it out the same way (public.garment_gst), so what the form shows is what is saved.
export const gstRate = (perPiece: number) => (perPiece > 2500 ? 0.18 : 0.05);
const paise = (x: number) => Math.round(x * 100) / 100;

export type Bill = { taxable: number; gst: number; roundOff: number; total: number; rates: number[] };

// A bill the way Tally makes it: the goods, GST at each style's rate, and the total rounded to the rupee.
export function garmentBill(lines: { qty: number; rate: number }[]): Bill {
  const taxable = paise(lines.reduce((s, l) => s + paise(l.qty * l.rate), 0));
  const gst = paise(lines.reduce((s, l) => s + paise(l.qty * l.rate * gstRate(l.rate)), 0));
  const total = Math.round(taxable + gst);
  const rates = [...new Set(lines.filter((l) => l.qty > 0).map((l) => gstRate(l.rate)))].sort();
  return { taxable, gst, roundOff: paise(total - taxable - gst), total, rates };
}

// "GST 5%", or "GST 5% and 18%" when the styles sit on both sides of ₹2,500.
export const gstLabel = (rates: number[]) => `GST ${(rates.length ? rates : [0.05]).map((r) => `${Math.round(r * 100)}%`).join(" and ")}`;
