// Sample approvals: fit, strike off, PP and size-set samples go from the factory, through the orders team, to the buyer.
// Each send is a round of one style's step; the buyer's approval closes that step in the TNA.

export const SAMPLE_STEPS = [
  { key: "fit_sample", label: "Fit sample", short: "Fit" },
  { key: "strike_off", label: "Strike off", short: "Strike off" },
  { key: "pp_sample", label: "PP sample", short: "PP" },
  { key: "size_set", label: "Size set", short: "Size set" },
] as const;
export type SampleStage = (typeof SAMPLE_STEPS)[number]["key"];
export const isSampleStep = (k: string): k is SampleStage => SAMPLE_STEPS.some((s) => s.key === k);
export const sampleLabel = (k: string) => SAMPLE_STEPS.find((s) => s.key === k)?.label ?? k;

export type SampleStatus = "with_team" | "returned" | "with_buyer" | "approved" | "changes";

// One round as the team reads it from sample_rounds.
export type SampleRound = {
  id: string; order_id: string; line_id: string; factory_id: string; stage: string; round: number; status: SampleStatus;
  note: string | null; photos: string[]; sent_by: string | null; sent_at: string; sent_by_team: boolean;
  courier: string | null; awb: string | null; dispatched_on: string | null; buyer_note: string | null; forwarded_by: string | null; forwarded_at: string | null;
  answer_note: string | null; answer_photos: string[]; answered_by: string | null; answered_at: string | null; answered_for_buyer: boolean; approved_on: string | null;
};
export const ROUND_COLUMNS = "id, order_id, line_id, factory_id, stage, round, status, note, photos, sent_by, sent_at, sent_by_team, courier, awb, dispatched_on, buyer_note, forwarded_by, forwarded_at, answer_note, answer_photos, answered_by, answered_at, answered_for_buyer, approved_on";

// Couriers the team picks from; anything else can be typed.
export const COURIERS = ["DTDC", "Blue Dart", "Delhivery", "DHL", "FedEx", "India Post", "By hand"];

// Where a style's sample stands, in the team's words: the latest round decides.
export type SampleState = "not_sent" | SampleStatus | "done";
export const STATE_TEXT: Record<SampleState, { text: string; cls: "" | "ok" | "warn" | "bad" | "info" }> = {
  not_sent: { text: "Not sent yet", cls: "" },
  with_team: { text: "To check and send", cls: "warn" },
  returned: { text: "Sent back to factory", cls: "bad" },
  with_buyer: { text: "With buyer", cls: "info" },
  changes: { text: "Changes asked", cls: "bad" },
  approved: { text: "Approved", cls: "ok" },
  done: { text: "Done in TNA", cls: "ok" },
};

// A parcel's tracking page, for the couriers that have one that takes the AWB in the address.
export function trackUrl(courier: string | null, awb: string | null): string | null {
  if (!courier || !awb) return null;
  const n = encodeURIComponent(awb.trim());
  const c = courier.toLowerCase();
  if (c.includes("dtdc")) return `https://www.dtdc.in/trace.asp?strCnno=${n}`;
  if (c.includes("blue")) return `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${n}`;
  if (c.includes("delhivery")) return `https://www.delhivery.com/track/package/${n}`;
  if (c.includes("dhl")) return `https://www.dhl.com/in-en/home/tracking.html?tracking-id=${n}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c.includes("india post") || c.includes("speed post")) return "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx";
  return null;
}

// Whole days a sample has waited since a timestamp, counted in India.
export const waitedDays = (since: string, now: number) => Math.max(0, Math.floor((now - Date.parse(since)) / 86_400_000));
