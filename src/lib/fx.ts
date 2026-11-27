import { FALLBACK_FX, fxFromPerInr, type Fx } from "./landed";

// Today's exchange rates from a free source (Frankfurter, which publishes the European Central Bank's daily rates; no
// key, no cost), cached for a day. If it can't be reached, the rough built-in rates are used and marked as such.
export async function todaysFx(): Promise<Fx> {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=INR", { next: { revalidate: 86400 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return FALLBACK_FX;
    const j = (await res.json()) as { date?: string; rates?: Record<string, number> };
    if (!j.rates || !j.rates.USD) return FALLBACK_FX;
    return fxFromPerInr(j.rates, j.date ?? FALLBACK_FX.date);
  } catch {
    return FALLBACK_FX;
  }
}
