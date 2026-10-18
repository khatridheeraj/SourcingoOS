import { NO_COMPANY } from "@/lib/names";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { loadBuyers } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { BuyerList } from "./buyer-list";

export default async function BuyersPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const supabase = await createClient();
  // Open orders are read page by page, so counts past 1,000 orders stay right.
  const owner = me?.role === "owner";
  const [buyers, { data: open }, { data: senders }] = await Promise.all([
    loadBuyers(),
    fetchAll((a, z) => supabase.from("orders").select("buyer_id").eq("company_id", me?.companyId ?? NO_COMPANY).eq("status", "open").order("id").range(a, z)),
    owner ? supabase.rpc("buyer_po_senders") : Promise.resolve({ data: null }),
  ]);
  const openOrders: Record<string, number> = {};
  for (const o of open) openOrders[o.buyer_id] = (openOrders[o.buyer_id] ?? 0) + 1;
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Buyers</h1>
          <p>The team sees buyers by name. Factory logins never see buyers.</p>
        </div>
      </div>
      <BuyerList buyers={buyers} owner={owner} openOrders={openOrders} senders={(senders ?? {}) as Record<string, string[]>} />
    </>
  );
}
