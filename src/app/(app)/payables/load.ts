import { type Claim, type ClaimRow, matchClaims, type TallyDebit } from "@/lib/claims";
import type { Payable } from "@/lib/payables";
import { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

// Every bill with money left on it, from Tally's copy. Only the owner and Accounts get any rows.
export async function loadPayables(supabase: Client) {
  const [{ data, error }, tally] = await Promise.all([
    supabase.rpc("payables"),
    supabase.from("tally_settings").select("snapshot_at, enabled").maybeSingle(),
  ]);
  const num = (v: unknown) => (v == null ? null : Number(v));
  const bills: Payable[] = ((data ?? []) as Payable[]).map((p) => ({
    ...p, amount: num(p.amount), settled: Number(p.settled), on_account: Number(p.on_account), open: Number(p.open), days: Number(p.days),
  }));
  return { bills, error, readAt: (tally.data?.snapshot_at as string | null) ?? null, tallyOn: !!tally.data?.enabled };
}

// Every factory claim, matched against the debit notes Tally has, so each reads "not in Tally yet" or "booked".
export async function loadClaims(supabase: Client) {
  const [{ data: claims, error }, { data: debits }] = await Promise.all([
    supabase.from("factory_claims").select("id, claim_no, ledger, bill, order_id, claim_date, reason, pieces, amount, note, created_at, cancelled_at, cancel_reason, orders(order_no)")
      .order("claim_date", { ascending: false }).order("claim_no", { ascending: false }).limit(1000),
    supabase.from("tally_vouchers").select("party, vdate, number, amount, bills").eq("kind", "debit_note").is("gone_at", null).order("vdate").limit(5000),
  ]);
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
  const raw = (claims ?? []).map((c) => ({ ...c, amount: Number(c.amount), order_no: one(c.orders as { order_no: string } | { order_no: string }[] | null)?.order_no ?? null })) as (Claim & { order_no: string | null })[];
  const rows = matchClaims(raw, (debits ?? []) as TallyDebit[]) as (ClaimRow & { order_no: string | null })[];
  return { claims: rows, error };
}
