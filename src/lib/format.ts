const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export const qty = (n: number | null | undefined) => (n == null ? "" : inr.format(n));
export const money = (n: number | null | undefined) => (n == null ? "" : `₹${inr.format(n)}`);
export const day = (d: string | null | undefined) => (d ? date.format(new Date(`${d}T00:00:00+05:30`)) : "");

// Today's date in India as YYYY-MM-DD.
export const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "chip info" },
  shipped: { label: "Shipped", cls: "chip ok" },
  cancelled: { label: "Cancelled", cls: "chip" },
};

// Production stages, in the order an order moves through the floor.
export const STAGES = [
  { key: "fabric", label: "Fabric" },
  { key: "printing", label: "Printing" },
  { key: "cutting", label: "Cutting" },
  { key: "stitching", label: "Stitching" },
  { key: "finishing", label: "Finishing" },
  { key: "packed", label: "Packed" },
] as const;
export const stageLabel = (s: string | null | undefined) => STAGES.find((x) => x.key === s)?.label ?? "Not started";

// The date an order is now expected to ship: the new date if it slipped, else the buyer's date.
export const dueDate = (o: { ship_date: string | null; revised_ship_date?: string | null }) => o.revised_ship_date || o.ship_date;

// Whole days between two YYYY-MM-DD dates (b minus a).
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// QC stages in the order they happen: sampling and approvals, then production checks.
// A re-check follows a failed final and counts as the final for shipping.
export const QC_KINDS = [
  { key: "greige", label: "Greige" },
  { key: "fit_sample", label: "Fit sample" },
  { key: "strike_off", label: "Strike off" },
  { key: "pp_sample", label: "PP sample" },
  { key: "size_set", label: "Size set" },
  { key: "inline", label: "Inline" },
  { key: "midline", label: "Mid-line" },
  { key: "final", label: "Final" },
  { key: "recheck", label: "Re-check" },
] as const;
export const SHIP_QC = ["final", "recheck"];
export const qcKindLabel = (k: string) => QC_KINDS.find((x) => x.key === k)?.label ?? k;

// TNA steps every style is planned against: samples and approvals, production, then inspection and ex-factory.
// `qc` names the QC check types whose result is shown against the step.
// A factory is expected to send its TNA plan within this many days of being asked.
export const PLAN_DUE_DAYS = 3;

export const TNA_STEPS: { key: string; label: string; qc?: string[] }[] = [
  { key: "greige", label: "Greige", qc: ["greige"] },
  { key: "fit_sample", label: "Fit sample", qc: ["fit_sample"] },
  { key: "strike_off", label: "Strike off", qc: ["strike_off"] },
  { key: "pp_sample", label: "PP sample", qc: ["pp_sample"] },
  { key: "size_set", label: "Size set", qc: ["size_set"] },
  { key: "fabric", label: "Fabric" },
  { key: "printing", label: "Printing" },
  { key: "cutting", label: "Cutting", qc: ["inline"] },
  { key: "stitching", label: "Stitching", qc: ["midline"] },
  { key: "finishing", label: "Finishing" },
  { key: "packed", label: "Packed" },
  { key: "final_qc", label: "Final QC", qc: ["final", "recheck"] },
  { key: "ex_factory", label: "Ex-factory" },
];
