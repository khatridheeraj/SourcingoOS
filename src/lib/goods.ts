// Goods bought from a factory should leave for the buyer within a day.
export const HOLD_HOURS = 24;

export const heldHours = (purchasedAt: string, now: number) => Math.max(0, Math.floor((now - Date.parse(purchasedAt)) / 3_600_000));

export const heldText = (h: number) =>
  h < 1 ? "With us under an hour" : h < 48 ? `With us ${h} ${h === 1 ? "hour" : "hours"}` : `With us ${Math.floor(h / 24)} days`;

// When goods bought before now count as held over a day.
export const heldSince = () => new Date(Date.now() - HOLD_HOURS * 3_600_000).toISOString();
