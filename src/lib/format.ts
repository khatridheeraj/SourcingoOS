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
