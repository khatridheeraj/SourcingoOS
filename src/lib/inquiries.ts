// Buyer inquiries: New, then Quoted, then Converted (a sales order) or Lost. A sample sent to the buyer is a step
// on the way (sample_sent_on), while the inquiry stays open.
export const INQUIRY_STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "chip info" },
  quoted: { label: "Quoted", cls: "chip warn" },
  converted: { label: "Converted", cls: "chip ok" },
  lost: { label: "Lost", cls: "chip" },
};

export const INQUIRY_SOURCES = [
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "phone", label: "Phone call" },
  { key: "visit", label: "Visit or meeting" },
  { key: "other", label: "Other" },
];
export const sourceLabel = (k: string) => INQUIRY_SOURCES.find((s) => s.key === k)?.label ?? k;

// Reasons offered when an inquiry is lost; anything else can be typed.
export const LOST_REASONS = ["Price too high", "Delivery date too tight", "Went to another supplier", "Buyer dropped the style", "No reply from the buyer"];

export type Inquiry = {
  id: string;
  inquiry_no: string;
  buyer_id: string | null;
  prospect: string | null;
  contact_name: string | null;
  contact: string | null;
  source: string;
  product: string;
  est_qty: number | null;
  unit: string;
  target_price: number | null;
  quoted_price: number | null;
  merchandiser_id: string | null;
  next_follow_up: string | null;
  status: string;
  lost_reason: string | null;
  order_id: string | null;
  notes: string | null;
  photos: string[];
  status_at: string;
  updated_at: string;
  created_by: string | null;
  created_at: string;
  sample_sent_on: string | null;
  sample_note: string | null;
  incoming_po_id: string | null;
  // Asked by the buyer on its own page for the costing of an exact sample (0092).
  asked_on_page: boolean;
  sample_in_on: string | null;
  sample_in_note: string | null;
  costing_draft: unknown;
  buyer_answer: "accepted" | "changes" | null;
  buyer_answer_note: string | null;
  buyer_answer_at: string | null;
  answer_seen_at: string | null;
};
export const INQUIRY_COLUMNS = "id, inquiry_no, buyer_id, prospect, contact_name, contact, source, product, est_qty, unit, target_price, quoted_price, merchandiser_id, next_follow_up, status, lost_reason, order_id, notes, photos, status_at, updated_at, created_by, created_at, sample_sent_on, sample_note, incoming_po_id, asked_on_page, sample_in_on, sample_in_note, costing_draft, buyer_answer, buyer_answer_note, buyer_answer_at, answer_seen_at";

export const isOpenInquiry = (status: string) => status === "new" || status === "quoted";

// Where an inquiry stands on its way to an order, for the steps shown on it.
export const STAGES = ["Asked", "Quoted", "Sample sent", "Order"] as const;
// A costing the buyer asked for on its page starts from its own sample, so the sample comes in before the price.
export const PAGE_STAGES = ["Asked", "Sample in", "Quoted", "Order"] as const;
type Staged = Pick<Inquiry, "status" | "sample_sent_on"> & Partial<Pick<Inquiry, "asked_on_page" | "sample_in_on">>;
export const stagesFor = (i: { asked_on_page?: boolean }) => (i.asked_on_page ? PAGE_STAGES : STAGES);
export function stageOf(i: Staged): number {
  if (i.status === "converted") return 3;
  if (i.asked_on_page) return i.status === "quoted" ? 2 : i.sample_in_on ? 1 : 0;
  if (i.sample_sent_on) return 2;
  return i.status === "quoted" ? 1 : 0;
}

// An open inquiry with no follow-up date and nothing done on it for this many days has gone quiet.
export const QUIET_DAYS = 30;

// The buyer answered the latest price on its page and no one has acted on it yet.
export const answerOpen = (i: Pick<Inquiry, "status" | "buyer_answer" | "answer_seen_at">) =>
  isOpenInquiry(i.status) && !!i.buyer_answer && !i.answer_seen_at;
// A costing the team owes: the buyer's sample is in and no price has gone, or the buyer asked to revise it.
export const costingDue = (i: Pick<Inquiry, "status" | "asked_on_page" | "sample_in_on" | "buyer_answer" | "answer_seen_at">) =>
  i.asked_on_page && ((i.status === "new" && !!i.sample_in_on) || (i.status === "quoted" && i.buyer_answer === "changes" && !i.answer_seen_at));
