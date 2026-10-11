import type { PoFile, PoLine, PoReading } from "./reader.ts";

// Reads buyer POs without AI, at no cost: finds the PO number, dates and buyer in the email and the files,
// and the style table in Excel, CSV and text PDFs. Scans and photos have no text, so their lines are typed in.
// Every reading is a draft the team checks against the file.

type Row = string[];
export type Sheet = { name: string; rows: Row[] };

const HEAD = {
  style: /^(style|style\s*(no|number|code|#)\.?|article|article\s*(no|code)\.?|art\.?\s*no\.?|sku|sku\s*code|item\s*code|design\s*(no|code)?\.?|product\s*code|item|item\s*name|product|product\s*name|particulars|description\s*of\s*goods)$/i,
  colour: /^(colou?r|colou?r\s*name|shade)$/i,
  qty: /^(qty|quantity|total\s*qty|order\s*qty|total\s*quantity|pcs|pieces|no\.?\s*of\s*pcs|units|total\s*pcs)\.?(\s*\(pcs\))?$/i,
  rate: /^(rate|price|unit\s*price|rate\s*\/\s*pc|rate\s*per\s*pc|cost|unit\s*cost|fob|price\s*\/\s*pc|rate\s*\(rs\.?\)|rate\s*\(inr\))\.?$/i,
  description: /^(description|desc|item\s*description|details|fabric)$/i,
};
const SIZE_HEAD = /^(xxs|xs|s|m|l|xl|xxl|2xl|3xl|xxxl|4xl|5xl|free\s*size|fs|\d{2})$/i;
const TOTAL_ROW = /^(total|grand\s*total|sub\s*total|subtotal|net\s*total|amount\s*in\s*words)/i;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

// A date in any common Indian form: 2026-09-15, 15-09-2026, 15/9/26, 15.09.2026, 15th Oct 2026, 15-Oct-26, Oct 15, 2026.
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return valid(year(m[3]), +m[2], +m[1]);
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([a-z]{3,9})[\s\-/.,']*(\d{2,4})\b/i);
  if (m && month(m[2])) return valid(year(m[3]), month(m[2])!, +m[1]);
  m = t.match(/\b([a-z]{3,9})[\s.]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m && month(m[1])) return valid(+m[3], month(m[1])!, +m[2]);
  return null;
}
const month = (s: string): number | undefined => MONTHS[s.slice(0, 3).toLowerCase()];
const year = (y: string) => (y.length === 2 ? 2000 + +y : +y);
function valid(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

// A number as printed: "1,250", "₹ 450.00", "Rs.450/-". Null when the cell isn't a number.
export function parseNumber(s: string): number | null {
  const t = s.replace(/(rs\.?|inr|₹|\/-|pcs|nos?\.?)/gi, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// --- Labelled fields (PO number, dates) from free text ---

const PO_LABEL = /(?<![a-z0-9\-])(?:buyer\s*)?(?:p\s*\/\s*o|p\.?\s*o\.?|purchase\s*order|order)\s*(?:no\.?|number|num|#|ref(?:erence)?)?\s*[:#.\-–|\s]*([A-Z0-9][A-Z0-9/\-_.]*\d[A-Z0-9/\-_.]*)/gi;
const PO_DATE_LABEL = /(?:p\.?\s*o\.?\s*date|order\s*date|purchase\s*order\s*date|date\s*of\s*(?:po|order)|dated)\s*[:\-–|\s]*([^\n|]{6,24})/i;
const SHIP_LABEL = /(?:expected\s*delivery\s*date|delivery\s*date|delivery\s*by|deliver\s*by|ship(?:ment|ping)?\s*date|dispatch\s*date|due\s*date|ex[\s-]*factory\s*date|delivery|ready\s*by)\s*[:\-–|\s]*([^\n|]{6,24})/i;

function poNumber(texts: string[]): string | null {
  for (const text of texts) {
    for (const m of text.matchAll(PO_LABEL)) {
      const v = m[1].replace(/[.\-/]+$/, "");
      if (v.length >= 3 && !/^SO\/\d+/i.test(v) && !/^(19|20)\d{2}$/.test(v)) return v;
    }
  }
  return null;
}
function labelledDate(texts: string[], label: RegExp): string | null {
  for (const text of texts) {
    const m = text.match(label);
    const d = m && parseDate(m[1]);
    if (d) return d;
  }
  return null;
}

// --- Style table from rows of cells ---

type Cols = { style: number; colour: number; qty: number; rate: number; description: number; sizes: { col: number; name: string }[] };

function headerOf(row: Row): Cols | null {
  const find = (re: RegExp) => row.findIndex((c) => re.test(c.trim().replace(/\s+/g, " ")));
  const cols: Cols = { style: find(HEAD.style), colour: find(HEAD.colour), qty: find(HEAD.qty), rate: find(HEAD.rate), description: find(HEAD.description), sizes: [] };
  row.forEach((c, i) => { if (SIZE_HEAD.test(c.trim()) && i !== cols.qty) cols.sizes.push({ col: i, name: c.trim().toUpperCase() }); });
  if (cols.style < 0 && cols.description >= 0) [cols.style, cols.description] = [cols.description, -1];
  const hasQty = cols.qty >= 0 || cols.sizes.length >= 2;
  return cols.style >= 0 && hasQty ? cols : null;
}

function linesFrom(rows: Row[]): PoLine[] {
  const out: PoLine[] = [];
  for (let h = 0; h < rows.length; h++) {
    const cols = headerOf(rows[h]);
    if (!cols) continue;
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r];
      const cell = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
      if (row.some((c) => TOTAL_ROW.test(c.trim()))) break;
      if (headerOf(row)) break;
      const style = cell(cols.style);
      const sizes = cols.sizes.map((s) => ({ name: s.name, n: parseNumber(cell(s.col)) ?? 0 })).filter((s) => s.n > 0);
      const qty = parseNumber(cell(cols.qty)) ?? sizes.reduce((t, s) => t + s.n, 0);
      if (!style || !qty) continue;
      out.push({
        style,
        description: cols.description >= 0 ? cell(cols.description) || null : null,
        colour: cell(cols.colour) || null,
        sizes: sizes.length ? sizes.map((s) => `${s.name} ${s.n}`).join(", ") : null,
        qty: Math.round(qty),
        rate: parseNumber(cell(cols.rate)),
      });
    }
    if (out.length) return combine(out);
  }
  return [];
}

// One line per style and colour, as the order form expects.
function combine(lines: PoLine[]): PoLine[] {
  const by = new Map<string, PoLine>();
  for (const l of lines) {
    const key = `${l.style.toLowerCase()}|${(l.colour ?? "").toLowerCase()}`;
    const had = by.get(key);
    if (!had) { by.set(key, { ...l }); continue; }
    had.qty += l.qty;
    had.sizes = [had.sizes, l.sizes].filter(Boolean).join(", ") || null;
    if (had.rate == null) had.rate = l.rate;
  }
  return [...by.values()];
}

// --- Files into rows of cells ---

async function pdfSheets(bytes: Uint8Array): Promise<Sheet[]> {
  // Loaded only when a PDF comes in, so a problem with it can't stop emails from being picked up.
  const { getDocumentProxy } = await import("npm:unpdf@1.8.1");
  const pdf = await getDocumentProxy(bytes);
  const sheets: Sheet[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 20); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[]; width?: number }[])
      .filter((i) => i.str && i.str.trim() && i.transform)
      .map((i) => ({ text: i.str!.trim(), x: i.transform![4], y: i.transform![5], w: i.width ?? 0 }));
    // Lines of text: items within 3 points of the same height, left to right. Gaps of 8+ points split cells.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { y: number; items: typeof items }[] = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    const rows: Row[] = [];
    let header: { x: number; end: number }[] | null = null;
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      const cells: { text: string; x: number; end: number }[] = [];
      for (const it of line.items) {
        const last = cells[cells.length - 1];
        if (last && it.x - last.end < 8) { last.text += ` ${it.text}`; last.end = it.x + it.w; }
        else cells.push({ text: it.text, x: it.x, end: it.x + it.w });
      }
      if (headerOf(cells.map((c) => c.text))) {
        header = cells.map((c) => ({ x: c.x, end: c.end }));
        rows.push(cells.map((c) => c.text));
        continue;
      }
      if (!header) { rows.push(cells.map((c) => c.text)); continue; }
      // Under a header, put each cell in the column it overlaps most, so blank cells don't shift the row.
      const row: Row = header.map(() => "");
      for (const c of cells) {
        let best = 0, bestScore = -Infinity;
        header.forEach((h, i) => {
          const overlap = Math.min(c.end, h.end) - Math.max(c.x, h.x);
          const score = overlap > 0 ? overlap : -Math.min(Math.abs(c.x - h.x), Math.abs(c.end - h.end));
          if (score > bestScore) { bestScore = score; best = i; }
        });
        row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
      }
      rows.push(row);
    }
    sheets.push({ name: `Page ${p}`, rows });
  }
  return sheets;
}

