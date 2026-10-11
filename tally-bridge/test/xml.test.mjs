import assert from "node:assert/strict";
import { test } from "node:test";
import { companiesRequest, isoDate, num, parseItems, parseLedgers, parseVouchers, parseXml, vouchersRequest } from "../lib/xml.mjs";
import { fyStart } from "../lib/sync.mjs";

test("requests ask Tally for one company and a date range", () => {
  const v = vouchersRequest("Ozia & Sons", "2026-04-01", "2026-10-10");
  assert.match(v, /<SVCURRENTCOMPANY>Ozia &amp; Sons<\/SVCURRENTCOMPANY>/);
  assert.match(v, /<SVFROMDATE>20260401<\/SVFROMDATE><SVTODATE>20261010<\/SVTODATE>/);
  assert.match(v, /AllLedgerEntries.BillAllocations.Name/);
  assert.match(v, /<TALLYREQUEST>Export<\/TALLYREQUEST>/);
  assert.doesNotMatch(companiesRequest(), /SVCURRENTCOMPANY/);
});

test("reads Tally's replies, including the control characters it adds", () => {
  const ledgers = parseLedgers(`<ENVELOPE><LEDGER NAME="A &amp; B"><PARENT>Sundry Debtors</PARENT><CLOSINGBALANCE>-1,200.50</CLOSINGBALANCE>` +
    `<PARTYGSTIN>09abc</PARTYGSTIN></LEDGER><LEDGER NAME="Cash"><CLOSINGBALANCE></CLOSINGBALANCE></LEDGER></ENVELOPE>`);
  assert.deepEqual(ledgers, [{ name: "A & B", parent: "Sundry Debtors", balance: 1200.5, gstin: "09ABC" }, { name: "Cash", parent: "", balance: 0, gstin: null }]);
  assert.deepEqual(parseItems(`<STOCKITEM NAME="K"><BASEUNITS>Pcs</BASEUNITS><CLOSINGBALANCE> 12 Pcs</CLOSINGBALANCE><CLOSINGVALUE>-300.00</CLOSINGVALUE></STOCKITEM>`),
    [{ name: "K", parent: "", unit: "Pcs", qty: 12, value: 300 }]);
  const [v] = parseVouchers(`<VOUCHER VCHTYPE="Receipt"><DATE>20261006</DATE><GUID>x-1</GUID><VOUCHERNUMBER>12</VOUCHERNUMBER>` +
    `<PARTYLEDGERNAME>A &amp; B</PARTYLEDGERNAME><NARRATION>Chq 269734&#4;</NARRATION>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>A &amp; B</LEDGERNAME><AMOUNT>5000.00</AMOUNT>` +
    `<BILLALLOCATIONS.LIST><NAME>SPL/1</NAME><AMOUNT>3000.00</AMOUNT></BILLALLOCATIONS.LIST>` +
    `<BILLALLOCATIONS.LIST><NAME>SPL/2</NAME><AMOUNT>2000.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC</LEDGERNAME><AMOUNT>-5000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`);
  assert.deepEqual(v, {
    guid: "x-1", vtype: "Receipt", number: "12", date: "2026-10-06", party: "A & B", amount: 5000, reference: null, narration: "Chq 269734",
    bills: [{ name: "SPL/1", amount: 3000 }, { name: "SPL/2", amount: 2000 }],
  });
});

test("dates, numbers and financial years", () => {
  assert.equal(isoDate("20261004"), "2026-10-04");
  assert.equal(isoDate("4-Oct-2026"), "2026-10-04");
  assert.equal(isoDate("4-Oct-26"), "2026-10-04");
  assert.equal(isoDate(""), null);
  assert.equal(num(" 1,23,456.75 Dr"), 123456.75);
  assert.equal(fyStart("2026-03-31"), "2025-04-01");
  assert.equal(fyStart("2026-04-01"), "2026-04-01");
  assert.equal(parseXml("<A><B>x</B></A>").children[0].children[0].text, "x");
});
