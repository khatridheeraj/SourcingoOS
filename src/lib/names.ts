export const personName = (p: { full_name: string | null; email: string }) => p.full_name || p.email.split("@")[0];
export const NO_COMPANY = "00000000-0000-0000-0000-000000000000";

// A code for a new buyer: initials of its name and the next number, like BYR-FC-0015.
export function suggestBuyerCode(name: string, codes: string[]): string {
  const initials = name.replace(/[^a-z\s]/gi, " ").trim().split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0].toUpperCase()).join("") || "NEW";
  const next = Math.max(0, ...codes.map((c) => Number(c.match(/(\d+)$/)?.[1] ?? 0))) + 1;
  return `BYR-${initials}-${String(next).padStart(4, "0")}`;
}
