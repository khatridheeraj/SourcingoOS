import { redirect } from "next/navigation";
import { Empty, Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import type { QcKind } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { QcForm } from "./qc-form";

export const metadata = { title: "Record QC · Sourcingo OS" };

export default async function NewQc({ searchParams }: PageProps<"/qc/new">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/qc");
  const sp = await searchParams;
  const { world: w } = await loadWorld();
  const orders = w.orders.filter((o) => o.status === "locked" || o.status === "shipped")
    .sort((a, b) => (a.status === b.status ? (a.factory_date ?? "9").localeCompare(b.factory_date ?? "9") : a.status === "locked" ? -1 : 1))
    .map((o) => ({
      id: o.id,
      label: `${o.id} · ${w.buyerCode(o.buyer_id)} · ${w.factoryName(o.factory_id)}${o.status === "shipped" ? " · shipped" : ""}`,
      styles: o.styles.map((s) => ({ id: s.id, label: `${s.name || "Style"} (${s.colour || "—"}) · ${s.qty} pcs`, qty: Number(s.qty) })),
    }));
  const kind = (["inline", "midline", "final"] as QcKind[]).includes(sp.kind as QcKind) ? (sp.kind as QcKind) : "final";
  return (
    <>
      <Head crumbs="Production › QC" title="Record QC inspection" sub="AQL 2.5 major / 4.0 minor, 0 critical. The app works out pass, fail or hold from the counts." />
      {orders.length ? (
        <QcForm orders={orders} today={w.today} initial={{ so: String(sp.so ?? ""), style: String(sp.style ?? ""), kind }} />
      ) : (
        <Empty title="No running orders">Inspections are recorded on orders whose TNA is locked.</Empty>
      )}
    </>
  );
}
