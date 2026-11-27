import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, xlsx } from "./xlsx.ts";

test("crc32 matches the zip standard", () => {
  assert.equal(crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("a workbook is a zip holding every sheet, with text kept as text", () => {
  const book = xlsx([
    { name: "Orders", rows: [["Order", "Pieces", "Ship date"], ["SO-0023", 1200, "2026-12-10"], ["=HYPERLINK(\"x\")", null, "a & b <c>"]] },
    { name: "Orders", rows: [["Again"]] },
  ]);
  assert.deepEqual([...book.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const text = new TextDecoder().decode(book);
  assert.match(text, /<sheet name="Orders" sheetId="1"/);
  assert.match(text, /<sheet name="Orders 2" sheetId="2"/);
  assert.match(text, /<c r="B2"><v>1200<\/v><\/c>/);
  assert.match(text, /<c r="C2" s="2"><v>46366<\/v><\/c>/); // 10 Dec 2026 as an Excel date
  assert.match(text, /<t xml:space="preserve">=HYPERLINK\(&quot;x&quot;\)<\/t>/);
  assert.match(text, /a &amp; b &lt;c&gt;/);
  assert.doesNotMatch(text, /<f>/);
});
