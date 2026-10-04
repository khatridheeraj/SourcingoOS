// Business rules and sums shared by every screen. Pure functions only, so
// they run the same on the server and in the browser.

export type SoStatus = "draft" | "tna_review" | "locked" | "shipped";
export type TnaStatus = "pending" | "in_progress" | "completed" | "delayed";
export type GrnStatus = "draft" | "pending_approval" | "approved" | "rejected";
export type DcStatus = "draft" | "dispatched";
export type Condition = "good" | "damaged" | "short";
export type OrderType = "garment" | "fabric";

export const SIZES = ["S", "M", "L", "XL", "XXL", "3XL"] as const;
export const DEFAULT_CHECKPOINTS = ["Fabric Sourcing", "Cutting", "Sewing", "QC", "Packing", "Ready for Dispatch"];
export const CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
export const SOURCES = ["Email", "PDF", "Buyer portal", "WhatsApp", "Phone", "Other"];
export const STAGES = ["Order confirmed", "Production", "QC", "Packing", "Ready to ship", "Shipped"];

export const SO_LABEL: Record<SoStatus, string> = { draft: "Draft", tna_review: "TNA review", locked: "Locked", shipped: "Shipped" };
export const TNA_LABEL: Record<TnaStatus, string> = { pending: "Pending", in_progress: "In progress", completed: "Completed", delayed: "Delayed" };
export const GRN_LABEL: Record<GrnStatus, string> = { draft: "Draft", pending_approval: "Pending approval", approved: "Approved", rejected: "Rejected" };
export const DC_LABEL: Record<DcStatus, string> = { draft: "Draft", dispatched: "Dispatched" };
export const CONDITION_LABEL: Record<Condition, string> = { good: "Good", damaged: "Damaged", short: "Short" };

export type Checkpoint = {
  id: string; style_id: string; position: number; name: string; due_date: string | null; status: TnaStatus;
  status_updated_at: string | null; status_updated_by: string | null; status_note?: string | null; delay_reason?: DelayReason | null;
};

