// The weekly buyer update: what moved on a buyer's orders since the last update, in the buyer's words.
// Built from exactly what the buyer's own page already shows (its orders, approved step photos, final QC,
// shipments and invoices), so the update can never tell a buyer something its page doesn't.
// Inside targets are not deadlines for the buyer: a passed target is never called late here. The ship date is the
// buyer's own deadline, so once it passes the update says so plainly, until the team sets a new date (28 Nov, Dheeraj).

import { dayNear } from "./format.ts";

export type WeekStep = { stage: string; label: string | null; planned_on: string | null; done_on: string | null };
export type WeekLine = {
  id: string; style: string; colour: string | null; qty: number; product?: string;
  steps: WeekStep[]; final_qc: { result: string; checked_on: string; pieces_checked: number | null } | null;
};
export type WeekOrder = {
  id: string; order_no: string; buyer_po: string | null; status: string;
  ship_date: string | null; revised_ship_date: string | null; lines: WeekLine[];
};
export type WeekShipment = { order_id: string; shipped_on: string; pieces: number; cartons: number | null; received_on: string | null };
export type WeekPhoto = { order_id: string; line_id: string; stage: string; done_on: string; photos: string[] };
export type WeekInvoice = { invoice_no: string; due: string | null; left: number; po: string | null };

export type OrderWeek = {
  id: string; po: string; ref: string; shipped: boolean;
  ship: string | null; daysLeft: number | null; pct: number; unit: string;
  done: { style: string; step: string; on: string }[];
  qc: { style: string; pass: boolean; on: string; pieces: number | null }[];
  sent: { on: string; pieces: number; cartons: number | null }[];
  photos: { style: string; step: string; paths: string[] }[];
  next: { style: string; step: string; by: string }[];
};
export type BuyerWeek = {
  since: string; today: string; weekOf: string;
  orders: OrderWeek[];
  money: { toPay: number; pastDue: number; dueSoon: number; nextDue: string | null };
  counts: { steps: number; photos: number; passed: number; reworked: number; shipments: number };
  headline: string;
  // Nothing open and nothing sent in the window: there is no update to send.
  empty: boolean;
};

const DAY = 86_400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
// "24 Nov", with the year only when it isn't this year's.
export const dm = (d: string, today?: string) => dayNear(d, today);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const rupees = (n: number) => `₹${inr.format(Math.round(n))}`;

// The Monday that starts the week holding `d` (a YYYY-MM-DD date in India).
export function weekOf(d: string): string {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(d, -((wd + 6) % 7));
}

// Where the update starts counting from: the day after the last one went, if that was in the last two weeks,
// otherwise seven days back. Never later than today.
export function sinceOf(today: string, lastSent: string | null): string {
  const week = addDays(today, -7);
  if (!lastSent || lastSent < addDays(today, -14)) return week;
  const s = addDays(lastSent, 1);
  return s > today ? today : s;
}

// How far ahead "next" looks.
const AHEAD = 14;

export function buyerWeek(p: {
  orders: WeekOrder[]; shipments: WeekShipment[]; photos: WeekPhoto[]; invoices: WeekInvoice[];
  names: Record<string, string>; today: string; since: string;
}): BuyerWeek {
  const { today, since } = p;
  const inWin = (d: string | null | undefined) => !!d && d >= since && d <= today;
  const name = (s: WeekStep) => s.label ?? p.names[s.stage] ?? s.stage;
  const orders: OrderWeek[] = [];
  for (const o of p.orders) {
    const sentRows = p.shipments.filter((x) => x.order_id === o.id && inWin(x.shipped_on));
    const shipped = o.status === "shipped";
    // A shipped order belongs in the update only the week it went.
    if (o.status !== "open" && !(shipped && sentRows.length)) continue;
    const label = (l: WeekLine) => (l.colour ? `${l.style} ${l.colour}` : l.style);
    const done = o.lines.flatMap((l) => l.steps.filter((s) => inWin(s.done_on)).map((s) => ({ style: label(l), step: name(s), on: s.done_on! })))
      .sort((a, b) => a.on.localeCompare(b.on));
    const qc = o.lines.filter((l) => l.final_qc && inWin(l.final_qc.checked_on))
      .map((l) => ({ style: label(l), pass: l.final_qc!.result === "pass", on: l.final_qc!.checked_on, pieces: l.final_qc!.pieces_checked }));
    const photos = o.lines.flatMap((l) => p.photos.filter((x) => x.line_id === l.id && inWin(x.done_on) && x.photos.length)
      .map((x) => ({ style: label(l), step: name(l.steps.find((s) => s.stage === x.stage) ?? { stage: x.stage, label: null, planned_on: null, done_on: null }), paths: x.photos })));
    const next = shipped ? [] : o.lines.flatMap((l) => {
      const n = l.steps.find((s) => !s.done_on);
      return n && n.planned_on && n.planned_on >= today && n.planned_on <= addDays(today, AHEAD) ? [{ style: label(l), step: name(n), by: n.planned_on }] : [];
    }).sort((a, b) => a.by.localeCompare(b.by));
    const steps = o.lines.flatMap((l) => l.steps);
    const ship = o.revised_ship_date ?? o.ship_date;
    orders.push({
      id: o.id, po: o.buyer_po || o.order_no, ref: o.order_no, shipped,
      ship, daysLeft: ship && !shipped ? between(today, ship) : null,
      pct: steps.length ? Math.round((steps.filter((s) => s.done_on).length / steps.length) * 100) : 0,
      unit: o.lines.length && o.lines.every((l) => l.product === "fabric") ? "m" : "pcs",
      done, qc, sent: sentRows.map((x) => ({ on: x.shipped_on, pieces: Number(x.pieces), cartons: x.cartons })), photos, next,
    });
  }
  // Soonest ship date first; shipped orders last.
  orders.sort((a, b) => Number(a.shipped) - Number(b.shipped) || (a.ship ?? "9999").localeCompare(b.ship ?? "9999"));

  const open = p.invoices.filter((i) => Number(i.left) > 0);
  const sum = (xs: WeekInvoice[]) => xs.reduce((n, i) => n + Number(i.left), 0);
  const soon = open.filter((i) => i.due && i.due >= today && i.due <= addDays(today, AHEAD));
  const money = {
    toPay: sum(open), pastDue: sum(open.filter((i) => i.due && i.due < today)), dueSoon: sum(soon),
    nextDue: soon.map((i) => i.due!).sort()[0] ?? null,
  };
  const counts = {
    steps: orders.reduce((n, o) => n + o.done.length, 0),
    photos: orders.reduce((n, o) => n + o.photos.reduce((m, x) => m + x.paths.length, 0), 0),
    passed: orders.reduce((n, o) => n + o.qc.filter((q) => q.pass).length, 0),
    reworked: orders.reduce((n, o) => n + o.qc.filter((q) => !q.pass).length, 0),
    shipments: orders.reduce((n, o) => n + o.sent.length, 0),
  };
  return { since, today, weekOf: weekOf(today), orders, money, counts, headline: headline(counts, since, today), empty: orders.length === 0 };
}

