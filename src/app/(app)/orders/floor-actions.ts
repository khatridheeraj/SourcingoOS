"use server";

import { revalidatePath } from "next/cache";
import { canEnterDone, canRecordQc, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";
import { friendly } from "@/lib/errors";
import { fetchAll } from "@/lib/fetch-all";
import { FLOOR_STATUS, INSPECTION_KIND, isRejection, qcFailed, qcRechecked, stepRejected, type FloorStatus, type VisitResult } from "@/lib/floor";
import { TNA_STEPS, todayIST, unitOf } from "@/lib/format";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { recordQc } from "./actions";

const str = (v: unknown) => (v == null ? "" : String(v));

// qc: the latest QC check on an inspection step (Inline, Mid-line, Final QC with its re-checks).
// rejected: the day Quality rejected the goods on any other step, while that is still the latest word on it.
export type VisitStep = { key: string; label: string; planned: string; done: string; qc?: { result: VisitResult; on: string }; rejected?: string };
export type VisitLast = { stage: string; step: string; status: FloorStatus; qtyDone: number | null; expectedOn: string; note: string; at: string; by: string };
export type VisitStyle = {
  id: string; orderId: string; orderNo: string; buyer: string; style: string; colour: string; qty: number; unit: string; photoUrl: string | null;
  due: string; steps: VisitStep[]; last: VisitLast | null;
};
export type VisitData = {
  companyId: string; today: string; factoryId: string; factoryName: string;
  // Quality and the owner record inspections as Pass or Fail; the orders team posts updates only.
  canQc: boolean;
  // Factories with production running, for switching the visit to another one.
  factories: { id: string; name: string; styles: number }[];
  styles: VisitStyle[];
};

// What a factory visit needs: every style in production at the factory (or on one order), each with its steps and
// the latest update from the floor.
export async function loadVisit(scope: { factoryId?: string; orderId?: string }): Promise<{ error?: string; visit?: VisitData }> {
  const me = await getMe();
  if (!canEnterDone(me?.role) || !me?.companyId) return { error: "Only Quality and the orders team post production updates." };
  const uuid = /^[0-9a-f-]{36}$/i;
  if ((scope.factoryId && !uuid.test(scope.factoryId)) || (scope.orderId && !uuid.test(scope.orderId))) return { error: "That wasn't found." };
  const supabase = await createClient();
  const [{ data: orders, error }, { data: pos }, buyers, factories, team] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, ship_date, revised_ship_date, order_lines(id, style, colour, qty, factory_id, position, product, photo_path)")
      .eq("company_id", me.companyId!).eq("status", "open").is("order_lines.removed_at", null).order("id").range(a, z)),
    fetchAll((a, z) => supabase.from("factory_pos").select("order_id, factory_id").not("released_at", "is", null).order("id").range(a, z)),
    loadBuyers(),
    loadFactories(),
    loadTeam(),
  ]);
  if (error) return { error: friendly(error) };
  const released = new Set((pos ?? []).map((p) => `${p.order_id}:${p.factory_id}`));
  const running = (orders ?? []).flatMap((o) => (o.order_lines ?? []).filter((l) => l.factory_id && released.has(`${o.id}:${l.factory_id}`)).map((l) => ({ o, l })));
  const counts = new Map<string, number>();
  for (const { l } of running) counts.set(l.factory_id!, (counts.get(l.factory_id!) ?? 0) + 1);
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const list = [...counts.entries()].map(([id, styles]) => ({ id, name: factoryName.get(id) ?? "Factory", styles })).sort((a, b) => a.name.localeCompare(b.name));

  const inScope = running.filter(({ o, l }) => (scope.orderId ? o.id === scope.orderId : true) && (scope.factoryId ? l.factory_id === scope.factoryId : !!scope.orderId));
  const ids = inScope.map(({ l }) => l.id);
  const [{ data: stages }, { data: ups }, { data: signed }, { data: checks }] = ids.length
    ? await Promise.all([
        fetchAll((a, z) => supabase.from("line_stages").select("line_id, stage, label, planned_on, done_on, not_needed, added_at").in("line_id", ids).order("added_at").order("id").range(a, z)),
        supabase.from("floor_updates").select("line_id, stage, status, qty_done, expected_on, note, visited_on, created_by, created_at").in("line_id", ids).order("created_at", { ascending: false }).limit(500),
        (() => {
          const paths = inScope.map(({ l }) => l.photo_path).filter(Boolean) as string[];
          return paths.length ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] });
        })(),
        supabase.from("qc_checks").select("line_id, kind, result, checked_on").in("line_id", ids).in("kind", ["inline", "midline", "final", "recheck"])
          .is("cancelled_at", null).order("checked_on", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const urlOf = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const labelOf = (lineId: string, stage: string) => TNA_STEPS.find((t) => t.key === stage)?.label
    ?? (str((stages ?? []).find((s) => s.line_id === lineId && s.stage === stage)?.label) || "Extra step");

  const styles: VisitStyle[] = inScope.map(({ o, l }) => {
    const rows = (stages ?? []).filter((s) => s.line_id === l.id);
    const step = (key: string, label: string) => {
      const r = rows.find((s) => s.stage === key);
      const kinds = key === "final_qc" ? ["final", "recheck"] : [INSPECTION_KIND[key]];
      const q = INSPECTION_KIND[key] ? (checks ?? []).find((c) => c.line_id === l.id && kinds.includes(c.kind)) : undefined;
      const said = INSPECTION_KIND[key] ? undefined : (ups ?? []).find((x) => x.line_id === l.id && x.stage === key);
      return r?.not_needed ? null : {
        key, label, planned: str(r?.planned_on), done: str(r?.done_on),
        ...(q ? { qc: { result: q.result as VisitResult, on: str(q.checked_on) } } : {}),
        ...(said && isRejection(said, label) ? { rejected: str(said.visited_on) } : {}),
      };
    };
    const u = (ups ?? []).find((x) => x.line_id === l.id);
    return {
      id: l.id, orderId: o.id, orderNo: o.order_no, buyer: buyerOf.get(o.buyer_id) ?? "", style: l.style, colour: str(l.colour), qty: l.qty, unit: unitOf(l.product),
      photoUrl: (l.photo_path && urlOf.get(l.photo_path)) || null, due: str(o.revised_ship_date || o.ship_date),
      steps: [...TNA_STEPS.map((t) => step(t.key, t.label)), ...rows.filter((s) => s.stage.startsWith("extra_")).map((s) => step(s.stage, str(s.label)))]
        .filter((x): x is VisitStep => !!x),
      last: u ? {
        stage: u.stage, step: labelOf(l.id, u.stage), status: u.status as FloorStatus, qtyDone: u.qty_done, expectedOn: str(u.expected_on), note: str(u.note),
        at: u.created_at, by: (u.created_by && people.get(u.created_by)) || "Someone",
      } : null,
    };
  }).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.orderNo.localeCompare(b.orderNo));

  const fid = scope.factoryId ?? (new Set(inScope.map(({ l }) => l.factory_id)).size === 1 ? inScope[0].l.factory_id! : "");
  return {
    visit: {
      companyId: me.companyId, today: todayIST(), canQc: canRecordQc(me.role), factoryId: fid, factoryName: fid ? factoryName.get(fid) ?? "Factory" : "",
      factories: list, styles,
    },
  };
}