// Why a step is late. The factory must pick one; staff may.
export type DelayReason = "fabric" | "trims" | "approval" | "capacity" | "quality" | "labour" | "transport" | "other";
export const DELAY_REASONS: { value: DelayReason; label: string }[] = [
  { value: "fabric", label: "Fabric late" },
  { value: "trims", label: "Trims or accessories late" },
  { value: "approval", label: "Waiting for buyer approval" },
  { value: "capacity", label: "Line busy with other work" },
  { value: "quality", label: "Quality issue, redoing" },
  { value: "labour", label: "Workers short" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
];
export const delayLabel = (r: string | null | undefined) => DELAY_REASONS.find((x) => x.value === r)?.label ?? "";
export type Style = {
  id: string; so_id: string; position: number; name: string; code: string; fabric: string; colour: string; use_sizes: boolean;
  sizes: Record<string, number | string | null>; qty: number; buyer_rate: number; factory_rate: number | null;
  internal_note: string | null; checkpoints: Checkpoint[];
};
export type Order = {
  id: string; inquiry_id: string | null; buyer_id: string; buyer_po_number: string; order_type: OrderType; currency: string;
  so_date: string; order_source: string | null; tags: string[]; factory_id: string | null; payment_terms: string | null;
  delivery_address: string | null; merchandiser_id: string | null; manager_id: string | null; fabric_poc_id: string | null;
  quality_poc_id: string | null; buyer_date: string | null; factory_date: string | null; merch_date: string | null;
  remarks: string | null; terms: string | null; status: SoStatus; locked_at: string | null; locked_by: string | null;
  created_at: string; styles: Style[];
};
export type GrnLine = { id: string; grn_id: string; style_id: string; qty: number; condition: Condition };
export type Grn = {
  id: string; so_id: string; received_at: string; received_by: string | null; qc_checked: boolean; qc_note: string | null;
  notes: string | null; status: GrnStatus; approved_by: string | null; approved_at: string | null; created_by: string | null;
  created_at: string; lines: GrnLine[];
};
export type DcLine = { id: string; dc_id: string; style_id: string; qty: number };
export type Dc = {
  id: string; grn_id: string; so_id: string; courier: string | null; tracking: string | null; address: string | null;
  invoice_no: string | null; invoice_date: string | null; status: DcStatus; dispatched_at: string | null;
  created_by: string | null; created_at: string; lines: DcLine[];
};
export type Inquiry = {
  id: string; buyer_id: string; product_type: string; status: "new" | "quoted" | "converted" | "lost";
  next_follow_up: string | null; merchandiser_id: string | null; created_at: string; unit: string; so_id: string | null;
};
export type Buyer = { id: string; code: string; default_payment_terms: string | null; default_address: string | null; real_name?: string };
export type Factory = { id: string; name: string; city: string | null; active: boolean };
export type Person = { id: string; full_name: string | null; email: string; role: string | null; active: boolean };

// ───────── factory POs and QC ─────────
export type FpoStatus = "issued" | "accepted" | "declined" | "superseded" | "cancelled";
export type FpoLine = {
  style_id: string; name: string; code: string; fabric: string; colour: string; use_sizes: boolean; sizes: Record<string, number | string | null>;
  qty: number; rate: number | null; steps: { name: string; due_date: string | null }[];
};
export type Fpo = {
  id: string; so_id: string; factory_id: string; revision: number; status: FpoStatus; currency: string; delivery_date: string | null;
  payment_terms: string | null; terms: string | null; lines: FpoLine[]; total_qty: number; total_value: number | null;
  issued_at: string; issued_by: string | null; responded_at: string | null; responded_by: string | null; response_note: string | null;
};
export const FPO_LABEL: Record<FpoStatus, string> = {
  issued: "Waiting for factory", accepted: "Accepted", declined: "Declined", superseded: "Replaced", cancelled: "Withdrawn",
};
export const FPO_TONE: Record<FpoStatus, string> = { issued: "warn", accepted: "ok", declined: "bad", superseded: "", cancelled: "" };

export type QcKind = "inline" | "midline" | "final";
export type QcResult = "pass" | "fail" | "hold";
export type QcDefect = { name: string; severity: "critical" | "major" | "minor"; count: number };
export type Qc = {
  id: string; so_id: string; style_id: string; kind: QcKind; inspected_on: string; inspector_id: string | null; lot_qty: number;
  sample_size: number; aql_major: number; aql_minor: number; defects: QcDefect[]; critical: number; major: number; minor: number;
  measurements_ok: boolean | null; packing_ok: boolean | null; result: QcResult; notes: string | null; created_at: string;
};
export const QC_KIND_LABEL: Record<QcKind, string> = { inline: "Inline", midline: "Mid-line", final: "Final" };
export const QC_RESULT_LABEL: Record<QcResult, string> = { pass: "Pass", fail: "Fail", hold: "On hold" };
export const QC_TONE: Record<QcResult, string> = { pass: "ok", fail: "bad", hold: "warn" };
export const COMMON_DEFECTS: { name: string; severity: QcDefect["severity"] }[] = [
  { name: "Open seam", severity: "major" }, { name: "Broken stitch", severity: "major" }, { name: "Skipped stitch", severity: "major" },
  { name: "Uneven hem", severity: "minor" }, { name: "Shade variation", severity: "major" }, { name: "Stain / spot", severity: "major" },
  { name: "Hole / damage", severity: "major" }, { name: "Measurement out", severity: "major" }, { name: "Loose thread", severity: "minor" },
  { name: "Puckering", severity: "minor" }, { name: "Label wrong / missing", severity: "minor" }, { name: "Needle / sharp object", severity: "critical" },
];

// ANSI/ASQ Z1.4, level II, normal single sampling: the same table the database uses.
const QC_N = [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250];
const QC_A25 = [0, 0, 0, 0, 1, 1, 2, 3, 5, 7, 10, 14, 21, 21, 21];
const QC_A40 = [0, 0, 0, 1, 1, 2, 3, 5, 7, 10, 14, 21, 21, 21, 21];
export function qcSampleSize(lot: number) {
  const steps: [number, number][] = [[8, 2], [15, 3], [25, 5], [50, 8], [90, 13], [150, 20], [280, 32], [500, 50], [1200, 80], [3200, 125], [10000, 200], [35000, 315], [150000, 500], [500000, 800]];
  const n = steps.find(([max]) => lot <= max)?.[1] ?? 1250;
  return Math.min(Math.max(lot, 1), n);
}
export function qcAccept(sample: number, aql: number) {
  let i = 0;
  QC_N.forEach((n, j) => { if (n <= Math.max(sample, 2)) i = j; });
  return (aql >= 4 ? QC_A40 : QC_A25)[i];
}
export function qcJudge(q: { sample_size: number; aql_major: number; aql_minor: number; defects: QcDefect[]; measurements_ok: boolean | null; packing_ok: boolean | null }) {
  const sum = (sev: QcDefect["severity"]) => q.defects.filter((d) => d.severity === sev).reduce((a, d) => a + num(d.count), 0);
  const critical = sum("critical"), major = sum("major"), minor = sum("minor");
  const acMajor = qcAccept(q.sample_size, q.aql_major), acMinor = qcAccept(q.sample_size, q.aql_minor);
  const result: QcResult = critical > 0 || major > acMajor || minor > acMinor ? "fail" : q.measurements_ok === false || q.packing_ok === false ? "hold" : "pass";
  return { critical, major, minor, acMajor, acMinor, result };
}

// ───────── samples ─────────
export type SampleStatus = "received" | "with_vendor" | "ready" | "dispatched" | "approved" | "changes" | "rejected" | "cancelled";
export type SampleType = "development" | "fit" | "size_set" | "pp" | "photoshoot" | "salesman" | "other";
export type Sample = {
  id: string; buyer_id: string; sample_type: SampleType; description: string | null; buyer_ref: string | null; fabric: string | null;
  qty: number; factory_id: string | null; merchandiser_id: string | null; status: SampleStatus; round: number;
  received_on: string | null; due_date: string | null; issued_on: string | null; vendor_due: string | null; ready_on: string | null;
  dispatched_on: string | null; courier: string | null; tracking: string | null; feedback: string | null; remarks: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};

export const SAMPLE_LABEL: Record<SampleStatus, string> = {
  received: "At Sourcingo", with_vendor: "With vendor", ready: "Ready to send", dispatched: "Sent to buyer",
  approved: "Approved", changes: "Changes asked", rejected: "Rejected", cancelled: "Cancelled",
};
export const SAMPLE_TONE: Record<SampleStatus, string> = {
  received: "", with_vendor: "info", ready: "info", dispatched: "ok", approved: "ok", changes: "warn", rejected: "bad", cancelled: "",
};
export const SAMPLE_TYPES: { value: SampleType; label: string }[] = [
  { value: "development", label: "Development / proto" },
  { value: "fit", label: "Fit sample" },
  { value: "size_set", label: "Size set" },
  { value: "pp", label: "Pre-production (PP)" },
  { value: "photoshoot", label: "Photoshoot" },
  { value: "salesman", label: "Salesman sample" },
  { value: "other", label: "Other" },
];
export const sampleTypeLabel = (t: string) => SAMPLE_TYPES.find((x) => x.value === t)?.label ?? t;
export const SAMPLE_STEPS = ["At Sourcingo", "With vendor", "Ready", "Sent to buyer", "Buyer decision"];
export const sampleStep = (st: SampleStatus) =>
  ({ received: 0, with_vendor: 1, ready: 2, dispatched: 3, approved: 4, changes: 4, rejected: 4, cancelled: -1 })[st];

// Still with Sourcingo or the vendor: the due date is what matters.
export const isOpenSample = (s: { status: SampleStatus }) => s.status === "received" || s.status === "with_vendor" || s.status === "ready";
export const sampleTitle = (s: { description: string | null; fabric: string | null }) => s.description || s.fabric || "Sample";
export const sampleDaysLeft = (s: { due_date: string | null }, today: string) => (s.due_date ? daysBetween(today, s.due_date) : null);
export const vendorLate = (s: Sample, today: string) => s.status === "with_vendor" && !!s.vendor_due && s.vendor_due < today;
// Sent on or before the due date? null until it is sent (or without a due date).
export const sampleOnTime = (s: Sample) => (s.dispatched_on && s.due_date ? s.dispatched_on <= s.due_date : null);

// Sort key: open samples first, by due date (missing dates first), then the rest newest first.
export function sampleOrder(a: Sample, b: Sample) {
  const oa = isOpenSample(a), ob = isOpenSample(b);
  if (oa !== ob) return oa ? -1 : 1;
  if (oa) return (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.id.localeCompare(b.id);
  return b.created_at.localeCompare(a.created_at);
}

// The one thing to say about a sample on the alert list, if anything.
export function sampleAlert(s: Sample, today: string, buyer: string, vendor: string): Omit<Alert, "href"> | null {
  const what = sampleTitle(s);
  const tag = `${s.id} · ${buyer}`;
  const where = s.status === "with_vendor" ? ` · with ${vendor}` : ` · ${SAMPLE_LABEL[s.status].toLowerCase()}`;
  const k = s.due_date ?? "";
  if (s.status === "dispatched" && s.dispatched_on && daysBetween(s.dispatched_on, today) >= 7) {
    return { sev: "note", t: `Ask for feedback: ${what}`, d: `${tag} · sent ${fmtDay(s.dispatched_on)}, no decision yet`, k: s.dispatched_on };
  }
  if (s.status === "changes") {
    return { sev: "warn", t: `Changes asked: ${what}`, d: `${tag} · start round ${s.round + 1}${s.feedback ? ` · "${s.feedback.slice(0, 80)}"` : ""}`, k };
  }
  if (!isOpenSample(s)) return null;
  const left = sampleDaysLeft(s, today);
  if (left === null) return { sev: "warn", t: `Set a due date: ${what}`, d: `${tag}${where} · no buyer deadline recorded`, k: "" };
  if (left < 0) return { sev: "bad", t: `Sample late by ${-left} day${left === -1 ? "" : "s"}: ${what}`, d: `${tag} · was due ${fmtDay(s.due_date)}${where}`, k };
  if (left === 0) return { sev: "bad", t: `Sample due today: ${what}`, d: `${tag}${where}`, k };
  if (vendorLate(s, today)) {
    return { sev: left <= 2 ? "bad" : "warn", t: `Vendor late: ${what}`, d: `${vendor} promised ${fmtDay(s.vendor_due)} · buyer needs it ${fmtDay(s.due_date)} · ${tag}`, k };
  }
  if (left <= 2) {
    return { sev: s.status === "received" ? "bad" : "warn", t: `Sample due in ${left} day${left === 1 ? "" : "s"}: ${what}`, d: `${tag} · due ${fmtDay(s.due_date)}${where}`, k };
  }
  if (s.status === "received") return { sev: "info", t: `Give to a vendor: ${what}`, d: `${tag} · due ${fmtDay(s.due_date)}`, k };
  if (s.status === "ready") return { sev: "info", t: `Ready to send: ${what}`, d: `${tag} · due ${fmtDay(s.due_date)}`, k };
  return null;
}

// ───────── costing ─────────
export type CostExtra = { label: string; amount: number };
export type Costing = {
  id: string; inquiry_id: string; style_name: string; currency: string; qty: number | null; factory_id: string | null; factory_cost: number;
  extras: CostExtra[]; overhead_pct: number; margin_pct: number; quoted_price: number | null; status: "draft" | "quoted" | "accepted" | "rejected"; notes: string | null;
};
// Cost per piece, and the price that earns the target margin on it.
export function costingMath(c: { factory_cost: number | string; extras: CostExtra[]; overhead_pct: number | string; margin_pct: number | string; quoted_price?: number | string | null }) {
  const base = num(c.factory_cost) + c.extras.reduce((a, e) => a + num(e.amount), 0);
  const cost = base * (1 + num(c.overhead_pct) / 100);
  const m = Math.min(num(c.margin_pct), 99);
  const suggested = Math.ceil((cost / (1 - m / 100)) * 100) / 100;
  const q = c.quoted_price == null || c.quoted_price === "" ? null : num(c.quoted_price);
  const realMargin = q && q > 0 ? ((q - cost) / q) * 100 : null;
  return { cost, suggested, realMargin };
}

// ───────── numbers and money ─────────
export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const nf = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const SYM: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
export function money(n: number, cur = "INR") {
  return (SYM[cur] ?? cur + " ") + num(n).toLocaleString(cur === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 2 });
}
// "₹1,20,000 + $3,000": totals never add different currencies together.
export function sumByCur(items: [number, string][]) {
  const m: Record<string, number> = {};
  for (const [v, c] of items) m[c || "INR"] = (m[c || "INR"] ?? 0) + num(v);
  const keys = Object.keys(m).filter((c) => m[c] || c === "INR");
  return (keys.length ? keys : ["INR"]).map((c) => money(m[c] ?? 0, c)).join(" + ");
}

// ───────── dates (business dates are Indian dates) ─────────
export const isoIST = (d: Date | string | number) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

// ───────── orders ─────────
export const unitOf = (o: { order_type: OrderType }) => (o.order_type === "fabric" ? "m" : "pcs");
export const isLocked = (o: { status: SoStatus }) => o.status === "locked" || o.status === "shipped";
export const orderQty = (o: Order) => o.styles.reduce((a, s) => a + num(s.qty), 0);
export const orderValue = (o: Order) => o.styles.reduce((a, s) => a + num(s.qty) * num(s.buyer_rate), 0);
export const overdue = (cp: Checkpoint, today: string) => cp.status !== "completed" && !!cp.due_date && cp.due_date < today;
export const allCheckpoints = (o: Order) => o.styles.flatMap((s) => s.checkpoints.map((cp) => ({ style: s, cp })));

function stageOf(name: string) {
  const n = name.toLowerCase();
  if (/qc|inspect|quality/.test(n)) return 2;
  if (/pack/.test(n)) return 3;
  if (/dispatch|ship/.test(n)) return 4;
  return 1;
}
// Index into STAGES, the same milestone the buyer portal shows.
export function buyerStage(o: Order) {
  if (o.status === "shipped") return 5;
  if (o.status !== "locked") return 0;
  let first: Checkpoint | undefined;
  for (const { cp } of allCheckpoints(o)) {
    if (cp.status === "completed") continue;
    if (!first || (cp.due_date ?? "9999") < (first.due_date ?? "9999")) first = cp;
  }
  return first ? stageOf(first.name) : 4;
}

// Coloured bar segments for a TNA: c=completed, o=overdue, d=delayed, p=in progress.
export function progressCells(o: Order, today: string) {
  return allCheckpoints(o).map(({ cp }) =>
    cp.status === "completed" ? "c" : overdue(cp, today) ? "o" : cp.status === "delayed" ? "d" : cp.status === "in_progress" ? "p" : "",
  );
}

// ───────── warehouse ─────────
export const grnQty = (g: Grn) => g.lines.reduce((a, l) => a + num(l.qty), 0);
export const dcQty = (d: Dc) => d.lines.reduce((a, l) => a + num(l.qty), 0);
export const heldHours = (g: Grn, now: number) => (now - Date.parse(g.received_at)) / 36e5;

// Everything the screens need, indexed once.
export type World = ReturnType<typeof makeWorld>;
export function makeWorld(raw: {
  orders: Order[]; grns: Grn[]; dcs: Dc[]; inquiries: Inquiry[]; buyers: Buyer[]; factories: Factory[]; people: Person[]; samples: Sample[];
  fpos?: Fpo[]; qcs?: Qc[]; today: string; now: number; meId: string; isOwner: boolean;
}) {
  const fpos = raw.fpos ?? [];
  const qcs = raw.qcs ?? [];
  const orderById = new Map(raw.orders.map((o) => [o.id, o]));
  const styleById = new Map(raw.orders.flatMap((o) => o.styles.map((s) => [s.id, s] as const)));
  const buyerById = new Map(raw.buyers.map((b) => [b.id, b]));
  const factoryById = new Map(raw.factories.map((f) => [f.id, f]));
  const personById = new Map(raw.people.map((p) => [p.id, p]));
  const grnById = new Map(raw.grns.map((g) => [g.id, g]));

  const rate = (styleId: string) => num(styleById.get(styleId)?.buyer_rate);
  const currencyOf = (soId: string) => orderById.get(soId)?.currency ?? "INR";
  const grnValue = (g: Grn) => g.lines.reduce((a, l) => a + num(l.qty) * rate(l.style_id), 0);
  const dcValue = (d: Dc) => d.lines.reduce((a, l) => a + num(l.qty) * rate(l.style_id), 0);

  // Units of a style on a GRN that are on any DC (draft too) or only dispatched ones.
  const dcQtyFor = (grnId: string, styleId: string, excludeDc: string | null, onlyDispatched: boolean) =>
    raw.dcs
      .filter((d) => d.grn_id === grnId && d.id !== excludeDc && (!onlyDispatched || d.status === "dispatched"))
      .reduce((a, d) => a + d.lines.filter((l) => l.style_id === styleId).reduce((b, l) => b + num(l.qty), 0), 0);
  const grnHeld = (g: Grn) =>
    g.status === "rejected" ? 0 : g.lines.reduce((a, l) => a + Math.max(0, num(l.qty) - dcQtyFor(g.id, l.style_id, null, true)), 0);
  const grnAvail = (g: Grn, excludeDc: string | null = null) =>
    g.status === "rejected" || g.status === "draft"
      ? 0
      : g.lines.reduce((a, l) => a + Math.max(0, num(l.qty) - dcQtyFor(g.id, l.style_id, excludeDc, false)), 0);
  const receivedFor = (styleId: string, excludeGrn: string | null) =>
    raw.grns
      .filter((g) => g.status !== "rejected" && g.id !== excludeGrn)
      .reduce((a, g) => a + g.lines.filter((l) => l.style_id === styleId).reduce((b, l) => b + num(l.qty), 0), 0);
  const dispatchedFor = (soId: string) =>
    raw.dcs.filter((d) => d.so_id === soId && d.status === "dispatched").reduce((a, d) => a + dcQty(d), 0);
  const lateGrns = () => raw.grns.filter((g) => grnHeld(g) > 0 && heldHours(g, raw.now) >= 24);

  const buyerCode = (id: string | null | undefined) => (id ? buyerById.get(id)?.code ?? "Unknown buyer" : "—");
  const factoryName = (id: string | null | undefined) => (id ? factoryById.get(id)?.name ?? "Unknown factory" : "—");
  const personName = (id: string | null | undefined) => {
    if (!id) return "—";
    if (id === raw.meId) return "You";
    const p = personById.get(id);
    return p ? p.full_name || p.email : "Someone";
  };

  // The factory PO that counts for an order: the live one, else the latest.
  const fpoFor = (soId: string) => {
    const list = fpos.filter((p) => p.so_id === soId).sort((a, b) => b.revision - a.revision);
    return list.find((p) => p.status === "issued" || p.status === "accepted") ?? list[0] ?? null;
  };
  // The latest inspection of each kind for a style.
  const qcFor = (styleId: string) => qcs.filter((q) => q.style_id === styleId).sort((a, b) => b.inspected_on.localeCompare(a.inspected_on) || b.created_at.localeCompare(a.created_at));

  return {
    ...raw, fpos, qcs, fpoFor, qcFor, orderById, styleById, buyerById, factoryById, personById, grnById,
    rate, currencyOf, grnValue, dcValue, dcQtyFor, grnHeld, grnAvail, receivedFor, dispatchedFor, lateGrns,
    buyerCode, factoryName, personName,
  };
}

// ───────── alerts ─────────
// who: the people this is for (order or inquiry owners). Empty means everyone.
export type Alert = { sev: "bad" | "warn" | "info" | "note"; t: string; d: string; href: string; k?: string; who?: (string | null)[] };

// When a style will really finish if every late step pushes the rest back.
export function projectedFinish(o: Order, today: string) {
  let worst: string | null = null;
  for (const st of o.styles) {
    const open = st.checkpoints.filter((c) => c.status !== "completed" && c.due_date);
    if (!open.length) continue;
    const last = st.checkpoints.reduce<string | null>((m, c) => (c.due_date && (!m || c.due_date > m) ? c.due_date : m), null)!;
    const slip = Math.max(0, ...open.map((c) => daysBetween(c.due_date!, today)));
    const end = addDays(last, slip);
    if (!worst || end > worst) worst = end;
  }
  return worst;
}

export function computeAlerts(w: World): Alert[] {
  const out: Alert[] = [];
  const t = w.today;
  if (!w.factories.some((f) => f.active)) {
    out.push({ sev: "info", t: "Add your factories", d: "Sales orders need a factory. Add them in Master data.", href: "/setup?tab=factories" });
  }
  if (w.isOwner && !w.people.some((p) => p.active && p.role === "merchandiser")) {
    out.push({ sev: "info", t: "Add your merchandiser", d: "Ask them to sign in, then give them the Merchandiser role in People.", href: "/team" });
  }
  for (const g of w.grns) {
    const held = w.grnHeld(g);
    const so = w.orderById.get(g.so_id);
    const tag = `${g.so_id} · ${w.buyerCode(so?.buyer_id)}`;
    const who = [g.created_by, so?.merchandiser_id ?? null];
    if (held > 0) {
      const h = heldHours(g, w.now);
      if (h >= 24) {
        out.push({ sev: "bad", t: `Zero-inventory breach: ${g.id} held ${Math.floor(h)} hours`, d: `${nf(held)} units still at Sourcingo · ${tag}. Invoice and dispatch now.`, href: `/grn/${g.id}`, k: "0", who });
      } else if (h >= 12) {
        out.push({ sev: "warn", t: `Dispatch window closing: ${g.id}`, d: `${Math.ceil(24 - h)} hours left · ${nf(held)} units · ${tag}`, href: `/grn/${g.id}`, k: "1", who });
      }
    }
    if (g.status === "pending_approval") {
      const failed = so?.styles.some((st) => w.qcFor(st.id).find((q) => q.kind === "final")?.result === "fail");
      out.push({
        sev: w.isOwner ? (failed ? "bad" : "warn") : "info",
        t: w.isOwner ? `Approve ${g.id}` : `${g.id} waiting for approval`,
        d: `${nf(grnQty(g))} units from ${w.factoryName(so?.factory_id)}${failed ? " · final QC failed" : g.qc_checked ? "" : " · QC not confirmed"}`,
        href: `/grn/${g.id}`,
        who: w.isOwner ? [] : who,
      });
    }
    if (g.status === "draft") {
      out.push({ sev: "note", t: `${g.id} is still a draft`, d: `${tag} · submit it so the goods can be dispatched`, href: `/grn/${g.id}`, who });
    }
  }
  let pastBuyer = 0, noTna = 0;
  for (const o of w.orders) {
    const tag = `${o.id} · ${w.buyerCode(o.buyer_id)}`;
    const who = [o.merchandiser_id, o.manager_id];
    if (o.status === "locked") {
      if (o.buyer_date && o.buyer_date < addDays(t, -7)) { pastBuyer++; continue; }
      const cps = allCheckpoints(o);
      if (!cps.length) { noTna++; continue; }
      let allDone = true;
      for (const { style, cp } of cps) {
        if (cp.status !== "completed") allDone = false;
        const what = `${cp.name} for ${style.name} (${style.colour})`;
        const why = cp.delay_reason ? ` · ${delayLabel(cp.delay_reason)}` : "";
        if (overdue(cp, t)) {
          out.push({ sev: "bad", t: `Overdue: ${what}`, d: `${tag} · due ${fmtDay(cp.due_date)} · ${TNA_LABEL[cp.status]}${why} · ${w.factoryName(o.factory_id)}`, href: `/orders/${o.id}`, k: cp.due_date ?? "", who });
        } else if (cp.status === "delayed") {
          out.push({ sev: "warn", t: `Delayed: ${what}`, d: `${tag} · due ${fmtDay(cp.due_date)}${why} · ${w.factoryName(o.factory_id)}`, href: `/orders/${o.id}`, k: cp.due_date ?? "", who });
        }
      }
      const end = projectedFinish(o, t);
      if (end && o.buyer_date && end > o.buyer_date) {
        out.push({ sev: "bad", t: `Buyer date at risk: ${o.id}`, d: `${w.buyerCode(o.buyer_id)} · at today's pace production ends ${fmtDay(end)}, buyer needs it ${fmtDay(o.buyer_date)}`, href: `/orders/${o.id}`, k: o.buyer_date, who });
      } else if (end && o.factory_date && end > o.factory_date) {
        out.push({ sev: "warn", t: `Factory date slipping: ${o.id}`, d: `${tag} · likely ${fmtDay(end)} instead of ${fmtDay(o.factory_date)}`, href: `/orders/${o.id}`, k: o.factory_date, who });
      }
      const bd = o.buyer_date;
      if (!allDone && bd && bd >= t && bd <= addDays(t, 7)) {
        const n = daysBetween(t, bd);
        out.push({ sev: "warn", t: n === 0 ? "Buyer deadline today" : `Buyer deadline in ${n} day${n === 1 ? "" : "s"}`, d: `${tag} · delivery ${fmtDay(bd)} and production isn't complete`, href: `/orders/${o.id}`, k: bd, who });
      }
      const po = w.fpoFor(o.id);
      if (po?.status === "declined") {
        out.push({ sev: "bad", t: `Factory declined ${po.id}`, d: `${tag} · ${w.factoryName(po.factory_id)}${po.response_note ? `: "${po.response_note.slice(0, 80)}"` : ""}`, href: `/fpos/${po.id}`, who });
      } else if (po?.status === "issued" && daysBetween(isoIST(po.issued_at), t) >= 2) {
        out.push({ sev: "warn", t: `Factory hasn't accepted ${po.id}`, d: `${tag} · sent ${fmtDay(isoIST(po.issued_at))} to ${w.factoryName(po.factory_id)}. Call them.`, href: `/fpos/${po.id}`, who });
      }
      for (const st of o.styles) {
        const last = w.qcFor(st.id)[0];
        if (last && last.result !== "pass") {
          out.push({ sev: last.result === "fail" ? "bad" : "warn", t: `${QC_KIND_LABEL[last.kind]} QC ${last.result === "fail" ? "failed" : "on hold"}: ${st.name} (${st.colour})`,
            d: `${tag} · ${last.critical} critical, ${last.major} major, ${last.minor} minor · ${fmtDay(last.inspected_on)}`, href: `/qc/${last.id}`, who: [...who, last.inspector_id] });
        }
      }
    } else if (o.status === "tna_review") {
      out.push({
        sev: w.isOwner ? "bad" : "info",
        t: w.isOwner ? "Waiting for your TNA lock" : "Waiting for the owner to lock the TNA",
        d: `${tag} · the factory gets the final PO only after the lock`,
        href: `/orders/${o.id}`,
        who: w.isOwner ? [] : who,
      });
    }
  }
  if (pastBuyer) {
    out.push({ sev: "warn", t: `${pastBuyer} running order${pastBuyer === 1 ? " is" : "s are"} past the buyer date`, d: "Mark the shipped ones as shipped so alerts stay true.", href: "/cleanup#shipped", k: "" });
  }
  if (noTna) {
    out.push({ sev: "warn", t: `${noTna} running order${noTna === 1 ? " has" : "s have"} no TNA`, d: "Apply a TNA template so delays show up here.", href: "/cleanup#tna", k: "" });
  }
  for (const i of w.inquiries) {
    const open = i.status === "new" || i.status === "quoted";
    if (open && i.next_follow_up && i.next_follow_up <= t) {
      out.push({ sev: "warn", t: `Follow-up due: ${i.product_type} for ${w.buyerCode(i.buyer_id)}`, d: `${i.id} · ${i.merchandiser_id ? w.personName(i.merchandiser_id) : "unassigned"} · due ${fmtDay(i.next_follow_up)}`, href: `/inquiries?status=due`, k: i.next_follow_up, who: [i.merchandiser_id] });
    }
    if (i.status === "new" && !i.merchandiser_id) {
      out.push({ sev: "info", t: `Assign a merchandiser: ${i.id}`, d: `${i.product_type} for ${w.buyerCode(i.buyer_id)}`, href: `/inquiries?status=new` });
    }
  }
  for (const sm of w.samples) {
    const a = sampleAlert(sm, t, w.buyerCode(sm.buyer_id), w.factoryName(sm.factory_id));
    if (a) out.push({ ...a, href: `/samples/${sm.id}`, who: [sm.merchandiser_id] });
  }
  const rank = { bad: 0, warn: 1, info: 2, note: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev] || (a.k ?? "").localeCompare(b.k ?? ""));
}

