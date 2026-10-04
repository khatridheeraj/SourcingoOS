import { Head } from "@/components/bits";
import { redirect } from "next/navigation";
import { panelCls } from "@/components/ui";
import { getMe } from "@/lib/auth";
import { canManageFactories, isInternal } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { AddBuyer, AddFactory, BuyerRow, FactoryRow, type Buyer, type Factory } from "./forms";

export const metadata = { title: "Buyers & factories · Sourcingo OS" };

function countBy<T>(rows: T[], key: (r: T) => string | null) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export default async function SetupPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!isInternal(me.role)) redirect("/");
  const isOwner = me.role === "owner";

  const supabase = await createClient();
  const [factories, buyers, registry, orders] = await Promise.all([
    supabase.from("factories").select("id, name, city, contact, address, active").order("active", { ascending: false }).order("name"),
    supabase.from("buyers").select("id, code, default_payment_terms, default_address").order("code"),
    isOwner ? supabase.from("buyer_registry").select("buyer_id, real_name") : Promise.resolve({ data: [] as { buyer_id: string; real_name: string }[], error: null }),
    supabase.from("sales_orders").select("factory_id, buyer_id"),
  ]);

  const error = factories.error || buyers.error || registry.error || orders.error;
  const byFactory = countBy(orders.data ?? [], (o) => o.factory_id);
  const byBuyer = countBy(orders.data ?? [], (o) => o.buyer_id);
  const realName = new Map((registry.data ?? []).map((r) => [r.buyer_id, r.real_name]));

  const factoryRows: Factory[] = (factories.data ?? []).map((f) => ({ ...f, orders: byFactory.get(f.id) ?? 0 }));
  const buyerRows: Buyer[] = (buyers.data ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    realName: realName.get(b.id) ?? null,
    terms: b.default_payment_terms,
    address: b.default_address,
    orders: byBuyer.get(b.id) ?? 0,
  }));
  const canEditFactories = canManageFactories(me.role);

  return (
    <>
      <Head crumbs="CRM › Buyers & factories" title="Buyers & factories" sub={<>Master data used on every inquiry, sales order and challan.</>} />
      {error && <p className="warnbox">Couldn&apos;t load everything: {error.message}</p>}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section className={panelCls}>
          <h2 className="font-bold">Factories ({factoryRows.filter((f) => f.active).length})</h2>
          <div className="divide-y divide-line">
            {factoryRows.length ? (
              factoryRows.map((f) => <FactoryRow key={f.id} f={f} canEdit={canEditFactories} />)
            ) : (
              <p className="py-3 text-sm text-muted">No factories yet. Sales orders need one, so add your first below.</p>
            )}
          </div>
          {canEditFactories && <AddFactory />}
        </section>

        <section className={panelCls}>
          <h2 className="font-bold">Buyers ({buyerRows.length})</h2>
          <p className="text-xs text-muted">
            {isOwner ? "Only you can see real names." : "Orders show buyer codes only. The owner keeps the real names."}
          </p>
          <div className="divide-y divide-line">
            {buyerRows.length ? (
              buyerRows.map((b) => <BuyerRow key={b.id} b={b} isOwner={isOwner} />)
            ) : (
              <p className="py-3 text-sm text-muted">No buyers yet.</p>
            )}
          </div>
          {isOwner && <AddBuyer />}
        </section>
      </div>
    </>
  );
}
