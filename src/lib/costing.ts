// A costing for one exact product, a piece at a time: each fabric in metres a piece × rupees a metre, then trims,
// stitching (CMT) and any other cost a piece, then the margin. The price to quote is the cost plus the margin,
// rounded up to the next rupee; the merchandiser may change it before sending. Shared by the costing card (live
// totals) and the save (so the numbers sent are worked out the same way).
import { amountText } from "./payments.ts";

export type Fabric = { name: string; metres: string; rate: string };
export type Cost = { name: string; amount: string };
export type Sheet = { fabrics: Fabric[]; costs: Cost[]; margin: string };

// What a new costing starts with: one fabric and the costs nearly every garment has.
export const blankSheet = (): Sheet => ({
  fabrics: [{ name: "Main fabric", metres: "", rate: "" }],
  costs: [{ name: "Trims and accessories", amount: "" }, { name: "Stitching (CMT)", amount: "" }, { name: "Packing", amount: "" }],
  margin: "15",
});

const num = (s: string) => {
  const t = amountText(s ?? "");
  return t && t !== "." ? Number(t) : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type Totals = { fabric: number; other: number; cost: number; marginPct: number; price: number };

export function totals(s: Sheet): Totals {
  const fabric = r2(s.fabrics.reduce((n, f) => n + num(f.metres) * num(f.rate), 0));
  const other = r2(s.costs.reduce((n, c) => n + num(c.amount), 0));
  const cost = r2(fabric + other);
  const marginPct = num(s.margin);
  const price = cost > 0 ? Math.ceil(r2(cost * (1 + marginPct / 100))) : 0;
  return { fabric, other, cost, marginPct, price };
}

// The first thing wrong with a costing, in the words the card shows, or null when it can be sent.
export function sheetProblem(s: Sheet, price: string): string | null {
  const bad = (v: string) => v.trim() !== "" && (/-\s*\d/.test(v) || !/\d/.test(v));
  for (const f of s.fabrics) {
    if (bad(f.metres) || bad(f.rate)) return `Check ${f.name.trim() || "the fabric"}: metres and rate are numbers, like 2.4 and 180.`;
    if (num(f.metres) > 50) return `${f.name.trim() || "The fabric"} at ${f.metres} metres a piece looks wrong. Enter metres for one piece.`;
  }
  for (const c of s.costs) if (bad(c.amount)) return `Check ${c.name.trim() || "the cost"}: it is rupees a piece, like 35.`;
  if (bad(s.margin) || num(s.margin) > 300) return "The margin is a percentage, like 15.";
  const t = totals(s);
  if (t.cost <= 0) return "Fill in at least the fabric or the costs.";
  if (!price.trim() || bad(price) || !(num(price) > 0)) return "Enter the price a piece to send.";
  if (num(price) < t.cost) return `The price is below the cost of ${t.cost}. Raise it, or check the costs.`;
  return null;
}

// The sheet as sent: names trimmed, numbers as numbers, rows that add nothing left out.
export function cleanSheet(s: Sheet) {
  return {
    fabrics: s.fabrics.filter((f) => num(f.metres) * num(f.rate) > 0)
      .map((f) => ({ name: f.name.trim().slice(0, 80) || "Fabric", metres: num(f.metres), rate: num(f.rate) })),
    costs: s.costs.filter((c) => num(c.amount) > 0).map((c) => ({ name: c.name.trim().slice(0, 80) || "Other", amount: num(c.amount) })),
    margin: num(s.margin),
  };
}

// A stored sheet back into the boxes, for a revised quote or a saved draft.
export function sheetFrom(v: unknown): Sheet {
  const o = (v && typeof v === "object" ? v : {}) as { fabrics?: unknown; costs?: unknown; margin?: unknown };
  const str = (x: unknown) => (x == null || x === 0 ? "" : String(x));
  const fabrics = Array.isArray(o.fabrics) ? o.fabrics.map((f) => ({ name: String(f?.name ?? ""), metres: str(f?.metres), rate: str(f?.rate) })) : [];
  const costs = Array.isArray(o.costs) ? o.costs.map((c) => ({ name: String(c?.name ?? ""), amount: str(c?.amount) })) : [];
  if (!fabrics.length && !costs.length) return blankSheet();
  return { fabrics, costs, margin: o.margin == null ? "15" : String(o.margin) };
}

export const priceNum = num;
