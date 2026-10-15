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
  const t = s.replace(/(rs\.?|inr|₹|\/-|pcs|nos?\.?)/gi, "").replace(/,/g, "").replace(/\/$/, "").trim();
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
      if ((v.match(/\d/g) ?? []).length >= 3 && !/^SO\/\d+/i.test(v) && !/^(19|20)\d{2}$/.test(v)) return v;
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

// A one-style PO sheet with no table, laid out as labels and values:
//   Style No. | AV-142,  Design Name | CORD-SET,  Rate | 485/,  ... Size | S | M | L | XL | TOTAL  then  TOP/PANT | ... | 500
const FORM = {
  style: /^(style|style\s*(no|number|code|#)\.?|article\s*(no|code)?\.?|art\.?\s*no\.?|design\s*no\.?|sku)\s*:?$/i,
  description: /^(design\s*name|description|item\s*name|product\s*name)\s*:?$/i,
  colour: /^(colou?r|shade)\s*:?$/i,
  rate: /^(rate|price|unit\s*price|rate\s*\/\s*pc|rate\s*per\s*pc)\s*:?$/i,
  qty: /^(qty|quantity|total\s*qty|order\s*qty|total\s*quantity|total\s*pcs)\.?\s*:?$/i,
};
function formLine(rows: Row[]): PoLine | null {
  const cells = (r: Row) => r.map((c) => c.trim()).filter(Boolean);
  const value = (re: RegExp) => {
    for (const r of rows) {
      const cs = cells(r);
      const i = cs.findIndex((c) => re.test(c.replace(/\s+/g, " ")));
      if (i >= 0 && cs[i + 1]) return cs[i + 1];
    }
    return null;
  };
  const style = value(FORM.style)?.replace(/\s*-\s*/g, "-");
  if (!style || !/\d/.test(style)) return null;
  let qty = parseNumber(value(FORM.qty) ?? "");
  if (qty == null) {
    // A size grid whose last column is the total: the total is the last number on the row below.
    for (let i = 0; i + 1 < rows.length && qty == null; i++) {
      const head = cells(rows[i]);
      if (head.length >= 3 && /^total$/i.test(head[head.length - 1])) {
        const below = cells(rows[i + 1]);
        qty = parseNumber(below[below.length - 1] ?? "");
      }
    }
  }
  if (!qty) return null;
  return {
    style,
    description: value(FORM.description),
    colour: value(FORM.colour),
    sizes: null,
    qty: Math.round(qty),
    rate: parseNumber(value(FORM.rate) ?? ""),
  };
}

// A date standing alone near the top of the first page, the way many POs print their date without a label.
function topDate(sheets: Sheet[]): string | null {
  for (const r of sheets[0]?.rows.slice(0, 4) ?? []) {
    for (const c of r) if (/^\s*[\d./-]{8,10}\s*$/.test(c)) { const d = parseDate(c); if (d) return d; }
  }
  return null;
}

// "Delivery: 30 to 45 days" counts from the PO date; the later end is used.
const DAYS_LABEL = /(?:delivery|deliver|ship(?:ment)?|dispatch)[^\n]{0,20}?(?:(\d{1,3})\s*(?:to|-|–)\s*)?(\d{1,3})\s*days/i;
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
const DOC_EXT = /\.(pdf|xlsx|xls|csv)$/i;

// A style-like code at the end of a file name, as in "PO CHAVI PRODUCTION - AV142 (1).pdf".
function styleInName(name: string): string | null {
  const m = name.replace(/\.[a-z]+$/i, "").replace(/\s*\(\d+\)$/, "").match(/[-_\s]([A-Z]{1,4}[-\s]?\d{2,6}[A-Z]?)$/i);
  return m ? m[1].toUpperCase() : null;
}

// Words that say an email is about a buyer's PO, and ones that say it is about goods already sent.
const PO_WORDS = /(^|[^a-z])(p\.?\s?o|purchase\s*orders?|new\s*orders?)([^a-z]|$)/i;
const NOT_PO_WORDS = /(invoice|packing\s*list|inward|grn|lr\s*copy|debit\s*note|credit\s*note|receipt|e-?way\s*bill)/i;

// An emailed file is taken as a PO only when something says so: the subject or a file name mentions a PO,
// a file is titled "purchase order", or a known buyer sent it. Anything else (bills, letters, packing lists) is skipped.
function looksLikePo(subject: string, fileNames: string[], sheets: Sheet[], buyerFromSender: boolean): boolean {
  const named = [subject, ...fileNames].join(" ");
  const titled = sheets.some((s) => s.rows.slice(0, 15).some((r) => r.some((c) => /purchase\s*order/i.test(c))));
  if (PO_WORDS.test(named) || titled) return true;
  return buyerFromSender && !NOT_PO_WORDS.test(named);
}

// --- The reading ---

export async function readPosFree(
  files: PoFile[],
  email: { from: string | null; subject: string | null; body: string | null } | null,
  buyers: { code: string; name: string | null }[],
  excelRows: (bytes: Uint8Array) => Promise<Sheet[]>,
): Promise<PoReading[]> {
  const parts: { name: string; hash: string; sheets: Sheet[]; doubts: string[] }[] = [];
  for (const f of files) {
    const e = ext(f.name);
    // Fingerprinted first: reading a PDF hands its bytes over to the PDF library.
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", f.bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
    const part = { name: f.name, hash, sheets: [] as Sheet[], doubts: [] as string[] };
    parts.push(part);
    try {
      if (f.type === "application/pdf" || e === "pdf") {
        const got = await pdfSheets(f.bytes);
        if (got.every((s) => s.rows.length === 0)) part.doubts.push(`${f.name} is a scan with no text: type its styles in from the file.`);
        part.sheets.push(...got);
      } else if (e === "xlsx") part.sheets.push(...(await excelRows(f.bytes)).map((s) => ({ ...s, rows: s.rows.map((r) => Array.from(r, (c) => c ?? "")) })));
      else if (e === "csv" || f.type === "text/csv") part.sheets.push({ name: f.name, rows: csvRows(new TextDecoder().decode(f.bytes)) });
      else part.doubts.push(`${f.name} is ${e === "xls" ? "an old Excel file" : "a photo"}: type its styles in from the file.`);
    } catch {
      part.doubts.push(`Couldn't open ${f.name}: type its styles in from the file.`);
    }
  }
  const sheets = parts.flatMap((p) => p.sheets);
  const textOf = (ss: Sheet[]) => ss.flatMap((s) => s.rows.map((r) => r.filter(Boolean).join(" | "))).join("\n");
  const linesOf = (ss: Sheet[]) => {
    const table = ss.reduce<PoLine[]>((got, s) => (got.length ? got : linesFrom(s.rows)), []);
    if (table.length) return table;
    const form = ss.length ? formLine(ss.flatMap((s) => s.rows)) : null;
    return form ? [form] : [];
  };
  const emailTexts = [email?.subject ?? "", email?.body ?? ""];

  const all = [...emailTexts, textOf(sheets)].join("\n").toLowerCase();
  const sender = (email?.from ?? "").toLowerCase();
  const shortName = (b: { name: string | null }) => (b.name ?? "").toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc|co)\b\.?/g, "").trim();
  const fromBuyer = (b: { name: string | null }) => {
    const word = shortName(b).split(/\s+/)[0] ?? "";
    return word.length >= 4 && sender.includes(word);
  };
  const buyer = buyers.find((b) => {
    const name = shortName(b);
    return name.length >= 3 && (all.includes(name) || fromBuyer(b));
  });
  if (email && !looksLikePo(email.subject ?? "", files.map((f) => f.name), sheets, buyers.some(fromBuyer))) return [];

  const reading = (texts: string[], lines: PoLine[], doubts: string[], from: string | null, own: Sheet[]): PoReading => {
    const r: PoReading = {
      buyer_name: buyer?.name ?? null,
      buyer_code: buyer?.code ?? null,
      po_number: poNumber(texts),
      po_date: labelledDate(texts, PO_DATE_LABEL) ?? topDate(own),
      ship_date: labelledDate(texts, SHIP_LABEL),
      lines,
      notes: null,
      doubts: from ? [`From the file ${from}.`] : [],
    };
    if (!r.ship_date && r.po_date) {
      const m = texts.map((t) => t.match(DAYS_LABEL)).find(Boolean);
      if (m) {
        r.ship_date = addDays(r.po_date, Number(m[2]));
        r.doubts.push(`Delivery is "${m[0].replace(/\s*\|\s*/g, " ").trim()}": set to ${m[2]} days after the PO date. Check it.`);
      }
    }
    if (!r.po_number) r.doubts.push("PO number not found: type it in.");
    if (!r.ship_date) r.doubts.push("Delivery date not found: type it in.");
    if (!lines.length && !doubts.length) r.doubts.push("No style table found: type the styles in from the file.");
    if (lines.some((l) => l.rate == null)) r.doubts.push("Some rates not found: fill them in.");
    r.doubts.push(...doubts);
    if (lines.length) r.doubts.push("Filled in automatically without AI: check each line against the file.");
    return r;
  };

  // Several PO documents (PDF, Excel, CSV) in one email are separate POs: one reading each, even when a file's
  // table can't be read, so the team checks each against its own file. A copy sent twice counts once.
  // The file's own text comes first, so its PO number and dates win over the email's.
  const docs = parts.filter((p, i) => DOC_EXT.test(p.name) && parts.findIndex((q) => q.hash === p.hash) === i);
  if (docs.length >= 2) {
    const rest = parts.filter((p) => !DOC_EXT.test(p.name));
    const readings = docs.map((p, i) => {
      const lines = linesOf(p.sheets);
      const hint = !lines.length && styleInName(p.name);
      return reading([textOf(p.sheets), ...emailTexts], lines, [
        ...p.doubts,
        ...(hint ? [`The file name says ${hint}: check whether that is the style.`] : []),
        ...(i === 0 ? rest.map((x) => `Also in this email: ${x.name}. Check whether it is another PO.`) : []),
      ], p.name, p.sheets);
    });
    // Two files with the same PO number is usually a typing slip on the buyer's side.
    readings.forEach((r, i) => {
      const same = readings.filter((x, j) => j !== i && r.po_number && x.po_number === r.po_number).map((x) => docs[readings.indexOf(x)].name);
      if (same.length) r.doubts.push(`${same.join(", ")} has the same PO number ${r.po_number}: ask the buyer which number is right.`);
    });
    return readings;
  }
  return [reading([...emailTexts, textOf(sheets)], linesOf(sheets), parts.flatMap((p) => p.doubts), null, sheets)];
}
