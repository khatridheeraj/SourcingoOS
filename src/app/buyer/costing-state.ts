import { dayNear as day, money } from "@/lib/format";

// A costing the buyer asked for, as it may see it: never the costs, the margin or who worked on it.
export type BuyerCostingAsk = {
  id: string; no: string; product: string; details: string | null; qty: number | null; target: number | null;
  photoUrls: string[]; asked_at: string; status: "new" | "quoted" | "converted" | "lost"; sample_in_on: string | null;
  answer: "accepted" | "changes" | null; answer_note: string | null; answer_at: string | null;
  quote: { price: number; qty: number | null; valid_till: string | null; note: string | null; sent_at: string; round: number } | null;
  order_po: string | null;
};

// Where an ask stands, in the buyer's words, and whether it waits on the buyer.
export function costingState(a: BuyerCostingAsk, today: string): { text: string; chip?: { text: string; cls: string }; waits: boolean } {
  if (a.status === "converted") return { text: a.order_po ? `Now your order ${a.order_po}.` : "Now an order.", chip: { text: "Order", cls: "ok" }, waits: false };
  if (a.status === "lost") return { text: "Closed. Ask again any time.", waits: false };
  if (a.status === "quoted" && a.quote) {
    if (a.answer === "accepted") return { text: `You accepted ${money(a.quote.price)} a piece. Send your PO below, and Sourcingo makes the order.`, chip: { text: "Accepted", cls: "ok" }, waits: false };
    if (a.answer === "changes") return { text: "You asked to revise it. Sourcingo is working on a new price.", waits: false };
    const ended = !!a.quote.valid_till && a.quote.valid_till < today;
    return ended
      ? { text: `This price held till ${day(a.quote.valid_till!)}. Ask to revise it for a fresh one.`, chip: { text: "Price ended", cls: "warn" }, waits: true }
      : { text: "Sourcingo's price is ready. Accept it, or ask to revise it.", chip: { text: "Waiting for you", cls: "warn" }, waits: true };
  }
  if (!a.sample_in_on) return { text: `Send or bring your sample to the Sourcingo office, marked ${a.no}. The costing starts when it arrives.`, chip: { text: "Send your sample", cls: "warn" }, waits: true };
  return { text: `Sample received ${day(a.sample_in_on)}. Sourcingo is working out the price.`, waits: false };
}

