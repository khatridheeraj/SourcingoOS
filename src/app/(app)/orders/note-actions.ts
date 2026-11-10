"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { isPartner } from "@/lib/auth-roles";
import { createClient } from "@/lib/supabase/server";
import { NOTE_MAX } from "@/lib/notes";

// One note on an order's team conversation, with the people it tags and its photos (already uploaded by the browser
// into the note's own folder). Writing on an order also clears the writer's own tags there.
export async function postOrderNote(input: { id: string; orderId: string; body: string; mentions: string[]; photos: string[] }): Promise<{ error?: string; field?: "body" }> {
  const me = await getMe();
  if (!me?.role || !me.companyId || isPartner(me.role)) return { error: "Only the team can write notes on an order." };
  const body = input.body.trim();
  if (!body) return { error: "Write the note first.", field: "body" };
  if (body.length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX.toLocaleString("en-IN")} characters (it has ${body.length.toLocaleString("en-IN")}).`, field: "body" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_order_note", {
    p_id: input.id, p_order: input.orderId, p_body: body, p_mentions: input.mentions, p_photos: input.photos,
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${input.orderId}`);
  revalidatePath("/today");
  return {};
}

// Marks a tag as dealt with: one note, or (with no note) every note on the order that tags me.
export async function clearMention(orderId: string, noteId?: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || isPartner(me.role)) return { error: "Only the team can do that." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_mentions", { p_order: orderId, p_note: noteId ?? null });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  return {};
}
