import type { FpoLine } from "@/components/factory-po-doc";

export type PublicPo = {
  po_no: string; date: string; delivery: string | null; payment_days: number;
  accepted_at: string | null; accepted_via: string | null; accept_note: string | null;
  company: { name: string; address: string | null; ship_address: string | null; gstin: string | null; phone: string | null; email: string | null };
  factory: { name: string; address: string | null; gstin: string | null; phone: string | null; contact: string | null; email: string | null };
  lines: (Omit<FpoLine, "rate"> & { rate: number | string | null })[];
};

// The PO behind a link, through the po-inbox function: the token is the only key, and photo links are made there.
export async function poByToken(action: "po_doc" | "po_accept", token: string, name = ""): Promise<{ data?: PublicPo & { ok?: boolean }; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { error: "Unknown PO." };
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/po-inbox`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    body: JSON.stringify({ action, token, name }),
  }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok || !data || data.error) return { error: data?.error ?? "The PO couldn't be opened. Try again." };
  return { data };
}
