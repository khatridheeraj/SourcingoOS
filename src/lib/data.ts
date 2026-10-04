import { cache } from "react";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { makeWorld, type World, type Buyer, type Dc, type Factory, type Fpo, type Grn, type Inquiry, type Order, type Person, type Qc, type Sample } from "@/lib/model";
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

// Supabase returns at most 1000 rows a request; page through so nothing is
// silently cut off as the data grows. Queries need a stable order (id last).
const PAGE = 1000;
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchAll(make: () => any): Promise<{ data: any[]; error: { message: string } | null }> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
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
  const { world, error } = await buildWorld(supabase, me?.id ?? "", me?.role === "owner");
  return { world, error, me };
});

// The same, from any client (the morning email uses the service key).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildWorld(supabase: any, meId: string, isOwner: boolean) {
  const none = Promise.resolve({ data: [], error: null });
  const [orders, grns, dcs, inquiries, buyers, registry, factories, people, samples, fpos, qcs] = await Promise.all([
    fetchAll(() => supabase.from("sales_orders").select("*, so_styles(*, tna_checkpoints(*))").order("created_at", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("grns").select("*, grn_lines(*)").order("received_at", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("delivery_challans").select("*, dc_lines(*)").order("created_at", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("inquiries").select("id, buyer_id, product_type, status, next_follow_up, merchandiser_id, created_at, unit, so_id").order("id")),
    fetchAll(() => supabase.from("buyers").select("id, code, default_payment_terms, default_address").order("code")),
    isOwner ? fetchAll(() => supabase.from("buyer_registry").select("buyer_id, real_name").order("buyer_id")) : none,
    fetchAll(() => supabase.from("factories").select("id, name, city, active").order("name").order("id")),
    fetchAll(() => supabase.from("profiles").select("id, full_name, email, role, active").order("id")),
    fetchAll(() => supabase.from("samples").select("*").order("created_at", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("factory_pos").select("*").order("issued_at", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("qc_inspections").select("*").order("inspected_on", { ascending: false }).order("id")),
  ]);
  const error = [orders, grns, dcs, inquiries, buyers, registry, factories, people, samples, fpos, qcs].find((r) => r.error)?.error ?? null;

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
    fpos: (fpos.data ?? []) as Fpo[],
    qcs: ((qcs.data ?? []) as any[]).map((q) => ({ ...q, aql_major: Number(q.aql_major), aql_minor: Number(q.aql_minor) })) as Qc[],
    today: todayIST(),
    now: Date.now(),
    meId,
    isOwner,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { world, error };
}

// Invoices, credit notes and cheques, for the owner and Accounts only.
export const loadBooks = cache(async () => {
  const supabase = await createClient();
  const { world } = await loadWorld();
  return buildBooks(supabase, world);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildBooks(supabase: any, world: World) {
  const [invoices, creditNotes, cheques, allocations, credit] = await Promise.all([
    fetchAll(() => supabase.from("invoices").select("id, invoice_no, buyer_id, invoice_date, amount, due_date, so_id, dc_id, notes, created_at").order("invoice_date", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("credit_notes").select("id, credit_note_no, invoice_id, note_date, amount, notes").order("note_date").order("id")),
    fetchAll(() => supabase.from("cheques").select("id, buyer_id, cheque_no, bank, cheque_date, amount, status, received_on, deposited_on, cleared_on, bounced_on, notes, created_at").order("cheque_date", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("cheque_allocations").select("id, cheque_id, invoice_id, amount").order("id")),
    fetchAll(() => supabase.from("buyers").select("id, credit_days").order("id")),
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
}
