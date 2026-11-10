// Packing lists: runs of identical cartons, each with pieces per size of one style.
export type PackRow = { carton_from: number; carton_to: number; line_id: string; sizes: Record<string, number>; net_kg: number | null; gross_kg: number | null };
export type PackStyle = { id: string; style: string; colour: string | null; sent: number; sizes: string[] };

const perCarton = (r: PackRow) => Object.values(r.sizes).reduce((a, b) => a + (Number(b) || 0), 0);
const count = (r: PackRow) => Math.max(0, r.carton_to - r.carton_from + 1);

// Cartons, pieces and weights for the whole list, and pieces packed per style.
export function packTotals(rows: PackRow[]) {
  const byStyle = new Map<string, number>();
  for (const r of rows) byStyle.set(r.line_id, (byStyle.get(r.line_id) ?? 0) + perCarton(r) * count(r));
  return {
    cartons: rows.reduce((a, r) => a + count(r), 0),
    pcs: rows.reduce((a, r) => a + perCarton(r) * count(r), 0),
    net: rows.reduce((a, r) => a + (r.net_kg ?? 0) * count(r), 0),
    gross: rows.reduce((a, r) => a + (r.gross_kg ?? 0) * count(r), 0),
    byStyle,
  };
}

// Styles whose packed pieces differ from what this lot sends, worded for the screen.
export function packGaps(rows: PackRow[], styles: PackStyle[]): string[] {
  const { byStyle } = packTotals(rows);
  return styles.flatMap((s) => {
    const packed = byStyle.get(s.id) ?? 0;
    return packed === s.sent ? [] : [`${s.style}: ${packed.toLocaleString("en-IN")} packed, ${s.sent.toLocaleString("en-IN")} in this lot`];
  });
}

// The first problem with a row before it goes to the server, or "".
export function rowProblem(r: PackRow, i: number, rows: PackRow[]): string {
  if (!Number.isInteger(r.carton_from) || r.carton_from < 1) return `Row ${i + 1}: enter the first carton number.`;
  if (!Number.isInteger(r.carton_to) || r.carton_to < r.carton_from) return `Row ${i + 1}: the last carton must be the same as or after the first.`;
  if (!r.line_id) return `Row ${i + 1}: pick the style.`;
  if (perCarton(r) < 1) return `Row ${i + 1}: enter the pieces in one carton.`;
  const clash = rows.findIndex((x, j) => j < i && x.carton_from <= r.carton_to && r.carton_from <= x.carton_to);
  if (clash >= 0) return `Row ${i + 1}: cartons overlap with row ${clash + 1}.`;
  if (r.net_kg != null && r.gross_kg != null && r.gross_kg < r.net_kg) return `Row ${i + 1}: gross weight can't be less than net.`;
  return "";
}
