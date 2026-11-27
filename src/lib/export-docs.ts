// Export papers for one lot of goods: the commercial invoice, the packing list and the shipment sheet a forwarder
// books from. The lot keeps its own export details (dispatches.export); our exporter details live on the company.
// Pure, so the page, the form and the tests agree.

export const INCOTERMS = ["FOB", "CIF", "CFR", "EXW", "FCA", "DAP", "DDP"] as const;
export const INCOTERM_WORDS: Record<string, string> = {
  FOB: "Free on board: the buyer pays freight from the Indian port",
  CIF: "Cost, insurance and freight to the buyer's port",
  CFR: "Cost and freight to the buyer's port, buyer insures",
  EXW: "Ex works: the buyer collects from us",
  FCA: "Free carrier: we hand over to the buyer's forwarder",
  DAP: "Delivered to the buyer's door, buyer pays duty",
  DDP: "Delivered to the buyer's door with duty paid",
};

export type ExportLine = { hs: string; rate: string };
export type ExportDetails = {
  currency: string; fx: string; incoterm: string; mode: "sea" | "air"; invoice_no: string; invoice_date: string;
  port_loading: string; port_discharge: string; country: string; final_dest: string; vessel: string;
  notify: string; terms: string; marks: string; cbm: string; container: string; etd: string; forwarder: string;
  freight: string; insurance: string; lines: Record<string, ExportLine>;
};

export type DocLine = { id: string; style: string; description: string | null; colour: string | null; product: string | null; qty: number; buyerRate: number | null };

