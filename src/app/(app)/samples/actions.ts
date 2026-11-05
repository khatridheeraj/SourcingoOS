"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { isSampleStep } from "@/lib/samples";
import { dayNear, istDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function team(): Promise<string | null> {
  const me = await getMe();
  return canEditOrders(me?.role) ? null : "Only the orders team handles samples.";
}
function refresh(orderId: string) {
  revalidatePath("/samples");
  revalidatePath("/today");
  revalidatePath(`/orders/${orderId}`);
}

// The team adds a sample the factory sent another way (WhatsApp, by hand), with photos already uploaded.
export async function addSample(orderId: string, lineId: string, stage: string, note: string, photos: string[]): Promise<Result> {
  const no = await team();
  if (no) return { error: no };
  if (!isSampleStep(stage)) return { error: "Samples are for the fit, strike off, PP and size-set steps." };
  if (!photos.length) return { error: "Add at least one photo of the sample." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_sample", { p_line: lineId, p_stage: stage, p_note: note.slice(0, 500), p_photos: photos });
  if (error) return { error: friendly(error) };
  refresh(orderId);
  return {};
}

// The team sends a checked sample to the buyer by courier.
export async function forwardSample(orderId: string, id: string, courier: string, awb: string, sentOn: string, note: string): Promise<Result> {
  const no = await team();
  if (no) return { error: no };
  if (!DAY.test(sentOn)) return { error: "Pick the day the sample went." };
  const supabase = await createClient();
  // A sample can't reach the buyer before it reached the team.
  const { data: r } = await supabase.from("sample_rounds").select("sent_at").eq("id", id).maybeSingle();
  if (r?.sent_at && sentOn < istDate(r.sent_at)) return { error: `The sample reached you on ${dayNear(istDate(r.sent_at))}, so it went to the buyer that day or later.` };
  const { error } = await supabase.rpc("forward_sample", { p_id: id, p_courier: courier.slice(0, 60), p_awb: awb.slice(0, 60), p_sent_on: sentOn, p_note: note.slice(0, 500) });
  if (error) return { error: friendly(error) };
  refresh(orderId);
  return {};
}

// The team sends a sample back to the factory before the buyer sees it.
export async function returnSample(orderId: string, id: string, note: string): Promise<Result> {
  const no = await team();
  if (no) return { error: no };
  if (!note.trim()) return { error: "Say what to fix, so the factory knows." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_sample", { p_id: id, p_note: note.slice(0, 1000) });
  if (error) return { error: friendly(error) };
  refresh(orderId);
  return {};
}

// The team records the buyer's answer (given by email, WhatsApp or in person), from the day the buyer gave it.
export async function recordAnswer(orderId: string, id: string, approved: boolean, note: string, photos: string[], on: string): Promise<Result> {
  const no = await team();
  if (no) return { error: no };
  if (!approved && !note.trim()) return { error: "Say what to change, so the factory can fix it." };
  if (!DAY.test(on)) return { error: "Pick the day the buyer answered." };
  const supabase = await createClient();
  // The buyer answers after getting the sample, so never before the day it went to them.
  const { data: r } = await supabase.from("sample_rounds").select("status, dispatched_on").eq("id", id).maybeSingle();
  if (r?.status === "with_buyer" && r.dispatched_on && on < r.dispatched_on) return { error: `The buyer could answer only after getting the sample, so pick ${dayNear(r.dispatched_on)} or later.` };
  const { error } = await supabase.rpc("answer_sample", { p_id: id, p_approved: approved, p_note: note.slice(0, 1000), p_photos: photos, p_on: on });
  if (error) return { error: friendly(error) };
  refresh(orderId);
  return {};
}
