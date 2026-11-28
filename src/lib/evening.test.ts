import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvening, eveningHtml, eveningText, type EveningData } from "./evening.ts";

const d: EveningData = {
  name: "Vidhi Khandelwal", email: "merchandiser@sourcingo.in", role: "merchandiser", date: "2026-11-28", company: "Sourcingo", late: 3,
  items: [
    { at: "2026-11-28T09:00:00Z", kind: "qc", order_id: "o1", order_no: "SO-0023", who: "Flavia", info: { qc_kind: "final", result: "fail", defects: 4 } },
    { at: "2026-11-28T08:00:00Z", kind: "buyer_message", order_id: "o1", order_no: "SO-0023", who: "Flavia", info: { body: "<b>Ship early?</b>" } },
  ],
  tomorrow: [
    { order_id: "o2", order_no: "SO-0030", style: "AV-142", stage: "cutting", label: null, on: "2026-11-30" },
    { order_id: "o2", order_no: "SO-0030", style: "AV-141", stage: "cutting", label: null, on: "2026-11-30" },
  ],
};

test("the headline counts updates, what needs you, what is due and what is late", () => {
  const e = buildEvening(d);
  assert.equal(e.headline, "2 updates, 1 needs you, 1 order with steps due next, 3 steps late");
  assert.equal(e.subject, "Sourcingo evening, 28 Nov 2026: 2 updates, 1 needs you, 1 order with steps due next, 3 steps late");
  assert.equal(e.due[0].text, "SO-0030: 2 steps due 30 Nov 2026");
  assert.equal(e.due[0].href, "/orders/o2#tna");
});

test("the email escapes what people typed and links into the app", () => {
  const e = buildEvening(d);
  const html = eveningHtml(e, d, "https://app.test");
  assert.match(html, /Good evening, Vidhi/);
  assert.match(html, /&lt;b&gt;Ship early\?&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/app.test\/orders\/o1#qc"/);
  assert.doesNotMatch(html, /<b>Ship/);
  assert.match(eveningText(e, d, "https://app.test"), /^Good evening, Vidhi\. 2 updates/);
});
