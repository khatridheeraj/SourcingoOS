// The price delivered to an overseas buyer's door, a piece (or a metre) at a time: our price ex-India, freight to the
// door, insurance, then the import duty the buyer's customs will charge, all turned into the buyer's currency.
// Every number is a rough guide the merchandiser can change; the buyer always sees it marked as an estimate.
// Shared by the costing card (live), the save (worked out again on the server) and the buyer's page.

export type Region = "na" | "latam" | "europe" | "gulf" | "asia" | "oceania" | "africa";
export type Mode = "sea" | "air";
// Customs value: most countries charge duty on CIF (goods + freight + insurance); the US, Canada, Australia, New
// Zealand and South Africa charge it on the FOB value of the goods alone.
export type Basis = "cif" | "fob";
export type Country = { code: string; name: string; currency: string; region: Region; basis: Basis; garment: number; fabric: number; note?: string };

export const REGION_NAMES: Record<Region, string> = {
  na: "North America", latam: "Latin America", europe: "Europe and UK", gulf: "Gulf and Middle East", asia: "Asia", oceania: "Australia and NZ", africa: "Africa",
};

// Starting freight rates, ₹ a kg door to door, for a small LCL sea shipment or air cargo. Rough on purpose: the team
// replaces them with forwarder quotes under "Freight rates".
export const DEFAULT_RATES: Record<Region, Record<Mode, number>> = {
  na: { sea: 120, air: 450 }, latam: { sea: 150, air: 550 }, europe: { sea: 90, air: 380 }, gulf: { sea: 45, air: 180 },
  asia: { sea: 70, air: 280 }, oceania: { sea: 110, air: 420 }, africa: { sea: 100, air: 400 },
};

const EU = "The EU–India trade deal is not in force yet, so standard EU rates apply.";
const GCC = "Gulf common tariff, about 5% on most garments and fabric.";
// Guide duty rates for goods made in India, % (garments: HS chapters 61/62; fabric: 52 cotton, 54 synthetic). The
// exact rate depends on the HS code and on a proof of origin where a trade deal applies. Checked Nov 2026.
export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", currency: "USD", region: "na", basis: "fob", garment: 12, fabric: 8,
    note: "US tariffs on Indian goods keep changing: in Nov 2026 a 25% extra tariff on Indian textiles was proposed. Add any extra tariff to the duty before quoting." },
  { code: "CA", name: "Canada", currency: "CAD", region: "na", basis: "fob", garment: 18, fabric: 10 },
  { code: "MX", name: "Mexico", currency: "MXN", region: "latam", basis: "cif", garment: 35, fabric: 15, note: "Mexico raised duty on garments from non-partner countries to 35%." },
  { code: "GB", name: "United Kingdom", currency: "GBP", region: "europe", basis: "cif", garment: 0, fabric: 0,
    note: "India–UK trade deal in force since 15 July 2026: 0% with a proof of Indian origin on the invoice. Without it, 12% garments and 8% fabric." },
  { code: "DE", name: "Germany", currency: "EUR", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "FR", name: "France", currency: "EUR", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "NL", name: "Netherlands", currency: "EUR", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "IT", name: "Italy", currency: "EUR", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "ES", name: "Spain", currency: "EUR", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "BE", name: "Belgium", currency: "EUR", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "IE", name: "Ireland", currency: "EUR", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "SE", name: "Sweden", currency: "SEK", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "DK", name: "Denmark", currency: "DKK", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "PL", name: "Poland", currency: "PLN", region: "europe", basis: "cif", garment: 12, fabric: 8, note: EU },
  { code: "CH", name: "Switzerland", currency: "CHF", region: "europe", basis: "cif", garment: 0, fabric: 0, note: "Switzerland charges no duty on industrial goods, garments included, since 2024." },
  { code: "NO", name: "Norway", currency: "NOK", region: "europe", basis: "cif", garment: 0, fabric: 0, note: "India–EFTA trade deal in force since Oct 2025; check the rate for the exact HS code." },
  { code: "AE", name: "United Arab Emirates", currency: "AED", region: "gulf", basis: "cif", garment: 0, fabric: 0,
    note: "India–UAE trade deal: 0% with a certificate of Indian origin, otherwise 5%." },
  { code: "SA", name: "Saudi Arabia", currency: "SAR", region: "gulf", basis: "cif", garment: 5, fabric: 5, note: GCC },
  { code: "QA", name: "Qatar", currency: "QAR", region: "gulf", basis: "cif", garment: 5, fabric: 5, note: GCC },
  { code: "KW", name: "Kuwait", currency: "KWD", region: "gulf", basis: "cif", garment: 5, fabric: 5, note: GCC },
  { code: "OM", name: "Oman", currency: "OMR", region: "gulf", basis: "cif", garment: 5, fabric: 5, note: GCC },
  { code: "BH", name: "Bahrain", currency: "BHD", region: "gulf", basis: "cif", garment: 5, fabric: 5, note: GCC },
  { code: "AU", name: "Australia", currency: "AUD", region: "oceania", basis: "fob", garment: 0, fabric: 0,
    note: "India–Australia trade deal: 0% on Indian textiles and garments with a proof of origin, otherwise 5%." },
  { code: "NZ", name: "New Zealand", currency: "NZD", region: "oceania", basis: "fob", garment: 10, fabric: 5 },
  { code: "JP", name: "Japan", currency: "JPY", region: "asia", basis: "cif", garment: 0, fabric: 0,
    note: "India–Japan trade deal: 0% on Indian garments that meet its origin rules, otherwise about 7 to 11%." },
  { code: "SG", name: "Singapore", currency: "SGD", region: "asia", basis: "cif", garment: 0, fabric: 0 },
  { code: "HK", name: "Hong Kong", currency: "HKD", region: "asia", basis: "cif", garment: 0, fabric: 0 },
  { code: "ZA", name: "South Africa", currency: "ZAR", region: "africa", basis: "fob", garment: 40, fabric: 15 },
];
export const countryOf = (code: string | null | undefined) => COUNTRIES.find((c) => c.code === code) ?? null;
// A country by the name a buyer typed on the website ("UK", "united states", "Deutschland" stays unknown).
export function countryFromName(name: string | null | undefined): Country | null {
  const t = (name ?? "").trim().toLowerCase().replace(/\./g, "");
  if (!t) return null;
  const alias: Record<string, string> = { uk: "GB", england: "GB", "great britain": "GB", britain: "GB", scotland: "GB", usa: "US", us: "US", america: "US",
    "united states of america": "US", uae: "AE", dubai: "AE", "abu dhabi": "AE", ksa: "SA", holland: "NL" };
  return countryOf(alias[t]) ?? COUNTRIES.find((c) => c.name.toLowerCase() === t || c.code.toLowerCase() === t) ?? null;
}

