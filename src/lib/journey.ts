// Where an order is on its way from buyer PO to shipped, and the one thing to do next.
// The order page, the orders list and its pipeline all read this, so every screen names the same next step.
import { dayNear } from "./format.ts";

export type StageKey = "factory" | "plan" | "approve" | "make" | "qc" | "ship" | "done";

export const STAGES: { key: Exclude<StageKey, "done">; label: string; hint: string }[] = [
  { key: "factory", label: "Factory", hint: "Buyer PO on file, factory and rate for every style" },
  { key: "plan", label: "Plan", hint: "Targets for every step, then the factory PO goes for approval" },
  { key: "approve", label: "PO", hint: "The owner approves the factory PO and it goes to the factory" },
  { key: "make", label: "Make", hint: "Samples and production, step by step" },
  { key: "qc", label: "Final QC", hint: "Every style passes its final QC" },
  { key: "ship", label: "Ship", hint: "Factory bill, our invoice, transport, then shipped" },
];

export type Action =
  | { kind: "start"; factoryId: string }
  | { kind: "update" }
  // Quality's factory visit: post each style's step from the floor, with photos.
  | { kind: "visit" }
  | { kind: "review" }
  | { kind: "samples" }
  | { kind: "po" }
  | { kind: "date" }
  | { kind: "qc" }
  | { kind: "dispatch" }
  | { kind: "ship" }
  | { kind: "none" };

export type Next = { title: string; detail: string; action: Action; label: string; tone: "bad" | "warn" | "info" | "ok"; who?: string };

export type JourneyInput = {
  status: string;
  role: string | null | undefined;
  // One entry per style.
  lines: { factoryId: string | null; hasRate: boolean }[];
  // One entry per factory on the order.
  groups: { factoryId: string | null; released: boolean; lockRequested: boolean }[];
  // null when this person can't see the buyer's PO files.
  hasBuyerPo: boolean | null;
  // Every step of every style still needed.
  steps: { stage: string; planned: string | null; done: string | null }[];
  // Every style has its Packed step done.
  packedAll: boolean;
  finalPassed: boolean;
  samplesToAct: number;
  pendingUpdates: number;
  dispatch: { count: number; uninvoiced: number; unshipped: number; billedAll: boolean } | null;
  shipBlocker?: string | null;
  // The date the order ships by: the new ship date when it moved, else the buyer's.
  due?: string | null;
  // Days the latest style will likely miss the ship date by (late steps push later ones back). When it is known
  // and 0, steps past their target are paperwork to catch up on, not a late order, so they show amber, not red.
  riskDays?: number;
  today: string;
};

export type Journey = { stage: StageKey; next: Next; done: number; total: number; overdue: number; nextStep: { label: string; planned: string | null } | null };

const STEP_LABEL: Record<string, string> = {
  greige: "Greige", fit_sample: "Fit sample", fabric: "Fabric", printing: "Printing / dyeing", strike_off: "Strike off", pp_sample: "PP sample",
  size_set: "Size set", cutting: "Cutting", stitching: "Stitching", inline: "Inline", midline: "Mid-line", finishing: "Finishing", packed: "Packed",
  final_qc: "Final QC", ex_factory: "Ex-factory",
};
const ORDER = Object.keys(STEP_LABEL);
// "12 Sep", with the year when it isn't this year's ("12 Sep 2025"), so a very old order doesn't read as recent.
const dm = (d: string, today: string) => dayNear(d, today);

export function journey(j: JourneyInput): Journey {
  const r = route(j);
  // Past its ship date and not yet packed: the date everyone plans by is wrong. Until the orders team agrees a new
  // one with the buyer and the factory, that is the next step, whatever stage the order is at.
  const late = j.due && j.due < j.today ? Math.round((Date.parse(j.today) - Date.parse(j.due)) / 86_400_000) : 0;
  if (late > 0 && j.role !== "quality" && ["factory", "plan", "approve", "make"].includes(r.stage)) {
    return { ...r, next: {
      title: `${late} ${late === 1 ? "day" : "days"} past the ship date`,
      detail: `It was due ${dm(j.due!, j.today)}. Agree a new ship date with the buyer and the factory, and say why it moved, so everyone works to the real date.`,
      action: { kind: "date" }, label: "Set new ship date", tone: "bad",
    } };
  }
  return r;
}

