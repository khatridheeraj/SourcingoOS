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
