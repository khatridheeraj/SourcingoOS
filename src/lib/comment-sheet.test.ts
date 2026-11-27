import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_CORRECTION, MEASURE_CORRECTION, sheetNotes, sheetProblem, sheetRow, sheetRows, sheetSummary, toCorrection, type SheetData } from "./comment-sheet.ts";

test("an instruction NOT to do something is never turned into doing it", () => {
  // Dheeraj, 12 Nov 2026: the team wrote "no fusing should be applied" and the first version produced "apply fusing".
  assert.equal(sheetRow("No fusing should be applied to the collar band, collar and placket.").correction, "Do not apply fusing to the collar band, collar and placket.");
  assert.equal(sheetRow("Collar: fusing should not be used").correction, "Do not use fusing.");
  assert.equal(sheetRow("Do not use contrast thread on hem").correction, "Do not use contrast thread on hem.");
  assert.equal(sheetRow("fusing applied on pocket flap which is not required. remove it").correction, "Remove it.");
  assert.equal(sheetRow("use only matching thread for topstitch").correction, "Use only matching thread for topstitch.");
});

test("a positive instruction keeps its meaning and reads as an imperative", () => {
  assert.equal(sheetRow("Fusing has not been applied to the placket, neckband and collar. please ensure fusing is applied to all these areas.").correction, "Apply fusing to all these areas.");
  assert.equal(sheetRow("buttons must be attached with lock stitch").correction, "Attach buttons with lock stitch.");
  assert.equal(sheetRow("The wash care lable is missing. please attach it as required.").correction, "Attach it as required.");
  assert.equal(sheetRow("The inside hem fold is visible. please ensure proper folding and stitching.").correction, "Ensure proper folding and stitching.");
  assert.equal(sheetRow("sleeve margin tucks are missing, please add tucks as per sample").correction, "Add tucks as per sample.");
});

test("a measurement off spec is read from the observation, with its direction", () => {
  assert.deepEqual(sheetRow("Sleeve length is 2 inches short."), { area: "Sleeve", observation: '2" short of spec.', correction: MEASURE_CORRECTION });
  assert.equal(sheetRow("Bottom measurement is 1/2 inch short.").observation, '½" short of spec.');
  assert.equal(sheetRow("chest 1 inch more").observation, '1" over spec.');
  // A length given as an instruction is not a deviation.
  assert.equal(sheetRow("hem should be 1 inch instead of 1/2 inch").correction, "Hem to be 1 inch instead of 1/2 inch.");
});

test("with no instruction and no measurement, the correction is left for the inspector", () => {
  const r = sheetRow("No tucks have been made on the sleeve margins.");
  assert.equal(r.correction, FALLBACK_CORRECTION);
  assert.equal(r.observation, "No tucks have been made on the sleeve margins.");
  assert.equal(sheetRow("shade variation between front and back panel").correction, FALLBACK_CORRECTION);
});

test("the area is a topic label and a named prefix wins", () => {
  assert.equal(sheetRow("Fusing: not applied on placket").area, "Fusing");
  assert.equal(sheetRow("fusing not applied on placket, neckband and collar").area, "Fusing");
  assert.equal(sheetRow("loose threads inside lining").area, "Lining");
  assert.equal(sheetRow("something odd").area, "General");
});

test("add as typed keeps the inspector's words", () => {
  assert.equal(sheetRow("Sleeve length is 1 inch short.", true).observation, "Sleeve length is 1 inch short.");
});

test("numbered lines and blank lines are handled", () => {
  const rows = sheetRows("1. Sleeve Length: Sleeve length is 2 inches short.\n\n6fusing has not been applied to the placet. please ensure fusing is applied.");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].area, "Fusing");
  assert.equal(rows[1].observation, "Fusing not applied to the placet.");
});

test("toCorrection strips politeness only", () => {
  assert.equal(toCorrection("Kindly trim all loose threads, please"), "Trim all loose threads.");
});

test("the summary follows the result", () => {
  const rows = sheetRows("sleeve 1 inch short\nhem fold visible");
  assert.match(sheetSummary(rows, "not_approved"), /^2 points to correct — sleeve, hem\. Resubmit/);
  assert.match(sheetSummary(rows, "approved_with_comments"), /^Approved for bulk with 2 comments/);
  assert.equal(sheetSummary([], "approved"), "Sample approved as submitted.");
});

const sheet: SheetData = {
  refNo: "SG-SCS-2026-0007", date: "2026-11-12", buyer: "BYR-AH-0001", style: "SH-101", factory: "Damru", stage: "pp", size: "M", checkedBy: "Himesh Singh",
  verdict: "not_approved", summary: "1 point to correct.", nextStep: "resubmit.", rows: [{ area: "Sleeve", observation: '2" short of spec.', correction: MEASURE_CORRECTION }],
};

test("a sheet is checked before it is saved", () => {
  assert.equal(sheetProblem(sheet), "");
  assert.equal(sheetProblem({ ...sheet, rows: [] }), "Add at least one comment.");
  assert.equal(sheetProblem({ ...sheet, rows: [{ area: "A", observation: "x", correction: "" }] }), "Point 1: write the correction required.");
  assert.equal(sheetProblem({ ...sheet, stage: "nope" }), "Pick the sample stage.");
});

test("the check's notes carry the whole sheet", () => {
  assert.equal(sheetNotes(sheet), 'SG-SCS-2026-0007 · NOT APPROVED\n1 point to correct.\n1. Sleeve: 2" short of spec. → Correct pattern; re-measure to spec within tolerance.\nNext step: resubmit.');
});
