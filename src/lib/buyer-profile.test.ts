import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE, askMessage, gapsFor, isIndian, needsEori, profileProblem, profileScore, toProfile, type BuyerDoc } from "./buyer-profile.ts";

const none = { delivery_address: null, currency: "INR", credit_days: null };
const doc = (kind: BuyerDoc["kind"]): BuyerDoc => ({ id: kind, kind, path: `x/buyer-files/y/${kind}.pdf`, file_name: kind, by_buyer: false, added_at: "2026-11-28" });

test("an empty Indian buyer is not ready and needs GSTIN, PAN and its papers", () => {
  const s = profileScore(EMPTY_PROFILE, none, []);
  assert.equal(s.ready, false);
  const keys = s.missing.map((i) => i.key);
  for (const k of ["legal_name", "billing_address", "delivery_address", "contact", "gstin", "pan", "terms", "doc_gst", "doc_pan", "doc_agreement"]) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes("consignee"), "export parties are not asked of Indian buyers");
});

test("a complete Indian buyer is ready for orders", () => {
  const p = toProfile({ legal_name: "S D Retail Limited", billing_address: "Plot 3, Ahmedabad", gstin: "24AAICS8200M1Z7", pan: "AAICS8200M",
    contacts: [{ name: "Vishal", phone: "9974018915", email: "vishal@x.com" }] });
  const s = profileScore(p, { delivery_address: "Plot 3, Ahmedabad", currency: "INR", credit_days: 45 }, [doc("gst"), doc("pan"), doc("agreement")]);
  assert.equal(s.ready, true);
  assert.ok(s.optional.some((i) => i.key === "bank"));
  assert.ok(s.pct < 100 && s.pct > 50);
});

test("an overseas buyer needs tax number and export parties, EORI only in the EU and UK", () => {
  const us = toProfile({ country: "United States" });
  assert.equal(isIndian(us), false);
  assert.equal(needsEori(us), false);
  const keys = profileScore(us, none, []).missing.map((i) => i.key);
  for (const k of ["tax_id", "incoterm", "port", "consignee", "notify_party", "doc_registration"]) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes("gstin") && !keys.includes("eori"));
  assert.equal(needsEori(toProfile({ country: "Germany" })), true);
});

test("each paper names only what it needs", () => {
  const p = toProfile({ legal_name: "Zolo Label Private Limited" });
  const inv = gapsFor("invoice", p, none, []);
  assert.ok(inv.includes("Buyer: Billing address"));
  assert.ok(inv.includes("Buyer: GSTIN"));
  assert.ok(!inv.some((g) => g.includes("Legal name")));
  assert.deepEqual(gapsFor("ship", p, { ...none, delivery_address: "Jaipur" }, []), ["Buyer: A contact with mobile and email"]);
});

test("typed details are checked, and PAN must match the GSTIN", () => {
  assert.equal(profileProblem({ gstin: "24AAICS8200M1Z7", pan: "AAICS8200M" }), null);
  assert.match(profileProblem({ gstin: "24AAICS8200" }) ?? "", /15 letters/);
  assert.match(profileProblem({ gstin: "24AAICS8200M1Z7", pan: "ABCDE1234F" }) ?? "", /doesn't match/);
  assert.match(profileProblem({ contacts: [{ name: "A", email: "nope" }] }) ?? "", /not an email/);
  assert.match(profileProblem({ contacts: [{ name: "A", phone: "12345" }] }) ?? "", /all its digits/);
});

test("the ask lists only what the buyer can give", () => {
  const s = profileScore(EMPTY_PROFILE, none, []);
  const m = askMessage("Zolo Label", s.missing, "https://x/s/abc");
  assert.ok(m.includes("• GSTIN"));
  assert.ok(!m.includes("Payment terms"));
  assert.ok(m.includes("https://x/s/abc"));
});
