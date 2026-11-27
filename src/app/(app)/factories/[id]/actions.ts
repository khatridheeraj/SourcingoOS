"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type VisitInput = { factoryId: string; visitedOn: string; gstOk: boolean; udyam: string; certs: { name: string; until: string }[]; note: string };

// The roles that visit factories and may vouch for one.
const VERIFIERS = ["owner", "manager", "merchandiser", "quality"];

export async function verifyFactory(v: VisitInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !VERIFIERS.includes(me.role)) return { error: "Only the owner, a manager, a merchandiser or Quality can verify a factory." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.visitedOn)) return { error: "Pick the day of the visit." };
  const certs = v.certs.map((c) => ({ name: c.name.trim(), until: c.until || null })).filter((c) => c.name || c.until);
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_factory", {
    p_factory: v.factoryId, p_visited_on: v.visitedOn, p_gst_ok: v.gstOk, p_udyam: v.udyam.trim() || null,
    p_certs: certs, p_note: v.note.trim().slice(0, 300) || null,
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${v.factoryId}`);
  revalidatePath("/factories");
  return {};
}

export async function takeBackVisit(factoryId: string, id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !VERIFIERS.includes(me.role)) return { error: "Only the owner, a manager, a merchandiser or Quality can do that." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_factory_verification", { p_id: id });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${factoryId}`);
  return {};
}

export type CertInput = { name: string; no: string; until: string; path: string | null; fileName: string | null };

// A certificate the team has seen: saved already checked.
export async function saveCert(factoryId: string, c: CertInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !VERIFIERS.includes(me.role)) return { error: "Only the owner, a manager, a merchandiser or Quality can add a certificate." };
  if (c.until && !/^\d{4}-\d{2}-\d{2}$/.test(c.until)) return { error: "Pick the date it runs out." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_factory_certificate", {
    p_factory: factoryId, p_name: c.name.trim(), p_no: c.no.trim() || null, p_until: c.until || null, p_path: c.path, p_file_name: c.fileName,
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${factoryId}`);
  return {};
}

export async function checkCert(factoryId: string, id: string, ok: boolean, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !VERIFIERS.includes(me.role)) return { error: "Only the owner, a manager, a merchandiser or Quality can check a certificate." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_factory_certificate", { p_id: id, p_ok: ok, p_note: note.trim().slice(0, 200) || null });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${factoryId}`);
  revalidatePath("/today");
  return {};
}

export async function removeCert(factoryId: string, id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !VERIFIERS.includes(me.role)) return { error: "Only the owner, a manager, a merchandiser or Quality can remove a certificate." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_factory_certificate", { p_id: id });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${factoryId}`);
  return {};
}

// Free capacity the factory gave the team on the phone.
export async function saveCapacity(factoryId: string, rows: { week: string; free: number | null }[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !["owner", "manager", "merchandiser", "accounts", "quality"].includes(me.role)) return { error: "Only the team can set a factory's capacity." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_factory_capacity", { p_factory: factoryId, p_weeks: rows });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${factoryId}`);
  return {};
}