const n = (s: string | undefined) => {
  const t = (s ?? "").replace(/[,\s]/g, "");
  return /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

// What a lot's export details start with: dollars at today's rate, FOB, sea, our usual port, the Tally invoice, and
// each style's rate turned from rupees into the invoice currency.
export function startExport(saved: unknown, base: { invoiceNo: string | null; invoiceDate: string | null; port: string | null; usdInr: number | null; country: string | null },
  lines: DocLine[]): ExportDetails {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<ExportDetails>;
  const fx = s.fx ?? (base.usdInr ? String(r2(base.usdInr)) : "");
  const fxn = n(fx);
  const savedLines = (s.lines && typeof s.lines === "object" ? s.lines : {}) as Record<string, Partial<ExportLine>>;
  const out: Record<string, ExportLine> = {};
  for (const l of lines) {
    const x = savedLines[l.id] ?? {};
    out[l.id] = { hs: x.hs ?? "", rate: x.rate ?? (l.buyerRate && fxn > 0 ? String(r2(l.buyerRate / fxn)) : "") };
  }
  return {
    currency: s.currency ?? "USD", fx, incoterm: s.incoterm ?? "FOB", mode: s.mode === "air" ? "air" : "sea",
    invoice_no: s.invoice_no ?? base.invoiceNo ?? "", invoice_date: s.invoice_date ?? base.invoiceDate ?? "",
    port_loading: s.port_loading ?? base.port ?? "", port_discharge: s.port_discharge ?? "", country: s.country ?? base.country ?? "",
    final_dest: s.final_dest ?? "", vessel: s.vessel ?? "", notify: s.notify ?? "", terms: s.terms ?? "", marks: s.marks ?? "",
    cbm: s.cbm ?? "", container: s.container ?? "", etd: s.etd ?? "", forwarder: s.forwarder ?? "",
    freight: s.freight ?? "", insurance: s.insurance ?? "", lines: out,
  };
}

// The invoice in its currency: each style's amount, then freight and insurance where the Incoterm includes them.
export function invoiceTotals(e: ExportDetails, lines: DocLine[]) {
  const rows = lines.map((l) => {
    const rate = n(e.lines[l.id]?.rate);
    return { ...l, hs: e.lines[l.id]?.hs ?? "", rate: rate >= 0 ? rate : null, amount: rate >= 0 ? r2(rate * l.qty) : null };
  });
  const goods = r2(rows.reduce((a, r) => a + (r.amount ?? 0), 0));
  const withFreight = e.incoterm === "CIF" || e.incoterm === "CFR" || e.incoterm === "DAP" || e.incoterm === "DDP";
  const freight = withFreight && n(e.freight) > 0 ? r2(n(e.freight)) : 0;
  const insurance = (e.incoterm === "CIF" || e.incoterm === "DDP" || e.incoterm === "DAP") && n(e.insurance) > 0 ? r2(n(e.insurance)) : 0;
  const total = r2(goods + freight + insurance);
  const fx = n(e.fx);
  return { rows, goods, freight, insurance, total, withFreight, inr: fx > 0 ? Math.round(total * fx) : null };
}

// What the papers still need before they go out, in plain words. Empty when ready.
export function exportGaps(e: ExportDetails, lines: DocLine[], co: { iec: string | null; ad_code: string | null; lut_no: string | null; address: string | null },
  buyerAddress: string | null, packed: boolean): string[] {
  const g: string[] = [];
  if (!co.iec) g.push("Our IEC (owner adds it once, below)");
  if (!co.ad_code) g.push("Our AD code from the bank");
  if (!co.lut_no) g.push("Our LUT number, to ship without IGST");
  if (!co.address) g.push("Our address");
  if (!buyerAddress) g.push("The buyer's full address");
  if (!e.country.trim()) g.push("Country of destination");
  if (!e.port_discharge.trim()) g.push("Port of discharge");
  if (!(n(e.fx) > 0)) g.push("The exchange rate");
  const noHs = lines.filter((l) => !/^\d{6,8}$/.test((e.lines[l.id]?.hs ?? "").replace(/[\s.]/g, "")));
  if (noHs.length) g.push(`HS code for ${noHs.map((l) => l.style).join(", ")}`);
  const noRate = lines.filter((l) => !(n(e.lines[l.id]?.rate) > 0));
  if (noRate.length) g.push(`Rate for ${noRate.map((l) => l.style).join(", ")}`);
  if (!packed && lines.some((l) => l.product !== "fabric")) g.push("The packing list (cartons and weights)");
  return g;
}

// The first thing wrong with what was typed, or null. Blank boxes are fine: the papers say what is still missing.
export function exportProblem(e: ExportDetails): string | null {
  if (!/^[A-Z]{3}$/.test(e.currency)) return "Pick the invoice currency.";
  if (e.fx.trim() && !(n(e.fx) > 0 && n(e.fx) < 100000)) return "The exchange rate is rupees for one unit, like 88.50.";
  if (!(INCOTERMS as readonly string[]).includes(e.incoterm)) return "Pick the Incoterm.";
  if (e.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(e.invoice_date)) return "Enter the invoice date as a date.";
  if (e.etd && !/^\d{4}-\d{2}-\d{2}$/.test(e.etd)) return "Enter the ready date as a date.";
  for (const [k, v] of [["freight", e.freight], ["insurance", e.insurance], ["CBM", e.cbm]] as const)
    if (v.trim() && !(n(v) >= 0)) return `${k[0].toUpperCase()}${k.slice(1)} is a number, like 120.`;
  for (const l of Object.values(e.lines)) {
    if (l.hs.trim() && !/^\d{6,8}$/.test(l.hs.replace(/[\s.]/g, ""))) return `HS codes are 6 to 8 digits, like 62114290. Check "${l.hs}".`;
    if (l.rate.trim() && !(n(l.rate) >= 0)) return `Rates are numbers, like 9.50. Check "${l.rate}".`;
  }
  const long = Object.entries(e).find(([k, v]) => k !== "lines" && typeof v === "string" && v.length > 500);
  if (long) return "One of the boxes is too long. Keep each under 500 characters.";
  return null;
}

// HS chapter hint for a style: garments are 61 (knitted) or 62 (woven); fabric 52 (cotton) or 54 (synthetic).
export const hsHint = (product: string | null) => (product === "fabric" ? "52xx cotton, 54xx synthetic" : "62xx woven, 61xx knit");
