// Dates are business dates in India, whatever the server's timezone.
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const date = new Date(d.length === 10 ? d + "T00:00:00+05:30" : d);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");
export const fmtINR = (n: number | null | undefined) => "₹" + (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
