import { test } from "node:test";
import assert from "node:assert/strict";
import { amountInWords, countryFromName, countryOf, curMoney, fxFromPerInr, landed, landedProblem, startInput, FALLBACK_FX, withPegs } from "./landed.ts";

const fx = withPegs({ inr: { USD: 80, EUR: 100, GBP: 100 }, date: "2026-11-27", live: true });

test("delivered price to the UK: CIF, then duty on CIF, in pounds", () => {
  const i = { ...startInput(countryOf("GB")!, false, null), duty: "12", kg: "0.4", freight: "100" };
  const l = landed(800, i, fx, false)!;
  // ₹800 + freight 0.4 × 100 = ₹40, insurance (840 × 1.1 × 0.5%) = ₹4.62, CIF 844.62, duty 12% = 101.35
  assert.equal(l.price, 8);
  assert.equal(l.freight, 0.4);
  assert.equal(l.insurance, 0.05);
  assert.equal(l.duty, 1.01);
  assert.equal(l.total, 9.46);
  assert.equal(l.currency, "GBP");
});

test("the US charges duty on the goods alone (FOB)", () => {
  const i = { ...startInput(countryOf("US")!, false, null), duty: "10", kg: "0.5", freight: "120" };
  const l = landed(800, i, fx, false)!;
  assert.equal(l.duty, 1); // 10% of ₹800 = ₹80 = $1
  assert.equal(l.freight, 0.75);
});

test("starting values follow the country and the team's own freight rates", () => {
  const i = startInput(countryOf("AE")!, true, { gulf: { sea: 60, air: 200 } });
  assert.equal(i.currency, "AED");
  assert.equal(i.freight, "60");
  assert.equal(i.kg, "0.15");
  assert.equal(startInput(countryOf("DE")!, false, null).duty, "12");
});

test("problems are worded for the card", () => {
  const i = startInput(countryOf("US")!, false, null);
  assert.equal(landedProblem(i, fx), null);
  assert.match(landedProblem({ ...i, kg: "" }, fx)!, /weight/);
  assert.match(landedProblem({ ...i, duty: "150" }, fx)!, /percentage/);
  assert.match(landedProblem({ ...i, currency: "XYZ" }, fx)!, /currency/);
  assert.equal(landed(0, i, fx, false), null);
});

test("rates from the daily source become rupees a unit, with Gulf pegs filled in", () => {
  const f = fxFromPerInr({ USD: 0.0125, EUR: 0.01 }, "2026-11-27");
  assert.equal(Math.round(f.inr.USD), 80);
  assert.equal(Math.round(f.inr.AED * 100) / 100, 21.78);
  assert.ok(FALLBACK_FX.inr.USD > 50 && !FALLBACK_FX.live);
});

test("countries by the names buyers type", () => {
  assert.equal(countryFromName("UK")?.code, "GB");
  assert.equal(countryFromName("united states")?.code, "US");
  assert.equal(countryFromName("Dubai")?.code, "AE");
  assert.equal(countryFromName("Narnia"), null);
});

test("money and words for invoices", () => {
  assert.equal(curMoney(1234.5, "USD"), "US$ 1,234.50");
  assert.equal(curMoney(1234.5, "JPY"), "¥ 1,235");
  assert.equal(amountInWords(1205.5, "USD"), "US Dollars One Thousand Two Hundred Five and Cents Fifty Only");
  assert.equal(amountInWords(21000, "EUR"), "Euros Twenty One Thousand Only");
});
