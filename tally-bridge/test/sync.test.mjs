import assert from "node:assert/strict";
import { test } from "node:test";
import { createSync, readRange, tallyClient } from "../lib/sync.mjs";
import { fakeTally } from "./fake-tally.mjs";

// Sourcingo OS side, in memory.
function memoryCloud(settings) {
  const c = { hellos: [], snapshots: [] };
  c.hello = async (info) => { c.hellos.push(info); return settings; };
  c.snapshot = async (p) => { c.snapshots.push(p); return { linked: 1 }; };
  return c;
}
const ON = { enabled: true, company: "Sourcingo Test", read_from: "2026-04-01" };

const books = () => fakeTally({
  ledgers: [{ name: "Ozia Retail & Co", parent: "Sundry Debtors", balance: -26250, gstin: "09abcde1234f1z5" }, { name: "Okhla Stitchers", parent: "Sundry Creditors", balance: 42000 }],
  items: [{ name: "K-22 Kurta", unit: "Pcs", qty: 120, value: 30000 }],
  vouchers: [
    { guid: "g1", vtype: "Sales", number: "SPL/26-27/147", date: "2026-10-04", party: "Ozia Retail & Co", amount: 26250 },
    { guid: "g2", vtype: "Credit Note", number: "CN/3", date: "2026-10-05", party: "Ozia Retail & Co", amount: 1250, bills: [{ name: "SPL/26-27/147", amount: 1250 }] },
    { guid: "g3", vtype: "Sales", number: "SPL/25-26/900", date: "2026-03-30", party: "Ozia Retail & Co", amount: 999 },   // before read_from
    { guid: "g4", vtype: "Sales", number: "SPL/26-27/148", date: "2026-10-06", party: "Ozia Retail & Co", amount: 5, cancelled: true },
    { guid: "g5", vtype: "Sales", number: "SPL/26-27/149", date: "2026-10-06", party: "Ozia Retail & Co", amount: 5, optional: true },
  ],
});

test("a round reads Tally over HTTP, sends it to the app and never writes to Tally", async () => {
  const tally = books();
  const url = await tally.listen();
  try {
    const cloud = memoryCloud(ON);
    const logs = [];
    const sync = createSync({ tally: tallyClient(url), cloud, log: (m) => logs.push(m), now: () => new Date("2026-10-10T08:00:00Z") });
    const r = await sync.round();
    assert.equal(r.read, true);
    assert.equal(cloud.hellos[0].tally, "online");
    assert.deepEqual(cloud.hellos[0].companies, ["Sourcingo Test"]);

    const s = cloud.snapshots[0];
    assert.deepEqual([s.from, s.to], ["2026-04-01", "2026-10-10"]);
    // Balances come in as "owed to us": a debit balance is positive.
    assert.deepEqual(s.ledgers.map((l) => [l.name, l.balance, l.gstin]), [["Ozia Retail & Co", 26250, "09ABCDE1234F1Z5"], ["Okhla Stitchers", -42000, null]]);
    assert.deepEqual(s.items, [{ name: "K-22 Kurta", parent: "", unit: "Pcs", qty: 120, value: 30000 }]);
    // Cancelled, optional and out-of-range vouchers stay out.
    assert.deepEqual(s.vouchers.map((v) => v.guid), ["g1", "g2"]);
    assert.deepEqual(s.vouchers[1], {
      guid: "g2", vtype: "Credit Note", number: "CN/3", date: "2026-10-05", party: "Ozia Retail & Co", amount: 1250, reference: null, narration: null,
      bills: [{ name: "SPL/26-27/147", amount: 1250 }],
    });
    assert.equal(tally.books.writes.length, 0);
    assert.match(logs.at(-1), /Read 2 ledgers, 1 stock items and 2 vouchers/);

    // Not due again for 15 minutes.
    assert.equal((await sync.round()).read, false);
    assert.equal(cloud.snapshots.length, 1);
  } finally {
    await tally.close();
  }
});

test("switched off in the app: checks in, reads nothing", async () => {
  const tally = books();
  const cloud = memoryCloud({ ...ON, enabled: false });
  const r = await createSync({ tally: tally.handle, cloud }).round();
  assert.equal(r.read, false);
  assert.equal(cloud.hellos.length, 1);
  assert.equal(cloud.snapshots.length, 0);
});

test("Tally closed: checks in as offline", async () => {
  const cloud = memoryCloud(ON);
  const r = await createSync({ tally: tallyClient("http://127.0.0.1:9", 2000), cloud }).round();
  assert.equal(r.read, false);
  assert.equal(cloud.hellos[0].tally, "offline");
});

test("wrong company open in Tally: says so", async () => {
  const tally = fakeTally({ company: "Some Other Co" });
  const cloud = memoryCloud(ON);
  const r = await createSync({ tally: tally.handle, cloud }).round();
  assert.equal(r.read, false);
  assert.match(cloud.hellos.at(-1).tally_error, /"Sourcingo Test" isn't open in Tally/);
});

test("read range defaults to the start of last financial year", () => {
  const now = new Date("2026-10-10T08:00:00Z");
  assert.deepEqual(readRange({}, now), { from: "2025-04-01", to: "2026-10-10" });
  assert.deepEqual(readRange({ read_from: "2026-06-15" }, now), { from: "2026-06-15", to: "2026-10-10" });
  assert.deepEqual(readRange({}, new Date("2027-02-01T00:00:00Z")), { from: "2025-04-01", to: "2027-02-01" });
  // Just after midnight in India is already the next day.
  assert.equal(readRange({}, new Date("2026-10-09T19:00:00Z")).to, "2026-10-10");
});
