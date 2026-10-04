import { cache } from "react";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { makeWorld, type Buyer, type Dc, type Factory, type Grn, type Inquiry, type Order, type Person, type Sample } from "@/lib/model";
import { makeBooks } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/* eslint-disable @typescript-eslint/no-explicit-any */
function shapeOrder({ so_styles, ...o }: any): Order {
  return {
    ...o,
    tags: o.tags ?? [],
    styles: ((so_styles ?? []) as any[]).map(({ tna_checkpoints, ...st }) => ({ ...st, checkpoints: [...(tna_checkpoints ?? [])].sort(byPos) })).sort(byPos),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// One order fresh from the database (not cached), for checks inside actions.
export async function loadOrder(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("sales_orders").select("*, so_styles(*, tna_checkpoints(*))").eq("id", id).maybeSingle();
  return data ? shapeOrder(data) : null;
}

// Every order, style, checkpoint, GRN and DC the signed-in person may read,
// loaded once per request. Row-level security decides what comes back.
export const loadWorld = cache(async () => {
  const me = await getMe();
  const supabase = await createClient();
  const isOwner = me?.role === "owner";
  const [orders, grns, dcs, inquiries, buyers, registry, factories, people, samples] = await Promise.all([
    supabase.from("sales_orders").select("*, so_styles(*, tna_checkpoints(*))").order("created_at", { ascending: false }),
    supabase.from("grns").select("*, grn_lines(*)").order("received_at", { ascending: false }),
    supabase.from("delivery_challans").select("*, dc_lines(*)").order("created_at", { ascending: false }),
    supabase.from("inquiries").select("id, buyer_id, product_type, status, next_follow_up, merchandiser_id, created_at, unit, so_id"),
    supabase.from("buyers").select("id, code, default_payment_terms, default_address").order("code"),
    isOwner ? supabase.from("buyer_registry").select("buyer_id, real_name") : Promise.resolve({ data: [], error: null }),
    supabase.from("factories").select("id, name, city, active").order("name"),
    supabase.from("profiles").select("id, full_name, email, role, active"),
    supabase.from("samples").select("*").order("created_at", { ascending: false }),
  ]);
  const error = [orders, grns, dcs, inquiries, buyers, registry, factories, people, samples].find((r) => r.error)?.error ?? null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const names = new Map(((registry.data ?? []) as any[]).map((r) => [r.buyer_id, r.real_name as string]));
  const world = makeWorld({
    orders: ((orders.data ?? []) as any[]).map(shapeOrder),
    grns: ((grns.data ?? []) as any[]).map(({ grn_lines, ...g }) => ({ ...g, lines: grn_lines ?? [] })) as Grn[],
    dcs: ((dcs.data ?? []) as any[]).map(({ dc_lines, ...d }) => ({ ...d, lines: dc_lines ?? [] })) as Dc[],
    inquiries: (inquiries.data ?? []) as Inquiry[],
    buyers: ((buyers.data ?? []) as Buyer[]).map((b) => ({ ...b, real_name: names.get(b.id) })),
    factories: (factories.data ?? []) as Factory[],
    people: (people.data ?? []) as Person[],
    samples: (samples.data ?? []) as Sample[],
    today: todayIST(),
    now: Date.now(),
    meId: me?.id ?? "",
    isOwner,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { world, error, me };
});

// Invoices, credit notes and cheques, for the owner and Accounts only.
export const loadBooks = cache(async () => {
  const supabase = await createClient();
  const { world } = await loadWorld();
  const [invoices, creditNotes, cheques, allocations, credit] = await Promise.all([
    supabase.from("invoices").select("id, invoice_no, buyer_id, invoice_date, amount, due_date, so_id, dc_id, notes, created_at").order("invoice_date", { ascending: false }),
    supabase.from("credit_notes").select("id, credit_note_no, invoice_id, note_date, amount, notes").order("note_date"),
    supabase.from("cheques").select("id, buyer_id, cheque_no, bank, cheque_date, amount, status, received_on, deposited_on, cleared_on, bounced_on, notes, created_at").order("cheque_date", { ascending: false }),
    supabase.from("cheque_allocations").select("id, cheque_id, invoice_id, amount"),
    supabase.from("buyers").select("id, credit_days"),
  ]);
  const error = [invoices, creditNotes, cheques, allocations, credit].find((r) => r.error)?.error ?? null;
  const days = new Map((credit.data ?? []).map((b) => [b.id as string, b.credit_days as number | null]));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const books = makeBooks({
    invoices: (invoices.data ?? []) as any[],
    creditNotes: (creditNotes.data ?? []) as any[],
    cheques: (cheques.data ?? []) as any[],
    allocations: (allocations.data ?? []) as any[],
    buyers: world.buyers.map((b) => ({ ...b, credit_days: days.get(b.id) ?? null })),
    today: world.today,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { books, world, error };
});
