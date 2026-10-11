import type { SupabaseClient } from "@supabase/supabase-js";

// What the reader saves for each PO (the same shape as in supabase/functions/po-inbox/reader.ts).
export type PoLine = { style: string; description: string | null; colour: string | null; sizes: string | null; qty: number; rate: number | null };
export type PoReading = {
  buyer_name: string | null;
  buyer_code: string | null;
  po_number: string | null;
  po_date: string | null;
  ship_date: string | null;
  lines: PoLine[];
  notes: string | null;
  doubts: string[];
};

// Asks the PO reader (a Supabase function) to read an incoming PO, as the signed-in person.
// It answers at once; the reading lands on the row a minute or two later.
export async function askToRead(supabase: SupabaseClient, id: string): Promise<{ error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Sign in again, then retry." };
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/po-inbox`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "read", id }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? {} : { error: data.error ?? "The PO reader didn't answer. Try Read again in a minute." };
  } catch {
    return { error: "The PO reader didn't answer. Try Read again in a minute." };
  }
}