// Alerts for one person: theirs, plus the ones nobody owns.
export const alertsFor = (alerts: Alert[], meId: string) =>
  alerts.filter((a) => !a.who?.some(Boolean) || a.who.includes(meId));

export function fmtDay(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// ───────── sales order editor ─────────
export type DraftCheckpoint = { id: string; name: string; due_date: string };
export type DraftStyle = {
  id: string; name: string; code: string; fabric: string; colour: string; use_sizes: boolean; sizes: Record<string, string>;
  qty: string; buyer_rate: string; factory_rate: string; internal_note: string; checkpoints: DraftCheckpoint[];
};
export type Draft = {
  id: string; status: SoStatus; inquiry_id: string | null; buyer_id: string; buyer_po_number: string; order_type: OrderType;
  currency: string; so_date: string; order_source: string; tags: string; factory_id: string; payment_terms: string;
  delivery_address: string; merchandiser_id: string; manager_id: string; fabric_poc_id: string; quality_poc_id: string;
  buyer_date: string; factory_date: string; merch_date: string; remarks: string; terms: string; styles: DraftStyle[];
};

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export function toDraft(o: Order): Draft {
  return {
    id: o.id, status: o.status, inquiry_id: o.inquiry_id, buyer_id: o.buyer_id, buyer_po_number: o.buyer_po_number,
    order_type: o.order_type, currency: o.currency, so_date: s(o.so_date), order_source: s(o.order_source), tags: o.tags.join(", "),
    factory_id: s(o.factory_id), payment_terms: s(o.payment_terms), delivery_address: s(o.delivery_address),
    merchandiser_id: s(o.merchandiser_id), manager_id: s(o.manager_id), fabric_poc_id: s(o.fabric_poc_id),
    quality_poc_id: s(o.quality_poc_id), buyer_date: s(o.buyer_date), factory_date: s(o.factory_date), merch_date: s(o.merch_date),
    remarks: s(o.remarks), terms: s(o.terms),
    styles: o.styles.map((st) => ({
      id: st.id, name: st.name, code: st.code, fabric: st.fabric, colour: st.colour, use_sizes: st.use_sizes,
      sizes: Object.fromEntries(SIZES.map((z) => [z, s(st.sizes?.[z])])),
      qty: st.qty ? String(st.qty) : "", buyer_rate: st.buyer_rate ? String(st.buyer_rate) : "", factory_rate: s(st.factory_rate),
      internal_note: s(st.internal_note),
      checkpoints: st.checkpoints.map((c) => ({ id: c.id, name: c.name, due_date: s(c.due_date) })),
    })),
  };
}

export const draftQty = (st: DraftStyle, type: OrderType) =>
  type === "garment" && st.use_sizes ? SIZES.reduce((a, z) => a + num(st.sizes[z]), 0) : num(st.qty);

export function toPayload(d: Draft) {
  return {
    ...d,
    tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
    styles: d.styles.map((st) => ({ ...st, use_sizes: d.order_type === "garment" && st.use_sizes })),
  };
}

export function validateDraft(p: Draft, today: string) {
  const E: string[] = [];
  const W: string[] = [];
  if (!p.buyer_id) E.push("Choose the customer (buyer code).");
  if (!p.buyer_po_number.trim()) E.push("Enter the buyer PO / reference number.");
  if (!p.so_date) E.push("Set the sales order date.");
  if (!p.factory_id) E.push("Choose a factory.");
  if (!p.payment_terms.trim()) E.push('Enter the payment terms, for example "45 days post-receipt".');
  if (!p.merchandiser_id) E.push("Choose the demand POC (merchandiser).");
  if (!p.manager_id) E.push("Choose the merchandiser manager (escalation point).");
  if (!p.buyer_date) E.push("Set the buyer delivery date.");
  else if (p.buyer_date <= today) E.push(`Buyer delivery date (${fmtDay(p.buyer_date)}) must be in the future.`);
  if (!p.factory_date) E.push("Set the factory delivery date.");
  else if (p.buyer_date && p.factory_date > p.buyer_date) E.push(`Factory delivery date (${fmtDay(p.factory_date)}) is after the buyer's deadline (${fmtDay(p.buyer_date)}).`);
  if (!p.merch_date) E.push("Set the merchandiser predicted date.");
  else if (p.factory_date && p.merch_date > p.factory_date) W.push(`Merchandiser predicted date (${fmtDay(p.merch_date)}) is later than the factory's commitment (${fmtDay(p.factory_date)}).`);
  if (!p.delivery_address.trim()) W.push("No delivery address. You'll need it for the delivery challan.");
  if (!p.styles.length) E.push("Add at least one style.");
  p.styles.forEach((st, i) => {
    const n = `Style ${i + 1}${st.name ? ` "${st.name}"` : ""}`;
    ([["name", "style name"], ["code", "style code"], ["fabric", "fabric type"], ["colour", "colour"]] as const).forEach(([k, l]) => {
      if (!st[k].trim()) E.push(`${n}: enter the ${l}.`);
    });
    if (draftQty(st, p.order_type) <= 0) E.push(`${n}: quantity must be more than 0.`);
    if (num(st.buyer_rate) <= 0) E.push(`${n}: rate must be more than 0.`);
    if (st.factory_rate && num(st.factory_rate) >= num(st.buyer_rate) && num(st.buyer_rate) > 0) {
      W.push(`${n}: factory rate is not below the buyer rate, so there's no margin.`);
    }
    if (!st.checkpoints.length) E.push(`${n}: add at least one TNA checkpoint.`);
    let prev: DraftCheckpoint | null = null;
    st.checkpoints.forEach((cp, j) => {
      if (!cp.name.trim()) E.push(`${n}: checkpoint ${j + 1} needs a name.`);
      if (!cp.due_date) E.push(`${n}: set a date for ${cp.name || "checkpoint " + (j + 1)}.`);
      else if (prev && cp.due_date < prev.due_date) E.push(`${n}: ${cp.name} (${fmtDay(cp.due_date)}) is before ${prev.name} (${fmtDay(prev.due_date)}).`);
      if (cp.due_date) prev = cp;
    });
    const last = st.checkpoints[st.checkpoints.length - 1];
    if (last?.due_date && p.factory_date && last.due_date > p.factory_date) W.push(`${n}: last checkpoint (${fmtDay(last.due_date)}) is after the factory delivery date.`);
  });
  return { E, W };
}

// <input type="datetime-local"> values, always in India time.
export function toLocalInput(iso: string | number) {
  const d = new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : "");
