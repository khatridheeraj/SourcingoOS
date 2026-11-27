// Sample comment sheets (Dheeraj, 12 Nov 2026): the one-page sheet Quality sends a factory after checking a sample.
// The inspector writes points in plain words; this turns each into Area / Observation / Correction and a
// summary line, and the saved sheet becomes a QC check on the order with the PDF as its report.
//
// The one rule that matters more than any other: a correction is NEVER guessed. The team sometimes tells a
// factory NOT to do something ("no fusing should be applied"); a correction that flips or invents meaning can
// put a wrong instruction into production. So a correction comes only from (a) an instruction the inspector
// wrote, with its polarity kept, or (b) a measurement deviation; anything else reads "Rectify as per tech
// pack / approved sample" for the inspector to fill in.

import { day } from "./format.ts";

export type SheetVerdict = "not_approved" | "approved_with_comments" | "approved";
export type SheetRow = { area: string; observation: string; correction: string };

export const VERDICTS: { key: SheetVerdict; label: string; badge: string; result: "pass" | "fail"; cls: "bad" | "warn" | "ok" }[] = [
  { key: "not_approved", label: "Not approved — rectify & resubmit", badge: "NOT APPROVED", result: "fail", cls: "bad" },
  { key: "approved_with_comments", label: "Approved with comments", badge: "APPROVED WITH COMMENTS", result: "pass", cls: "warn" },
  { key: "approved", label: "Approved", badge: "APPROVED", result: "pass", cls: "ok" },
];
export const verdictOf = (k: string) => VERDICTS.find((v) => v.key === k);

// The sample stages a sheet is written for, and the QC check each one is recorded as on the order.
export const SHEET_STAGES: { key: string; label: string; qc: string }[] = [
  { key: "proto", label: "Proto sample", qc: "fit_sample" },
  { key: "fit", label: "Fit sample", qc: "fit_sample" },
  { key: "pp", label: "Pre-production sample", qc: "pp_sample" },
  { key: "size_set", label: "Size-set sample", qc: "size_set" },
  { key: "top", label: "Top of production", qc: "inline" },
  { key: "shipment", label: "Shipment sample", qc: "final" },
];
export const stageOf = (k: string) => SHEET_STAGES.find((s) => s.key === k);

export const MAX_ROWS = 40;
export const MAX_CELL = 300;

// The default "Next step" line for each result; the inspector can change it.
export const NEXT_STEP: Record<SheetVerdict, string> = {
  not_approved: "rectify all points above and resubmit the sample for re-check. Bulk cutting on hold until approved.",
  approved_with_comments: "sample approved for bulk subject to the corrections above being implemented in production. Sourcingo QC to verify at inline inspection.",
  approved: "sample approved. Proceed to bulk as per approved sample and tech pack.",
};

// Area labels only (a topic tag can't flip meaning). Specific words before general ones.
const AREAS: [RegExp, string][] = [
  [/fusing|interlining|fuse/, "Fusing"], [/wash ?care|care label/, "Wash-care label"], [/size label/, "Size label"], [/main label|brand label|woven label/, "Main label"],
  [/hang ?tag|price tag/, "Hang tag"], [/label/, "Label"],
  [/sleeve/, "Sleeve"], [/body length|full length|garment length|total length|\bhps\b/, "Body length"], [/chest|bust/, "Chest"], [/waist/, "Waist"], [/\bhip/, "Hip"],
  [/bottom|sweep|hem width/, "Bottom"], [/shoulder/, "Shoulder"], [/armhole|arm hole/, "Armhole"], [/collar ?band|neck ?band/, "Collar band"], [/\bneck\b|neckline/, "Neck"],
  [/inseam|outseam|\brise\b/, "Trouser measurement"],
  [/button ?hole/, "Buttonhole"], [/button/, "Buttons"], [/zip/, "Zipper"], [/pocket/, "Pocket"], [/collar/, "Collar"], [/placket/, "Placket"], [/cuff/, "Cuff"], [/lining/, "Lining"],
  [/\bhem\b|hemming/, "Hem"], [/tuck|pleat|dart/, "Tucks / pleats"],
  [/loose thread|uncut thread|thread/, "Thread trimming"], [/skip|broken stitch|open seam|pucker|\bspi\b|stitch|seam/, "Stitching"], [/shade|colou?r/, "Shade / colour"],
  [/stain|spot|oil mark|dirt|soil/, "Stains / marks"], [/print/, "Print"], [/embroider/, "Embroidery"], [/press|iron|crease|wrinkle/, "Pressing"],
  [/fabric|gsm|hand ?feel|pilling/, "Fabric"], [/trim|lace|elastic|drawcord|draw string|eyelet/, "Trims"], [/pack|poly ?bag|carton/, "Packing"], [/measure|spec/, "Measurement"],
];

