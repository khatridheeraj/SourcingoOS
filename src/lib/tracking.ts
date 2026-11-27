// Door-to-door tracking of a shipped part (0115_shipment_tracking.sql): how it travels, the stages it passes until
// delivered, and a link to the carrier's own public tracking page. The team keeps it; the buyer reads it.

export type Mode = "road" | "sea" | "air" | "courier";
export type Stage = "shipped" | "transit" | "origin_port" | "departed" | "arrived" | "customs" | "out" | "delivered";
export type TrackEvent = { id?: string; stage: Stage; on: string; place: string | null; note: string | null };
export type Tracking = { mode: Mode | null; carrier: string | null; track_no: string | null; to: string | null; eta: string | null; delivered_on: string | null; shipped_on: string; events: TrackEvent[] };

export const MODES: Mode[] = ["road", "sea", "air", "courier"];
export const MODE_LABEL: Record<Mode, string> = { road: "Road (truck)", sea: "Sea", air: "Air", courier: "Courier" };
export const NO_LABEL: Record<Mode, string> = { road: "LR or docket number", sea: "B/L or container number", air: "AWB number", courier: "Tracking number" };

// The stages in order; road and courier have no ports. Matches track_stages() in the database.
export const stagesFor = (m: Mode | null): Stage[] =>
  m === "sea" || m === "air" ? ["shipped", "origin_port", "departed", "arrived", "customs", "out", "delivered"] : ["shipped", "transit", "out", "delivered"];

export function stageLabel(s: Stage, m: Mode | null): string {
  const air = m === "air";
  switch (s) {
    case "shipped": return "Left us";
    case "transit": return "On the road";
    case "origin_port": return air ? "At the airport" : "At the port";
    case "departed": return air ? "Flown out" : "Sailed";
    case "arrived": return air ? "Landed" : "Arrived at port";
    case "customs": return "Cleared customs";
    case "out": return "Out for delivery";
    case "delivered": return "Delivered";
  }
}

export type TrackStep = { stage: Stage; label: string; on: string | null; place: string | null; note: string | null; done: boolean; current: boolean };

// Every stage with the day it was reached. "Left us" is the ship day. A later stage reached marks the earlier ones done.
export function trackSteps(t: Tracking): TrackStep[] {
  const stages = stagesFor(t.mode);
  const last = new Map<Stage, TrackEvent>();
  for (const e of [...t.events].sort((a, z) => a.on.localeCompare(z.on))) last.set(e.stage, e);
  const reached = Math.max(0, ...stages.map((s, i) => (s === "shipped" || last.has(s) || (s === "delivered" && t.delivered_on) ? i : 0)));
  return stages.map((s, i) => {
    const e = last.get(s);
    const on = s === "shipped" ? (e?.on ?? t.shipped_on) : s === "delivered" ? (t.delivered_on ?? e?.on ?? null) : e?.on ?? null;
    return { stage: s, label: stageLabel(s, t.mode), on, place: e?.place ?? null, note: e?.note ?? null, done: i <= reached, current: i === reached };
  });
}

// The next stage to record, for the team's form.
export function nextStage(t: Tracking): Stage {
  const steps = trackSteps(t);
  const i = steps.findIndex((s) => s.current);
  return steps[Math.min(i + 1, steps.length - 1)].stage;
}

// Where it stands in a word, and whether it needs looking at: delivered (green), past its ETA without delivery (amber,
// "needs an update"), no update for 10 days on the way (amber), else on its way.
export function trackState(t: Tracking, today: string): { text: string; tone: "ok" | "warn" | "" } {
  const steps = trackSteps(t);
  const cur = steps.find((s) => s.current)!;
  if (cur.stage === "delivered") return { text: "Delivered", tone: "ok" };
  if (t.eta && t.eta < today) return { text: `${cur.label} · past its arrival date`, tone: "warn" };
  const lastOn = steps.filter((s) => s.on).map((s) => s.on!).sort().at(-1) ?? t.shipped_on;
  const quiet = Math.round((Date.parse(today) - Date.parse(lastOn)) / 86_400_000);
  if (quiet >= 10) return { text: `${cur.label} · no update for ${quiet} days`, tone: "warn" };
  return { text: cur.label, tone: "" };
}

// The carrier's own public tracking page, for carriers whose page takes the number in its address. Free, no API.
const LINKS: [RegExp, (n: string) => string][] = [
  [/maersk/i, (n) => `https://www.maersk.com/tracking/${n}`],
  [/\bmsc\b|mediterranean shipping/i, (n) => `https://www.msc.com/en/track-a-shipment?trackingNumber=${n}`],
  [/cma ?cgm/i, (n) => `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${n}`],
  [/hapag/i, (n) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${n}`],
  [/\bone\b|ocean network/i, (n) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${n}`],
  [/\bdhl\b/i, (n) => `https://www.dhl.com/in-en/home/tracking.html?tracking-id=${n}`],
  [/fedex/i, (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/\bups\b/i, (n) => `https://www.ups.com/track?tracknum=${n}`],
  [/aramex/i, (n) => `https://www.aramex.com/track/results?ShipmentNumber=${n}`],
  [/blue ?dart/i, (n) => `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${n}`],
  [/delhivery/i, (n) => `https://www.delhivery.com/track/package/${n}`],
];
export function trackLink(carrier: string | null, no: string | null): string | null {
  if (!carrier || !no) return null;
  const hit = LINKS.find(([re]) => re.test(carrier));
  return hit ? hit[1](encodeURIComponent(no.replace(/\s+/g, ""))) : null;
}
export const KNOWN_CARRIERS = ["Maersk", "MSC", "CMA CGM", "Hapag-Lloyd", "ONE", "DHL", "FedEx", "UPS", "Aramex", "Blue Dart", "Delhivery"];
