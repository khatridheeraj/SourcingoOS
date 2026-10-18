import { cookies } from "next/headers";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FactoryOrder, type PanelOrder } from "./factory-order";
import type { FactoryUpdate } from "./step-update";
import { LANG_COOKIE, langOf, words } from "./i18n";

export default async function FactoryPage() {
  const supabase = await createClient();
  const [me, { data, error }, { data: ups }] = await Promise.all([getMe(), supabase.rpc("factory_tna"), supabase.rpc("factory_step_updates")]);
  const updates = (ups ?? []) as FactoryUpdate[];
  const panel = (data ?? { factory: "", orders: [] }) as { factory: string; orders: PanelOrder[] };
  const waiting = panel.orders.filter((o) => !o.released_at);
  const now = new Date().toISOString();
  const lang = langOf((await cookies()).get(LANG_COOKIE)?.value);
  const w = words(lang);

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{panel.factory || w.yourPos}</h1>
          <p className="show-phone">{w.introPhone}</p>
          <p className="hide-phone">{w.intro}</p>
        </div>
      </div>
      {error && <div className="errbox">{error.message}</div>}
      {panel.orders.length === 0 ? (
        <div className="empty"><b>{w.noOrders}</b>{w.noOrdersSub}</div>
      ) : (
        <>
          {waiting.length > 0 && (
            <p className="text-[13px] font-semibold text-warn">
              {w.needDates(waiting.length)}
            </p>
          )}
          {panel.orders.map((o) => <FactoryOrder key={o.order_id} order={o} now={now} companyId={me?.companyId ?? ""} updates={updates} lang={lang} />)}
        </>
      )}
    </>
  );
}
