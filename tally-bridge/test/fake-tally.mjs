// A stand-in for TallyPrime's XML server that answers the questions the reader
// asks (companies, ledgers, stock items, vouchers for a period) and records
// any attempt to write, so tests can prove nothing is ever written.
import { createServer } from "node:http";
import { all, esc, kid, parseXml, tallyDate, val } from "../lib/xml.mjs";

const amt = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// ledgers: [{name, parent, balance (Tally sign: debit negative), gstin}]
// items: [{name, unit, qty, value}]
// vouchers: [{guid, vtype, number, date: "YYYY-MM-DD", party, amount, cancelled, optional, bills: [{name, amount}]}]
export function fakeTally({ company = "Sourcingo Test", ledgers = [], items = [], vouchers = [] } = {}) {
  const books = { company, ledgers, items, vouchers, requests: [], writes: [] };

  function exportCollection(doc) {
    const id = val(kid(kid(doc, "ENVELOPE"), "HEADER"), "ID");
    const statics = (k) => all(doc, k)[0]?.text.trim();
    const wrap = (body) => `<ENVELOPE><BODY><DATA><COLLECTION>${body}</COLLECTION></DATA></BODY></ENVELOPE>`;
    if (id === "SgoCompanies") return wrap(`<COMPANY NAME="${esc(books.company)}"><NAME>${esc(books.company)}</NAME></COMPANY>`);
    if (id === "SgoLedgers") return wrap(books.ledgers.map((l) =>
      `<LEDGER NAME="${esc(l.name)}"><PARENT TYPE="String">${esc(l.parent ?? "")}</PARENT><CLOSINGBALANCE TYPE="Amount">${amt(l.balance ?? 0)}</CLOSINGBALANCE>` +
      (l.gstin ? `<PARTYGSTIN>${esc(l.gstin)}</PARTYGSTIN>` : "") + `</LEDGER>`).join(""));
    if (id === "SgoItems") return wrap(books.items.map((s) =>
      `<STOCKITEM NAME="${esc(s.name)}"><BASEUNITS>${esc(s.unit)}</BASEUNITS><CLOSINGBALANCE> ${s.qty} ${esc(s.unit)}</CLOSINGBALANCE>` +
      `<CLOSINGVALUE>-${amt(s.value)}</CLOSINGVALUE></STOCKITEM>`).join(""));
    if (id === "SgoVouchers") {
      const from = statics("SVFROMDATE") ?? "00000000";
      const to = statics("SVTODATE") ?? "99999999";
      return wrap(books.vouchers.filter((v) => tallyDate(v.date) >= from && tallyDate(v.date) <= to).map((v) => {
        // The party line is negative (debit) on sales, positive (credit) on receipts and credit notes.
        const sign = v.vtype.match(/sales/i) ? -1 : 1;
        return `<VOUCHER VCHTYPE="${esc(v.vtype)}"><DATE>${tallyDate(v.date)}</DATE><GUID>${esc(v.guid)}</GUID>` +
          `<VOUCHERTYPENAME>${esc(v.vtype)}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(v.number ?? "")}</VOUCHERNUMBER>` +
          `<ISCANCELLED>${v.cancelled ? "Yes" : "No"}</ISCANCELLED><ISOPTIONAL>${v.optional ? "Yes" : "No"}</ISOPTIONAL>` +
          `<PARTYLEDGERNAME>${esc(v.party ?? "")}</PARTYLEDGERNAME><NARRATION>${esc(v.narration ?? "")}&#4;</NARRATION>` +
          `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(v.party ?? "")}</LEDGERNAME><AMOUNT>${amt(sign * v.amount)}</AMOUNT>` +
          (v.bills ?? []).map((b) => `<BILLALLOCATIONS.LIST><NAME>${esc(b.name)}</NAME><AMOUNT>${amt(sign * b.amount)}</AMOUNT></BILLALLOCATIONS.LIST>`).join("") +
          `</ALLLEDGERENTRIES.LIST>` +
          `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Other side</LEDGERNAME><AMOUNT>${amt(-sign * v.amount)}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`;
      }).join(""));
    }
    return wrap("");
  }

  const handle = (body) => {
    books.requests.push(body);
    const doc = parseXml(body);
    const req = all(doc, "TALLYREQUEST")[0]?.text.trim();
    if (req !== "Export") {
      books.writes.push(body);
      return `<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Unexpected write</LINEERROR></RESPONSE>`;
    }
    const svc = all(doc, "SVCURRENTCOMPANY")[0]?.text.trim();
    if (svc && svc !== books.company) {
      return `<ENVELOPE><BODY><DATA><LINEERROR>Could not set 'SVCurrentCompany' to '${esc(svc)}'</LINEERROR></DATA></BODY></ENVELOPE>`;
    }
    return exportCollection(doc);
  };

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
      res.end(handle(body));
    });
  });
  return {
    books,
    handle: async (xml) => handle(xml),
    listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  };
}
