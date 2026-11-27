import { test } from "node:test";
import assert from "node:assert/strict";
import { exportGaps, exportProblem, invoiceTotals, startExport, type DocLine } from "./export-docs.ts";

const lines: DocLine[] = [
  { id: "a", style: "K-101", description: "Cotton kurta", colour: "Indigo", product: "garment", qty: 200, buyerRate: 880 },
  { id: "b", style: "F-9", description: "Cotton cambric", colour: null, product: "fabric", qty: 500, buyerRate: null },
];
const base = { invoiceNo: "SPL/26-27/301", invoiceDate: "2026-11-20", port: "Nhava Sheva", usdInr: 88, country: null };

test("a new lot starts in dollars, FOB, with rupee rates turned into dollars", () => {
  const e = startExport(null, base, lines);
  assert.equal(e.currency, "USD");
  assert.equal(e.incoterm, "FOB");
  assert.equal(e.fx, "88");
  assert.equal(e.invoice_no, "SPL/26-27/301");
  assert.equal(e.lines.a.rate, "10");
  assert.equal(e.lines.b.rate, "");
  // What was saved wins over the starting values.
  assert.equal(startExport({ currency: "EUR", lines: { a: { hs: "62114290", rate: "9.5" } } }, base, lines).lines.a.rate, "9.5");
});

test("invoice totals add freight and insurance only when the Incoterm includes them", () => {
  const e = { ...startExport(null, base, lines), freight: "300", insurance: "20" };
  e.lines.b.rate = "1.2";
  assert.equal(invoiceTotals(e, lines).total, 2600); // 200 × 10 + 500 × 1.2
  assert.equal(invoiceTotals({ ...e, incoterm: "CIF" }, lines).total, 2920);
  assert.equal(invoiceTotals({ ...e, incoterm: "CFR" }, lines).total, 2900);
  assert.equal(invoiceTotals(e, lines).inr, 228800);
});

test("the papers say what is still missing", () => {
  const e = startExport(null, base, lines);
  const g = exportGaps(e, lines, { iec: null, ad_code: "0510005", lut_no: "AD0811", address: "Jaipur" }, null, false);
  assert.ok(g.includes("Our IEC (owner adds it once, below)"));
  assert.ok(g.includes("The buyer's full address"));
  assert.ok(g.some((x) => x.startsWith("HS code for K-101, F-9")));
  assert.ok(g.some((x) => x === "Rate for F-9"));
  assert.ok(g.includes("The packing list (cartons and weights)"));
});

test("typed values are checked, blanks are fine", () => {
  const e = startExport(null, base, lines);
  assert.equal(exportProblem(e), null);
  assert.match(exportProblem({ ...e, fx: "abc" })!, /exchange rate/);
  assert.match(exportProblem({ ...e, lines: { a: { hs: "62", rate: "" } } })!, /HS codes/);
  assert.match(exportProblem({ ...e, incoterm: "XYZ" })!, /Incoterm/);
});
