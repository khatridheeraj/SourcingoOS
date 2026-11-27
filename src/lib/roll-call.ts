// The morning update ask: one WhatsApp message for the team group that tags each person and lists what the app
// shows for them, then asks for a fresh update. Sourcingo never sends it; the owner or a manager taps Send on WhatsApp.
// Built from the same numbers as the Team board (Reports > Team), so the two never disagree.

export type AskOrder = { order_no: string; late: boolean; overdueSteps: number };
export type AskPerson = {
  id: string; name: string; role: string;
  // Digits with the country code, like 919876543210, or null when the owner hasn't saved it on the Team page.
  whatsapp: string | null;
  orders: AskOrder[];
  // Notes that tag this person and still wait for their reply.
  tags: number;
  // When they last changed anything in the app (ISO time), or null for not in 30 days.
  lastAt: string | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ROLE_ORDER: Record<string, number> = { manager: 0, merchandiser: 1, quality: 2, accounts: 3, owner: 4 };

// Lists a few order numbers, then "and N more", so one line never runs on.
function few(xs: string[], max = 4): string {
  return xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;
}

// What a WhatsApp tag looks like: @ and the number turns into the person's name in the group. Without a number
// the first name is written instead, so the message still reads right.
export const tagOf = (p: Pick<AskPerson, "name" | "whatsapp">) => (p.whatsapp ? `@${p.whatsapp}` : `@${p.name.split(" ")[0]}`);

// Whole days between an ISO time and today (both read as India dates).
function quietDays(lastAt: string | null, today: string): number | null {
  if (!lastAt) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(lastAt));
  return Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
}

// The lines under one person's tag: what is late first, then what waits on them, then the question for their role.
export function linesFor(p: AskPerson, today: string): string[] {
  const out: string[] = [];
  const late = p.orders.filter((o) => o.late).map((o) => o.order_no);
  const behind = p.orders.filter((o) => !o.late && o.overdueSteps > 0).sort((a, b) => b.overdueSteps - a.overdueSteps);
  if (p.orders.length) out.push(`${plural(p.orders.length, "open order")}`);
  if (late.length) out.push(`Past ship date: ${few(late)}. When will ${late.length === 1 ? "it" : "they"} go?`);
  if (behind.length) out.push(`Steps past target: ${few(behind.map((o) => `${o.order_no} (${o.overdueSteps})`))}`);
  if (p.tags) out.push(`${plural(p.tags, "note")} on orders waiting for your reply`);
  const quiet = quietDays(p.lastAt, today);
  if (quiet === null) out.push("Nothing updated in the app in 30 days");
  else if (quiet >= 2) out.push(`Nothing updated in the app for ${quiet} days`);
  if (p.role === "quality") out.push("Which factories are you visiting today, and what did you check yesterday?");
  else if (p.role === "accounts") out.push("Payments and bills: anything received, paid or stuck?");
  else if (!p.orders.length) out.push("What are you working on today?");
  return out;
}

// The whole message. People come in a steady order (managers, merchandisers, Quality, Accounts) so it reads the same each day.
export function rollCallText(input: { company: string; today: string; people: AskPerson[] }): string {
  const d = new Date(`${input.today}T00:00:00Z`);
  const date = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const people = [...input.people].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name));
  const out = [
    `*Good morning team · ${date}*`,
    "Please reply here with a fresh update on your work for today, and mark what is done in Sourcingo so everyone sees it.",
  ];
  for (const p of people) {
    out.push("", `${tagOf(p)}${p.whatsapp ? ` (${p.name.split(" ")[0]})` : ""}`);
    for (const l of linesFor(p, input.today)) out.push(`• ${l}`);
  }
  out.push("", `${input.company} · from the Team page in Sourcingo`);
  return out.join("\n");
}

// Cleans what the owner types into a WhatsApp number: keeps digits, and adds India's 91 to a 10-digit mobile number.
// Returns "" for an empty box and null when it can't be a number.
export function cleanWhatsapp(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (!digits) return raw.trim() ? null : "";
  const full = digits.length === 10 && /^[6-9]/.test(digits) ? `91${digits}` : digits;
  return /^[1-9][0-9]{9,14}$/.test(full) ? full : null;
}
