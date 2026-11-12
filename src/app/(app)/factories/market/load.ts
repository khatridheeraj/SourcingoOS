import { NO_COMPANY } from "@/lib/names";
import { getMe } from "@/lib/auth";
import { buyerName, loadBuyers } from "@/lib/data";
import { factoryRecord, recordLine, type RecordFacts } from "@/lib/factory-record";
import { todayIST } from "@/lib/format";
import type { MarketQuote } from "@/lib/market";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

export type Listing = {
  id: string; order_id: string; line_id: string; target_rate: number | null; ready_by: string; closes_on: string; note: string | null;
  opened_at: string; closed_at: string | null; awarded_quote: string | null;
  style: string; description: string | null; colour: string | null; qty: number; product: string; photo: string | null;
  factory_id: string | null; order_no: string; buyer: string; buyer_po: string | null; buyer_rate: number | null;
  quotes: MarketQuote[];
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Styles opened to factories: still open, and those decided in the last 30 days (or one by id), with every quote.
export async function loadListings(id?: string): Promise<{ listings: Listing[]; error?: string }> {
  const [me, supabase, buyers] = await Promise.all([getMe(), createClient(), loadBuyers()]);
  let q = supabase.from("market_listings")
    .select("id, order_id, line_id, target_rate, ready_by, closes_on, note, opened_at, closed_at, awarded_quote, order_lines(style, description, colour, qty, product, photo_path, factory_id, removed_at), orders(order_no, buyer_id, buyer_po, status, removed_at), market_quotes!market_quotes_listing_id_fkey(id, factory_id, rate, ready_on, note, created_at, updated_at, withdrawn_at, factories(name, city))")
    .eq("company_id", me?.companyId ?? NO_COMPANY).order("closes_on").limit(300);
  q = id ? q.eq("id", id) : q.or(`closed_at.is.null,closed_at.gt.${new Date(Date.now() - 30 * 86_400_000).toISOString()}`);
  const { data, error } = await q;
  const rows = data ?? [];
  const orderIds = [...new Set(rows.map((r) => r.order_id as string))];
  const factoryIds = [...new Set(rows.flatMap((r) => ((r.market_quotes ?? []) as { factory_id: string }[]).map((x) => x.factory_id)))];
  const photoPaths = rows.map((r) => one(r.order_lines as unknown as { photo_path: string | null } | null)?.photo_path).filter((p): p is string => !!p);
  const [{ data: prices }, { data: made }, { data: signed }, { data: records }] = await Promise.all([
    orderIds.length ? supabase.rpc("line_prices", { p_orders: orderIds }) : Promise.resolve({ data: [] }),
    factoryIds.length ? supabase.from("order_lines").select("factory_id").in("factory_id", factoryIds).is("removed_at", null).limit(5000) : Promise.resolve({ data: [] }),
    photoPaths.length ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(photoPaths, 3600) : Promise.resolve({ data: [] }),
    // Each quoting factory's record with us, read the same way as on the Factories page.
    factoryIds.length ? supabase.rpc("factory_records") : Promise.resolve({ data: [] }),
  ]);
  const today = todayIST();
  const recordOf = new Map<string, { line: string; watch: boolean }>();
  for (const f of (records ?? []) as RecordFacts[]) {
    if (!f.factory_id || !factoryIds.includes(f.factory_id)) continue;
    const r = factoryRecord(f, today);
    recordOf.set(f.factory_id, { line: f.orders ? recordLine(f, r) : "New to us", watch: r.level === "watch" });
  }
  const priceOf = new Map(((prices ?? []) as { id: string; buyer_rate: number | null }[]).map((p) => [p.id, p.buyer_rate]));
  const madeBy = new Map<string, number>();
  for (const m of (made ?? []) as { factory_id: string }[]) madeBy.set(m.factory_id, (madeBy.get(m.factory_id) ?? 0) + 1);
  const urlOf = new Map(((signed ?? []) as { path: string | null; signedUrl: string | null }[]).filter((x) => x.path && x.signedUrl).map((x) => [x.path!, x.signedUrl!]));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const listings: Listing[] = [];
  for (const r of rows) {
    const l = one(r.order_lines as unknown as { style: string; description: string | null; colour: string | null; qty: number; product: string | null; photo_path: string | null; factory_id: string | null; removed_at: string | null } | null);
    const o = one(r.orders as unknown as { order_no: string; buyer_id: string; buyer_po: string | null; status: string; removed_at: string | null } | null);
    if (!l || !o) continue;
    listings.push({
      id: r.id, order_id: r.order_id, line_id: r.line_id, target_rate: r.target_rate, ready_by: r.ready_by, closes_on: r.closes_on, note: r.note,
      opened_at: r.opened_at, closed_at: r.closed_at, awarded_quote: r.awarded_quote,
      style: l.style, description: l.description, colour: l.colour, qty: l.qty, product: l.product ?? "garment",
      photo: l.photo_path ? urlOf.get(l.photo_path) ?? null : null, factory_id: l.factory_id,
      order_no: o.order_no, buyer: buyerOf.get(o.buyer_id) ?? "", buyer_po: o.buyer_po, buyer_rate: priceOf.get(r.line_id) ?? null,
      quotes: ((r.market_quotes ?? []) as unknown as (Omit<MarketQuote, "factory" | "city" | "styles_with_us" | "record"> & { factories: { name: string; city: string | null } | { name: string; city: string | null }[] | null })[])
        .map(({ factories, ...x }) => ({ ...x, factory: one(factories)?.name ?? "Factory", city: one(factories)?.city ?? null, styles_with_us: madeBy.get(x.factory_id) ?? 0, record: recordOf.get(x.factory_id) ?? null })),
    });
  }
  return { listings, error: error?.message };
}
