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