function csvRows(text: string): Row[] {
  const rows: Row[] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

// --- The reading ---

export async function readPosFree(
  files: PoFile[],
  email: { from: string | null; subject: string | null; body: string | null } | null,
  buyers: { code: string; name: string | null }[],
  excelRows: (bytes: Uint8Array) => Promise<Sheet[]>,
): Promise<PoReading[]> {
  const doubts: string[] = [];
  const sheets: Sheet[] = [];
  for (const f of files) {
    const e = ext(f.name);
    try {
      if (f.type === "application/pdf" || e === "pdf") {
        const got = await pdfSheets(f.bytes);
        if (got.every((s) => s.rows.length === 0)) doubts.push(`${f.name} is a scan with no text: type its styles in from the file.`);
        sheets.push(...got);
      } else if (e === "xlsx") sheets.push(...await excelRows(f.bytes));
      else if (e === "csv" || f.type === "text/csv") sheets.push({ name: f.name, rows: csvRows(new TextDecoder().decode(f.bytes)) });
      else doubts.push(`${f.name} is ${e === "xls" ? "an old Excel file" : "a photo"}: type its styles in from the file.`);
    } catch {
      doubts.push(`Couldn't open ${f.name}: type its styles in from the file.`);
    }
  }

  const fileText = sheets.flatMap((s) => s.rows.map((r) => r.filter(Boolean).join(" | "))).join("\n");
  const texts = [email?.subject ?? "", email?.body ?? "", fileText];
  const lines = sheets.reduce<PoLine[]>((got, s) => (got.length ? got : linesFrom(s.rows)), []);

  const all = texts.join("\n").toLowerCase();
  const sender = (email?.from ?? "").toLowerCase();
  const buyer = buyers.find((b) => {
    const name = (b.name ?? "").toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc|co)\b\.?/g, "").trim();
    if (name.length < 3) return false;
    const word = name.split(/\s+/)[0];
    return all.includes(name) || (word.length >= 4 && sender.includes(word));
  });

  const reading: PoReading = {
    buyer_name: buyer?.name ?? null,
    buyer_code: buyer?.code ?? null,
    po_number: poNumber(texts),
    po_date: labelledDate(texts, PO_DATE_LABEL),
    ship_date: labelledDate(texts, SHIP_LABEL),
    lines,
    notes: null,
    doubts: [],
  };
  if (!reading.po_number) reading.doubts.push("PO number not found: type it in.");
  if (!reading.ship_date) reading.doubts.push("Delivery date not found: type it in.");
  if (!lines.length && !doubts.length) reading.doubts.push("No style table found: type the styles in from the file.");
  if (lines.some((l) => l.rate == null)) reading.doubts.push("Some rates not found: fill them in.");
  reading.doubts.push(...doubts);
  if (lines.length) reading.doubts.push("Filled in automatically without AI: check each line against the file.");
  return [reading];
}
