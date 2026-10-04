import { cache } from "react";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { makeWorld, type Buyer, type Dc, type Factory, type Grn, type Inquiry, type Order, type Person } from "@/lib/model";
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
  const [orders, grns, dcs, inquiries, buyers, registry, factories, people] = await Promise.all([
    supabase.from("sales_orders").select("*, so_styles(*, tna_checkpoints(*))").order("created_at", { ascending: false }),
    supabase.from("grns").select("*, grn_lines(*)").order("received_at", { ascending: false }),
    supabase.from("delivery_challans").select("*, dc_lines(*)").order("created_at", { ascending: false }),
    supabase.from("inquiries").select("id, buyer_id, product_type, status, next_follow_up, merchandiser_id, created_at, unit, so_id"),
    supabase.from("buyers").select("id, code, default_payment_terms, default_address").order("code"),
    isOwner ? supabase.from("buyer_registry").select("buyer_id, real_name") : Promise.resolve({ data: [], error: null }),
    supabase.from("factories").select("id, name, city, active").order("name"),
    supabase.from("profiles").select("id, full_name, email, role, active"),
  ]);
  const error = [orders, grns, dcs, inquiries, buyers, registry, factories, people].find((r) => r.error)?.error ?? null;

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
    today: todayIST(),
    now: Date.now(),
    meId: me?.id ?? "",
    isOwner,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { world, error, me };
});