function route(j: JourneyInput): Journey {
  const team = j.role !== "quality";
  const owner = j.role === "owner";
  const qcRole = j.role === "owner" || j.role === "quality";
  const total = j.steps.length;
  const done = j.steps.filter((s) => s.done).length;
  const overdue = j.steps.filter((s) => !s.done && s.planned && s.planned < j.today).length;
  // The earliest step still open, by target date and then by its place in the TNA.
  const open = j.steps.filter((s) => !s.done).sort((a, b) => (a.planned ?? "9999").localeCompare(b.planned ?? "9999") || ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));
  const first = open[0];
  const nextStep = first ? { label: STEP_LABEL[first.stage] ?? "Extra step", planned: first.planned } : null;
  const base = { done, total, overdue, nextStep };
  const wait = (title: string, detail: string, who?: string): Next => ({ title, detail, action: { kind: "none" }, label: "", tone: "info", who });

  if (j.status !== "open") {
    return { ...base, stage: "done", next: { title: j.status === "shipped" ? "Shipped" : "Cancelled", detail: j.status === "shipped" ? "Nothing more to do on this order." : "This order was cancelled.", action: { kind: "none" }, label: "", tone: "ok" } };
  }

  const firstWaiting = j.groups.find((g) => !g.released && !g.lockRequested);
  // 1. Factory: every style needs a factory and a factory rate.
  const noFactory = j.lines.filter((l) => !l.factoryId).length;
  const noRate = j.lines.filter((l) => l.factoryId && !l.hasRate).length;
  if (noFactory || (team && noRate && j.groups.some((g) => !g.released))) {
    return { ...base, stage: "factory", next: team ? {
      title: noFactory ? `Pick the factory for ${noFactory === j.lines.length ? "this order" : `${noFactory} ${noFactory === 1 ? "style" : "styles"}`}` : `Add the factory rate for ${noRate} ${noRate === 1 ? "style" : "styles"}`,
      detail: "Start production asks for the factory and rate, fills the plan from the ship date and sends the PO for approval, all in one go.",
      action: { kind: "start", factoryId: firstWaiting?.factoryId ?? "" }, label: "Start production", tone: "warn",
    } : wait("Waiting for the orders team", "The orders team is choosing the factory.") };
  }

  // 2. Plan and send the factory PO for approval. It needs the buyer's PO on file first.
  if (firstWaiting) {
    if (team && j.hasBuyerPo === false) {
      return { ...base, stage: "plan", next: {
        title: "Add the buyer's PO", detail: "A factory PO goes out only against the buyer's PO. Add its PDF or photo, then start production.",
        action: { kind: "po" }, label: "Add buyer PO", tone: "warn",
      } };
    }
    return { ...base, stage: "plan", next: team ? {
      title: "Start production", detail: "One sheet: the plan fills itself from the ship date, you check it, and the factory PO goes to the owner for approval.",
      action: { kind: "start", factoryId: firstWaiting.factoryId ?? "" }, label: "Start production", tone: "warn",
    } : wait("Plan not set yet", "The orders team sets the plan and releases the factory PO.") };
  }

  // 3. The owner approves; the PO is then emailed to the factory.
  const awaiting = j.groups.find((g) => !g.released && g.lockRequested);
  if (awaiting) {
    if (owner && j.hasBuyerPo === false) {
      return { ...base, stage: "approve", next: {
        title: "Add the buyer's PO to approve", detail: "This factory PO is waiting for you, but a factory PO goes out only against the buyer's PO. Add its file first.",
        action: { kind: "po" }, label: "Add buyer PO", tone: "warn",
      } };
    }
    return { ...base, stage: "approve", next: owner ? {
      title: "Approve the factory PO", detail: "Check the plan and rates. Approving locks the plan and emails the PO to the factory.",
      action: { kind: "start", factoryId: awaiting.factoryId ?? "" }, label: "Check and approve", tone: "warn",
    } : wait("Waiting for the owner's approval", "The factory PO is with the owner. Once approved, it is emailed to the factory and production starts.", "Owner") };
  }

  // Goods already went out (old orders, part shipments): what's left is shipping the rest or closing short,
  // not chasing production steps or a final QC nobody will record now.
  const sent = !!j.dispatch && j.dispatch.count - j.dispatch.unshipped > 0;

  // 4. Production, with samples and factory updates first when they are waiting.
  if (!j.packedAll && !sent) {
    if (j.pendingUpdates > 0) {
      return { ...base, stage: "make", next: { title: `Confirm ${j.pendingUpdates} ${j.pendingUpdates === 1 ? "update" : "updates"} from the factory`, detail: "The factory marked steps done with photos. Check them and confirm.", action: { kind: "review" }, label: "Review updates", tone: "info" } };
    }
    if (team && j.samplesToAct > 0) {
      return { ...base, stage: "make", next: { title: `Check ${j.samplesToAct} ${j.samplesToAct === 1 ? "sample" : "samples"} from the factory`, detail: "Look at the photos, then send it on to the buyer or back to the factory.", action: { kind: "samples" }, label: "Open samples", tone: "info" } };
    }
    const late = overdue > 0;
    // Past target but the ship date still holds: most likely done and not marked yet, so ask for an update in amber.
    const catchUp = late && j.riskDays === 0;
    const risk = j.riskDays ?? 0;
    // Quality owns the updates from the floor (Dheeraj, 26 Oct 2026): it visits the factory and posts every step.
    if (!team) {
      return { ...base, stage: "make", next: {
        title: late ? `${overdue} ${overdue === 1 ? "step needs" : "steps need"} an update from the floor` : nextStep ? `Next: ${nextStep.label}${nextStep.planned ? ` by ${dm(nextStep.planned, j.today)}` : ""}` : "In production",
        detail: `Visit the factory and post each style's step with photos: done, on track, running late or a problem. ${done} of ${total} steps done.`,
        action: { kind: "visit" }, label: "Post update", tone: late ? (catchUp ? "warn" : "bad") : "info",
      } };
    }
    return { ...base, stage: "make", next: {
      title: catchUp ? `${overdue} ${overdue === 1 ? "step needs" : "steps need"} an update`
        : late ? `${overdue} ${overdue === 1 ? "step is" : "steps are"} past target` : nextStep ? `Next: ${nextStep.label}${nextStep.planned ? ` by ${dm(nextStep.planned, j.today)}` : ""}` : "In production",
      detail: catchUp ? `Their targets have passed with no Done date. Mark what's done, and give the rest a new target. The ship date still holds. ${done} of ${total} steps done.`
        : late ? `Mark what's done, or chase the factory for the rest.${risk > 0 ? ` At this pace it ships about ${risk} ${risk === 1 ? "day" : "days"} late.` : ""} ${done} of ${total} steps done.`
        : `${done} of ${total} steps done. Mark steps done as the factory finishes them.`,
      action: { kind: "update" }, label: "Update progress", tone: catchUp ? "warn" : late ? "bad" : "info",
    } };
  }

  // 5. Final QC on every style.
  if (!j.finalPassed && !sent) {
    return { ...base, stage: "qc", next: qcRole ? {
      title: "Record the final QC", detail: "Every style needs a passed final QC before it ships.", action: { kind: "qc" }, label: "Record QC", tone: "warn",
    } : { title: "Final QC due", detail: "Packed. Quality records the final QC for each style before it ships.", action: { kind: "qc" }, label: "See QC", tone: "warn", who: "Quality" } };
  }

  // 6. Dispatch: factory bill, our invoice, transport, then shipped.
  if (!team) return { ...base, stage: "ship", next: wait("Ready to ship", "Final QC passed. The orders team handles the bills and transport.") };
  const d = j.dispatch;
  if (!d || d.count === 0) {
    return { ...base, stage: "ship", next: { title: "Record the factory's bill", detail: "Final QC passed. Add the factory's purchase bill in Dispatch: it is matched with Tally.", action: { kind: "dispatch" }, label: "Open dispatch", tone: "warn" } };
  }
  if (d.uninvoiced > 0) {
    return { ...base, stage: "ship", next: { title: "Add our invoice", detail: "The factory bill is in. Add our sales invoice and e-way bill (both come from Tally).", action: { kind: "dispatch" }, label: "Open dispatch", tone: "warn" } };
  }
  if (d.unshipped > 0) {
    return { ...base, stage: "ship", next: { title: "Add transport and send it", detail: "Invoiced. Add the transporter and LR, then mark the goods sent.", action: { kind: "dispatch" }, label: "Open dispatch", tone: "warn" } };
  }
  return { ...base, stage: "ship", next: {
    title: d.billedAll ? "Mark the order shipped" : "Ship the rest, or close short",
    detail: d.billedAll ? "Everything is billed and sent. Close the order." : "Part of the order has gone. Ship the rest from Dispatch, or close it short with a reason.",
    action: d.billedAll ? { kind: "ship" } : { kind: "dispatch" }, label: d.billedAll ? "Mark shipped" : "Open dispatch", tone: "ok",
  } };
}

