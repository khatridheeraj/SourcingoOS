"use server";

import { revalidatePath } from "next/cache";
import { attachKind, attachName } from "@/lib/attachments";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import type { NoteKind } from "@/lib/help-guide";
import { TNA_STEPS, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type TeamNote = {
  id: string; no: number; kind: NoteKind; body: string; page: string | null; page_title: string | null; photos: string[];
  status: "new" | "planned" | "later" | "done" | "declined"; reply: string | null; replied_by: string | null; replied_at: string | null;
  decided_at: string | null; seen: boolean; created_at: string; mine: boolean;
  // The owner only.
  suggestion?: string | null; sender?: string | null; sender_role?: string | null;
  // The attachments with signed links, filled in here.
  files?: NoteFile[];
};

export type NoteFile = { url: string; kind: "photo" | "video" | "file"; name: string };

// Logs a question typed into Help with the topic it was answered with, if any. Returns its id for the thumbs up or down.
export async function logAsk(question: string, page: string, topic: string | null): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("log_help_ask", { p_question: question.slice(0, 500), p_page: page, p_topic: topic ?? "" });
  return typeof data === "string" ? data : null;
}

export async function rateAsk(id: string, helpful: boolean): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("rate_help_ask", { p_id: id, p_helpful: helpful });
}

export async function sendNote(n: { kind: NoteKind; body: string; page: string; pageTitle: string; photos: string[] }): Promise<{ no?: number; error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_team_note", { p_kind: n.kind, p_body: n.body, p_page: n.page, p_page_title: n.pageTitle, p_photos: n.photos });
  if (error) return { error: friendly(error) };
  revalidatePath("/", "layout");
  return { no: Number((data as { no: number }).no) };
}

// The signed-in person's notes (the owner: everyone's), newest first, with links to their attachments.
export async function loadNotes(): Promise<{ notes: TeamNote[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_notes_list");
  if (error) return { notes: [], error: friendly(error) };
  const notes = (data ?? []) as TeamNote[];
  const paths = notes.flatMap((n) => n.photos ?? []);
  if (paths.length) {
    const { data: signed } = await supabase.storage.from("order-photos").createSignedUrls(paths, 3600);
    const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const n of notes) {
      n.files = (n.photos ?? []).flatMap((p) => {
        const u = url.get(p);
        return u ? [{ url: u, kind: attachKind(p), name: attachName(p) }] : [];
      });
    }
  }
  return { notes };
}

export async function markSeen(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("mark_team_notes_seen");
}

export async function decideNote(id: string, status: TeamNote["status"], reply: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can answer team notes." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_team_note", { p_id: id, p_status: status, p_reply: reply });
  if (error) return { error: friendly(error) };
  revalidatePath("/feedback");
  revalidatePath("/", "layout");
  return {};
}

export type OrderCheck = { title: string; items: { ok: boolean; text: string }[] };

// Help's live check of one order: what is blocking it right now and the next step, read from the same
// rules the order screen enforces, so the answer is never a guess.
export async function checkOrder(orderId: string): Promise<OrderCheck | null> {
  const me = await getMe();
  if (!me?.role || !/^[0-9a-f-]{36}$/.test(orderId)) return null;
  const supabase = await createClient();
  const { data: o } = await supabase.from("orders")
    .select("id, order_no, status, order_lines(id, style, factory_id, photo_path)")
    .eq("id", orderId).is("order_lines.removed_at", null).maybeSingle();
  if (!o) return null;
  const title = `Live check of ${o.order_no}`;
  if (o.status !== "open") return { title, items: [{ ok: false, text: `This order is ${o.status}, so nothing on it can change.` }] };
  const lines = (o.order_lines ?? []) as { id: string; style: string; factory_id: string | null; photo_path: string | null }[];
  const items: OrderCheck["items"] = [];
  const unassigned = lines.filter((l) => !l.factory_id).map((l) => l.style);
  if (unassigned.length) items.push({ ok: false, text: `No factory picked yet for ${unassigned.join(", ")}. Pick one on the style card.` });
  const factoryIds = [...new Set(lines.flatMap((l) => (l.factory_id ? [l.factory_id] : [])))];
  const today = todayIST();
  const [{ data: facs }, { data: pos }, { data: stages }, { data: pending }] = await Promise.all([
    factoryIds.length ? supabase.from("factories").select("id, name").in("id", factoryIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("factory_pos").select("factory_id, released_at, lock_requested_at, lock_note, mailed_at, accepted_at").eq("order_id", orderId),
    supabase.from("line_stages").select("line_id, stage, planned_on, done_on, not_needed").eq("order_id", orderId).is("done_on", null).eq("not_needed", false).lt("planned_on", today),
    supabase.from("step_updates").select("id").eq("order_id", orderId).eq("status", "pending"),
  ]);
  const name = new Map((facs ?? []).map((f) => [f.id, f.name as string]));
  for (const fid of factoryIds) {
    const f = name.get(fid) ?? "the factory";
    const po = (pos ?? []).find((p) => p.factory_id === fid);
    if (po?.released_at) {
      items.push({ ok: true, text: `${f}: PO approved, so Done dates are open.` });
      if (po.accepted_at) items.push({ ok: true, text: `${f} accepted the PO.` });
      else if (po.mailed_at) items.push({ ok: false, text: `${f} hasn't accepted the emailed PO yet. Help follows up every 2 hours; you can also call them.` });
      continue;
    }
    const [{ data: block }, { data: send }] = await Promise.all([
      supabase.rpc("release_blocker", { p_order: orderId, p_factory: fid }),
      supabase.rpc("po_send_blocker", { p_order: orderId, p_factory: fid }),
    ]);
    const why = [block as string | null, send as string | null].filter((x): x is string => !!x);
    if (why.length) {
      items.push({ ok: false, text: `${f}: PO not approved yet, so Done dates stay closed. Next: ${why[0]}` });
      if (why[1]) items.push({ ok: false, text: `${f}: then ${why[1].charAt(0).toLowerCase()}${why[1].slice(1)}` });
    } else if (po?.lock_requested_at) items.push({ ok: false, text: `${f}: PO sent for approval. Waiting for Dheeraj to approve it; Done dates open after that.` });
    else if (po?.lock_note) items.push({ ok: false, text: `${f}: Dheeraj sent the PO back: "${po.lock_note}". Fix that, then press Send PO for approval.` });
    else items.push({ ok: false, text: `${f}: everything is ready. Press Send PO for approval on the factory's PO.` });
  }
  const late = stages ?? [];
  if (late.length) {
    const style = new Map(lines.map((l) => [l.id, l.style]));
    const few = late.slice(0, 3).map((s) => `${style.get(s.line_id) ?? "a style"} ${TNA_STEPS.find((t) => t.key === s.stage)?.label ?? "extra step"}`).join(", ");
    items.push({ ok: false, text: `${late.length} step${late.length > 1 ? "s are" : " is"} past target with no Done date (${few}${late.length > 3 ? ", …" : ""}). Fill the Done date, or move the target with a reason.` });
  } else if (factoryIds.length) items.push({ ok: true, text: "No step is past its target." });
  if (pending?.length) items.push({ ok: false, text: `The factory marked ${pending.length} step${pending.length > 1 ? "s" : ""} done. Confirm ${pending.length > 1 ? "them" : "it"} at the top of the order.` });
  if (!items.length) items.push({ ok: true, text: "Nothing is blocking this order right now." });
  return { title, items };
}
