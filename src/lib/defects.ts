// Defect lists on a QC check: which defects, how many pieces, how serious. The factory fixes them before the re-check.

export type Severity = "critical" | "major" | "minor";
export const SEVERITY: Record<Severity, string> = { critical: "Critical", major: "Major", minor: "Minor" };
export type Defect = { defect: string; pieces: number; severity: Severity };

// The defects garment inspections find most, offered as the list is typed (anything else can be written in).
export const COMMON_DEFECTS = [
  "Loose threads", "Untrimmed threads", "Open seam", "Skipped stitch", "Broken stitch", "Uneven stitching", "Puckering",
  "Shade variation", "Colour bleeding", "Stain", "Oil mark", "Hole", "Fabric fault", "Print defect", "Embroidery defect",
  "Measurement out of tolerance", "Wrong label", "Missing label", "Button missing", "Button loose", "Zip defect",
  "Pressing / creases", "Wrong size ratio", "Wrong packing",
];

// "Shade variation 6 (major), Loose threads 8 (minor)": worst first, for a line under the check and the factory message.
const RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };
const worstFirst = (list: Defect[]) => [...list].sort((a, z) => RANK[a.severity] - RANK[z.severity] || z.pieces - a.pieces);
export function defectLine(list: Defect[]) {
  return worstFirst(list)
    .map((d) => `${d.defect} ${d.pieces}${d.severity === "major" ? "" : ` (${SEVERITY[d.severity].toLowerCase()})`}`).join(", ");
}

// The message to the factory after a failed check: what failed and what to fix before the re-check.
export function defectMessage(o: { order: string; style: string; kind: string; on: string; checked: number | null; list: Defect[]; notes: string | null }) {
  const total = o.list.reduce((a, d) => a + d.pieces, 0);
  return [
    `*${o.kind} check failed* · ${o.order} · ${o.style} · ${o.on}`,
    o.checked ? `${o.checked} pcs checked.` : "",
    "Please fix before the re-check:",
    ...worstFirst(o.list).map((d, i) => `${i + 1}. ${d.defect}: ${d.pieces} ${d.pieces === 1 ? "pc" : "pcs"}${d.severity !== "major" ? ` (${SEVERITY[d.severity].toLowerCase()})` : ""}`),
    total ? `${total} defects in all.` : "",
    o.notes ? `Note: ${o.notes}` : "",
  ].filter(Boolean).join("\n");
}
