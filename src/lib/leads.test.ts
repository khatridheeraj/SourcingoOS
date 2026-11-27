import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFunnel, channelOf, hoursText, type LeadRow } from "./leads.ts";

const lead = (o: Partial<LeadRow>): LeadRow => ({
  id: Math.random().toString(36), inquiry_no: "ENQ-0001", status: "new", source: "email", from_site: false, asked_on_page: false, country: null,
  created_at: "2026-11-29T04:00:00Z", first_reply_at: null, quoted_price: null, sample_sent_on: null, sample_in_on: null,
  lost_reason: null, next_follow_up: null, ...o,
});
const now = Date.parse("2026-12-01T04:00:00Z");

test("each step of the funnel counts the leads that reached it", () => {
  const f = buildFunnel([
    lead({}),
    lead({ first_reply_at: "2026-11-29T06:00:00Z" }),
    lead({ status: "quoted", quoted_price: 400 }),
    lead({ status: "quoted", quoted_price: 400, sample_sent_on: "2026-11-30" }),
    lead({ status: "converted", quoted_price: 380 }),
    lead({ status: "lost", lost_reason: "Price too high", quoted_price: 500 }),
  ], now, "2026-12-01");
  assert.deepEqual(f.steps.map((s) => s.n), [6, 5, 4, 2, 1]);
  assert.equal(f.winRate, 50);
  assert.deepEqual(f.lostReasons, [{ reason: "Price too high", n: 1 }]);
});

test("reply speed counts only leads since replies were kept, and waits a day before counting a silence", () => {
  const f = buildFunnel([
    lead({ created_at: "2026-11-01T04:00:00Z" }),                                         // before replies were kept
    lead({ first_reply_at: "2026-11-29T06:00:00Z" }),                                     // 2 hours
    lead({ created_at: "2026-11-29T04:00:00Z", first_reply_at: "2026-11-30T10:00:00Z" }), // 30 hours
    lead({ created_at: "2026-11-30T04:00:00Z" }),                                         // a day, no reply: counted, late
    lead({ created_at: "2026-12-01T01:00:00Z" }),                                         // 3 hours, still in time: not counted yet
  ], now, "2026-12-01");
  assert.equal(f.replyCounted, 3);
  assert.equal(f.replyInDay, 1);
  assert.equal(f.replyMedianHours, 16);
  assert.equal(f.waiting.length, 2);
});

test("where a lead came from", () => {
  assert.equal(channelOf(lead({ from_site: true, source: "other" })), "website");
  assert.equal(channelOf(lead({ asked_on_page: true })), "page");
  assert.equal(channelOf(lead({ referred_by: "x", from_site: true })), "referral");
  assert.equal(channelOf(lead({ source: "whatsapp" })), "whatsapp");
  assert.equal(hoursText(0.25), "15 min");
  assert.equal(hoursText(30), "30 h");
});