export type FloorInput = { lineId: string; orderId: string; stage: string; status: FloorStatus; qty: string; expectedOn: string; note: string; photos: string[] };

// Posts one update from the floor. "Done" also enters the step's done date for today.
export async function postFloorUpdate(input: FloorInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEnterDone(me?.role)) return { error: "Only Quality and the orders team post production updates." };
  if (!FLOOR_STATUS.some((s) => s.key === input.status)) return { error: "Say how the step is: done, on track, running late or a problem." };
  const qty = input.qty.replace(/[,\s]/g, "");
  if (qty && !/^\d+$/.test(qty)) return { error: "Enter the quantity done as a whole number." };
  if (input.expectedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedOn)) return { error: "Pick the ready date from the calendar." };
  if (!input.photos.length) return { error: "Add at least one photo from the floor." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_floor_update", {
    p_line: input.lineId, p_stage: input.stage, p_status: input.status, p_qty: qty ? Number(qty) : null,
    p_expected: input.expectedOn || null, p_note: input.note.trim().slice(0, 500), p_photos: input.photos,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
  revalidatePath(`/orders/${input.orderId}`);
  if (input.status === "done") revalidatePath("/");
  return {};
}

export type VisitRejectInput = { lineId: string; orderId: string; stage: string; note: string; recheckOn: string; photos: string[] };

