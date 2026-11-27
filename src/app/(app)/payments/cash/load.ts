import type { OpenOrder } from "@/lib/cash";
import { buyerName, loadFactories, loadPace, loadTerms } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { dueDate, todayIST } from "@/lib/format";
import type { LinePrice } from "@/lib/margin";
import { forecast, paceLookup, type StepRow } from "@/lib/progress";
import { loadShipProgress } from "@/lib/shipments";
import { createClient } from "@/lib/supabase/server";
import { loadBooks } from "../load";

// One factory's share of an open order still to be billed: what it will bill and the days it is paid in.
export type FactoryShare = { factoryId: string; name: string; cost: number; days: number };
export type OpenOrderMoney = OpenOrder & { buyerId: string; factories: FactoryShare[] };

// Open orders not billed yet, priced from their rates, landing at the likely ship date the order page shows.
// What is billed already is in invoices and Tally bills, so it isn't counted twice. Shared by Cash ahead and the
// factory payment calendar.
export async function loadOpenOrderMoney(books: Awaited<ReturnType<typeof loadBooks>>["books"]) {
  const supabase = await createClient();
  const today = todayIST();
  const [factories, pace, { buyerDays, factoryDays }, orders] = await Promise.all([
    loadFactories(),
    loadPace(),
    loadTerms(),
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, ship_date, revised_ship_date, order_lines(id, style, qty, factory_id)")
      .eq("status", "open").order("order_no").order("id").range(a, z)),
  ]);
  const ids = (orders.data ?? []).map((o) => o.id);
  const none = { data: [], error: null };
  const [rates, ship, steps] = await Promise.all([
    ids.length ? fetchAll<LinePrice>((a, z) => supabase.rpc("line_prices", { p_orders: ids }).order("id").range(a, z)) : none,
    loadShipProgress(supabase, ids),
    ids.length
      ? fetchAll((a, z) => supabase.from("line_stages").select("order_id, line_id, stage, planned_on, done_on, not_needed").in("order_id", ids).eq("not_needed", false).order("id").range(a, z))
      : none,
  ]);
  const rateOf = new Map((rates.data as LinePrice[]).map((r) => [r.id, r]));
  const billedOf = new Map((ship.data ?? []).map((r) => [r.line_id, r.billed]));
  const factoryName = (id: string) => factories.find((f) => f.id === id)?.name ?? "This factory";

  let unpriced = 0, undated = 0;
  const open: OpenOrderMoney[] = [];
  for (const o of orders.data ?? []) {
    const lines = (o.order_lines ?? []) as { id: string; style: string; qty: number; factory_id: string | null }[];
    let sale = 0, cost = 0, missing = false;
    const days: number[] = [];
    const shares = new Map<string, FactoryShare>();
    for (const l of lines) {
      const left = Math.max(0, l.qty - (billedOf.get(l.id) ?? 0));
      if (!left) continue;
      const r = rateOf.get(l.id);
      if (r?.buyer_rate == null || r?.factory_rate == null) { missing = true; continue; }
      sale += left * Number(r.buyer_rate);
      const c = left * Number(r.factory_rate);
      cost += c;
      days.push(factoryDays(l.factory_id));
      if (l.factory_id && c > 0) {
        const s = shares.get(l.factory_id) ?? { factoryId: l.factory_id, name: factoryName(l.factory_id), cost: 0, days: factoryDays(l.factory_id) };
        s.cost += c;
        shares.set(l.factory_id, s);
      }
    }
    if (missing) unpriced++;
    if (!sale && !cost) continue;
    const due = dueDate(o);
    if (!due) { undated++; continue; }
    const f = forecast(lines, (steps.data ?? []) as StepRow[], due, today, paceLookup(pace, lines, factoryName));
    const ships = [today, due, f?.finish ?? due].sort().at(-1)!;
    const b = books.buyerById.get(o.buyer_id);
    open.push({
      id: o.id, orderNo: o.order_no, buyer: b ? buyerName(b) : "Buyer", buyerId: o.buyer_id, sale, cost, ships,
      buyerDays: buyerDays(o.buyer_id), factoryDays: days.length ? Math.min(...days) : 60, factories: [...shares.values()],
    });
  }
  return { open, unpriced, undated };
}
