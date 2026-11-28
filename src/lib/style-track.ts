// Orders tracked style by style. A PO's styles are often made at different factories and move at different speeds,
// so each style gets its own stage and next step from journey(), worked out from that style alone: a style still
// waiting for a factory no longer holds back the ones already being made, and a late style is not hidden behind the
// order's earliest stage. The order page, Orders > By style and the factory view all read this.
import { journey, STAGES, type Journey, type StageKey } from "./journey.ts";
import { dayNear } from "./format.ts";
import { project, shipRisk } from "./tna-plan.ts";

export type TrackStep = { line_id: string; stage: string; planned_on: string | null; done_on: string | null; not_needed?: boolean | null };
export type TrackShip = { line_id: string; ordered: number; bought: number; billed: number; shipped: number };

export type TrackStyle = {
  id: string;
  style: string;
  factoryId: string | null;
  hasRate: boolean;
  // The style's own ship date, when it ships apart from the PO.
  shipDate?: string | null;
};

export type TrackOrder = {
  status: string;
  // The PO's ship date (the new one when it moved).
  due: string | null;
  // The factory POs on the order, by factory.
  pos: { factoryId: string; released: boolean; lockRequested: boolean }[];
  hasBuyerPo: boolean | null;
  // The order as a whole reached Packed (old orders tracked before styles had steps).
  packedAll?: boolean;
  closedShort?: boolean;
};

export type TrackFacts = {
  role: string | null | undefined;
  today: string;
  steps: TrackStep[];
  // Latest final QC result per style.
  finalQc: Map<string, string>;
  ship: TrackShip[];
  // Samples with the team and factory updates waiting, per style.
  samples?: Map<string, number>;
  updates?: Map<string, number>;
  // Whether this person sees dispatch (bills and invoices).
  dispatch: boolean;
};

export type StyleState = { id: string; style: string; factoryId: string | null; due: string | null; j: Journey };

// A style's ship date: its own when set, else the PO's.
export const styleDue = (s: Pick<TrackStyle, "shipDate">, orderDue: string | null) => s.shipDate || orderDue;

export function styleJourney(s: TrackStyle, o: TrackOrder, f: TrackFacts): Journey {
  const steps = f.steps.filter((r) => r.line_id === s.id && !r.not_needed);
  const po = s.factoryId ? o.pos.find((p) => p.factoryId === s.factoryId) : undefined;
  const sh = f.ship.find((r) => r.line_id === s.id);
  const sent = !!sh && sh.shipped > 0;
  const due = styleDue(s, o.due);
  const j = journey({
    status: o.status, role: f.role,
    lines: [{ factoryId: s.factoryId, hasRate: s.hasRate }],
    groups: [{ factoryId: s.factoryId, released: !!po?.released, lockRequested: !!po?.lockRequested }],
    hasBuyerPo: o.hasBuyerPo,
    steps: steps.map((r) => ({ stage: r.stage, planned: r.planned_on, done: r.done_on })),
    packedAll: !!o.packedAll || steps.some((r) => r.stage === "packed" && r.done_on),
    finalPassed: f.finalQc.get(s.id) === "pass",
    samplesToAct: f.samples?.get(s.id) ?? 0,
    pendingUpdates: f.updates?.get(s.id) ?? 0,
    // This style's own share of the bills: bought from the factory, invoiced by us, sent.
    dispatch: f.dispatch && sh ? {
      count: sh.bought > 0 ? 1 : 0,
      uninvoiced: sh.bought > sh.billed ? 1 : 0,
      unshipped: sh.billed > sh.shipped ? 1 : 0,
      billedAll: !!o.closedShort || sh.billed >= sh.ordered,
    } : f.dispatch ? { count: 0, uninvoiced: 0, unshipped: 0, billedAll: !!o.closedShort } : null,
    shipped: { any: sent, all: !!sh && sh.shipped > 0 && sh.shipped >= sh.ordered },
    due,
    // Will it miss its ship date at this pace? A step past target while the date still holds is an update to make (amber),
    // as the style's own card on the order says.
    riskDays: (() => { const r = shipRisk(project(steps.map((x) => ({ stage: x.stage, planned_on: x.planned_on, done_on: x.done_on })), f.today), due); return r.level === "risk" ? r.daysLate : 0; })(),
    today: f.today,
  });
  // Said of one style, not the whole order.
  if (j.stage === "factory" && j.next.action.kind === "start") {
    return { ...j, next: { ...j.next, title: s.factoryId ? "Add the factory rate" : "Pick a factory", label: s.factoryId ? "Add rate" : "Pick factory",
      detail: s.factoryId ? "The factory PO needs this style's rate." : "Choose who makes this style. The rest of the order carries on meanwhile." } };
  }
  // Late steps on one style: name the step and its day, which says more than a count.
  if (j.stage === "make" && j.overdue > 0 && j.nextStep?.planned && j.next.action.kind !== "review" && j.next.action.kind !== "samples") {
    const more = j.overdue > 1 ? `, ${j.overdue - 1} more after it` : "";
    return { ...j, next: { ...j.next, title: `${j.nextStep.label} ${j.next.tone === "bad" ? "was due" : "needs an update, due"} ${dayNear(j.nextStep.planned, f.today)}${more}` } };
  }
  return j;
}

export function styleStates(styles: TrackStyle[], o: TrackOrder, f: TrackFacts): StyleState[] {
  return styles.map((s) => ({ id: s.id, style: s.style, factoryId: s.factoryId, due: styleDue(s, o.due), j: styleJourney(s, o, f) }));
}

const TONE: Record<string, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
const at = (k: StageKey) => (k === "done" ? STAGES.length : STAGES.findIndex((x) => x.key === k));
// Most urgent first: red, then amber, then the rest; something to do before waiting on someone; then the earlier stage.
export function byUrgency(a: Journey, b: Journey) {
  return (TONE[a.next.tone] - TONE[b.next.tone])
    || (Number(a.next.action.kind === "none") - Number(b.next.action.kind === "none"))
    || (at(a.stage) - at(b.stage));
}

// The order's one next step, now that each style has its own. The order-level step stands when it is red (the PO's
// ship date has passed) or when no style is behind. Otherwise a style that is behind comes first, so a late style at
// one factory is never hidden behind another style still waiting for its factory.
export function orderFromStyles(order: Journey, styles: StyleState[]): Journey {
  if (order.stage === "done" || order.next.tone === "bad" || styles.length < 2) return order;
  const behind = styles.filter((s) => s.j.next.tone === "bad").sort((a, b) => byUrgency(a.j, b.j));
  if (!behind.length) return order;
  const w = behind[0];
  const names = behind.map((s) => s.style);
  const next = behind.length === 1
    ? { ...w.j.next, title: `${w.style}: ${lower(w.j.next.title)}` }
    : { ...w.j.next, title: `${behind.length} styles are behind`, detail: `${list(names)}. ${w.j.next.detail}` };
  return { ...order, stage: w.j.stage, next };
}

// How many styles are where, for the order's top line: late, waiting on a factory, on track, passed final QC.
export function styleCounts(styles: StyleState[]) {
  return {
    late: styles.filter((s) => s.j.next.tone === "bad").length,
    noFactory: styles.filter((s) => !s.factoryId).length,
    attention: styles.filter((s) => s.factoryId && s.j.next.tone === "warn").length,
    passed: styles.filter((s) => s.j.stage === "ship" || s.j.stage === "done").length,
  };
}

const lower = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const list = (xs: string[]) => (xs.length <= 3 ? xs.join(", ") : `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more`);