// Currencies an invoice or a quote can be in. Gulf currencies are fixed to the US dollar, so they are worked out
// from it when the daily source doesn't list them.
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY", "CHF", "SEK", "DKK", "NOK", "PLN", "SGD", "HKD", "ZAR", "MXN",
  "AED", "SAR", "QAR", "KWD", "OMR", "BHD"] as const;
export const USD_PEGS: Record<string, number> = { AED: 3.6725, SAR: 3.75, QAR: 3.64, OMR: 0.3845, BHD: 0.376, KWD: 0.307 };
const SYMBOL: Record<string, string> = { USD: "US$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", NZD: "NZ$", JPY: "¥", INR: "₹", HKD: "HK$", SGD: "S$" };

// Rupees for one unit of each currency, and the day they are from.
export type Fx = { inr: Record<string, number>; date: string; live: boolean };
// Used only when the daily source can't be reached: rough rates, shown as such.
export const FALLBACK_FX: Fx = {
  inr: { USD: 88, EUR: 102, GBP: 117, CAD: 63, AUD: 58, NZD: 51, JPY: 0.58, CHF: 110, SEK: 9.3, DKK: 13.7, NOK: 8.7, PLN: 24, SGD: 68, HKD: 11.3, ZAR: 5, MXN: 4.8 },
  date: "2026-11-27", live: false,
};
// Rupees a unit from a source that gives units a rupee (as the ECB-based daily source does), with the pegs filled in.
export function fxFromPerInr(perInr: Record<string, number>, date: string): Fx {
  const inr: Record<string, number> = {};
  for (const [k, v] of Object.entries(perInr)) if (v > 0) inr[k] = 1 / v;
  if (inr.USD) for (const [k, peg] of Object.entries(USD_PEGS)) if (!inr[k]) inr[k] = inr.USD / peg;
  return { inr, date, live: true };
}
export function withPegs(fx: Fx): Fx {
  const inr = { ...fx.inr };
  if (inr.USD) for (const [k, peg] of Object.entries(USD_PEGS)) if (!inr[k]) inr[k] = inr.USD / peg;
  return { ...fx, inr };
}

// What the merchandiser picks (all text, as typed).
export type LandedInput = { country: string; mode: Mode; currency: string; kg: string; freight: string; insurance: string; duty: string };
// As sent to the buyer: every amount a piece in the buyer's currency.
export type Landed = {
  country: string; countryName: string; mode: Mode; currency: string; fx: number; fxDate: string; unit: "pc" | "m";
  basis: Basis; dutyPct: number; kg: number; freightInr: number; insPct: number; price: number; freight: number; insurance: number; duty: number; total: number;
};

