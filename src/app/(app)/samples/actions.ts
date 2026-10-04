"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { SAMPLE_TYPES, type SampleStatus } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok?: string; error?: string; nonce?: number };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const opt = (form: FormData, key: string) => text(form, key) || null;
const NOT_ALLOWED = "Only merchandisers, managers, QC and the owner can change samples.";

function refresh(id?: string) {
  revalidatePath("/", "layout");
  if (id) revalidatePath(`/samples/${id}`);
}

// Database rule messages are already written for people; anything else is shown as is.
const plain = (msg: string) => (msg.includes("row-level security") ? NOT_ALLOWED : msg);

function details(form: FormData) {
  const qty = Number(text(form, "qty") || "1");
  const type = text(form, "sample_type");
  return {
    row: {
      buyer_id: text(form, "buyer_id"),
      sample_type: SAMPLE_TYPES.some((t) => t.value === type) ? type : "development",
      description: opt(form, "description"),
      buyer_ref: opt(form, "buyer_ref"),
      fabric: opt(form, "fabric"),
      qty,
      merchandiser_id: opt(form, "merchandiser_id"),
      received_on: opt(form, "received_on"),
      due_date: opt(form, "due_date"),
      remarks: opt(form, "remarks"),
    },
    problem: !text(form, "buyer_id")
      ? "Choose the buyer."
      : !text(form, "due_date")
        ? "Set the date the buyer needs this sample by."
        : !Number.isInteger(qty) || qty < 1
          ? "Quantity must be a whole number of pieces, at least 1."
          : !text(form, "description") && !text(form, "fabric")
            ? "Say what the sample is, or at least its fabric."
            : null,
  };
}

export async function createSample(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  const { row, problem } = details(form);
  if (problem) return { error: problem };
  const factory = opt(form, "factory_id");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("samples")
    .insert({
      ...row,
      factory_id: factory,
      status: factory ? "with_vendor" : "received",
      issued_on: factory ? opt(form, "issued_on") : null,
      vendor_due: factory ? opt(form, "vendor_due") : null,
    })
    .select("id")
    .single();
  if (error) return { error: plain(error.message) };
  refresh();
  redirect(`/samples/${data.id}?new=1`);
}

export async function saveSample(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  const id = text(form, "id");
  const { row, problem } = details(form);
  if (problem) return { error: problem };
  // Only the dates of steps the sample has reached are on the form.
  const extra: Record<string, string | null> = {};
  for (const k of ["factory_id", "issued_on", "vendor_due", "ready_on", "dispatched_on", "courier", "tracking", "feedback"]) {
    if (form.has(k)) extra[k] = opt(form, k);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("samples").update({ ...row, ...extra }).eq("id", id).select("id");
  if (error) return { error: plain(error.message) };
  if (!data?.length) return { error: "That sample is gone or you can't change it. Reload the page." };
  refresh(id);
  return { ok: "Saved.", nonce: Date.now() };
}

const MOVES: Record<SampleStatus, string[]> = {
  received: [],
  with_vendor: ["factory_id", "issued_on", "vendor_due", "due_date"],
  ready: ["ready_on"],
  dispatched: ["dispatched_on", "courier", "tracking"],
  approved: ["feedback"],
  changes: ["feedback"],
  rejected: ["feedback"],
  cancelled: [],
};

// Moves a sample to its next step, with that step's details and an optional note.
export async function moveSample(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getMe();
  if (!isOps(me?.role)) return { error: NOT_ALLOWED };
  const id = text(form, "id");
  const to = text(form, "to") as SampleStatus;
  if (!(to in MOVES)) return { error: "Unknown step." };
  const note = text(form, "note");
  if (to === "with_vendor" && !text(form, "factory_id")) return { error: "Choose the vendor." };
  if (to === "changes" && !text(form, "feedback")) return { error: "Write what the buyer wants changed, so the vendor can act on it." };
  if (to === "cancelled" && !note) return { error: "Say why it's cancelled." };
  if (note.length > 1000) return { error: "Keep the note under 1,000 characters." };

  const patch: Record<string, string | null> = { status: to };
  for (const k of MOVES[to]) if (form.has(k)) patch[k] = opt(form, k);
  const supabase = await createClient();
  const { data, error } = await supabase.from("samples").update(patch).eq("id", id).select("id");
  if (error) return { error: plain(error.message) };
  if (!data?.length) return { error: "That sample is gone or you can't change it. Reload the page." };
  if (note) {
    const n = await supabase.from("sample_events").insert({ sample_id: id, kind: "note", note, created_by: me!.id });
    if (n.error) return { error: `Moved, but the note wasn't saved: ${plain(n.error.message)}` };
  }
  refresh(id);
  return { ok: "Updated.", nonce: Date.now() };
}

export async function addSampleNote(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getMe();
  if (!isOps(me?.role)) return { error: NOT_ALLOWED };
  const id = text(form, "id");
  const note = text(form, "note");
  if (!note) return { error: "Write the update first." };
  if (note.length > 1000) return { error: "Keep the note under 1,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.from("sample_events").insert({ sample_id: id, kind: "note", note, created_by: me!.id });
  if (error) return { error: plain(error.message) };
  refresh(id);
  return { ok: "Note added.", nonce: Date.now() };
}

export async function deleteSample(id: string): Promise<FormState> {
  if ((await getMe())?.role !== "owner") return { error: "Only the owner can delete a sample. Cancel it instead." };
  const supabase = await createClient();
  const { data: files } = await supabase.from("files").select("storage_path").eq("sample_id", id);
  if (files?.length) await supabase.storage.from("files").remove(files.map((f) => f.storage_path));
  const { data, error } = await supabase.from("samples").delete().eq("id", id).select("id");
  if (error) return { error: plain(error.message) };
  if (!data?.length) return { error: "That sample is already gone." };
  refresh();
  redirect("/samples");
}
