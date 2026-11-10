// Monday-to-Sunday weeks: `back` 0 is this week, 1 last week, -1 next week. Dates are YYYY-MM-DD.
export function weekOf(today: string, back = 0): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000 - back * 7 * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
