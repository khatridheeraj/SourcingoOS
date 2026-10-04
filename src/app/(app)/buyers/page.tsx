import { NO_COMPANY } from "@/lib/names";
import { getMe } from "@/lib/auth";
import { loadBuyers } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { BuyerList } from "./buyer-list";

export default async function BuyersPage() {
  const me = await getMe();
  const supabase = await createClient();
  const [buyers, { data: open }] = await Promise.all([loadBuyers(), supabase.from("orders").select("buyer_id").eq("company_id", me?.companyId ?? NO_COMPANY).eq("status", "open")]);
  const openOrders: Record<string, number> = {};
  for (const o of open ?? []) openOrders[o.buyer_id] = (openOrders[o.buyer_id] ?? 0) + 1;
  const owner = me?.role === "owner";
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Buyers</h1>
          <p>{owner ? "The team sees only the code. Real names are visible to you alone." : "Buyers are shown by code."}</p>
        </div>
      </div>
      <BuyerList buyers={buyers} owner={owner} openOrders={openOrders} />
    </>
  );
}
