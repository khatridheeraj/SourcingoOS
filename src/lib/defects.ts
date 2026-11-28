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

// ---------------------------------------------------------------- analytics (defect_stats(), migration 0109)
export type TopDefect = { defect: string; pieces: number; checks: number; critical: number; major: number; minor: number };
export type FactoryDefects = { factory_id: string; name: string; checks: number; failed: number; pieces_checked: number; defects: number; top: { defect: string; pieces: number }[] };
export type KindDefects = { kind: string; checks: number; failed: number; pieces_checked: number; defects: number };
export type MonthPass = { month: string; firsts: number; passed: number };
export type DefectStats = { top: TopDefect[]; factories: FactoryDefects[]; kinds: KindDefects[]; months: MonthPass[]; since: string };

// Defects per 100 pieces checked, one decimal; nothing under 100 pieces, where one bad carton swings it.
export const per100 = (defects: number, checked: number) => (checked >= 100 ? Math.round((defects / checked) * 1000) / 10 : null);

// The last 12 months ending this month, each with its first-time Final pass (null when no style had a first Final).
export function passByMonth(months: MonthPass[], today: string): { month: string; label: string; firsts: number; pct: number | null }[] {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const out = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const row = months.find((x) => x.month === key);
    out.unshift({ month: key, label: MON[m - 1], firsts: row?.firsts ?? 0, pct: row?.firsts ? Math.round((row.passed / row.firsts) * 100) : null });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

// Factories worst first by defect rate, those without enough pieces checked last.
export function rankFactories(rows: FactoryDefects[]) {
  return rows.map((f) => ({ ...f, rate: per100(f.defects, f.pieces_checked) }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.failed - a.failed || a.name.localeCompare(b.name));
}

export const KIND_WORDS: Record<string, string> = { inline: "Inline", midline: "Mid-line", final: "Final", recheck: "Re-check" };
