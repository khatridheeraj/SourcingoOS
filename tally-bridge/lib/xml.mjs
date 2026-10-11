// Tally XML: asking Tally for its books and reading its replies. Nothing here
// writes into Tally.
// No dependencies, so the sync program runs on a plain Node install.

export const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// 2026-10-04 -> 20261004
export const tallyDate = (iso) => String(iso).slice(0, 10).replace(/-/g, "");
// 20261004 or 4-Oct-2026 -> 2026-10-04
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function isoDate(t) {
  const s = String(t ?? "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// "-1,234.50", " 120 Pcs", "1234.5 Dr" -> number
export function num(t) {
  const m = String(t ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

// ───────────────────────── requests ─────────────────────────
// A collection export with its own small TDL definition.
export function collectionRequest(company, id, type, methods, vars = {}, filter) {
  const statics = Object.entries({ SVEXPORTFORMAT: "$$SysName:XML", ...(company ? { SVCURRENTCOMPANY: company } : {}), ...vars })
    .map(([k, v]) => `<${k}>${k === "SVEXPORTFORMAT" ? v : esc(v)}</${k}>`).join("");
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${id}</ID></HEADER>` +
    `<BODY><DESC><STATICVARIABLES>${statics}</STATICVARIABLES><TDL><TDLMESSAGE>` +
    `<COLLECTION NAME="${id}" ISMODIFY="No"><TYPE>${type}</TYPE>` +
    `<FETCH>${methods.join(", ")}</FETCH>` + (filter ? `<FILTER>${id}Filter</FILTER>` : "") + `</COLLECTION>` +
    (filter ? `<SYSTEM TYPE="Formulae" NAME="${id}Filter">${esc(filter)}</SYSTEM>` : "") +
    `</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

export const companiesRequest = () => collectionRequest(null, "SgoCompanies", "Company", ["Name"]);
export const ledgersRequest = (company) =>
  collectionRequest(company, "SgoLedgers", "Ledger", ["Name", "Parent", "ClosingBalance", "PartyGSTIN", "GUID"]);
export const itemsRequest = (company) =>
  collectionRequest(company, "SgoItems", "StockItem", ["Name", "Parent", "BaseUnits", "ClosingBalance", "ClosingValue"]);
export const vouchersRequest = (company, from, to) =>
  collectionRequest(company, "SgoVouchers", "Voucher",
    ["Date", "VoucherTypeName", "VoucherNumber", "PartyLedgerName", "Amount", "GUID", "Narration", "Reference",
     "IsCancelled", "IsOptional", "AllLedgerEntries.LedgerName", "AllLedgerEntries.Amount",
     "AllLedgerEntries.BillAllocations.Name", "AllLedgerEntries.BillAllocations.Amount"],
    { SVFROMDATE: tallyDate(from), SVTODATE: tallyDate(to) });

// ───────────────────────── reading replies ─────────────────────────
// Small, forgiving XML reader: Tally sometimes sends control characters as
// &#4; and the like, which strict parsers reject.
export function parseXml(src) {
  const text = String(src).replace(/^﻿/, "").replace(/&#(\d+);/g, (m, d) => (Number(d) < 32 && ![9, 10, 13].includes(Number(d)) ? "" : m));
  const root = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^>\s]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      const i = stack.map((n) => n.tag).lastIndexOf(m[2]);
      if (i > 0) stack.length = i;
    } else if (m[3]) {
      const attrs = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toUpperCase()] = unesc(a[2] ?? a[3]);
      const node = { tag: m[3].toUpperCase(), attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += unesc(m[6]);
  }
  return root;
}

function unesc(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "amp") return "&";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
  });
}

export const kids = (n, tag) => (n?.children ?? []).filter((c) => c.tag === tag);
export const kid = (n, tag) => (n?.children ?? []).find((c) => c.tag === tag);
export function all(n, tag, out = []) {
  for (const c of n?.children ?? []) {
    if (c.tag === tag) out.push(c);
    all(c, tag, out);
  }
  return out;
}
export const val = (n, tag) => (kid(n, tag)?.text ?? "").trim();
const deep = (n, tag) => (all(n, tag)[0]?.text ?? "").trim();

const objName = (n) => (n.attrs.NAME ?? val(n, "NAME") ?? "").trim() || deep(n, "NAME");

export function parseCompanies(xml) {
  return all(parseXml(xml), "COMPANY").map(objName).filter(Boolean);
}

export function parseLedgers(xml) {
  return all(parseXml(xml), "LEDGER").map((l) => ({
    name: objName(l),
    parent: val(l, "PARENT"),
    // Tally sends debit balances as negative; we store "they owe us" as positive.
    balance: -num(val(l, "CLOSINGBALANCE")) || 0,
    gstin: (val(l, "PARTYGSTIN") || deep(l, "GSTIN")).toUpperCase() || null,
  })).filter((l) => l.name);
}

export function parseItems(xml) {
  return all(parseXml(xml), "STOCKITEM").map((s) => ({
    name: objName(s),
    parent: val(s, "PARENT"),
    unit: val(s, "BASEUNITS"),
    qty: num(val(s, "CLOSINGBALANCE")),
    value: Math.abs(num(val(s, "CLOSINGVALUE"))),
  })).filter((s) => s.name);
}

export function parseVouchers(xml) {
  return all(parseXml(xml), "VOUCHER").filter((v) => val(v, "ISCANCELLED") !== "Yes" && val(v, "ISOPTIONAL") !== "Yes").map((v) => {
    const party = val(v, "PARTYLEDGERNAME");
    const entries = [...kids(v, "ALLLEDGERENTRIES.LIST"), ...kids(v, "LEDGERENTRIES.LIST")];
    const partyEntry = entries.find((e) => val(e, "LEDGERNAME") === party);
    const amount = partyEntry ? Math.abs(num(val(partyEntry, "AMOUNT")))
      : val(v, "AMOUNT") ? Math.abs(num(val(v, "AMOUNT")))
      : entries.reduce((s, e) => s + Math.max(0, num(val(e, "AMOUNT"))), 0);
    return {
      guid: val(v, "GUID") || v.attrs.REMOTEID,
      vtype: val(v, "VOUCHERTYPENAME") || v.attrs.VCHTYPE,
      number: val(v, "VOUCHERNUMBER"),
      date: isoDate(val(v, "DATE")),
      party: party || null,
      amount,
      reference: val(v, "REFERENCE") || null,
      narration: val(v, "NARRATION") || null,
      // The bills the party's line is set against, e.g. the invoice a credit note or receipt settles.
      bills: partyEntry ? kids(partyEntry, "BILLALLOCATIONS.LIST").map((b) => ({ name: val(b, "NAME"), amount: Math.abs(num(val(b, "AMOUNT"))) })).filter((b) => b.name) : [],
    };
  }).filter((v) => v.guid && v.date);
}
