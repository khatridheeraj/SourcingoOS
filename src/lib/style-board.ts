// Every open style across every order, each with its own stage and next step (style-track.ts): Orders > By style
// and Orders > By factory read this.
import { NO_COMPANY } from "@/lib/names";
import { canEditOrders, getMe } from "@/lib/auth";
import { can } from "@/lib/auth-roles";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { dueDate, SHIP_QC, stageReached, todayIST } from "@/lib/format";
import { shipClock, type Clock } from "@/lib/journey";
import { loadShipProgress } from "@/lib/shipments";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { byUrgency, styleStates, type StyleState } from "@/lib/style-track";

export type BoardStyle = StyleState & {
  orderId: string; orderNo: string; buyerPo: string; buyer: string; factory: string; qty: number; product: string;
  colour: string; photoUrl: string | null; clock: Clock;
};

type Row = {
  id: string; order_no: string; buyer_id: string; buyer_po: string; ship_date: string | null; revised_ship_date: string | null; stage: string | null;
  status: string; closed_short_at: string | null;
  order_lines: { id: string; style: string; colour: string | null; qty: number; factory_id: string | null; product: string; photo_path: string | null; ship_date: string | null }[] | null;
};

export async function loadStyleBoard(): Promise<{ styles: BoardStyle[]; factories: { id: string; name: string; phone: string | null }[]; error: string | null; role: string | null }> {
  const me = await getMe();
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const prices = canEditOrders(me?.role);
  const seeBuyers = prices && can(me, "buyers");
  const [{ data, error }, buyers, factories] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders")
      .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, stage, status, closed_short_at, order_lines(id, style, colour, qty, factory_id, product, photo_path, ship_date)")
      .eq("company_id", companyId).eq("status", "open").is("order_lines.removed_at", null).order("id").range(a, z)),
    loadBuyers(),
    loadFactories(),
  ]);
  const orders = (data ?? []) as unknown as Row[];
  const ids = orders.map((o) => o.id);
  const none = { data: [], error: null };
  const [steps, ship, fpos, qc, smp, ups, withPo, prices_] = await Promise.all([
    ids.length ? fetchAll((a, z) => supabase.from("line_stages").select("order_id, line_id, stage, planned_on, done_on, not_needed").in("order_id", ids).eq("not_needed", false).order("id").range(a, z)) : none,
    loadShipProgress(supabase, ids),
    ids.length ? fetchAll((a, z) => supabase.from("factory_pos").select("order_id, factory_id, released_at, lock_requested_at").in("order_id", ids).order("id").range(a, z)) : none,
    ids.length ? fetchAll((a, z) => supabase.from("qc_checks").select("line_id, result").in("order_id", ids).in("kind", SHIP_QC).is("cancelled_at", null)
      .order("checked_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(a, z)) : none,
    ids.length ? fetchAll((a, z) => supabase.from("sample_rounds").select("order_id, line_id").in("order_id", ids).eq("status", "with_team").order("id").range(a, z)) : none,
    ids.length ? fetchAll((a, z) => supabase.from("step_updates").select("order_id, line_id").in("order_id", ids).eq("status", "pending").order("id").range(a, z)) : none,
    seeBuyers && ids.length ? supabase.rpc("orders_with_po_file", { p_orders: ids }) : Promise.resolve({ data: null }),
    prices && ids.length ? fetchAll<{ id: string; factory_rate: number | null }>((a, z) => supabase.rpc("line_prices", { p_orders: ids }).order("id").range(a, z)) : Promise.resolve({ data: [] as { id: string; factory_rate: number | null }[], error: null }),
  ]);
  const finalQc = new Map<string, string>();
  for (const c of (qc.data ?? []) as { line_id: string; result: string }[]) if (!finalQc.has(c.line_id)) finalQc.set(c.line_id, c.result);
  const rate = new Map((prices_.data ?? []).map((r) => [r.id, r.factory_rate]));
  const hasPo = new Set(((withPo as { data: unknown }).data ?? []) as string[]);
  const count = (xs: { line_id: string }[]) => xs.reduce((m, x) => m.set(x.line_id, (m.get(x.line_id) ?? 0) + 1), new Map<string, number>());
  const samples = count((smp.data ?? []) as { line_id: string }[]);
  const updates = count((ups.data ?? []) as { line_id: string }[]);
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryOf = new Map(factories.map((f) => [f.id, f.name]));
  const today = todayIST();
  const stepRows = (steps.data ?? []) as { order_id: string; line_id: string; stage: string; planned_on: string | null; done_on: string | null }[];
  const posRows = (fpos.data ?? []) as { order_id: string; factory_id: string; released_at: string | null; lock_requested_at: string | null }[];

  // Style photos, through links that work for an hour.
  const paths = orders.flatMap((o) => (o.order_lines ?? []).map((l) => l.photo_path).filter(Boolean)) as string[];
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));

  const styles: BoardStyle[] = orders.flatMap((o) => {
    const lines = o.order_lines ?? [];
    const due = dueDate(o);
    const states = styleStates(
      lines.map((l) => ({ id: l.id, style: l.style, factoryId: l.factory_id, hasRate: !prices || rate.get(l.id) != null, shipDate: l.ship_date })),
      { status: o.status, due, hasBuyerPo: seeBuyers && withPo ? hasPo.has(o.id) : null, packedAll: stageReached(o.stage, "packed"), closedShort: !!o.closed_short_at,
        pos: posRows.filter((p) => p.order_id === o.id).map((p) => ({ factoryId: p.factory_id, released: !!p.released_at, lockRequested: !!p.lock_requested_at })) },
      { role: me?.role, today, steps: stepRows.filter((r) => r.order_id === o.id), finalQc, ship: ship.data.filter((r) => r.order_id === o.id), dispatch: seeBuyers, samples, updates },
    );
    return states.map((st) => {
      const l = lines.find((x) => x.id === st.id)!;
      const sh = ship.data.find((r) => r.line_id === l.id);
      return {
        ...st, orderId: o.id, orderNo: o.order_no, buyerPo: o.buyer_po, buyer: buyerOf.get(o.buyer_id) ?? "Buyer",
        factory: l.factory_id ? factoryOf.get(l.factory_id) ?? "Factory" : "", qty: l.qty, product: l.product, colour: l.colour ?? "",
        photoUrl: (l.photo_path && urlOf.get(l.photo_path)) || null,
        clock: shipClock(st.due, today, o.status, !!sh && sh.shipped > 0 && sh.shipped >= sh.ordered),
      };
    });
  });
  styles.sort((a, b) => byUrgency(a.j, b.j) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.orderNo.localeCompare(b.orderNo));
  const err = [error, steps.error, ship.error, fpos.error, qc.error].find(Boolean);
  return { styles, factories: factories.map((f) => ({ id: f.id, name: f.name, phone: f.phone ?? null })), error: err ? String((err as { message?: string }).message ?? err) : null, role: me?.role ?? null };
}
