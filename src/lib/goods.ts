// Goods bought from a factory should leave for the buyer within a day.
export const HOLD_HOURS = 24;

export const heldHours = (purchasedAt: string, now: number) => Math.max(0, Math.floor((now - Date.parse(purchasedAt)) / 3_600_000));

export const heldText = (h: number) =>
  h < 1 ? "With us under an hour" : h < 48 ? `With us ${h} ${h === 1 ? "hour" : "hours"}` : `With us ${Math.floor(h / 24)} days`;

// When goods bought before now count as held over a day.
export const heldSince = () => new Date(Date.now() - HOLD_HOURS * 3_600_000).toISOString();

// Rupees an invoice falls short of the factory bill it covers, both before GST; 0 when it doesn't (or isn't made).
// A sourcing invoice below cost is almost always a wrong amount or invoice number, so it is flagged wherever it shows.
export function belowCost(purchaseTaxable: number | string | null | undefined, invoiceTaxable: number | string | null | undefined): number {
  if (invoiceTaxable == null || purchaseTaxable == null) return 0;
  const gap = Number(purchaseTaxable) - Number(invoiceTaxable);
  return Number.isFinite(gap) && gap > 1 ? Math.round(gap) : 0;
}
