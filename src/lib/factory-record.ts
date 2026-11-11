// A factory's record: trust it earns from its real orders with Sourcingo, not a badge it buys.
// The database counts what happened (supabase/migrations/0094_factory_record.sql); this file turns the counts into
// the few numbers and words every screen shows, so the team, the factory and the buyer all read the same record.

export type Cert = { name: string; until: string | null };
export type Verified = { id?: string; visited_on: string; gst_ok: boolean; udyam_no?: string | null; certs: Cert[] };
export type RecordFacts = {
  factory_id?: string; name?: string; city: string | null;
  orders: number; pieces_ordered?: number; since: string | null;
  steps_finished: number; steps_on_time: number; steps_overdue: number;
  final_firsts: number; final_first_pass: number;
  pieces_checked?: number; defects?: number;
  shipments: number; shipments_dated: number; shipments_on_time: number; pieces_shipped: number;
  claims?: number; claim_amount?: number; date_asks?: number; accept_hours?: number | null;
  verified: Verified | null;
};

// Below these, a percentage says more about luck than about the factory, so it is not shown.
export const MIN_STEPS = 8;
export const MIN_CHECKS = 3;
export const MIN_SHIPMENTS = 2;
// A visit counts as current for a year; a certificate is "running out" in its last 60 days.
export const VISIT_DAYS = 365;
export const CERT_SOON_DAYS = 60;

export type Level = "new" | "strong" | "steady" | "watch";
export type CertState = Cert & { state: "ok" | "soon" | "expired" };
export type FactoryRecord = {
  onTime: number | null;      // % of steps finished by their target (open steps past target count as late)
  firstPass: number | null;   // % of styles that passed their first Final QC
  shipOnTime: number | null;  // % of shipments that left by the buyer's ship date
  defectRate: number | null;  // defects per 100 pieces checked at Final QC, one decimal
  askRate: number | null;     // % of steps the factory asked to move
  level: Level;
  watch: string[];            // why the team should watch this factory, in plain words
  visit: { on: string; current: boolean; dueOn: string; gst: boolean; udyam: string | null } | null;
  certs: CertState[];
};

const pct = (n: number, of: number) => Math.round((n / of) * 100);
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export function factoryRecord(f: RecordFacts, today: string): FactoryRecord {
  const stepsCounted = f.steps_finished + f.steps_overdue;
  const onTime = stepsCounted >= MIN_STEPS ? pct(f.steps_on_time, stepsCounted) : null;
  const firstPass = f.final_firsts >= MIN_CHECKS ? pct(f.final_first_pass, f.final_firsts) : null;
  const shipOnTime = f.shipments_dated >= MIN_SHIPMENTS ? pct(f.shipments_on_time, f.shipments_dated) : null;
  const checked = f.pieces_checked ?? 0;
  const defectRate = checked >= 100 ? Math.round(((f.defects ?? 0) / checked) * 1000) / 10 : null;
  const askRate = stepsCounted >= MIN_STEPS && f.date_asks != null ? pct(f.date_asks, stepsCounted) : null;

  const watch: string[] = [];
  if (onTime != null && onTime < 70) watch.push(`Only ${onTime}% of steps on time`);
  if (firstPass != null && firstPass < 75) watch.push(`Only ${firstPass}% passed Final QC first time`);
  if (shipOnTime != null && shipOnTime < 80) watch.push(`${100 - shipOnTime}% of shipments left after the ship date`);
  if ((f.claims ?? 0) >= 2) watch.push(`${f.claims} claims raised`);

  const known = onTime != null || firstPass != null;
  const level: Level = !known ? "new" : watch.length ? "watch"
    : (onTime ?? 0) >= 85 && (firstPass ?? 0) >= 85 && !(f.claims ?? 0) ? "strong" : "steady";

  const v = f.verified;
  const dueOn = v ? addDays(v.visited_on, VISIT_DAYS) : "";
  const visit = v ? { on: v.visited_on, current: dueOn > today, dueOn, gst: v.gst_ok, udyam: v.udyam_no ?? null } : null;
  const soon = addDays(today, CERT_SOON_DAYS);
  const certs: CertState[] = (v?.certs ?? []).map((c) => ({ ...c, state: !c.until ? "ok" : c.until < today ? "expired" : c.until <= soon ? "soon" : "ok" }));
  return { onTime, firstPass, shipOnTime, defectRate, askRate, level, watch, visit, certs };
}

export const LEVEL_WORDS: Record<Level, string> = { new: "New with us", strong: "Strong record", steady: "Steady record", watch: "Watch" };

// The record in one line, for a list row or a quote ("92% on time · 89% first-time QC · 18 orders").
export function recordLine(f: RecordFacts, r: FactoryRecord): string {
  const bits = [
    r.onTime != null ? `${r.onTime}% on time` : "",
    r.firstPass != null ? `${r.firstPass}% first-time QC` : "",
    f.orders ? `${f.orders} ${f.orders === 1 ? "order" : "orders"}` : "",
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "No finished work with us yet";
}

// What the buyer reads under a PO: who makes it (by city, never by name) and how reliably that factory delivers.
// A measure reaches the buyer only at BUYER_SHOWS or better: a weak number is ours to fix with the factory, not the
// buyer's worry, and Sourcingo answers for the order either way. Nothing is said when we have neither a current visit
// nor a measure to show: an empty claim helps no one.
export const BUYER_SHOWS = 80;
export function buyerLine(f: RecordFacts, r: FactoryRecord): string | null {
  const who = `${r.visit?.current ? "a factory verified by Sourcingo" : "a factory"}${f.city ? ` in ${f.city}` : ""}`;
  const good = (n: number | null): n is number => n != null && n >= BUYER_SHOWS;
  const proof = [
    good(r.onTime) ? `${r.onTime}% of steps on time` : "",
    good(r.firstPass) ? `${r.firstPass}% passed final QC first time` : "",
    good(r.shipOnTime) ? `${r.shipOnTime}% shipped by the date` : "",
  ].filter(Boolean);
  if (!r.visit?.current && !proof.length) return null;
  const across = proof.length && f.orders > 1 ? ` across ${f.orders} orders` : "";
  return `Made by ${who}${proof.length ? ` · ${proof.join(" · ")}${across}` : ""}`;
}
