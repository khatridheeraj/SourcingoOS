import { bellItem, type BellRow, type Tone } from "./bell.ts";
import { day, stageLabel } from "./format.ts";

// The 7 pm email: what changed today on the orders, then the steps due tomorrow, worded like the bell.
// The database gives the facts (evening_data_for_email in 0118); tools/evening-email.ts turns them into an email.
export type EveningData = {
  name: string; email: string; role: string; date: string; company: string | null; late: number;
  items: BellRow[];
  tomorrow: { order_id: string; order_no: string; style: string | null; stage: string; label: string | null; on: string }[];
};
export type Evening = { subject: string; headline: string; today: ReturnType<typeof bellItem>[]; due: { text: string; sub: string; href: string }[]; late: number };

const firstName = (n: string) => n.split(/\s+/)[0] || n;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildEvening(d: EveningData): Evening {
  const today = d.items.map((r) => bellItem({ ...r, fresh: false }));
  const red = today.filter((i) => i.tone === "bad").length;
  // Tomorrow's steps grouped per order, so a big order reads as one line.
  const byOrder = new Map<string, { no: string; id: string; steps: string[]; on: string }>();
  for (const t of d.tomorrow) {
    const g = byOrder.get(t.order_id) ?? { no: t.order_no, id: t.order_id, steps: [], on: t.on };
    const step = t.label ?? (stageLabel(t.stage) === "No step done yet" ? t.stage.replace(/_/g, " ") : stageLabel(t.stage));
    g.steps.push(t.style ? `${t.style}: ${step}` : step);
    byOrder.set(t.order_id, g);
  }
  const due = [...byOrder.values()].map((g) => ({
    text: `${g.no}: ${plural(g.steps.length, "step")} due ${day(g.on)}`,
    sub: g.steps.slice(0, 4).join(" · ") + (g.steps.length > 4 ? ` · ${g.steps.length - 4} more` : ""),
    href: `/orders/${g.id}#tna`,
  }));
  const parts = [
    today.length ? plural(today.length, "update") : null,
    red ? `${red} need${red === 1 ? "s" : ""} you` : null,
    due.length ? `${plural(due.length, "order")} with steps due next` : null,
    d.late ? `${plural(d.late, "step")} late` : null,
  ].filter(Boolean);
  const headline = parts.join(", ") || "A quiet day";
  return { subject: `Sourcingo evening, ${day(d.date)}: ${headline}`, headline, today, due, late: d.late };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TONE: Record<Tone, string> = { bad: "#c8261f", warn: "#a35200", good: "#157a46", info: "#9a9da8" };
const FONT = "-apple-system,Segoe UI,Roboto,sans-serif";

// A plain email that reads well in Gmail on a phone. Every line opens the app where the work is.
export function eveningHtml(e: Evening, d: EveningData, appUrl: string): string {
  const row = (dot: string, title: string, sub: string | null, href: string) => `
    <tr><td style="padding:9px 0;border-top:1px solid #ececec;font:14px/1.45 ${FONT};color:#1a1a1a">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-right:8px;vertical-align:1px"></span><a href="${esc(appUrl + href)}" style="color:#1a1a1a;text-decoration:none;font-weight:600">${esc(title)}</a>
      ${sub ? `<div style="color:#6b6b6b;font-size:13px;padding-left:16px">${esc(sub)}</div>` : ""}</td></tr>`;
  const head = (t: string) => `<tr><td style="padding:18px 0 6px;font:600 12px/1.4 ${FONT};color:#6b6b6b;text-transform:uppercase;letter-spacing:.04em">${esc(t)}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#f7f7f8;padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:20px 22px">
  <tr><td style="font:600 12px/1.4 ${FONT};color:#6b6b6b">${esc(d.company ?? "Sourcingo")} · ${esc(day(d.date))}</td></tr>
  <tr><td style="padding-top:4px;font:700 20px/1.3 ${FONT};color:#1a1a1a">Good evening, ${esc(firstName(d.name))}</td></tr>
  <tr><td style="padding-top:2px;font:14px/1.45 ${FONT};color:#6b6b6b">${esc(e.headline)}.</td></tr>
  ${e.today.length ? head("What changed today") + e.today.slice(0, 25).map((i) => row(TONE[i.tone], i.title, i.detail, i.href)).join("") : ""}
  ${e.today.length > 25 ? `<tr><td style="padding:8px 0;font:13px ${FONT};color:#6b6b6b">${e.today.length - 25} more in Notifications.</td></tr>` : ""}
  ${e.due.length ? head("Due next") + e.due.map((x) => row("#4f46e5", x.text, x.sub, x.href)).join("") : ""}
  ${e.late ? head("Late") + row(TONE.bad, `${plural(e.late, "step")} past target on open orders`, "Home lists them, red first.", "/today") : ""}
  <tr><td style="padding-top:20px">
    <a href="${esc(appUrl)}/notifications" style="display:inline-block;background:#4f46e5;color:#fff;border-radius:8px;padding:10px 16px;font:600 14px ${FONT};text-decoration:none">Open Notifications</a>
  </td></tr>
  <tr><td style="padding-top:16px;font:12px/1.45 ${FONT};color:#9a9da8">You get this at 7 pm, Monday to Saturday, only on days with news. Switch it off on the Notifications page.</td></tr>
</table></body></html>`;
}

export function eveningText(e: Evening, d: EveningData, appUrl: string): string {
  const lines = [`Good evening, ${firstName(d.name)}. ${e.headline}.`];
  if (e.today.length) lines.push("", "What changed today:", ...e.today.slice(0, 25).map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ""}`));
  if (e.due.length) lines.push("", "Due next:", ...e.due.map((x) => `- ${x.text}: ${x.sub}`));
  if (e.late) lines.push("", `${plural(e.late, "step")} late on open orders. Home lists them.`);
  lines.push("", `${appUrl}/notifications`);
  return lines.join("\n");
}
