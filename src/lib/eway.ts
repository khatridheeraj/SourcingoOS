// When a lot needs an e-way bill (Rule 138, CGST Rules), and how the app says so. The database makes the decision
// (dispatch_eway_rule in 0132): this file only reads the same limits to explain it. docs/EWAY-BILL.md has the sources.

export type EwayZone = "other_state" | "in_state" | "same_city";
export type EwayRules = { home_state: string; inter_state: number; in_state: number; same_city: number; checked_on: string; source: string };

export const EWAY_DEFAULTS: EwayRules = {
  home_state: "Rajasthan", inter_state: 50000, in_state: 100000, same_city: 200000, checked_on: "2026-11-28",
  source: "https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter16/rule138_v1.00.html",
};

export const EWAY_ZONES: EwayZone[] = ["other_state", "in_state", "same_city"];

export function ewayRules(raw: unknown): EwayRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof EwayRules) => (Number.isFinite(Number(r[k])) && r[k] !== null && r[k] !== "" ? Number(r[k]) : (EWAY_DEFAULTS[k] as number));
  const s = (k: keyof EwayRules) => (typeof r[k] === "string" ? (r[k] as string) : (EWAY_DEFAULTS[k] as string));
  return { home_state: s("home_state"), inter_state: n("inter_state"), in_state: n("in_state"), same_city: n("same_city"), checked_on: s("checked_on"), source: s("source") };
}

export const zoneLabel = (z: EwayZone, r: EwayRules) =>
  z === "same_city" ? "Same city" : z === "in_state" ? `Elsewhere in ${r.home_state}` : "Another state";

export const ewayLimit = (z: EwayZone | null | undefined, r: EwayRules) =>
  z === "same_city" ? r.same_city : z === "in_state" ? r.in_state : r.inter_state;

// The law asks for one only when the value with GST is MORE than the limit.
export const ewayNeeded = (value: number, z: EwayZone | null | undefined, r: EwayRules) => value > ewayLimit(z, r);

const inr = (x: number) => `Rs ${Math.round(x).toLocaleString("en-IN")}`;

// "Needed: Rs 60,000 with GST is above the Rs 50,000 limit for another state."
export function ewayWhy(value: number, z: EwayZone | null | undefined, r: EwayRules): string {
  const zone = z ?? "other_state";
  const where = zone === "same_city" ? "the same city" : zone === "in_state" ? `goods staying in ${r.home_state}` : "another state";
  return ewayNeeded(value, zone, r)
    ? `Needed: ${inr(value)} with GST is above the ${inr(ewayLimit(zone, r))} limit for ${where}.`
    : `Not required: ${inr(value)} with GST is not above the ${inr(ewayLimit(zone, r))} limit for ${where}.`;
}

export const ewayLimitsLine = (r: EwayRules) =>
  `Another state above ${inr(r.inter_state)}, elsewhere in ${r.home_state} above ${inr(r.in_state)}, same city above ${inr(r.same_city)}.`;
