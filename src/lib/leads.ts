// The lead funnel (Reports > Leads): how many asked, how many heard back within a day, got a price, a sample and
// became an order, by where they came from, and why the rest were lost. Pure, so it is tested (leads.test.ts).
import { isOpenInquiry, REPLY_HOURS, REPLY_SINCE } from "./inquiries.ts";

export type LeadRow = {
  id: string; inquiry_no: string; status: string; source: string; from_site: boolean; asked_on_page: boolean; country: string | null;
  created_at: string; first_reply_at: string | null; quoted_price: number | null; sample_sent_on: string | null; sample_in_on: string | null;
  lost_reason: string | null; next_follow_up: string | null; referred_by?: string | null;
};

export const CHANNELS: Record<string, string> = {
  website: "Website", page: "Buyer page", referral: "Referral", email: "Email", whatsapp: "WhatsApp", phone: "Phone call", visit: "Visit or meeting", other: "Other",
};
export const channelOf = (l: LeadRow) => (l.referred_by ? "referral" : l.from_site ? "website" : l.asked_on_page ? "page" : CHANNELS[l.source] ? l.source : "other");

const priced = (l: LeadRow) => l.status === "converted" || l.status === "quoted" || l.quoted_price != null;
const sampled = (l: LeadRow) => !!l.sample_sent_on || !!l.sample_in_on || l.status === "converted";
const replied = (l: LeadRow) => !!l.first_reply_at || priced(l) || sampled(l);
const hoursTo = (l: LeadRow) => (l.first_reply_at ? (Date.parse(l.first_reply_at) - Date.parse(l.created_at)) / 3_600_000 : null);

export type Funnel = {
  steps: { key: string; label: string; n: number }[];
  won: number; lost: number; open: number; winRate: number | null;
  // First replies, counted only for leads since replies were kept.
  replyCounted: number; replyInDay: number; replyMedianHours: number | null;
  waiting: LeadRow[];        // open, no reply yet, oldest first
  followLate: number;        // open with a follow-up date before today
  channels: { key: string; label: string; n: number; priced: number; won: number }[];
  lostReasons: { reason: string; n: number }[];
  countries: { country: string; n: number }[];
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function buildFunnel(rows: LeadRow[], now: number, today: string): Funnel {
  const won = rows.filter((l) => l.status === "converted").length;
  const lost = rows.filter((l) => l.status === "lost").length;
  const steps = [
    { key: "asked", label: "Asked", n: rows.length },
    { key: "replied", label: "Heard back", n: rows.filter(replied).length },
    { key: "priced", label: "Got a price", n: rows.filter(priced).length },
    { key: "sample", label: "Sample", n: rows.filter(sampled).length },
    { key: "order", label: "Order", n: won },
  ];
  // A lead counts towards reply speed once it was replied to, or once a day has passed without a reply.
  const since = Date.parse(REPLY_SINCE);
  const counted = rows.filter((l) => Date.parse(l.created_at) >= since && (l.first_reply_at || now - Date.parse(l.created_at) >= REPLY_HOURS * 3_600_000));
  const hours = counted.map(hoursTo).filter((h): h is number => h != null);
  const by = new Map<string, { n: number; priced: number; won: number }>();
  for (const l of rows) {
    const k = channelOf(l);
    const c = by.get(k) ?? { n: 0, priced: 0, won: 0 };
    c.n++; if (priced(l)) c.priced++; if (l.status === "converted") c.won++;
    by.set(k, c);
  }
  const tally = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    steps, won, lost, open: rows.filter((l) => isOpenInquiry(l.status)).length,
    winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
    replyCounted: counted.length,
    replyInDay: hours.filter((h) => h <= REPLY_HOURS).length,
    replyMedianHours: median(hours) == null ? null : Math.round(median(hours)! * 10) / 10,
    waiting: rows.filter((l) => isOpenInquiry(l.status) && !l.first_reply_at && !priced(l) && !sampled(l) && Date.parse(l.created_at) >= since)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    followLate: rows.filter((l) => isOpenInquiry(l.status) && !!l.next_follow_up && l.next_follow_up < today).length,
    channels: [...by].map(([key, c]) => ({ key, label: CHANNELS[key] ?? key, ...c })).sort((a, b) => b.n - a.n),
    lostReasons: tally(rows.filter((l) => l.status === "lost").map((l) => (l.lost_reason ?? "").trim() || "No reason given")).map(([reason, n]) => ({ reason, n })),
    countries: tally(rows.filter((l) => l.from_site).map((l) => l.country?.trim() || "Not given")).map(([country, n]) => ({ country, n })),
  };
}

export const hoursText = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
