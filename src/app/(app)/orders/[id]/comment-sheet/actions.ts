"use server";

import { revalidatePath } from "next/cache";
import { canRecordQc, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { sheetNotes, sheetProblem, stageOf, verdictOf, type SheetData } from "@/lib/comment-sheet";
import { createClient } from "@/lib/supabase/server";
import { recordQc, type QcFile } from "../../actions";

type Result = { error?: string };

// The next sheet number, taken before the PDF is made so it can be printed on it.
export async function reserveSheetRef(): Promise<{ ref?: string; error?: string }> {
  const me = await getMe();
  if (!canRecordQc(me?.role)) return { error: "Only the Quality team writes comment sheets." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reserve_comment_sheet_ref");
  if (error) return { error: friendly(error) };
  return { ref: String(data) };
}

// Saves a sheet: a QC check on the style (the PDF as its report, the photos as its photos), then the structured
// sheet behind it. Files are already in the check's folder.
export async function saveCommentSheet(orderId: string, qcId: string, lineId: string, d: SheetData, files: QcFile[]): Promise<Result> {
  const me = await getMe();
  if (!canRecordQc(me?.role)) return { error: "Only the Quality team writes comment sheets." };
  const problem = sheetProblem(d);
  if (problem) return { error: problem };
  if (!/^SG-SCS-\d{4}-\d{4,6}$/.test(d.refNo)) return { error: "The sheet has no number yet. Try again." };
  if (!files.some((f) => f.kind === "report")) return { error: "The PDF didn't upload. Try again." };
  const stage = stageOf(d.stage)!;
  const verdict = verdictOf(d.verdict)!;
  const rec = await recordQc(orderId, qcId, { line_id: lineId, kind: stage.qc, checked_on: d.date, result: verdict.result, pieces_checked: "", defects: "", notes: sheetNotes(d) }, files);
  if (rec.error) return rec;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_comment_sheet", {
    p_check: qcId,
    p: { ref_no: d.refNo, stage: d.stage, size: d.size, verdict: d.verdict, summary: d.summary, next_step: d.nextStep, rows: d.rows },
  });
  if (error) return { error: `The check was saved but not the sheet's details: ${friendly(error)}` };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  return {};
}
