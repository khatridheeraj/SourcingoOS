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

// POs a buyer sent from its page wait (status "receiving") until someone on the orders team is signed in, because only
// the team may ask the reader. Home and Buyer POs call this: it finds them and asks for each to be read once the page
// has been sent, so nobody waits for it.
export async function readBuyerSentPos(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.from("incoming_pos").select("id, buyer_po_uploads!inner(incoming_id)")
    .eq("status", "receiving").eq("source", "upload").limit(5);
  if (!data?.length) return;
  // The session is read now: request data can't be read once the page has gone.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { after } = await import("next/server");
  after(async () => {
    for (const r of data) {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/po-inbox`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "read", id: r.id }),
      }).catch(() => undefined);
    }
  });
}
