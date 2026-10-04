import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { type Costing, costingMath, money } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { CostSheet } from "./editor";

export async function generateMetadata({ params }: PageProps<"/inquiries/[id]/costing">) {
  return { title: `Costing ${(await params).id} · Sourcingo OS` };
}

const s = (v: unknown) => (v == null ? "" : String(v));

// One cost sheet per style quoted. Accepted sheets become the styles of the sales order.
export default async function CostingPage({ params }: PageProps<"/inquiries/[id]/costing">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const inq = w.inquiries.find((i) => i.id === id);
  if (!inq) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("costings").select("*").eq("inquiry_id", id).order("created_at");
  const list = (data ?? []) as Costing[];
  const factories = w.factories.filter((f) => f.active).map((f) => ({ id: f.id, label: f.city ? `${f.name} · ${f.city}` : f.name }));
  const blank = { inquiry_id: id, style_name: "", currency: "INR", qty: "", factory_id: "", factory_cost: "", extras: [], overhead_pct: "5", margin_pct: "15", quoted_price: "", status: "draft" as const, notes: "" };
  const accepted = list.filter((c) => c.status === "accepted");

  return (
    <>
      <Head crumbs={<>Sales › <Link className="link" href="/inquiries">Inquiries</Link> › {id}</>} title={`Costing · ${inq.product_type}`}
        sub={`${w.buyerCode(inq.buyer_id)} · Work out the price from the factory's rate, our costs and the margin you want.`}>
        {inq.status !== "converted" && accepted.length > 0 && <Link className="btn primary" href={`/orders/new?inquiry=${id}`}>Create sales order from {accepted.length} accepted</Link>}
        {inq.so_id && <Link className="btn" href={`/orders/${inq.so_id}`}>Open {inq.so_id}</Link>}
      </Head>
      {list.length > 1 && (
        <section className="panel">
          <div className="list-rows">
            {list.map((c) => {
              const m = costingMath(c);
              return (
                <div key={c.id}>
                  <b className="grow">{c.style_name}</b>
                  <span className="text-[13px] text-muted">cost {money(m.cost, c.currency)} · quoted {c.quoted_price != null ? money(c.quoted_price, c.currency) : "—"}{m.realMargin != null && ` · ${m.realMargin.toFixed(1)}%`}</span>
                  <span className={`chip ${c.status === "accepted" ? "ok" : c.status === "rejected" ? "bad" : c.status === "quoted" ? "info" : ""}`}>{c.status}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {list.map((c) => (
        <CostSheet key={c.id + c.status + s(c.quoted_price)} canDelete factories={factories} initial={{
          id: c.id, inquiry_id: id, style_name: c.style_name, currency: c.currency, qty: s(c.qty), factory_id: s(c.factory_id), factory_cost: s(c.factory_cost),
          extras: c.extras, overhead_pct: s(c.overhead_pct), margin_pct: s(c.margin_pct), quoted_price: s(c.quoted_price), status: c.status, notes: s(c.notes),
        }} />
      ))}
      <h2 className="text-[17px] font-bold">{list.length ? "Add another style" : "First cost sheet"}</h2>
      <CostSheet initial={blank} factories={factories} />
    </>
  );
}
