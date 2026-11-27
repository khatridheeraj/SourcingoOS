// Many buyer POs from one sheet: rows pasted from Excel or Google Sheets, or a CSV file, become one order per
// buyer and PO number, each style a line. Pure, so the page can show every problem before anything is saved and
// the server can check the same way.

import { latinDigits } from "./digits.ts";
import { num, orderProblem } from "./order-input.ts";

export type SheetBuyer = { id: string; label: string; code: string };
export type SheetFactory = { id: string; name: string; label: string };
export type SheetLine = { row: number; style: string; colour: string; description: string; qty: string; buyer_rate: string; factory_id: string; factory: string; factory_rate: string };
export type SheetOrder = {
  key: string; buyerId: string; buyer: string; po: string; po_date: string; ship_date: string;
  lines: SheetLine[]; problems: string[];
};
export type SheetResult = { orders: SheetOrder[]; problems: string[]; columns: Field[] };

export type Field = "buyer" | "po" | "po_date" | "ship_date" | "style" | "colour" | "description" | "qty" | "buyer_rate" | "factory" | "factory_rate";

// The words people put at the top of each column, already lower-cased with punctuation dropped.
const ALIASES: Record<Field, string[]> = {
  buyer: ["buyer", "customer", "brand", "client", "buyer code", "buyer name"],
  po: ["po", "po no", "po number", "po num", "buyer po", "order no", "order number", "purchase order"],
  po_date: ["po date", "order date", "date"],
  ship_date: ["ship date", "ship by", "delivery", "delivery date", "ex factory", "ex factory date", "exfactory", "shipment date", "dispatch date", "etd"],
  style: ["style", "style no", "style number", "style code", "article", "article no", "sku", "item code"],
  colour: ["colour", "color", "shade", "colourway", "colorway"],
  description: ["description", "desc", "product", "details", "item", "item description"],
  qty: ["qty", "quantity", "pcs", "pieces", "units", "metres", "meters", "order qty"],
  buyer_rate: ["rate", "price", "buyer rate", "buyer price", "fob", "unit price", "selling price"],
  factory: ["factory", "vendor", "supplier", "maker", "manufacturer"],
  factory_rate: ["factory rate", "factory price", "cost", "cost price", "cmt", "vendor rate"],
};
const clean = (s: string) => s.toLowerCase().replace(/[._#:()/\\-]+/g, " ").replace(/\s+/g, " ").trim();
const FIELD_OF = new Map<string, Field>(Object.entries(ALIASES).flatMap(([f, words]) => words.map((w) => [w, f as Field])));

// The columns a blank sheet starts with, in order.
export const SHEET_COLUMNS = ["Buyer", "PO", "PO date", "Ship date", "Style", "Colour", "Description", "Qty", "Rate", "Factory", "Factory rate"];
export const MAX_SHEET_POS = 50;

// Cells of a sheet: tab-separated when pasted from a spreadsheet, else comma or semicolon CSV with quotes.
export function cells(text: string): string[][] {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = t.split("\n", 1)[0];
  const sep = first.includes("\t") ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null;
};

// A date as people write it in India: 20/12/2026, 20-12-26, 20 Dec 2026, 20-Dec-26, 2026-12-20, or an Excel day number.
// Day comes first; "" when empty, null when it can't be read.
export function sheetDate(s: string): string | null {
  const v = latinDigits(s).trim().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!v) return "";
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = v.match(/^(\d{1,2})[-/. ]?([a-z]{3})[a-z]*[-/. ]?(\d{2}|\d{4})$/i);
  if (m && MON.includes(m[2].toLowerCase())) return valid(+m[3], MON.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = v.match(/^([a-z]{3})[a-z]* (\d{1,2}) (\d{4})$/i);
  if (m && MON.includes(m[1].toLowerCase())) return valid(+m[3], MON.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  // Excel stores dates as days since 30 Dec 1899; 36526 is 1 Jan 2000.
  if (/^\d{5}$/.test(v) && +v > 36526 && +v < 73051) {
    const d = new Date(Date.UTC(1899, 11, 30) + +v * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

const same = (a: string, b: string) => clean(a) === clean(b);

function findBuyer(s: string, buyers: SheetBuyer[]) {
  if (!s.trim()) return null;
  return buyers.find((b) => same(b.code, s) || same(b.label, s)) ?? buyers.find((b) => clean(b.label).startsWith(clean(s)) && clean(s).length >= 4) ?? null;
}
function findFactory(s: string, factories: SheetFactory[]) {
  return factories.find((f) => same(f.name, s) || same(f.label, s)) ?? null;
}

// Rows → orders. Buyer, PO and dates written once at the top of a PO carry down to the rows under it.
export function readSheet(text: string, buyers: SheetBuyer[], factories: SheetFactory[]): SheetResult {
  const rows = cells(text);
  if (!rows.length) return { orders: [], problems: [], columns: [] };
  const head = rows[0].map((h) => FIELD_OF.get(clean(h)) ?? null);
  const columns = head.filter((f): f is Field => !!f);
  const problems: string[] = [];
  if (!columns.includes("style") || !columns.includes("qty")) {
    return { orders: [], columns, problems: ["The first row must name the columns, with at least Style and Qty. Download the blank sheet to see them all."] };
  }
  if (!columns.includes("po")) problems.push("Add a PO column, so each style knows its PO.");
  if (!columns.includes("buyer") && buyers.length !== 1) problems.push("Add a Buyer column with each buyer's code or name.");
  const dup = columns.find((f, i) => columns.indexOf(f) !== i);
  if (dup) problems.push(`Two columns read as ${dup.replace("_", " ")}. Rename one.`);
  if (problems.length) return { orders: [], columns, problems };

  const at = (r: string[], f: Field) => { const i = head.indexOf(f); return i < 0 ? "" : (r[i] ?? "").trim(); };
  const byKey = new Map<string, SheetOrder>();
  const carry = { buyer: buyers.length === 1 && !columns.includes("buyer") ? buyers[0].code : "", po: "", po_date: "", ship_date: "" };
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const poCell = at(r, "po");
    // A new PO number starts a new block: its dates come from its own row, never the PO above.
    if (poCell && poCell !== carry.po) { carry.po_date = ""; carry.ship_date = ""; }
    for (const f of ["buyer", "po", "po_date", "ship_date"] as const) { const v = at(r, f); if (v) carry[f] = v; }
    const style = at(r, "style"), q = at(r, "qty");
    if (!style && !q) return;
    const buyer = findBuyer(carry.buyer, buyers);
    const key = `${buyer?.id ?? clean(carry.buyer)}|${clean(carry.po)}`;
    let o = byKey.get(key);
    if (!o) {
      o = { key, buyerId: buyer?.id ?? "", buyer: buyer?.label ?? carry.buyer, po: carry.po, po_date: "", ship_date: "", lines: [], problems: [] };
      byKey.set(key, o);
      if (!carry.buyer) o.problems.push(`Row ${row}: the buyer is empty.`);
      else if (!buyer) o.problems.push(`Row ${row}: no buyer called "${carry.buyer}" in Buyers. Use its code, like ${buyers[0]?.code ?? "BYR-AH"}.`);
      if (!carry.po) o.problems.push(`Row ${row}: the PO number is empty.`);
    }
    for (const f of ["po_date", "ship_date"] as const) {
      const d = sheetDate(carry[f]);
      const name = f === "po_date" ? "PO date" : "ship date";
      if (d === null) o.problems.push(`Row ${row}: can't read the ${name} "${carry[f]}". Write it like 20/12/2026.`);
      else if (d && o[f] && d !== o[f]) o.problems.push(`Row ${row}: PO ${o.po} has two ${name}s. One PO has one ${name}.`);
      else if (d) o[f] = d;
    }
    const factoryName = at(r, "factory");
    const factory = factoryName ? findFactory(factoryName, factories) : null;
    if (factoryName && !factory) o.problems.push(`Row ${row}: no factory called "${factoryName}" in Factories. Fix the name or clear the cell.`);
    const qtyCell = latinDigits(q).replace(/(pcs|pieces|pc|metres|meters|mtrs|m)\s*$/i, "").trim();
    o.lines.push({ row, style, colour: at(r, "colour"), description: at(r, "description"), qty: qtyCell, buyer_rate: at(r, "buyer_rate"),
      factory_id: factory?.id ?? "", factory: factory?.name ?? factoryName, factory_rate: at(r, "factory_rate") });
  });

  const orders = [...byKey.values()];
  for (const o of orders) {
    const p = orderProblem({ buyer_id: o.buyerId || "x", buyer_po: o.po || "x", po_date: o.po_date, ship_date: o.ship_date }, o.lines);
    if (p) o.problems.push(p.field.startsWith("line-") ? p.msg.replace(/^Line (\d+)/, (_, n) => `Row ${o.lines[Number(n) - 1]?.row ?? n}`) : p.msg);
    const seen = new Set<string>();
    for (const l of o.lines) {
      const k = `${clean(l.style)}|${clean(l.colour)}`;
      if (seen.has(k)) o.problems.push(`Row ${l.row}: ${l.style}${l.colour ? ` ${l.colour}` : ""} is twice in PO ${o.po}. Add the quantities into one row.`);
      seen.add(k);
    }
  }
  if (orders.length > MAX_SHEET_POS) problems.push(`That's ${orders.length} POs. Add at most ${MAX_SHEET_POS} at a time.`);
  return { orders, problems, columns };
}

export const sheetQty = (o: SheetOrder) => o.lines.reduce((s, l) => s + (Number(num(l.qty)) || 0), 0);

export function blankSheet() {
  const ex = [
    ["BYR-AH", "AFH-120", "28/11/2026", "20/01/2027", "K-101", "Indigo", "Cotton kurta, block print", "500", "560", "", ""],
    ["", "", "", "", "K-102", "Rust", "Cotton kurta, block print", "300", "560", "", ""],
  ];
  return [SHEET_COLUMNS, ...ex].map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
}
