"use server";

import { revalidatePath } from "next/cache";
import { attachKind, attachName } from "@/lib/attachments";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import type { NoteKind } from "@/lib/help-guide";
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
