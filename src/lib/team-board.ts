// The team board: what each person on the team is carrying, so the owner or a manager can see who is behind and step in.

export type BoardOrder = { id: string; merchandiser_id: string | null; due: string | null; late: boolean; overdueSteps: number };
export type BoardPerson = { id: string; name: string; role: string };
export type BoardRow = BoardPerson & {
  orders: number; late: number; overdueSteps: number; tags: number;
  // Edits in the app in the last 7 days, and when this person last changed anything.
  edits7: number; lastAt: string | null;
  // Quality: updates posted from the factory floor and QC checks recorded in 7 days.
  floor7: number; qc7: number;
  tone: "bad" | "warn" | "";
};

// The owner and managers lead the team: they see the board and hand orders over.
export const canLead = (role: string | null | undefined) => role === "owner" || role === "manager";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function buildBoard(input: {
  people: BoardPerson[]; orders: BoardOrder[]; tags: Map<string, number>; edits7: Map<string, number>; lastAt: Map<string, string>;
  floor7: Map<string, number>; qc7: Map<string, number>; now: number;
}): BoardRow[] {
  return input.people.map((p) => {
    const mine = input.orders.filter((o) => o.merchandiser_id === p.id);
    const late = mine.filter((o) => o.late).length;
    const overdueSteps = sum(mine.map((o) => o.overdueSteps));
    const tags = input.tags.get(p.id) ?? 0;
    const lastAt = input.lastAt.get(p.id) ?? null;
    // Red when an order of theirs will miss its ship date; amber when work waits on them or they have gone quiet for 3+ days.
    const quiet = !lastAt || input.now - Date.parse(lastAt) > 3 * 86_400_000;
    const tone: BoardRow["tone"] = late ? "bad" : overdueSteps || tags || (quiet && (mine.length > 0 || p.role === "quality")) ? "warn" : "";
    return {
      ...p, orders: mine.length, late, overdueSteps, tags, edits7: input.edits7.get(p.id) ?? 0, lastAt,
      floor7: input.floor7.get(p.id) ?? 0, qc7: input.qc7.get(p.id) ?? 0, tone,
    };
  }).sort((a, b) => ({ bad: 0, warn: 1, "": 2 })[a.tone] - ({ bad: 0, warn: 1, "": 2 })[b.tone] || b.orders - a.orders || a.name.localeCompare(b.name));
}

// Counts how often each key appears.
export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}
