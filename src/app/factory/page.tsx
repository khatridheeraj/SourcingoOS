import { createClient } from "@/lib/supabase/server";
import { FactoryOrder, type PanelOrder } from "./factory-order";

export default async function FactoryPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("factory_tna");
  const panel = (data ?? { factory: "", orders: [] }) as { factory: string; orders: PanelOrder[] };
  const waiting = panel.orders.filter((o) => !o.released_at);
  const now = new Date().toISOString();

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{panel.factory || "Your POs"}</h1>
          <p>
            For each order, enter the date you will finish every step for each style, on or before the target date, and send it within 24 hours of being asked.
            Sourcingo releases the PO once your dates and their plan are both in. Your dates are fixed after release.
          </p>
        </div>
      </div>
      {error && <div className="errbox">{error.message}</div>}
      {panel.orders.length === 0 ? (
        <div className="empty"><b>No open orders for you right now</b>New POs appear here when Sourcingo asks for your plan.</div>
      ) : (
        <>
          {waiting.length > 0 && (
            <p className="text-[13px] font-semibold text-warn">
              {waiting.length} {waiting.length === 1 ? "order needs" : "orders need"} your TNA dates before the PO can be released.
            </p>
          )}
          {panel.orders.map((o) => <FactoryOrder key={o.order_id} order={o} now={now} />)}
        </>
      )}
    </>
  );
}
