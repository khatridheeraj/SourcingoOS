// The morning brief: what is at risk, late or waiting, worked out from brief_data() in the database.
// One source for the Brief page, its WhatsApp text and the 9 am email.
import { project, shipRisk } from "./tna-plan";

type Step = { stage: string; label: string; planned_on: string | null; done_on: string | null };
export type BriefData = {
  company: string;
  name: string;
  role: string;
  today: string;
  orders: { id: string; order_no: string; buyer_po: string; buyer: string; due: string | null;
    lines: { id: string; style: string; factory: string | null; released: boolean; steps: Step[] }[] }[];
  plans_overdue: { order_no: string; factory: string; asked_at: string }[];
  updates_waiting: number;
  pos_to_check: number | null;
  cheques: { to_clear: number; to_clear_amount: number; to_deposit: number; to_deposit_amount: number } | null;
};

export type BriefItem = { text: string; sub?: string; href: string };
export type BriefSection = { key: string; title: string; tone: "bad" | "warn" | "info" | "ok"; items: BriefItem[] };
export type Brief = { title: string; headline: string; sections: BriefSection[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const diff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildBrief(d: BriefData): Brief {
  const today = d.today;
  const risk: (BriefItem & { n: number })[] = [];
  const overdue: (BriefItem & { n: number })[] = [];
  const soon: (BriefItem & { n: string })[] = [];
  let noTarget = 0;
  const noTargetOrders: string[] = [];

  for (const o of d.orders) {
    const name = `${o.order_no} · ${o.buyer}${o.buyer_po ? ` PO ${o.buyer_po}` : ""}`;
    const href = `/orders/${o.id}#tna`;
    let worst = 0;
    let why = "";
    const late: { style: string; label: string; by: number }[] = [];
    const next: { style: string; label: string; on: string }[] = [];
    let missing = 0;
    for (const l of o.lines) {
      const p = project(l.steps, today);
      const r = shipRisk(p, o.due);
      const open = l.steps.filter((s) => !s.done_on);
      const lateHere = open.filter((s) => s.planned_on && s.planned_on < today);
      for (const s of lateHere) late.push({ style: l.style, label: s.label, by: diff(s.planned_on!, today) });
      for (const s of open) if (s.planned_on && s.planned_on >= today && diff(today, s.planned_on) <= 2) next.push({ style: l.style, label: s.label, on: s.planned_on });
      missing += open.filter((s) => !s.planned_on).length;
      if (r.daysLate > worst) {
        worst = r.daysLate;
        const first = lateHere[0];
        why = first ? `${l.style} ${first.label} was due ${dm(first.planned_on!)}` : `${l.style} likely ready ${dm(p!.finish)}`;
      }
    }
    if (missing) {
      noTarget += missing;
      noTargetOrders.push(o.order_no);
    }
    if (o.due && o.due < today) {
      risk.push({ text: `${name}: ship date ${dm(o.due)} has passed, ${days(diff(o.due, today))} ago`, sub: why || undefined, href, n: 1000 + diff(o.due, today) });
    } else if (worst > 0) {
      risk.push({ text: `${name}: likely ${days(worst)} late for ${dm(o.due!)}`, sub: why, href, n: worst });
    } else if (late.length) {
      const top = late.sort((a, b) => b.by - a.by)[0];
      overdue.push({ text: `${name}: ${late.length === 1 ? "1 step" : `${late.length} steps`} overdue`,
        sub: `${top.style} ${top.label}, ${days(top.by)} late${o.due ? ` · ships ${dm(o.due)}` : ""}`, href, n: top.by });
    }
    if (next.length) {
      const first = next.sort((a, b) => a.on.localeCompare(b.on))[0];
      soon.push({ text: `${name}: ${first.style} ${first.label} ${first.on === today ? "due today" : `due ${dm(first.on)}`}${next.length > 1 ? `, ${next.length - 1} more` : ""}`,
        href, n: first.on });
    }
  }

  const sections: BriefSection[] = [];
  if (risk.length) sections.push({ key: "risk", title: "Ship dates at risk", tone: "bad", items: risk.sort((a, b) => b.n - a.n) });
  if (overdue.length) sections.push({ key: "overdue", title: "Steps overdue", tone: "bad", items: overdue.sort((a, b) => b.n - a.n) });
  if (soon.length) sections.push({ key: "soon", title: "Due in the next 2 days", tone: "warn", items: soon.sort((a, b) => a.n.localeCompare(b.n)) });
  const waiting: BriefItem[] = [];
  for (const p of d.plans_overdue) waiting.push({ text: `${p.factory} hasn't sent its TNA for ${p.order_no}`, sub: `Asked ${dm(p.asked_at.slice(0, 10))}, more than 24 hours ago`, href: "/today" });
  if (d.updates_waiting) waiting.push({ text: `${d.updates_waiting} factory ${d.updates_waiting === 1 ? "update" : "updates"} with photos to confirm`, href: "/today" });
  if (d.pos_to_check) waiting.push({ text: `${d.pos_to_check} new buyer ${d.pos_to_check === 1 ? "PO" : "POs"} to check`, href: "/pos" });
  if (noTarget) waiting.push({ text: `${noTarget} ${noTarget === 1 ? "step has" : "steps have"} no target date`, sub: `${noTargetOrders.slice(0, 4).join(", ")}${noTargetOrders.length > 4 ? ` and ${noTargetOrders.length - 4} more` : ""}. Lateness can't show without one.`, href: "/today" });
  if (waiting.length) sections.push({ key: "waiting", title: "Waiting on you or a factory", tone: "info", items: waiting });
  if (d.cheques && (d.cheques.to_clear || d.cheques.to_deposit)) {
    const money: BriefItem[] = [];
    if (d.cheques.to_deposit) money.push({ text: `${d.cheques.to_deposit} ${d.cheques.to_deposit === 1 ? "cheque" : "cheques"} in hand ready to deposit, ₹${inr.format(d.cheques.to_deposit_amount)}`, href: "/payments" });
    if (d.cheques.to_clear) money.push({ text: `${d.cheques.to_clear} ${d.cheques.to_clear === 1 ? "cheque" : "cheques"} deposited over a week ago, not marked cleared, ₹${inr.format(d.cheques.to_clear_amount)}`, sub: "Check with the bank and mark them cleared or bounced.", href: "/payments" });
    sections.push({ key: "money", title: "Money", tone: "warn", items: money });
  }

  const nRisk = risk.length;
  const nLate = overdue.length;
  const headline = !sections.length ? "Nothing is late or waiting. A clear day."
    : [nRisk ? `${nRisk} ${nRisk === 1 ? "order" : "orders"} at risk` : "", nLate ? `${nLate} more with overdue steps` : "",
       !nRisk && !nLate ? "Nothing at risk" : ""].filter(Boolean).join(", ") + `, ${d.orders.length} open ${d.orders.length === 1 ? "order" : "orders"}.`;
  const date = new Date(`${today}T00:00:00Z`);
  return { title: `${WEEKDAYS[date.getUTCDay()]} ${dm(today)}`, headline, sections };
}

// Plain text for WhatsApp: bold titles with asterisks, one line per item.
export function briefText(b: Brief, company: string): string {
  const out = [`*${company} · morning brief, ${b.title}*`, b.headline];
  for (const s of b.sections) {
    out.push("", `*${s.title}*`);
    for (const i of s.items) out.push(`• ${i.text}${i.sub ? ` (${i.sub})` : ""}`);
  }
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TONE = { bad: "#c8261f", warn: "#a35200", info: "#4f46e5", ok: "#157a46" };

// A simple HTML email that reads well in Gmail on a phone. Links open the app.
export function briefHtml(b: Brief, company: string, appUrl: string): string {
  const sec = b.sections.map((s) => `
    <tr><td style="padding:18px 0 6px;font:600 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${TONE[s.tone]};text-transform:uppercase;letter-spacing:.04em">${esc(s.title)}</td></tr>
    ${s.items.map((i) => `<tr><td style="padding:8px 0;border-top:1px solid #ececec;font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">
      <a href="${esc(appUrl + i.href)}" style="color:#1a1a1a;text-decoration:none;font-weight:600">${esc(i.text)}</a>
      ${i.sub ? `<div style="color:#6b6b6b;font-size:13px">${esc(i.sub)}</div>` : ""}</td></tr>`).join("")}`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f7f7f8;padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:20px 22px">
  <tr><td style="font:600 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b6b6b">${esc(company)} · ${esc(b.title)}</td></tr>
  <tr><td style="padding-top:4px;font:700 20px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">${esc(b.headline)}</td></tr>
  ${sec}
  <tr><td style="padding-top:20px"><a href="${esc(appUrl)}/brief" style="display:inline-block;background:#4f46e5;color:#fff;border-radius:8px;padding:10px 16px;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none">Open Sourcingo</a></td></tr>
</table></body></html>`;
}
