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
  // The owner only: notes sent from Help still waiting for a decision.
  team_notes?: { no: number; kind: string; body: string; by: string; at: string; suggestion: string | null }[];
  // The owner: factory POs sent for the lock. The team: plans the owner sent back, with the note.
  locks?: { order_id: string; order_no: string; factory: string; at: string; note: string | null }[];
  // Inquiry follow-ups due today or late.
  inquiries_due?: { id: string; inquiry_no: string; product: string; on: string; who: string | null }[];
  // Open orders sent in part, and (the owner only) orders closed short in the last two days.
  part_shipped?: { order_id: string; order_no: string; ordered: number; shipped: number }[];
  // Each style's open sample, or changes the factory hasn't sent again yet (owner and orders team).
  samples?: { order_id: string; order_no: string; style: string; stage: string; round: number; status: "with_team" | "with_buyer" | "changes" | "returned";
    factory: string; at: string; courier: string | null; awb: string | null; note: string | null }[];
  closed_short?: { order_id: string; order_no: string; reason: string; at: string; by: string | null; ordered: number; billed: number }[];
};

export type BriefItem = { text: string; sub?: string; href: string };
export type BriefSection = { key: string; title: string; tone: "bad" | "warn" | "info" | "ok"; items: BriefItem[] };
export type Brief = { title: string; headline: string; sections: BriefSection[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Timestamps come in UTC; the day they fall on is India's.
const istDay = (t: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(t));
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

  const partOf = new Map((d.part_shipped ?? []).map((p) => [p.order_id, p]));
  const pcs = (n: number) => inr.format(n);
  for (const o of d.orders) {
    const name = `${o.order_no} · ${o.buyer}${o.buyer_po ? ` PO ${o.buyer_po}` : ""}`;
    const part = partOf.get(o.id);
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
      risk.push({ text: `${name}: ship date ${dm(o.due)} has passed, ${days(diff(o.due, today))} ago`,
        sub: part ? `${pcs(part.shipped)} of ${pcs(part.ordered)} pcs shipped, ${pcs(part.ordered - part.shipped)} still to send` : why || undefined,
        href: part ? `/orders/${o.id}#dispatch` : href, n: 1000 + diff(o.due, today) });
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
  const owner = d.role === "owner";
  // Factory POs can't go out until the owner locks them, so they come first.
  if (d.locks?.length) {
    sections.push({ key: "locks", title: owner ? "Waiting for your lock" : "Plans the owner sent back", tone: owner ? "warn" : "bad",
      items: d.locks.map((l) => ({
        text: owner ? `${l.order_no}: ${l.factory}'s plan is ready to lock and release` : `${l.order_no}: ${l.factory}'s plan was sent back`,
        sub: owner ? `Sent ${dm(istDay(l.at))}` : l.note ?? undefined,
        href: `/orders/${l.order_id}#tna`,
      })) });
  }
  if (risk.length) sections.push({ key: "risk", title: "Ship dates at risk", tone: "bad", items: risk.sort((a, b) => b.n - a.n) });
  if (overdue.length) sections.push({ key: "overdue", title: "Steps overdue", tone: "bad", items: overdue.sort((a, b) => b.n - a.n) });
  if (soon.length) sections.push({ key: "soon", title: "Due in the next 2 days", tone: "warn", items: soon.sort((a, b) => a.n.localeCompare(b.n)) });
  const waiting: BriefItem[] = [];
  for (const p of d.plans_overdue) waiting.push({ text: `${p.factory} hasn't sent its TNA for ${p.order_no}`, sub: `Asked ${dm(istDay(p.asked_at))}, more than 24 hours ago`, href: "/today" });
  if (d.updates_waiting) waiting.push({ text: `${d.updates_waiting} factory ${d.updates_waiting === 1 ? "update" : "updates"} with photos to confirm`, href: "/today" });
  if (d.pos_to_check) waiting.push({ text: `${d.pos_to_check} new buyer ${d.pos_to_check === 1 ? "PO" : "POs"} to check`, href: "/pos" });
  if (noTarget) waiting.push({ text: `${noTarget} ${noTarget === 1 ? "step has" : "steps have"} no target date`, sub: `${noTargetOrders.slice(0, 4).join(", ")}${noTargetOrders.length > 4 ? ` and ${noTargetOrders.length - 4} more` : ""}. Lateness can't show without one.`, href: "/today" });
  if (waiting.length) sections.push({ key: "waiting", title: "Waiting on you or a factory", tone: "info", items: waiting });
  if (d.samples?.length) {
    const step: Record<string, string> = { fit_sample: "fit sample", strike_off: "strike off", pp_sample: "PP sample", size_set: "size set" };
    const rank = { with_team: 0, changes: 1, returned: 1, with_buyer: 2 };
    sections.push({ key: "samples", title: "Samples", tone: "warn", items: [...d.samples].sort((a, b) => rank[a.status] - rank[b.status] || a.at.localeCompare(b.at)).map((x) => {
      const what = `${x.order_no} ${x.style} ${step[x.stage] ?? x.stage}${x.round > 1 ? ` (round ${x.round})` : ""}`;
      const waited = Math.max(0, diff(istDay(x.at), today));
      const since = days(waited);
      return x.status === "with_team" ? { text: `${what}: sent by ${x.factory}, check it and send it to the buyer`, sub: waited ? `Waiting ${since}` : "Came in today", href: `/orders/${x.order_id}#samples` }
        : x.status === "with_buyer" ? { text: waited ? `${what}: with the buyer for ${since}` : `${what}: sent to the buyer today`, sub: [x.courier, x.awb && `AWB ${x.awb}`].filter(Boolean).join(" · ") || undefined, href: `/orders/${x.order_id}#samples` }
        : { text: `${what}: changes asked, ${x.factory} to send the next round`, sub: x.note ?? undefined, href: `/orders/${x.order_id}#samples` };
    }) });
  }
  // Orders sent in part whose ship date hasn't passed (late ones are under Ship dates at risk).
  const parts = (d.part_shipped ?? []).filter((p) => !risk.some((r) => r.href === `/orders/${p.order_id}#dispatch`));
  if (parts.length) {
    sections.push({ key: "parts", title: "Shipped in part, rest to send", tone: "warn", items: parts.map((p) => ({
      text: `${p.order_no}: ${pcs(p.shipped)} of ${pcs(p.ordered)} pcs shipped, ${pcs(p.ordered - p.shipped)} to send`,
      href: `/orders/${p.order_id}#dispatch`,
    })) });
  }
  if (d.closed_short?.length) {
    sections.push({ key: "short", title: "Closed short", tone: "info", items: d.closed_short.map((c) => ({
      text: `${c.order_no}: closed with ${pcs(c.billed)} of ${pcs(c.ordered)} pcs`,
      sub: `${c.by ? `${c.by}, ` : ""}${dm(istDay(c.at))}: ${c.reason}`,
      href: `/orders/${c.order_id}#dispatch`,
    })) });
  }
  if (d.inquiries_due?.length) {
    sections.push({ key: "inquiries", title: "Inquiry follow-ups due", tone: "warn", items: d.inquiries_due.map((i) => ({
      text: `${i.inquiry_no} · ${i.who ?? "New buyer"}: ${i.product}`,
      sub: i.on < today ? `Follow-up was due ${dm(i.on)}, ${days(diff(i.on, today))} late` : "Follow up today",
      href: `/inquiries/${i.id}`,
    })) });
  }
  if (d.cheques && (d.cheques.to_clear || d.cheques.to_deposit)) {
    const money: BriefItem[] = [];
    if (d.cheques.to_deposit) money.push({ text: `${d.cheques.to_deposit} ${d.cheques.to_deposit === 1 ? "cheque" : "cheques"} in hand ready to deposit, ₹${inr.format(d.cheques.to_deposit_amount)}`, href: "/payments" });
    if (d.cheques.to_clear) money.push({ text: `${d.cheques.to_clear} ${d.cheques.to_clear === 1 ? "cheque" : "cheques"} deposited over a week ago, not marked cleared, ₹${inr.format(d.cheques.to_clear_amount)}`, sub: "Check with the bank and mark them cleared or bounced.", href: "/payments" });
    sections.push({ key: "money", title: "Money", tone: "warn", items: money });
  }

  if (d.team_notes?.length) {
    const kind: Record<string, string> = { problem: "not working", wrong_data: "wrong data", idea: "idea", question: "question" };
    sections.push({ key: "team", title: "From the team, for your call", tone: "info", items: d.team_notes.map((n) => ({
      text: `#${n.no} ${n.by} (${kind[n.kind] ?? n.kind}): ${n.body.length > 120 ? `${n.body.slice(0, 117)}…` : n.body}`,
      sub: n.suggestion ? `Claude suggests: ${n.suggestion}` : undefined,
      href: "/feedback",
    })) });
  }

  const nRisk = risk.length;
  const nLate = overdue.length;
  const nLocks = owner ? d.locks?.length ?? 0 : 0;
  const headline = !sections.length ? "Nothing is late or waiting. A clear day."
    : [nLocks ? `${nLocks} ${nLocks === 1 ? "PO waits" : "POs wait"} for your lock` : "", nRisk ? `${nRisk} ${nRisk === 1 ? "order" : "orders"} at risk` : "", nLate ? `${nLate}${nRisk ? " more" : ""} ${nLate === 1 ? "order" : "orders"} with overdue steps` : "",
       !nRisk && !nLate ? (nLocks ? "nothing at risk" : "Nothing at risk") : ""].filter(Boolean).join(", ") + `, ${d.orders.length} open ${d.orders.length === 1 ? "order" : "orders"}.`;
  const date = new Date(`${today}T00:00:00Z`);
  return { title: `${WEEKDAYS[date.getUTCDay()]} ${dm(today)}`, headline, sections };
}

// The brief to share with a group: everything but money, which stays with the owner and Accounts,
// and the team's notes, which are for the owner.
export const teamCopy = (b: Brief): Brief => ({ ...b, sections: b.sections.filter((s) => s.key !== "money" && s.key !== "team") });

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
  <tr><td style="padding-top:20px">
    <a href="${esc(appUrl)}/brief" style="display:inline-block;background:#4f46e5;color:#fff;border-radius:8px;padding:10px 16px;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none">Open Sourcingo</a>
    <a href="https://wa.me/?text=${encodeURIComponent(briefText(teamCopy(b), company))}" style="display:inline-block;margin-left:8px;background:#1da851;color:#fff;border-radius:8px;padding:10px 16px;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none">Send to a WhatsApp group</a>
  </td></tr>
</table></body></html>`;
}
