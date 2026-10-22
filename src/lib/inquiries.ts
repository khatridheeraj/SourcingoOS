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
};
export const INQUIRY_COLUMNS = "id, inquiry_no, buyer_id, prospect, contact_name, contact, source, product, est_qty, unit, target_price, quoted_price, merchandiser_id, next_follow_up, status, lost_reason, order_id, notes, photos, status_at, updated_at, created_by, created_at, sample_sent_on, sample_note, incoming_po_id";

export const isOpenInquiry = (status: string) => status === "new" || status === "quoted";

// Where an inquiry stands on its way to an order, for the steps shown on it.
export const STAGES = ["Asked", "Quoted", "Sample sent", "Order"] as const;
export function stageOf(i: Pick<Inquiry, "status" | "sample_sent_on">): number {
  if (i.status === "converted") return 3;
  if (i.sample_sent_on) return 2;
  return i.status === "quoted" ? 1 : 0;
}

// An open inquiry with no follow-up date and nothing done on it for this many days has gone quiet.
export const QUIET_DAYS = 30;
