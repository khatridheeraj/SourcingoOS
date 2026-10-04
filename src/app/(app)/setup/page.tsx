import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { canManageFactories, isInternal } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { loadTemplates } from "@/lib/tna";
import { AddBuyer, AddFactory, BuyerRow, type Company, CompanyForm, FactoryRow, TemplateEditor, type Buyer, type Factory } from "./forms";

export const metadata = { title: "Master data · Sourcingo OS" };

const TABS = [["factories", "Factories"], ["buyers", "Buyers"], ["company", "Company"], ["templates", "TNA templates"]] as const;

function countBy<T>(rows: T[], key: (r: T) => string | null) {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!isInternal(me.role)) redirect("/");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? String(sp.tab) : "factories";
  const isOwner = me.role === "owner";
  const canEdit = canManageFactories(me.role);
  const supabase = await createClient();

  let body: React.ReactNode = null;
  if (tab === "factories") {
    const [factories, orders] = await Promise.all([
      supabase.from("factories").select("*").order("active", { ascending: false }).order("name"),
      supabase.from("sales_orders").select("factory_id").limit(10000),
    ]);
    const by = countBy(orders.data ?? [], (o) => o.factory_id);
    const rows = ((factories.data ?? []) as Omit<Factory, "orders">[]).map((f) => ({ ...f, categories: f.categories ?? [], orders: by.get(f.id) ?? 0 }));
    body = (
      <section className="panel">
        <div className="row mb-2"><h2 className="grow font-bold">Factories ({rows.filter((f) => f.active).length} active)</h2></div>
        {factories.error && <p className="errbox">{factories.error.message}</p>}
        <div className="divide-y divide-line">
          {rows.length ? rows.map((f) => <FactoryRow key={f.id} f={f} canEdit={canEdit} />) : <p className="py-3 text-sm text-muted">No factories yet. Sales orders need one, so add your first.</p>}
        </div>
        {canEdit && <div className="mt-3"><AddFactory /></div>}
      </section>
    );
  } else if (tab === "buyers") {
    const [buyers, registry, orders] = await Promise.all([
      supabase.from("buyers").select("id, code, default_payment_terms, default_address, gstin, state").order("code"),
      isOwner ? supabase.from("buyer_registry").select("buyer_id, real_name, billing_address, contact_name, contact_email, contact_phone, notes") : Promise.resolve({ data: [], error: null }),
      supabase.from("sales_orders").select("buyer_id").limit(10000),
    ]);
    const by = countBy(orders.data ?? [], (o) => o.buyer_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = new Map(((registry.data ?? []) as any[]).map((r) => [r.buyer_id, r]));
    const rows: Buyer[] = (buyers.data ?? []).map((b) => {
      const r = reg.get(b.id);
      return {
        id: b.id, code: b.code, realName: r?.real_name ?? null, terms: b.default_payment_terms, address: b.default_address, orders: by.get(b.id) ?? 0,
        gstin: isOwner ? b.gstin : null, state: isOwner ? b.state : null, billing_address: r?.billing_address ?? null, contact_name: r?.contact_name ?? null,
        contact_email: r?.contact_email ?? null, contact_phone: r?.contact_phone ?? null, notes: r?.notes ?? null,
      };
    });
    body = (
      <>
        <section className="panel">
          <h2 className="font-bold">Buyers ({rows.length})</h2>
          <p className="text-xs text-muted">{isOwner ? "Only you can see real names, contacts and GSTINs." : "Buyers show by code only. The owner keeps their names and contacts."}</p>
          <div className="divide-y divide-line">
            {rows.length ? rows.map((b) => <BuyerRow key={b.id} b={b} isOwner={isOwner} />) : <p className="py-3 text-sm text-muted">No buyers yet.</p>}
          </div>
        </section>
        {isOwner && <AddBuyer />}
      </>
    );
  } else if (tab === "company") {
    const { data } = await supabase.from("company_profile").select("*").maybeSingle();
    body = data ? <CompanyForm c={data as Company} canEdit={isOwner} /> : <p className="errbox">Company details aren&apos;t set up yet.</p>;
  } else {
    const templates = await loadTemplates(true);
    body = (
      <section className="panel">
        <h2 className="font-bold">TNA templates</h2>
        <p className="text-xs text-muted">Steps are dated back from the factory delivery date. Pick one in the sales order editor, or on Fix my data for running orders.</p>
        <div className="divide-y divide-line">
          {templates.map((t) => <TemplateEditor key={t.id + JSON.stringify(t.steps)} t={t} canEdit={canEdit} />)}
        </div>
        <div className="mt-3"><TemplateEditor canEdit={canEdit} /></div>
      </section>
    );
  }

  return (
    <>
      <Head crumbs="Setup › Master data" title="Master data" sub="Factories, buyers, your company letterhead and TNA templates: used on every order, PO and challan." />
      <nav className="tabs" aria-label="Master data">
        {TABS.map(([k, l]) => <Link key={k} href={`/setup?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      {body}
    </>
  );
}
