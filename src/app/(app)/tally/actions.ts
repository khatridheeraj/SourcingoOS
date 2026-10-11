"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "../payments/load";

type Result = { ok?: string; error?: string };

async function call(fn: string, args: Record<string, unknown>) {
  if (!isFinance((await getMe())?.role)) return { error: "Only Accounts and the owner can use the Tally page.", data: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error), data: null };
  revalidatePath("/tally");
  revalidatePath("/payments", "layout");
  return { data, error: undefined };
}

export type TallySettingsInput = { tally_company: string; read_from: string; enabled: boolean };
export async function saveTallySettings(input: TallySettingsInput): Promise<Result> {
  const r = await call("tally_save_settings", { p: input });
  return r.error ? { error: r.error } : { ok: input.enabled ? "Saved. Tally will be read on the office computer's next check." : "Saved. Reading is off." };
}

export async function makeSyncKey(): Promise<{ key?: string; error?: string }> {
  const r = await call("tally_new_key", {});
  return r.error ? { error: r.error } : { key: r.data as string };
}

export async function setLedger(kind: "buyer" | "factory", id: string, ledger: string): Promise<Result> {
  const r = await call("tally_set_ledger", { p_kind: kind, p_id: id, p_ledger: ledger });
  return r.error ? { error: r.error } : { ok: ledger.trim() ? `Linked to "${ledger.trim()}"` : "Unlinked" };
}

export async function bringIn(guids: string[]): Promise<Result & { skipped?: string[] }> {
  if (!guids.length) return { error: "Tick at least one entry." };
  const r = await call("tally_import", { p_guids: guids });
  if (r.error) return { error: r.error };
  const d = r.data as { invoices: number; credit_notes: number; skipped: string[] };
  const parts = [d.invoices && `${d.invoices} ${d.invoices === 1 ? "invoice" : "invoices"}`, d.credit_notes && `${d.credit_notes} ${d.credit_notes === 1 ? "credit note" : "credit notes"}`].filter(Boolean);
  return { ok: parts.length ? `Added ${parts.join(" and ")} to Payments.` : "Nothing new was added.", skipped: d.skipped };
}
