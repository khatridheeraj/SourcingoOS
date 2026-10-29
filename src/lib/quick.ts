// Helpers behind the quick sheets: an order's steps per style, what to mark done, the plan to start production with,
// and the WhatsApp chase for a factory. Pure functions, used on the server and in the browser alike.
import { daysBetween, qtyTotal, qtyU, TNA_STEPS } from "@/lib/format";
export { emptySteps, startBuffer, startTargets } from "@/lib/tna-plan";

// factory_on: the factory's own date for the step, when it has sent one.
export type QStep = { key: string; label: string; planned_on: string; done_on: string; not_needed: boolean; extra: boolean; factory_on?: string };
// fabric: a fabric style, planned with the fabric standard days.
export type QStyle = { id: string; style: string; colour: string; qty: number; hasRate: boolean; hasPhoto?: boolean; factoryId: string | null; fabric?: boolean; steps: QStep[] };
export type QGroup = {
  factoryId: string | null; factoryName: string; phone: string | null; email: string | null;
  released: boolean; asked: boolean; sent: boolean; lockRequestedAt: string; lockNote: string; bufferDays: number | null;
  // What stops the owner approving a plan sent for approval, in the database's words ("" when nothing does).
  blocker?: string;
  styles: QStyle[];
};
export type QOrder = {
  id: string; orderNo: string; buyer: string; buyerPo: string; due: string; shipDate: string; status: string;
  today: string; isOwner: boolean; ownerName: string; companyId: string;
  // The buyer's PO is on file (from email or added by hand): a factory PO is issued only against it.
  hasBuyerPo: boolean;
  factories: { id: string; name: string; email: string | null }[];
  groups: QGroup[];
};

// An email the PO can be sent to.
export const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Open targets after the date a factory has to finish by (the ship date less the buffer), which stop the approval.
// `movable`: every one of them can simply go back to that date, because the factory's own date is on or before it.
export function pastTarget(styles: QStyle[], target: string) {
  const rows = styles.flatMap((s) => live(s).filter((x) => !x.done_on && !!x.planned_on && x.planned_on > target).map((x) => ({ style: s, step: x })));
  const labels = [...new Set(rows.map((r) => r.step.label))];
  const dates = [...new Set(rows.map((r) => r.step.planned_on))].sort();
  const movable = rows.length > 0 && rows.every((r) => !r.step.factory_on || r.step.factory_on <= target);
  return { rows, labels, dates, movable, styleCount: new Set(rows.map((r) => r.style.id)).size };
}

// "Final QC and Ex-factory" from a list of step names.
export const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// One style's line in a chase: the first late step, or what is next.
export function styleLine(s: QStyle, today: string) {
  const st = live(s);
  const over = st.filter((x) => !x.done_on && x.planned_on && x.planned_on < today);
  const next = st.find((x) => !x.done_on);
  return `• ${s.style}${s.colour ? ` (${s.colour})` : ""}, ${qtyU(s.qty, s.fabric ? "fabric" : null)}: `
    + (over.length ? `${over[0].label} was due ${dm(over[0].planned_on)}${over.length > 1 ? ` (+${over.length - 1} more late)` : ""}`
      : next ? `next ${next.label}${next.planned_on ? ` by ${dm(next.planned_on)}` : ""}` : "all steps done");
}

// Blank lines between parts, never two in a row.
const tidy = (xs: string[]) => xs.filter((x, i, a) => x !== "" || (i > 0 && (a[i - 1] ?? "") !== "")).join("\n").trim();

// The message asking a factory for today's status, listing what is late or next on each of its styles.
// The factory's own panel, where it marks steps done with photos, ends every chase when it has one.
export const panelLine = (link?: string) => (link ? `Mark each step done with photos here, no password needed:\n${link}` : "");

export function chaseText(orderNo: string, buyerPo: string, factoryName: string, styles: QStyle[], today: string, target: string, link?: string) {
  return tidy([
    `*${orderNo}${buyerPo ? ` · PO ${buyerPo}` : ""} · ${factoryName}*`,
    "Please share today's status and photos for these styles:",
    "",
    ...styles.map((s) => styleLine(s, today)),
    "",
    target ? `Everything must be ready by ${dm(target)}.` : "",
    "",
    panelLine(link),
  ]);
}

// One message to a factory covering every order it is behind on.
export function chaseAllText(factoryName: string, orders: { orderNo: string; buyerPo: string; target: string; styles: QStyle[] }[], today: string, link?: string) {
  if (orders.length === 1) return chaseText(orders[0].orderNo, orders[0].buyerPo, factoryName, orders[0].styles, today, orders[0].target, link);
  return tidy([
    `*${factoryName} · status needed today*`,
    "Please share today's status and photos for these orders:",
    ...orders.flatMap((o) => ["", `*${o.orderNo}${o.buyerPo ? ` · PO ${o.buyerPo}` : ""}*${o.target ? ` (ready by ${dm(o.target)})` : ""}`, ...o.styles.map((s) => styleLine(s, today))]),
    "",
    panelLine(link),
  ]);
}

// Where a style stands, as a buyer would want it: the last step done and what comes next. No factory names or dates
// the buyer doesn't need.
export function buyerStyleLine(s: QStyle, today: string, started: boolean) {
  const st = live(s);
  const head = `• ${s.style}${s.colour ? ` (${s.colour})` : ""}, ${qtyU(s.qty, s.fabric ? "fabric" : null)}: `;
  if (!started) return `${head}pre-production, plan being set with the factory`;
  const done = [...st].reverse().find((x) => x.done_on);
  const next = st.find((x) => !x.done_on);
  if (!next) return `${head}ready, all steps done`;
  return `${head}${done ? `${done.label} done` : "production started"} · next ${next.label}${next.planned_on && next.planned_on >= today ? ` (${dm(next.planned_on)})` : ""}`;
}

// A buyer's update on every open order: where each style is, and whether the order is on time.
export function buyerUpdateText(buyer: string, orders: { orderNo: string; buyerPo: string; due: string; started: boolean; late: boolean; styles: QStyle[] }[], today: string) {
  return tidy([
    `*${buyer} · order update, ${dm(today)}*`,
    ...orders.flatMap((o) => [
      "",
      `*${o.buyerPo ? `PO ${o.buyerPo}` : o.orderNo}*${o.due ? ` · ship date ${dm(o.due)}` : ""}${o.due && o.due < today ? " · delayed, new date to follow" : o.late ? " · a few steps behind, catching up" : o.started ? " · on track" : ""}`,
      ...(o.started ? o.styles.map((s) => buyerStyleLine(s, today, true))
        : [`• ${o.styles.map((s) => s.style).join(", ")} (${qtyTotal(o.styles.map((s) => ({ qty: s.qty, product: s.fabric ? "fabric" : null })))}): in pre-production`]),
    ]),
    "",
    "Please let us know if you need anything.",
  ]);
}

// A WhatsApp link to the factory's number (Indian numbers without the country code get +91), or to any chat.
export function waLink(phone: string | null | undefined, text: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits.length >= 11 ? digits.replace(/^0+/, "") : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