const num = (s: string) => {
  const t = (s ?? "").replace(/[,\s₹%]/g, "");
  return /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
// Yen and the like are shown whole; the rest to the cent.
export const decimalsOf = (cur: string) => (cur === "JPY" ? 0 : cur === "KWD" || cur === "OMR" || cur === "BHD" ? 3 : 2);

export const rateFor = (rates: unknown, region: Region, mode: Mode): number => {
  const v = (rates as Record<string, Record<string, unknown>> | null)?.[region]?.[mode];
  const n = typeof v === "number" ? v : Number(v);
  return n > 0 ? n : DEFAULT_RATES[region][mode];
};

// What a delivered price starts with for a country: its currency, sea freight, its guide duty, 0.5% insurance, and a
// typical weight a piece (a kurta or co-ord piece is about 0.35 kg; a metre of cotton about 0.15 kg).
export function startInput(c: Country, fabric: boolean, rates: unknown): LandedInput {
  return { country: c.code, mode: "sea", currency: c.currency, kg: fabric ? "0.15" : "0.35", freight: String(rateFor(rates, c.region, "sea")),
    insurance: "0.5", duty: String(fabric ? c.fabric : c.garment) };
}

// The first thing wrong, in the words the card shows, or null.
export function landedProblem(i: LandedInput, fx: Fx): string | null {
  if (!countryOf(i.country)) return "Pick the buyer's country.";
  if (!fx.inr[i.currency]) return "Pick the buyer's currency.";
  const kg = num(i.kg), fr = num(i.freight), ins = num(i.insurance), duty = num(i.duty);
  if (!(kg > 0) || kg > 20) return "Enter the weight of one piece in kg, like 0.35.";
  if (!(fr >= 0) || fr > 5000) return "Freight is rupees a kg, like 120.";
  if (!(ins >= 0) || ins > 10) return "Insurance is a percentage, like 0.5.";
  if (!(duty >= 0) || duty > 100) return "Duty is a percentage, like 12.";
  return null;
}

// The delivered price for a price ex-India (₹ a piece), or null when something is missing.
export function landed(price: number, i: LandedInput, fx: Fx, fabric: boolean): Landed | null {
  const c = countryOf(i.country);
  if (!c || !(price > 0) || landedProblem(i, fx)) return null;
  const rate = fx.inr[i.currency];
  const freight = num(i.kg) * num(i.freight);
  // Insurance is usually on 110% of the CIF value; on goods plus freight that is close enough for an estimate.
  const insurance = (price + freight) * 1.1 * (num(i.insurance) / 100);
  const base = c.basis === "fob" ? price : price + freight + insurance;
  const duty = base * (num(i.duty) / 100);
  const d = decimalsOf(i.currency), f = 10 ** d;
  const cur = (inr: number) => Math.round((inr / rate) * f) / f;
  const parts = { price: cur(price), freight: cur(freight), insurance: cur(insurance), duty: cur(duty) };
  return {
    country: c.code, countryName: c.name, mode: i.mode, currency: i.currency, fx: r2(rate * 10000) / 10000, fxDate: fx.date, unit: fabric ? "m" : "pc",
    basis: c.basis, dutyPct: num(i.duty), kg: num(i.kg), freightInr: num(i.freight), insPct: num(i.insurance), ...parts,
    total: Math.round((parts.price + parts.freight + parts.insurance + parts.duty) * f) / f,
  };
}

// "US$ 9.85", "€ 8.10", "AED 36.20".
export function curMoney(n: number | null | undefined, cur: string): string {
  if (n == null || !Number.isFinite(n)) return "";
  const d = decimalsOf(cur);
  const s = n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${SYMBOL[cur] ?? cur} ${s}`;
}

// A stored delivered price back, or null when it isn't one.
export function landedFrom(v: unknown): Landed | null {
  const o = v as Partial<Landed> | null;
  if (!o || typeof o !== "object" || typeof o.total !== "number" || typeof o.currency !== "string") return null;
  return o as Landed;
}

// The boxes a sent delivered price was worked out from, to start a revised quote with.
export function landedInputFrom(v: unknown): LandedInput | null {
  const l = landedFrom(v);
  if (!l || !countryOf(l.country)) return null;
  return { country: l.country, mode: l.mode === "air" ? "air" : "sea", currency: l.currency, kg: String(l.kg ?? ""), freight: String(l.freightInr ?? ""),
    insurance: String(l.insPct ?? "0.5"), duty: String(l.dutyPct) };
}

// An amount in words for the commercial invoice: "US Dollars One Thousand Two Hundred Five and Cents Fifty Only".
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function under1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ""}`;
  return [h ? `${ONES[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}
export function inWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  for (const [size, name] of [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]] as const) {
    const k = Math.floor(n / size);
    if (k) { parts.push(`${under1000(k)}${name ? ` ${name}` : ""}`); n -= k * size; }
  }
  return parts.join(" ");
}
const CUR_WORDS: Record<string, [string, string]> = { USD: ["US Dollars", "Cents"], EUR: ["Euros", "Cents"], GBP: ["Pounds Sterling", "Pence"], INR: ["Rupees", "Paise"],
  CAD: ["Canadian Dollars", "Cents"], AUD: ["Australian Dollars", "Cents"], AED: ["UAE Dirhams", "Fils"] };
export function amountInWords(amount: number, cur: string): string {
  const [main, sub] = CUR_WORDS[cur] ?? [cur, "Cents"];
  const whole = Math.floor(amount + 1e-9), cents = Math.round((amount - whole) * 100);
  return `${main} ${inWords(whole)}${cents ? ` and ${sub} ${inWords(cents)}` : ""} Only`;
}
