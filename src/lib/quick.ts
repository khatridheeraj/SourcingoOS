// Helpers behind the quick sheets: an order's steps per style, what to mark done, the plan to start production with,
// and the WhatsApp chase for a factory. Pure functions, used on the server and in the browser alike.
import { daysBetween, TNA_STEPS } from "@/lib/format";
import { fillEmptyTargets } from "@/lib/tna-plan";

export type QStep = { key: string; label: string; planned_on: string; done_on: string; not_needed: boolean; extra: boolean };
export type QStyle = { id: string; style: string; colour: string; qty: number; hasRate: boolean; factoryId: string | null; steps: QStep[] };
export type QGroup = {
  factoryId: string | null; factoryName: string; phone: string | null;
  released: boolean; asked: boolean; sent: boolean; lockRequestedAt: string; lockNote: string; bufferDays: number | null;
  styles: QStyle[];
};
export type QOrder = {
  id: string; orderNo: string; buyer: string; buyerPo: string; due: string; shipDate: string; status: string;
  today: string; isOwner: boolean; ownerName: string;
  factories: { id: string; name: string }[];
  groups: QGroup[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "10 Sep" from YYYY-MM-DD.
export const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// A style's steps that count, in order (standard ones, then its extra steps).
export const live = (s: QStyle) => s.steps.filter((x) => !x.not_needed);
export const nextStep = (s: QStyle) => live(s).find((x) => !x.done_on) ?? null;

// How a step stands today, in a few words.
export function when(planned: string, today: string): { text: string; cls: "bad" | "warn" | "" } {
  if (!planned) return { text: "No target", cls: "" };
  const n = daysBetween(today, planned);
  if (n < 0) return { text: `${plural(-n, "day")} late`, cls: "bad" };
  if (n === 0) return { text: "Due today", cls: "warn" };
  if (n === 1) return { text: "Due tomorrow", cls: "warn" };
  return { text: `Due ${dm(planned)}`, cls: n <= 3 ? "warn" : "" };
}

// Styles of released factory POs grouped by the step each is on next, earliest target first.
export function byNextStep(groups: QGroup[]) {
  const out: { key: string; label: string; planned: string; styles: QStyle[] }[] = [];
  for (const s of groups.filter((g) => g.released).flatMap((g) => g.styles)) {
    const n = nextStep(s);
    if (!n) continue;
    let g = out.find((x) => x.key === n.key);
    if (!g) out.push(g = { key: n.key, label: n.label, planned: n.planned_on, styles: [] });
    if (n.planned_on && (!g.planned || n.planned_on < g.planned)) g.planned = n.planned_on;
    g.styles.push(s);
  }
  const at = (k: string) => { const i = TNA_STEPS.findIndex((t) => t.key === k); return i < 0 ? 99 : i; };
  return out.sort((a, b) => (a.planned || "9999").localeCompare(b.planned || "9999") || at(a.key) - at(b.key));
}

// The steps every chosen style shares, for "where are they now?": standard steps, plus extras by name.
export function sharedSteps(styles: QStyle[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const s of styles) for (const x of live(s)) if (!seen.has(x.extra ? `x:${x.label.toLowerCase()}` : x.key)) seen.set(x.extra ? `x:${x.label.toLowerCase()}` : x.key, x.label);
  return [...seen.entries()].map(([key, label]) => ({ key, label }));
}

// Done date for a step finished some time ago: its target if that has passed, else today.
export const caughtUpOn = (planned: string, today: string) => (planned && planned <= today ? planned : today);

// Rows that mark every step up to and including `upTo` done on the chosen styles (steps already done are kept).
export function catchUpRows(styles: QStyle[], upTo: string, today: string, onTarget: boolean) {
  return styles.flatMap((s) => {
    const steps = live(s);
    const i = steps.findIndex((x) => (upTo.startsWith("x:") ? x.extra && `x:${x.label.toLowerCase()}` === upTo : x.key === upTo));
    if (i < 0) return [];
    return steps.slice(0, i + 1).filter((x) => !x.done_on).map((x) => ({
      line_id: s.id, stage: x.key, planned_on: x.planned_on, done_on: onTarget ? caughtUpOn(x.planned_on, today) : today, not_needed: false,
      ...(x.extra ? { label: x.label } : {}),
      was: { planned_on: x.planned_on, done_on: x.done_on, not_needed: x.not_needed },
    }));
  });
}

// Targets for a factory's styles, ready to start production: empty ones filled from the standard days, and any
// open target that is already past or after the target date moved into the days that are left. Done steps stay.
// Returns the changes only, per style.
export function startTargets(styles: QStyle[], target: string, today: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of styles) {
    const std = TNA_STEPS.map((t) => s.steps.find((x) => x.key === t.key) ?? { key: t.key, label: t.label, planned_on: "", done_on: "", not_needed: false, extra: false })
      .filter((x) => !x.not_needed);
    const keep = (x: QStep) => !!x.done_on || (!!x.planned_on && x.planned_on >= today && x.planned_on <= target);
    const plan = fillEmptyTargets(std.map((x) => ({ stage: x.key, on: keep(x) ? x.planned_on || x.done_on : null })), target, today);
    const changes: Record<string, string> = {};
    for (const x of std) if (plan[x.key] && plan[x.key] !== x.planned_on) changes[x.key] = plan[x.key];
    // Extra steps have no standard days: one without a usable target goes on the target date.
    for (const x of s.steps.filter((y) => y.extra && !y.not_needed && !keep(y))) changes[x.key] = target;
    out[s.id] = changes;
  }
  return out;
}

// The message asking a factory for today's status, listing what is late or next on each of its styles.
export function chaseText(orderNo: string, buyerPo: string, factoryName: string, styles: QStyle[], today: string, target: string) {
  const lines = styles.map((s) => {
    const st = live(s);
    const over = st.filter((x) => !x.done_on && x.planned_on && x.planned_on < today);
    const next = st.find((x) => !x.done_on);
    return `• ${s.style}${s.colour ? ` (${s.colour})` : ""}, ${s.qty} pcs: `
      + (over.length ? `${over[0].label} was due ${dm(over[0].planned_on)}${over.length > 1 ? ` (+${over.length - 1} more late)` : ""}`
        : next ? `next ${next.label}${next.planned_on ? ` by ${dm(next.planned_on)}` : ""}` : "all steps done");
  });
  return [
    `*${orderNo}${buyerPo ? ` · PO ${buyerPo}` : ""} · ${factoryName}*`,
    "Please share today's status and photos for these styles:",
    "",
    ...lines,
    target ? `\nEverything must be ready by ${dm(target)}.` : "",
  ].filter((x, i, a) => x !== "" || (a[i - 1] ?? "") !== "").join("\n");
}

// A WhatsApp link to the factory's number (Indian numbers without the country code get +91), or to any chat.
export function waLink(phone: string | null | undefined, text: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits.length >= 11 ? digits.replace(/^0+/, "") : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