export const stageIndex = (k: StageKey) => (k === "done" ? STAGES.length : STAGES.findIndex((s) => s.key === k));

// How long until an order ships, said the way people count it: "12 days to ship", "Ships today", "5 days late".
export type Clock = { n: string; unit: string; tone: "bad" | "warn" | "ok" | "calm" | "muted" };
export function shipClock(due: string | null, today: string, status: string): Clock {
  if (status === "shipped") return { n: "✓", unit: "Shipped", tone: "ok" };
  if (status === "cancelled") return { n: "–", unit: "Cancelled", tone: "muted" };
  if (!due) return { n: "–", unit: "No ship date", tone: "muted" };
  const d = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  if (d < 0) return { n: String(-d), unit: -d === 1 ? "day late" : "days late", tone: "bad" };
  if (d === 0) return { n: "0", unit: "Ships today", tone: "warn" };
  return { n: String(d), unit: d === 1 ? "day to ship" : "days to ship", tone: d <= 7 ? "warn" : "calm" };
}

// The part of an order page each stage's work lives in.
export function areaOf(stage: StageKey, canEdit: boolean): string {
  if (stage === "factory") return canEdit ? "details" : "tna";
  if (stage === "qc") return "qc";
  if (stage === "ship" || stage === "done") return canEdit ? "dispatch" : "qc";
  return "tna";
}
