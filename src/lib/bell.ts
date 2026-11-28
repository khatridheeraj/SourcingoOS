import { day, stageLabel } from "./format.ts";

// One row of bell_for() in the database: a fact about something that moved. Words come from here, so the bell,
// the Notifications page and the evening email always say the same thing.
export type BellRow = {
  at: string; kind: string; order_id: string | null; order_no: string | null; who: string | null;
  info: Record<string, unknown> | null; fresh?: boolean;
};
export type Tone = "bad" | "warn" | "good" | "info";
export type BellItem = { at: string; title: string; detail: string | null; tone: Tone; href: string; fresh: boolean; order: string | null };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const QC_KIND: Record<string, string> = { inline: "Inline", midline: "Mid-line", final: "Final", recheck: "Re-check" };
const step = (info: Record<string, unknown>) => {
  const s = str(info.stage);
  return s ? (stageLabel(s) === "No step done yet" ? s.replace(/^extra_/, "").replace(/_/g, " ") : stageLabel(s)) : "a step";
};

export function bellItem(r: BellRow): BellItem {
  const i = r.info ?? {};
  const on = r.order_no ? ` on ${r.order_no}` : "";
  const order = (area: string) => (r.order_id ? `/orders/${r.order_id}#${area}` : "/");
  const who = r.who ?? "";
  const base = { at: r.at, fresh: !!r.fresh, order: r.order_no };
  switch (r.kind) {
    case "buyer_message":
      return { ...base, title: `${who || "The buyer"} wrote${on}`, detail: str(i.body), tone: "warn", href: order("buyer-talk") };
    case "buyer_claim":
      return { ...base, title: `Buyer claim ${str(i.claim_no) ?? ""}${on}`.replace("  ", " "), detail: [i.pieces ? `${i.pieces} pcs` : null, str(i.reason)].filter(Boolean).join(", ") || null, tone: "bad", href: "/guarantee" };
    case "qc": {
      const pass = i.result === "pass";
      const kind = QC_KIND[String(i.qc_kind)] ?? "QC";
      return { ...base, title: `${kind} QC ${pass ? "passed" : "failed"}${on}`, detail: !pass && Number(i.defects) > 0 ? `${i.defects} defects` : null, tone: pass ? "good" : "bad", href: order("qc") };
    }
    case "po_accepted":
      return { ...base, title: `${who} accepted the factory PO${on}`, detail: str(i.po_no), tone: "good", href: order("details") };
    case "po_reply":
      return { ...base, title: `${who} replied about the factory PO${on}`, detail: str(i.body), tone: "warn", href: order("details") };
    case "po_approval":
      return { ...base, title: `Factory PO for ${who} waits for your approval${on ? `,${on.slice(3)}` : ""}`, detail: null, tone: "info", href: "/today" };
    case "date_ask": {
      const dates = i.new_on ? `${i.old_on ? `${day(String(i.old_on))} to ` : ""}${day(String(i.new_on))}` : null;
      return { ...base, title: `${who} asks to move ${step(i)}${on}`, detail: [dates, str(i.reason)].filter(Boolean).join(". ") || null, tone: "warn", href: order("tna") };
    }
    case "goods_ready":
      return { ...base, title: `Goods ready at ${who}${on}`, detail: i.ready_on ? `Ready ${day(String(i.ready_on))}${i.cartons ? `, ${i.cartons} cartons` : ""}` : null, tone: "good", href: order("dispatch") };
    case "step_update":
      return { ...base, title: `${who} posted ${step(i)}${on}`, detail: Number(i.photos) > 0 ? `${i.photos} photo${Number(i.photos) === 1 ? "" : "s"} to check` : null, tone: "info", href: order("tna") };
    case "sample_in":
      return { ...base, title: `Sample arrived from ${who || "the factory"}${on}`, detail: `${step(i)}${Number(i.round) > 1 ? `, round ${i.round}` : ""}`, tone: "info", href: order("samples") };
    case "sample_answer": {
      const ok = i.status === "approved";
      return { ...base, title: `Buyer ${ok ? "approved" : "asked for changes to"} the sample${on}`, detail: str(i.body), tone: ok ? "good" : "warn", href: order("samples") };
    }
    case "tagged":
      return { ...base, title: `${who || "Someone"} tagged you${on}`, detail: str(i.body), tone: "warn", href: order("talk") };
    case "buyer_email":
      return { ...base, title: "New buyer email with a PO", detail: str(i.subject), tone: "info", href: "/pos" };
    case "email_held":
      return { ...base, title: "Email from an unknown sender waits for you", detail: [str(i.from), str(i.subject)].filter(Boolean).join(": ") || null, tone: "info", href: "/today" };
    case "buyer_po":
      return { ...base, title: `${who || "A buyer"} sent a PO on their page`, detail: str(i.buyer_po), tone: "info", href: "/pos" };
    case "enquiry":
      return { ...base, title: `New costing request from ${who || "a visitor"}`, detail: [str(i.product), str(i.country)].filter(Boolean).join(", ") || null, tone: "info", href: i.id ? `/inquiries/${i.id}` : "/inquiries" };
    case "costing_answer":
      return { ...base, title: `${who || "The buyer"} answered the costing ${str(i.no) ?? ""}`.trim(), detail: str(i.body) ?? str(i.answer), tone: "warn", href: i.id ? `/inquiries/${i.id}` : "/inquiries" };
    case "factory_join":
      return { ...base, title: `${who} asked to join as a factory`, detail: [str(i.city), str(i.makes)].filter(Boolean).join(", ") || null, tone: "info", href: "/factories" };
    case "quote":
      return { ...base, title: `New quote from ${who}`, detail: null, tone: "info", href: "/factories/market" };
    default:
      return { ...base, title: `Something changed${on}`, detail: null, tone: "info", href: order("history") };
  }
}

// Rows grouped under Today, Yesterday or the date, newest first (India time).
export function byDay(items: BellItem[], now = new Date()): { label: string; items: BellItem[] }[] {
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const today = ist(now);
  const yesterday = ist(new Date(now.getTime() - 864e5));
  const out: { label: string; items: BellItem[] }[] = [];
  for (const it of items) {
    const d = ist(new Date(it.at));
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : day(d);
    const last = out[out.length - 1];
    if (last?.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}
