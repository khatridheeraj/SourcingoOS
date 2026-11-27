import { test } from "node:test";
import assert from "node:assert/strict";
import { blankSheet, cells, readSheet, sheetDate, sheetQty } from "./po-sheet.ts";

const buyers = [{ id: "b1", label: "Areeba Fashion House", code: "BYR-AH" }, { id: "b2", label: "Ozia Retail", code: "BYR-OZ" }];
const factories = [{ id: "f1", name: "Kkora", label: "Kkora (Jaipur)" }];

test("cells reads pasted tabs and quoted CSV", () => {
  assert.deepEqual(cells("Style\tQty\nK-1\t1,200\n\n"), [["Style", "Qty"], ["K-1", "1,200"]]);
  assert.deepEqual(cells('Style,Description,Qty\r\nK-1,"Kurta, ""block"" print",500'), [["Style", "Description", "Qty"], ["K-1", 'Kurta, "block" print', "500"]]);
  assert.deepEqual(cells("Style;Qty\nK-1;5"), [["Style", "Qty"], ["K-1", "5"]]);
});

test("sheetDate reads the dates people write, day first", () => {
  assert.equal(sheetDate("20/12/2026"), "2026-12-20");
  assert.equal(sheetDate("5-1-27"), "2027-01-05");
  assert.equal(sheetDate("20 Dec 2026"), "2026-12-20");
  assert.equal(sheetDate("20-Dec-26"), "2026-12-20");
  assert.equal(sheetDate("Dec 20, 2026"), "2026-12-20");
  assert.equal(sheetDate("2026-12-20"), "2026-12-20");
  assert.equal(sheetDate("46376"), "2026-12-20");
  assert.equal(sheetDate(""), "");
  assert.equal(sheetDate("31/02/2026"), null);
  assert.equal(sheetDate("soon"), null);
});

test("rows become one order per buyer and PO, with PO details carried down", () => {
  const text = [
    "Buyer\tPO No.\tPO Date\tDelivery\tStyle No\tColor\tQty\tRate\tFactory\tFactory rate",
    "BYR-AH\tAFH-1\t28/11/2026\t20/01/2027\tK-1\tIndigo\t500 pcs\t560\tKkora\t450",
    "\t\t\t\tK-2\tRust\t300\t560\tkkora (jaipur)\t450",
    "Ozia Retail\tOZ-9\t01/12/2026\t15/02/2027\tO-1\t\t1,000\t400\t\t",
  ].join("\n");
  const r = readSheet(text, buyers, factories);
  assert.deepEqual(r.problems, []);
  assert.equal(r.orders.length, 2);
  const [a, o] = r.orders;
  assert.equal(a.buyerId, "b1");
  assert.equal(a.po, "AFH-1");
  assert.equal(a.ship_date, "2027-01-20");
  assert.deepEqual(a.lines.map((l) => [l.style, l.qty, l.factory_id]), [["K-1", "500", "f1"], ["K-2", "300", "f1"]]);
  assert.deepEqual(a.problems, []);
  assert.equal(sheetQty(a), 800);
  assert.equal(o.buyerId, "b2");
  assert.equal(o.po_date, "2026-12-01");
  assert.deepEqual(o.problems, []);
});

test("each problem names its row", () => {
  const text = [
    "Buyer,PO,Ship date,Style,Colour,Qty,Factory",
    "Nobody,X-1,20/01/2027,A,,100,",
    "BYR-AH,AH-7,someday,B,,100,Elsewhere",
    "BYR-AH,AH-7,,B,,0,",
    "BYR-AH,AH-8,10/01/2027,C,Red,50,",
    "BYR-AH,AH-8,,C,red,50,",
  ].join("\n");
  const r = readSheet(text, buyers, factories);
  const [x, ah7, ah8] = r.orders;
  assert.match(x.problems[0], /Row 2: no buyer called "Nobody"/);
  assert.ok(ah7.problems.some((p) => /Row 3: can't read the ship date "someday"/.test(p)));
  assert.ok(ah7.problems.some((p) => /Row 3: no factory called "Elsewhere"/.test(p)));
  assert.ok(ah7.problems.some((p) => /Row 4: quantity must be a whole number/.test(p)));
  assert.ok(ah8.problems.some((p) => /Row 6: C Red is twice in PO AH-8/i.test(p)));
});

test("a sheet without Style and Qty columns is refused whole", () => {
  assert.match(readSheet("Name,Amount\nA,1", buyers, factories).problems[0], /at least Style and Qty/);
  assert.match(readSheet("Style,Qty\nA,1", buyers, factories).problems.join(" "), /PO column/);
});

test("the blank sheet reads back as one clean PO", () => {
  const r = readSheet(blankSheet(), buyers, factories);
  assert.equal(r.orders.length, 1);
  assert.deepEqual(r.orders[0].problems, []);
  assert.equal(r.orders[0].lines.length, 2);
});