// Quality rejects goods on a step that isn't an inspection (fabric, cutting, stitching, packing): the floor hears it as a
// problem with the rejection named, and the step stays in Quality's to-do until its goods are checked again.
export async function postVisitReject(input: VisitRejectInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canRecordQc(me?.role)) return { error: "Only the Quality team rejects goods." };
  if (INSPECTION_KIND[input.stage]) return { error: "Inline, Mid-line and Final QC are rejected as a QC check: pick Rejected there." };
  const note = input.note.trim();
  if (!note) return { error: "Write what was rejected and why, so the factory knows what to fix." };
  if (input.recheckOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.recheckOn)) return { error: "Pick the re-check date from the calendar." };
  const supabase = await createClient();
  const { data: extra } = input.stage.startsWith("extra_")
    ? await supabase.from("line_stages").select("label").eq("line_id", input.lineId).eq("stage", input.stage).maybeSingle() : { data: null };
  const label = TNA_STEPS.find((t) => t.key === input.stage)?.label ?? (str(extra?.label) || "Extra step");
  return postFloorUpdate({
    lineId: input.lineId, orderId: input.orderId, stage: input.stage, status: "issue", qty: "", expectedOn: input.recheckOn,
    note: `${stepRejected(label)}: ${note}`, photos: input.photos,
  });
}

export type VisitCheckInput = {
  lineId: string; orderId: string; stage: string; result: VisitResult; qcId: string; pieces: string; defects: string; note: string; recheckOn: string;
  // The check's photos, in its own QC folder; and a copy for the floor, when the visit also posts an update.
  qcPhotos: string[]; floorPhotos: string[];
};

// Records an inspection made on a visit as a QC check, exactly as Record QC does, so a fail flags the style
// (Final QC failed, re-check due) and the merchandiser hears of it from the floor.
// A fail also goes on the floor as a problem; a pass on Inline or Mid-line also marks the step done today.
// After a fail, the next check is its re-check: a re-check that passes goes on the floor too, so the team hears it.
export async function postVisitCheck(input: VisitCheckInput): Promise<{ error?: string; warning?: string }> {
  const me = await getMe();
  if (!canRecordQc(me?.role)) return { error: "Only the Quality team records QC." };
  const kind0 = INSPECTION_KIND[input.stage];
  if (!kind0) return { error: "Pass and Rejected are for Inline, Mid-line and Final QC." };
  if (input.result !== "pass" && input.result !== "fail") return { error: "Pick Pass or Rejected." };
  const note = input.note.trim();
  if (input.result === "fail" && !note) return { error: "Write what was rejected and why, so the factory knows what to fix." };
  if (input.recheckOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.recheckOn)) return { error: "Pick the re-check date from the calendar." };
  const supabase = await createClient();
  const [{ data: last }, { data: step }] = await Promise.all([
    supabase.from("qc_checks").select("result").eq("line_id", input.lineId).in("kind", kind0 === "final" ? ["final", "recheck"] : [kind0])
      .is("cancelled_at", null).order("checked_on", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("line_stages").select("done_on").eq("line_id", input.lineId).eq("stage", input.stage).maybeSingle(),
  ]);
  const recheck = last?.result === "fail";
  // A failed final's re-check is the Re-check type, which counts for shipping. Inline and Mid-line re-checks keep their
  // own type (a Re-check would count as the final), and say so in the notes.
  const kind = recheck && kind0 === "final" ? "recheck" : kind0;
  const notes = recheck && kind0 !== "final" ? `Re-check${note ? `: ${note}` : ""}` : note;
  const res = await recordQc(input.orderId, input.qcId, {
    line_id: input.lineId, kind, checked_on: todayIST(), result: input.result, pieces_checked: input.pieces, defects: input.defects, notes,
  }, input.qcPhotos.map((path) => ({ path, kind: "photo" as const, file_name: "" })));
  if (res.error) return res;
  revalidatePath("/today");
  if (!input.floorPhotos.length) return {};
  const label = TNA_STEPS.find((t) => t.key === input.stage)?.label ?? "QC";
  const markDone = input.stage !== "final_qc" && !step?.done_on;
  const floor = await postFloorUpdate({
    lineId: input.lineId, orderId: input.orderId, stage: input.stage, status: input.result === "fail" ? "issue" : markDone ? "done" : "on_track", qty: "",
    expectedOn: input.result === "fail" ? input.recheckOn : "", photos: input.floorPhotos,
    note: input.result === "fail" ? `${qcFailed(label)}: ${note}` : recheck ? `${qcRechecked(label)}${note ? `: ${note}` : ""}` : note,
  });
  return floor.error ? { warning: `The QC check is saved, but the floor update didn't post: ${floor.error}` } : {};
}
