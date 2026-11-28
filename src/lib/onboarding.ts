// A new factory's way to its first order with us (0110): tell us what it makes, show its floor, give free capacity,
// then a Sourcingo visit. Certificates help but are not a step, because many good small units have none.

export type FactoryProfile = {
  factory_id: string; makes: string[]; about?: string | null; address?: string | null; gstin?: string | null;
  people?: number | null; machines?: number | null; pieces_month?: number | null; photos: string[];
  visit_from?: string | null; visit_note?: string | null; visit_asked_at?: string | null; visit_on?: string | null;
};

// What factories tell us they make: the products on the website, in the words a factory uses.
export const MAKES = ["Kurtas", "Co-ord sets", "Kaftans", "Dresses", "Tops", "Printed fabric", "Embroidery", "Kidswear", "Home textiles"];
export const MIN_PHOTOS = 3;

export type StepKey = "about" | "photos" | "capacity" | "visit";
export type Step = { key: StepKey; done: boolean };
export type Visit = { state: "verified" | "booked" | "asked" | "none"; on?: string | null };

export function visitState(p: FactoryProfile | null, verifiedOn: string | null | undefined, today: string): Visit {
  if (verifiedOn) return { state: "verified", on: verifiedOn };
  if (p?.visit_on && p.visit_on >= today) return { state: "booked", on: p.visit_on };
  if (p?.visit_asked_at && !p.visit_on) return { state: "asked", on: p.visit_from ?? null };
  return { state: "none" };
}

export function aboutDone(p: FactoryProfile | null): boolean {
  return !!p && p.makes.length > 0 && !!p.people && !!p.pieces_month;
}

// The four steps, in order. `capacityGiven`: any week of free capacity saved in the last 21 days counts.
export function onboardingSteps(p: FactoryProfile | null, capacityGiven: boolean, verifiedOn: string | null | undefined, today: string): Step[] {
  return [
    { key: "about", done: aboutDone(p) },
    { key: "photos", done: (p?.photos.length ?? 0) >= MIN_PHOTOS },
    { key: "capacity", done: capacityGiven },
    { key: "visit", done: visitState(p, verifiedOn, today).state === "verified" },
  ];
}

// A visit can be asked for once the factory has told us enough to make the trip worth it.
export function canAskVisit(steps: Step[]): boolean {
  return steps.filter((s) => s.key !== "visit").every((s) => s.done);
}

// For the team: how far along a factory is, as words for a list ("2 of 4 ready").
export function readyLine(steps: Step[]): string {
  const done = steps.filter((s) => s.done).length;
  return done === steps.length ? "Ready for orders" : `${done} of ${steps.length} ready`;
}
