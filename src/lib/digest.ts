import { type Alert, alertsFor, computeAlerts, fmtDay, type Person, type World } from "@/lib/model";
import { type Books, paymentAlerts } from "@/lib/payments";
import type { Role } from "@/lib/roles";

export const APP_URL = (process.env.APP_URL || "https://sourcingo-os.vercel.app").replace(/\/$/, "");

export type DigestNote = { title: string; body: string | null; href: string | null; created_at: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const OPS: Role[] = ["owner", "merchandiser", "manager", "qc"];

// What one person sees first thing: their urgent items, today's items, and
// what happened since yesterday. Same rules as My day.
export function buildDigest(w: World, p: Person, books: Books | null, notes: DigestNote[]) {
  const role = p.role as Role;
  const ops = OPS.includes(role);
  const all = computeAlerts(w);
  const scoped = [...(ops ? all : all.filter((a) => /^\/(grn|dc|samples)/.test(a.href))), ...(books && (role === "owner" || role === "accounts") ? paymentAlerts(books, (id) => w.buyerCode(id)) : [])];
  const mine = role === "owner" ? scoped : alertsFor(scoped, p.id);
  const urgent = mine.filter((a) => a.sev === "bad");
  const soon = mine.filter((a) => a.sev === "warn");
  const name = (p.full_name || p.email).split(/[ @]/)[0];
  const day = new Date(w.now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  const empty = !urgent.length && !soon.length && !notes.length;
  const subject = urgent.length
    ? `${urgent.length} urgent, ${soon.length} to watch · Sourcingo ${fmtDay(w.today)}`
    : soon.length ? `${soon.length} to watch today · Sourcingo ${fmtDay(w.today)}` : `All clear · Sourcingo ${fmtDay(w.today)}`;

  const list = (title: string, items: Alert[], color: string) => !items.length ? "" : `
    <h3 style="margin:22px 0 8px;font-size:15px;color:${color}">${esc(title)} (${items.length})</h3>
    ${items.slice(0, 15).map((a) => `
      <a href="${APP_URL}${esc(a.href)}" style="display:block;text-decoration:none;color:#16181f;border-left:3px solid ${color};padding:6px 10px;margin:0 0 6px;background:#f7f8fa;border-radius:4px">
        <b style="font-size:14px">${esc(a.t)}</b><br><span style="font-size:12.5px;color:#5b6070">${esc(a.d)}</span>
      </a>`).join("")}
    ${items.length > 15 ? `<p style="font-size:12.5px;color:#5b6070">+${items.length - 15} more in the app.</p>` : ""}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <p style="font-size:12px;color:#5b6070;margin:0">SOURCINGO OS · ${esc(day)}</p>
    <h2 style="margin:6px 0 4px;font-size:20px">Good morning, ${esc(name)}</h2>
    <p style="margin:0;color:#5b6070;font-size:14px">${empty ? "Nothing needs you today." : urgent.length ? `${urgent.length} thing${urgent.length === 1 ? "" : "s"} need${urgent.length === 1 ? "s" : ""} you first.` : "Nothing urgent. A few things to watch."}</p>
    ${list("Urgent", urgent, "#b3261e")}
    ${list("Watch today", soon, "#9a6200")}
    ${notes.length ? `<h3 style="margin:22px 0 8px;font-size:15px">Since yesterday</h3>
      ${notes.slice(0, 12).map((n) => `<p style="margin:0 0 8px;font-size:13.5px"><a href="${APP_URL}${esc(n.href ?? "/notifications")}" style="color:#2f4fa0;font-weight:600;text-decoration:none">${esc(n.title)}</a>${n.body ? `<br><span style="color:#5b6070;font-size:12.5px">${esc(n.body)}</span>` : ""}</p>`).join("")}` : ""}
    <p style="margin:28px 0 0"><a href="${APP_URL}/" style="background:#2f4fa0;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open My day</a></p>
    <p style="margin:24px 0 0;font-size:11.5px;color:#5b6070">You get this because the morning email is on in <a href="${APP_URL}/settings" style="color:#5b6070">My settings</a>.</p>
  </div></body></html>`;
  const text = [
    `Good morning, ${name}. ${day}.`,
    ...(urgent.length ? ["", `URGENT (${urgent.length})`, ...urgent.slice(0, 15).map((a) => `- ${a.t}: ${a.d}`)] : []),
    ...(soon.length ? ["", `WATCH TODAY (${soon.length})`, ...soon.slice(0, 15).map((a) => `- ${a.t}: ${a.d}`)] : []),
    ...(notes.length ? ["", "SINCE YESTERDAY", ...notes.slice(0, 12).map((n) => `- ${n.title}${n.body ? `: ${n.body}` : ""}`)] : []),
    "", `${APP_URL}/`,
  ].join("\n");
  return { subject, html, text, empty, counts: { urgent: urgent.length, soon: soon.length, notes: notes.length } };
}
