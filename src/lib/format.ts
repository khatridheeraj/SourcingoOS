const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

export const qty = (n: number | null | undefined) => (n == null ? "" : inr.format(n));
// Fabric is bought by the metre, garments by the piece (order_lines.product).
export const unitOf = (product: string | null | undefined) => (product === "fabric" ? "m" : "pcs");
export const qtyU = (n: number | null | undefined, product: string | null | undefined) => (n == null ? "" : `${qty(n)} ${unitOf(product)}`);
// A total across styles, kept apart by unit: "500 pcs", "250 m" or "500 pcs + 250 m".
export const qtyTotal = (lines: { qty: number | null; product?: string | null }[], qtyOf: (l: { qty: number | null; product?: string | null }) => number = (l) => Number(l.qty ?? 0)) => {
  let pcs = 0, m = 0;
  for (const l of lines) if (l.product === "fabric") m += qtyOf(l); else pcs += qtyOf(l);
  return [pcs || !m ? `${qty(pcs)} pcs` : "", m ? `${qty(m)} m` : ""].filter(Boolean).join(" + ");
};
// One unit for a number summed over several styles: "m" when all are fabric, "pcs" when none are, else "units".
export const unitOfAll = (lines: { product?: string | null }[]) =>
  lines.length && lines.every((l) => l.product === "fabric") ? "m" : lines.some((l) => l.product === "fabric") ? "units" : "pcs";
export const money = (n: number | null | undefined) => (n == null ? "" : `₹${inr.format(n)}`);
// Rupees the way people say them at a glance: ₹10.7 L, ₹1.2 Cr.
export const moneyShort = (n: number | null | undefined) =>
  n == null ? "" : n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(1)} L` : money(n);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "10 Sep 2026" from YYYY-MM-DD (en-IN would write "Sept"), read straight from the string so no time zone can shift it.
export const day = (d: string | null | undefined) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");
// The India date of a timestamp (a UTC timestamp's first 10 characters can be the day before).
export const dayAt = (ts: string | null | undefined) => (ts ? day(date.format(new Date(ts))) : "");

// Today's date in India as YYYY-MM-DD.
export const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
// "24 Oct" when the date falls in this year, else "24 Oct 2025": near dates read faster without the year.
export const dayNear = (d: string | null | undefined, today: string = todayIST()) =>
  d && d.slice(0, 4) === today.slice(0, 4) ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : day(d);

export const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "chip info" },
  shipped: { label: "Shipped", cls: "chip ok" },
  cancelled: { label: "Cancelled", cls: "chip" },
};

// An order's stage is the furthest standard TNA step its slowest style has done (set by the database).
// Target dates alone don't move it, so an order with only targets reads "No step done yet".
export const stageLabel = (s: string | null | undefined) => TNA_STEPS.find((x) => x.key === s)?.label ?? "No step done yet";
export const stageReached = (s: string | null | undefined, step: string) =>
  !!s && TNA_STEPS.findIndex((x) => x.key === s) >= TNA_STEPS.findIndex((x) => x.key === step);

// The date an order is now expected to ship: the new date if it slipped, else the buyer's date.
export const dueDate = (o: { ship_date: string | null; revised_ship_date?: string | null }) => o.revised_ship_date || o.ship_date;

// Whole days between two YYYY-MM-DD dates (b minus a).
// "1 day late", "5 days late": every late chip counts days the same way.
export const daysLate = (n: number) => `${n} ${n === 1 ? "day" : "days"} late`;
// An "At risk" order is not late yet: it will likely finish this many days after its ship date.
export const riskLate = (n: number) => `At risk · about ${daysLate(n)}`;
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
// A factory has this many hours to send its TNA once asked; after that it is critical.
export const PLAN_HOURS = 24;
// Days kept between the factory's last date and the PO's delivery date, unless the merchandiser picks another buffer.
export const DEFAULT_BUFFER_DAYS = 7;
// Fabric goes from the mill straight to the buyer, with no garment making after it, so it keeps a shorter buffer.
export const FABRIC_BUFFER_DAYS = 2;
export const defaultBuffer = (fabric: boolean) => (fabric ? FABRIC_BUFFER_DAYS : DEFAULT_BUFFER_DAYS);
// The current time, for comparing against deadlines on the server.
export const nowMs = () => Date.now();
export const planDueAt = (requestedAt: string) => new Date(Date.parse(requestedAt) + PLAN_HOURS * 3_600_000);

// Every style goes through all the standard steps (none can be marked not needed); extra steps can be added per style.
export const TNA_STEPS: { key: string; label: string; qc?: string[]; required?: boolean }[] = [
  { key: "greige", label: "Greige", qc: ["greige"], required: true },
  { key: "fit_sample", label: "Fit sample", qc: ["fit_sample"], required: true },
  { key: "fabric", label: "Fabric", required: true },
  { key: "printing", label: "Printing / dyeing", required: true },
  { key: "strike_off", label: "Strike off", qc: ["strike_off"], required: true },
  { key: "pp_sample", label: "PP sample", qc: ["pp_sample"], required: true },
  { key: "size_set", label: "Size set", qc: ["size_set"], required: true },
  { key: "cutting", label: "Cutting", required: true },
  { key: "stitching", label: "Stitching", required: true },
  { key: "inline", label: "Inline", qc: ["inline"], required: true },
  { key: "midline", label: "Mid-line", qc: ["midline"], required: true },
  { key: "finishing", label: "Finishing", required: true },
  { key: "packed", label: "Packed", required: true },
  { key: "final_qc", label: "Final QC", qc: ["final", "recheck"], required: true },
  { key: "ex_factory", label: "Ex-factory", required: true },
];
