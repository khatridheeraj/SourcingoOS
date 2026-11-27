import { createClient } from "@/lib/supabase/server";
import { TNA_STEPS, todayIST } from "@/lib/format";
import { PHOTO_BUCKET } from "@/lib/storage";
import { buyerWeek, type BuyerWeek, type WeekInvoice, type WeekOrder, type WeekPhoto, type WeekShipment } from "@/lib/buyer-week";

const NAMES = Object.fromEntries(TNA_STEPS.map((s) => [s.key, s.label]));

// This week's update for a buyer, read through the buyer's own page functions so it can only ever show what the
// buyer's page shows. `buyerId` reads it for that buyer from inside the app (the same preview the team uses for
// "See what they see"); without it, it is the signed-in buyer's own.
export async function loadBuyerWeek({ buyerId, since, photos = 0 }: { buyerId?: string; since: (today: string) => string; photos?: number }):
  Promise<{ week: BuyerWeek; buyer: string; photoUrls: string[] }> {
  const supabase = await createClient(buyerId ? { "x-preview-buyer": buyerId } : undefined);
  const [{ data }, { data: shipRows }, { data: photoRows }, { data: moneyRow }] = await Promise.all([
    supabase.rpc("buyer_orders"), supabase.rpc("buyer_shipments"), supabase.rpc("buyer_step_photos"), supabase.rpc("buyer_money"),
  ]);
  const { buyer, orders } = (data ?? { buyer: "", orders: [] }) as { buyer: string; orders: WeekOrder[] };
  const today = todayIST();
  const week = buyerWeek({
    orders, shipments: (shipRows ?? []) as WeekShipment[], photos: (photoRows ?? []) as WeekPhoto[],
    invoices: ((moneyRow as { invoices?: WeekInvoice[] } | null)?.invoices ?? []), names: NAMES, today, since: since(today),
  });
  // The week's newest approved photos, as short-lived links.
  const paths = photos ? week.orders.flatMap((o) => o.photos.flatMap((p) => p.paths)).slice(-photos) : [];
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const photoUrls = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
  return { week, buyer, photoUrls };
}
