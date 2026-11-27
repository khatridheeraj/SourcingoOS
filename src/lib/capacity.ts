// Factory capacity: free pieces a factory says it has, week by week, beside what is already due to ship with us.
// Read from capacity_weeks() (supabase/migrations/0108_factory_certs_capacity.sql); weeks start on Monday.

export type CapWeek = { week: string; free: number | null; note: string | null; due_pcs: number; due_m: number; said_at: string | null };
export type FactoryCap = { factory_id: string; weeks: CapWeek[] };

// The Monday of the week a date falls in.
export function mondayOf(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

// A free number older than this is stale: the factory has likely taken other work since.
export const CAP_STALE_DAYS = 21;

export type Fit = { state: "fits" | "tight" | "full" | "unknown"; free: number | null; week: string };

// Can the factory take `pieces` finishing by `readyOn`? The free pieces it said for the weeks from this one up to
// the ready week, added up. Over the need: fits; at least half: tight; less: full; nothing said: unknown.
export function capacityFit(cap: FactoryCap | undefined, readyOn: string, pieces: number, today: string): Fit {
  const until = mondayOf(readyOn);
  const weeks = (cap?.weeks ?? []).filter((w) => w.week >= mondayOf(today) && w.week <= until);
  const said = weeks.filter((w) => w.free != null && (!w.said_at || daysSince(w.said_at, today) <= CAP_STALE_DAYS));
  if (!said.length) return { state: "unknown", free: null, week: until };
  const free = said.reduce((a, w) => a + (w.free ?? 0), 0);
  return { state: free >= pieces ? "fits" : free * 2 >= pieces ? "tight" : "full", free, week: until };
}

export function fitLine(f: Fit, need: number, unit = "pcs"): string {
  if (f.state === "unknown") return "Free capacity not given";
  const n = (v: number) => v.toLocaleString("en-IN");
  const tail = `${n(f.free ?? 0)} ${unit} free by then, needs ${n(need)}`;
  return f.state === "fits" ? `Has room: ${tail}` : f.state === "tight" ? `Tight: ${tail}` : `Full: ${tail}`;
}

function daysSince(iso: string, today: string) {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}