// One sentence a buyer reads first.
export function headline(c: BuyerWeek["counts"], since: string, today: string): string {
  const parts = [
    c.steps ? `${plural(c.steps, "step")} done` : "",
    c.photos ? `${plural(c.photos, "new photo")} checked by Sourcingo` : "",
    c.passed ? `${plural(c.passed, "style")} passed final QC` : "",
    c.shipments ? `${plural(c.shipments, "shipment")} sent` : "",
  ].filter(Boolean);
  if (!parts.length) return c.reworked ? `Since ${dm(since, today)}: a style is being reworked after final QC.` : `Since ${dm(since, today)}: production carries on, with nothing new to show yet.`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Since ${dm(since, today)}: ${list}.`;
}

// "6 days past the ship date": what the buyer page and the update say once a PO's ship date has gone by.
export const pastShip = (daysLeft: number) => `${plural(-daysLeft, "day")} past the ship date`;

const shipText = (o: OrderWeek, today: string) => o.shipped ? "shipped"
  : o.ship ? (o.daysLeft != null && o.daysLeft >= 0 ? `ships ${dm(o.ship, today)}, ${o.daysLeft === 0 ? "today" : `in ${plural(o.daysLeft, "day")}`}`
    : `ship date ${dm(o.ship, today)}, ${pastShip(o.daysLeft ?? 0)}; we will confirm the new date`)
  : "ship date to be confirmed";

// A short list of styles: "AV-141, AV-142 and 3 more".
const few = (xs: string[]) => {
  const u = [...new Set(xs)];
  return u.length <= 3 ? u.join(", ") : `${u.slice(0, 3).join(", ")} and ${u.length - 3} more`;
};

// The same update as plain text, ready for WhatsApp or an email body.
export function weekText(w: BuyerWeek, buyer: string, link?: string): string {
  const out: string[] = [`Hello ${buyer},`, `Here is your Sourcingo update for the week of ${dm(w.weekOf, w.today)}. ${w.headline}`];
  for (const o of w.orders) {
    const lines = [`*PO ${o.po}* (${o.ref}) · ${shipText(o, w.today)}${o.shipped ? "" : ` · ${o.pct}% done`}`];
    // Steps grouped by name: "Stitching done: AV-141, AV-142".
    const bySteps = new Map<string, string[]>();
    for (const d of o.done) bySteps.set(d.step, [...(bySteps.get(d.step) ?? []), d.style]);
    for (const [step, styles] of bySteps) lines.push(`- ${step} done: ${few(styles)}`);
    for (const q of o.qc) lines.push(q.pass ? `- Final QC passed: ${q.style}${q.pieces ? `, ${inr.format(q.pieces)} ${o.unit} checked` : ""}` : `- Final QC: ${q.style} is being reworked and will be checked again`);
    for (const s of o.sent) lines.push(`- Sent ${dm(s.on, w.today)}: ${inr.format(s.pieces)} ${o.unit}${s.cartons ? `, ${plural(s.cartons, "carton")}` : ""}`);
    if (o.next.length) lines.push(`- Next: ${o.next.slice(0, 3).map((n) => `${n.step} by ${dm(n.by, w.today)} (${n.style})`).join("; ")}`);
    if (lines.length === 1 && !o.shipped && !(o.daysLeft != null && o.daysLeft < 0)) lines.push("- Production carries on; nothing new to show this week");
    out.push(lines.join("\n"));
  }
  if (w.money.pastDue > 0) out.push(`Payment: ${rupees(w.money.pastDue)} is past its due date.`);
  else if (w.money.dueSoon > 0 && w.money.nextDue) out.push(`Payment: ${rupees(w.money.dueSoon)} falls due from ${dm(w.money.nextDue, w.today)}.`);
  if (link) out.push(`Photos and every detail, any time:\n${link}`);
  out.push("Sourcingo");
  return out.join("\n\n");
}