// A sentence that tells the factory what to do (or not do), rather than describing the sample.
const INSTR = /\b(please|kindly|should|shouldn't|must|mustn't|need(s)? to|ensure|make sure|do not|don't|dont|avoid|to be (applied|used|made|done|given|added|attached|stitched|kept|removed|trimmed|corrected|maintained)|has to|have to|required to|use only|only use|never|always)\b/i;
const IMPERATIVE = /^(attach|apply|trim|remove|correct|re-?stitch|re-?cut|re-?do|replace|keep|maintain|use|add|fix|check|follow|match|clean|press|change|increase|reduce|make|do|give|put|stitch|cut|avoid|stop|provide|send|submit|re-?submit)\b/i;
const VERB: Record<string, string> = {
  applied: "apply", used: "use", made: "make", done: "do", given: "give", added: "add", attached: "attach", stitched: "stitch", kept: "keep",
  removed: "remove", trimmed: "trim", provided: "provide", fused: "fuse", pressed: "press", cut: "cut",
};
const FRACTIONS: Record<string, string> = { "1/2": "½", "1/4": "¼", "3/4": "¾", "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞" };

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// One clean sentence: trimmed, single spaces, first letter up, one full stop.
export function tidy(t: string): string {
  const s = t.trim().replace(/\s{2,}/g, " ").replace(/[.;,\s]+$/, "");
  return s ? capital(s) + "." : "";
}
function fmtNum(n: string) {
  const t = n.trim();
  if (FRACTIONS[t]) return FRACTIONS[t];
  const m = /^(\d+)\s+(\d\/\d)$/.exec(t);
  if (m && FRACTIONS[m[2]]) return m[1] + FRACTIONS[m[2]];
  return t.replace(/\.0$/, "");
}
// Politeness off an instruction; its meaning untouched. "Ensure" stays unless a plain statement follows it.
function cleanInstruction(t: string) {
  return t.trim().replace(/^(please|kindly|pls)\s+/i, "")
    .replace(/^(ensure|make sure)\s+(that\s+)?(?=(?:the\s+)?[a-z]+\s+(?:is|are|should|must)\b)/i, "")
    .replace(/^(it\s+)?(is\s+)?(required|needed)\s+(that\s+)?/i, "")
    .replace(/\s*,?\s*(please|kindly)\s*$/i, "");
}
// An instruction as the correction column reads it, polarity preserved: "No fusing should be applied to X" ->
// "Do not apply fusing to X"; "X must be attached with Y" -> "Attach X with Y"; anything else as written.
export function toCorrection(instruction: string): string {
  const t = cleanInstruction(instruction);
  const imp = (verb: string, what: string, rest: string) => tidy(`${capital(verb)} ${what}${rest}`);
  let m = /^no\s+(.+?)\s+(?:should|must|needs? to|to|has to|have to|is to|are to)\s+be\s+(\w+)(.*)$/i.exec(t);
  if (m && VERB[m[2].toLowerCase()]) return tidy(`Do not ${VERB[m[2].toLowerCase()]} ${m[1]}${m[3]}`);
  m = /^(.+?)\s+(?:should not|shouldn't|must not|mustn't|is not to|are not to|not to)\s+be\s+(\w+)(.*)$/i.exec(t);
  if (m && VERB[m[2].toLowerCase()]) return tidy(`Do not ${VERB[m[2].toLowerCase()]} ${m[1]}${m[3]}`);
  m = /^(.+?)\s+(?:should|must|needs? to|has to|have to|is to|are to)\s+be\s+(\w+)(.*)$/i.exec(t);
  if (m && VERB[m[2].toLowerCase()]) return imp(VERB[m[2].toLowerCase()], m[1], m[3]);
  m = /^(.+?)\s+(?:is|are)\s+(\w+)(\s.*)?$/i.exec(t);
  if (m && VERB[m[2].toLowerCase()]) return imp(VERB[m[2].toLowerCase()], m[1], m[3] ?? "");
  return tidy(t.replace(/\b(should|must)\s+not\s+be\b/gi, "not to be").replace(/\b(should|must|needs? to|has to|have to)\s+be\b/gi, "to be").replace(/\bdont\b/gi, "don't"));
}
function cleanObservation(t: string) {
  return tidy(t.replace(/^(the|there is|there are|it is)\s+/i, "").replace(/\b(is|are)\s+visible\b/gi, "visible").replace(/\bhas not been\b/gi, "not").replace(/\bhave not been\b/gi, "not"));
}

export const FALLBACK_CORRECTION = "Rectify as per tech pack / approved sample.";
export const MEASURE_CORRECTION = "Correct pattern; re-measure to spec within tolerance.";

// One typed line -> one row. `verbatim` keeps the inspector's own words in the observation (Add as typed).
export function sheetRow(line: string, verbatim = false): SheetRow {
  let raw = line.replace(/^\d+[).\-:]?\s*(?=[A-Za-z])/, "").trim();
  let areaHint = "";
  const named = /^([A-Za-z][^:–—]{1,30})\s*[:–—]\s*(.+)$/.exec(raw);
  if (named) { areaHint = named[1].trim(); raw = named[2].trim(); }
  const low = `${areaHint} ${raw}`.toLowerCase();
  const area = areaHint ? tidy(areaHint).replace(/\.$/, "") : (AREAS.find(([re]) => re.test(low))?.[1] ?? "General");

  // Sentences, split also at ", please ..." so an observation and its instruction in one line come apart.
  const sentences = raw.split(/(?<=[.;!?])\s+|\s*\.\s+(?=[A-Za-z])|,\s*(?=(?:please|kindly|pls)\b)|\s+and\s+(?=(?:please|kindly)\b)/i).map((x) => x.trim()).filter(Boolean);
  const observations: string[] = [];
  const instructions: string[] = [];
  for (const s of sentences) (INSTR.test(s) || IMPERATIVE.test(s.replace(/^(please|kindly|pls)\s+/i, "")) ? instructions : observations).push(s);
  const obsText = observations.join(" ");

  // A measurement off spec, read from the observation only (never from an instruction like "hem should be 1 inch").
  const dev = /(\d+(?:\s+\d\/\d)?|\d\/\d|\d*\.\d+)\s*(?:"|''|inch(?:es)?|in\b|cm|mm)?\s*(short|less|small|smaller|down|minus|long|more|big|bigger|extra|plus|over|up)\b/i.exec(obsText)
    ?? /\b(short|less|long|more|extra)\s*(?:by)?\s*(\d+(?:\s+\d\/\d)?|\d\/\d|\d*\.\d+)\s*(?:"|''|inch(?:es)?|in\b|cm|mm)?/i.exec(obsText);
  if (dev) {
    const numFirst = /^\d|^\./.test(dev[1]);
    const num = numFirst ? dev[1] : dev[2];
    const word = (numFirst ? dev[2] : dev[1]).toLowerCase();
    const unit = /\bcm\b/i.test(obsText) ? " cm" : /\bmm\b/i.test(obsText) ? " mm" : '"';
    const dir = /short|less|small|down|minus/.test(word) ? "short of spec" : "over spec";
    return { area, observation: verbatim ? tidy(obsText) : `${fmtNum(num)}${unit} ${dir}.`, correction: instructions.length ? instructions.map(toCorrection).join(" ") : MEASURE_CORRECTION };
  }
  if (observations.length) {
    return { area, observation: verbatim ? tidy(obsText) : cleanObservation(obsText), correction: instructions.length ? instructions.map(toCorrection).join(" ") : FALLBACK_CORRECTION };
  }
  // Only an instruction: the observation restates the requirement, the correction keeps it exactly.
  return { area, observation: tidy(`Requirement: ${cleanInstruction(instructions.join(" ")).replace(/\.$/, "")}`), correction: instructions.map(toCorrection).join(" ") };
}

export const sheetRows = (text: string, verbatim = false) => text.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, MAX_ROWS).map((l) => sheetRow(l, verbatim));

// The one-line summary under the result badge.
export function sheetSummary(rows: SheetRow[], verdict: SheetVerdict): string {
  const n = rows.length;
  const key = rows.slice(0, 3).map((r) => r.area.toLowerCase()).join(", ");
  if (verdict === "approved") return n ? `Sample approved. ${n} observation${n > 1 ? "s" : ""} noted for bulk.` : "Sample approved as submitted.";
  if (verdict === "approved_with_comments") return `Approved for bulk with ${n} comment${n > 1 ? "s" : ""} (${key}) to be implemented in production.`;
  return `${n} point${n > 1 ? "s" : ""} to correct — ${key}. Resubmit a corrected sample before bulk.`;
}

// Everything on a sheet, as the page holds it and the database stores it.
// `date` is the check date as YYYY-MM-DD.
export type SheetData = {
  refNo: string; date: string; buyer: string; style: string; factory: string; stage: string; size: string; checkedBy: string;
  verdict: SheetVerdict; summary: string; nextStep: string; rows: SheetRow[];
};

// A measurement observation, shown in red.
export const isDeviation = (observation: string) => /short|long|less|more|over|exceed/i.test(observation) && /\d|[½¼¾⅛⅜⅝⅞]/.test(observation);

// What is wrong with a sheet before it is saved, or "" when it can go.
export function sheetProblem(d: SheetData): string {
  if (!d.rows.length) return "Add at least one comment.";
  if (d.rows.length > MAX_ROWS) return `Keep the sheet under ${MAX_ROWS} points.`;
  for (const [i, r] of d.rows.entries()) {
    if (!r.observation.trim()) return `Point ${i + 1}: write the observation.`;
    if (!r.correction.trim()) return `Point ${i + 1}: write the correction required.`;
    if ([r.area, r.observation, r.correction].some((c) => c.length > MAX_CELL)) return `Point ${i + 1}: keep each cell under ${MAX_CELL} letters.`;
  }
  if (!d.summary.trim()) return "Write the one-line summary.";
  if (!d.nextStep.trim()) return "Write the next step.";
  if (!stageOf(d.stage)) return "Pick the sample stage.";
  if (!verdictOf(d.verdict)) return "Pick the result.";
  return "";
}

// The notes saved on the QC check, so the check reads on its own (order QC tab, factory message, history).
export function sheetNotes(d: SheetData): string {
  return [`${d.refNo} · ${verdictOf(d.verdict)?.badge ?? d.verdict}`, d.summary, ...d.rows.map((r, i) => `${i + 1}. ${r.area}: ${r.observation} → ${r.correction}`), `Next step: ${d.nextStep}`].join("\n");
}

// The sheet as a WhatsApp message.
export function sheetText(d: SheetData, orderNo: string): string {
  const v = verdictOf(d.verdict);
  return [
    `*Sample Comment Sheet — Sourcingo*`, `Ref: ${d.refNo} | Date: ${day(d.date)}`, `Order: ${orderNo} | Style: ${d.style}${d.size ? ` | Size: ${d.size}` : ""}`, `Factory: ${d.factory} | Stage: ${stageOf(d.stage)?.label ?? d.stage}`,
    "", `*Result: ${v?.badge ?? d.verdict}*`, d.summary, "",
    ...d.rows.map((r, i) => `${i + 1}. *${r.area}* — ${r.observation} → ${r.correction}`),
    "", `Next step: ${d.nextStep}`, "", `Checked by: ${d.checkedBy}`,
  ].join("\n");
}

export const sheetFileName = (refNo: string, style: string) => `Sourcingo_Sample_Comment_Sheet_${refNo}${style ? `_${style.replace(/[^\w-]+/g, "_")}` : ""}.pdf`;
