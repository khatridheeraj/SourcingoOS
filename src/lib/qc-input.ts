// Pieces checked and defects on a QC check, read the way the Quality team types them ("1,200", "120 pcs") and
// checked the same way on the phone (so the box is marked before any photo goes up) and on the server (so it
// can't be skipped). Used by Record QC (sheet and QC tab), the factory visit sheet and recordQc.
import { qtyText } from "./inquiry-input.ts";

export type QcCountField = "pieces" | "defects";

// Whole numbers that fit the database's number column.
const fits = (n: number) => Number.isInteger(n) && n <= 2_147_483_647;

// The number in a box, or null when it is blank, or NaN when it isn't a whole number.
export function qcCount(s: string): number | null {
  const t = qtyText(s.trim());
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

export function qcCountsProblem(pieces: string, defects: string): { field: QcCountField; error: string } | null {
  const p = qcCount(pieces);
  const d = qcCount(defects) ?? 0;
  if (p != null && (!fits(p) || p <= 0)) return { field: "pieces", error: "Pieces checked must be a whole number above zero, like 120." };
  if (!fits(d) || d < 0) return { field: "defects", error: "Defects must be a whole number, 0 or more." };
  if (p != null && d > p) return { field: "defects", error: `Defects (${d}) can't be more than the pieces checked (${p}).` };
  return null;
}
