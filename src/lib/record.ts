// Our record: the numbers that prove Sourcingo delivers, for the sales kit (team page, public page, PDF).
// The database counts what happened (sourcingo_record(), supabase/migrations/0104_sales_kit.sql); this file decides
// which counts are big enough to say out loud and how to word them. A rate drawn from a handful of cases says more
// about luck than about us, so below a minimum it is left out and the plain count is shown instead.

export type RecordCounts = {
  since: string | null;
  orders: number; orders_shipped: number; buyers: number; styles: number;
  pieces_ordered: number; metres_ordered: number;
  factories_used: number; factories_verified: number;
  shipments: number; shipments_dated: number; shipments_on_time: number;
  pieces_shipped: number; metres_shipped: number;
  steps_finished: number; steps_on_time: number; steps_overdue: number;
  qc_checks: number; qc_inline: number;
  final_firsts: number; final_first_pass: number;
  pieces_checked: number; defects: number;
  public: boolean; as_of: string; email?: string | null; phone?: string | null;
};

// The smallest base a rate is shown on, company-wide.
export const MIN = { steps: 30, finals: 5, shipments: 5, piecesChecked: 500 };
// The sales kit puts a rate in front of a lead only when it is one we are proud of. The team page always shows the
// true figure and says which ones are held back, so nobody mistakes the kit for the whole story.
export const PROUD = { steps: 75, firstPass: 80, onTime: 80, defects: 5 };

export type Stat = {
  key: string;
  held?: boolean;  // true but below PROUD: on the team page, not in the kit
  value: string;   // the big number, "5,272" or "94%"
  label: string;   // what it is, "pieces shipped"
  note: string;    // how it was counted, in one line
};

const n = new Intl.NumberFormat("en-US");
const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthYear = (d: string | null) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");
const plural = (k: number, one: string, many: string) => `${n.format(k)} ${k === 1 ? one : many}`;

// What goes in front of a lead: the true numbers we are proud of.
export const kitStats = (c: RecordCounts) => recordStats(c).filter((s) => !s.held);

// Every headline number, most persuasive first. Each is a count of real records; none is typed in.
export function recordStats(c: RecordCounts): Stat[] {
  const out: Stat[] = [];
  if (c.pieces_shipped > 0) {
    out.push({ key: "shipped", value: n.format(c.pieces_shipped), label: "pieces shipped",
      note: `In ${plural(c.shipments, "shipment", "shipments")}${c.metres_shipped ? `, plus ${n.format(c.metres_shipped)} metres of fabric` : ""}.` });
  }
  const stepsCounted = c.steps_finished + c.steps_overdue;
  if (stepsCounted >= MIN.steps) {
    out.push({ key: "steps", held: (c.steps_on_time / stepsCounted) * 100 < PROUD.steps, value: pct(c.steps_on_time, stepsCounted), label: "production steps on time",
      note: `${n.format(c.steps_on_time)} of ${n.format(stepsCounted)} dated steps finished by their date; open steps past their date count as late.` });
  }
  if (c.final_firsts >= MIN.finals) {
    out.push({ key: "firstpass", held: (c.final_first_pass / c.final_firsts) * 100 < PROUD.firstPass, value: pct(c.final_first_pass, c.final_firsts), label: "passed final QC first time",
      note: `${n.format(c.final_first_pass)} of ${n.format(c.final_firsts)} styles passed our first final inspection.` });
  }
  if (c.shipments_dated >= MIN.shipments) {
    out.push({ key: "ontime", held: (c.shipments_on_time / c.shipments_dated) * 100 < PROUD.onTime, value: pct(c.shipments_on_time, c.shipments_dated), label: "shipments left on time",
      note: `${n.format(c.shipments_on_time)} of ${n.format(c.shipments_dated)} shipments left by the buyer's ship date.` });
  }
  if (c.qc_checks > 0) {
    out.push({ key: "checks", value: n.format(c.qc_checks), label: "quality inspections by our team",
      note: `${plural(c.qc_inline, "inline or mid-line check", "inline and mid-line checks")} and ${plural(c.qc_checks - c.qc_inline, "final inspection", "final inspections")}${c.pieces_checked ? `, ${n.format(c.pieces_checked)} pieces inspected at final` : ""}.` });
  }
  if (c.pieces_checked >= MIN.piecesChecked) {
    out.push({ key: "defects", held: (c.defects / c.pieces_checked) * 100 > PROUD.defects, value: (Math.round((c.defects / c.pieces_checked) * 1000) / 10).toFixed(1), label: "defects per 100 pieces at final QC",
      note: `${n.format(c.defects)} defects found in ${n.format(c.pieces_checked)} pieces inspected before packing.` });
  }
  if (c.orders > 0) {
    out.push({ key: "orders", value: n.format(c.orders), label: c.orders === 1 ? "order managed" : "orders managed",
      note: `${plural(c.styles, "style", "styles")} for ${plural(c.buyers, "buyer", "buyers")}, ${n.format(c.pieces_ordered)} pieces${c.metres_ordered ? ` and ${n.format(c.metres_ordered)} metres` : ""} ordered${c.since ? ` since ${monthYear(c.since)}` : ""}.` });
  }
  if (c.factories_used > 0) {
    out.push(c.factories_verified > 0
      ? { key: "factories", value: n.format(c.factories_verified), label: c.factories_verified === 1 ? "factory visited and verified" : "factories visited and verified",
          note: `Visited by our team in the last year with GST papers checked, out of ${plural(c.factories_used, "factory", "factories")} on our orders.` }
      : { key: "factories", value: n.format(c.factories_used), label: c.factories_used === 1 ? "factory on our orders" : "factories on our orders",
          note: "Each one keeps a record with us from its real orders: steps on time, first-time QC, defects and claims." });
  }
  return out;
}

// Rates we can't show yet, and how far each is from showing, for the team page only.
export function recordGaps(c: RecordCounts): string[] {
  const gaps: string[] = [];
  const steps = c.steps_finished + c.steps_overdue;
  if (steps < MIN.steps) gaps.push(`Steps on time shows after ${MIN.steps} dated steps (${steps} so far).`);
  if (c.final_firsts < MIN.finals) gaps.push(`First-time QC pass shows after ${MIN.finals} styles have a final inspection (${c.final_firsts} so far).`);
  if (c.shipments_dated < MIN.shipments) gaps.push(`Shipments on time shows after ${MIN.shipments} shipments with a ship date (${c.shipments_dated} so far).`);
  if (c.pieces_checked < MIN.piecesChecked) gaps.push(`Defects per 100 pieces shows after ${n.format(MIN.piecesChecked)} pieces are inspected at final (${n.format(c.pieces_checked)} so far).`);
  if (!c.factories_verified) gaps.push("Factories verified shows once a factory visit is recorded (Factories > a factory > Record a visit).");
  return gaps;
}

// One line for a WhatsApp or email to a lead.
export function recordLine(c: RecordCounts): string {
  const s = kitStats(c).slice(0, 3);
  return s.map((x) => `${x.value} ${x.label}`).join(" · ");
}
