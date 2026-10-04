import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head, Pills, Tile } from "@/components/bits";
import { GrnCard } from "@/components/doc-cards";
import { SearchParamInput } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { isoIST, sumByCur } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";

export const metadata = { title: "GRN · Sourcingo OS" };

const FILTERS = [
  { key: "all", label: "All" }, { key: "draft", label: "Draft" }, { key: "pending_approval", label: "Pending approval" },
  { key: "approved", label: "Approved" }, { key: "held", label: "Not dispatched" }, { key: "rejected", label: "Rejected" },
];

export default async function GrnList({ searchParams }: PageProps<"/grn">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const sp = await searchParams;
  const status = FILTERS.some((f) => f.key === sp.status) ? String(sp.status) : "all";
  const q = String(sp.q ?? "").trim().toLowerCase();
  const { world: w } = await loadWorld();
  const today = w.grns.filter((g) => isoIST(g.received_at) === w.today);
  const late = w.lateGrns().length;
  const list = w.grns
    .filter((g) => status === "all" || (status === "held" ? w.grnHeld(g) > 0 : g.status === status))
    .filter((g) => {
      if (!q) return true;
      const o = w.orderById.get(g.so_id);
      return [g.id, g.so_id, o?.buyer_po_number, w.buyerCode(o?.buyer_id), w.factoryName(o?.factory_id)].join(" ").toLowerCase().includes(q);
    });
  const href = (s: string) => `/grn?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <Head crumbs="Warehouse › GRN" title="GRN" sub="Goods received from factories. Every GRN must be dispatched to the buyer within 24 hours.">
        {isOps(me?.role) && <Link className="btn primary" href="/grn/new">+ Create GRN</Link>}
      </Head>
      <section className="stack">
        <span className="sub">Your today&apos;s summary</span>
        <div className="tiles">
          <Tile tone="blue" label="GRNs created" value={today.length} note="Today" />
          <Tile tone="yellow" label="Pending GRN approval" value={w.grns.filter((g) => g.status === "pending_approval").length} note="All dates" href={href("pending_approval")} />
          <Tile tone="green" money label="Total value" value={sumByCur(today.map((g) => [w.grnValue(g), w.currencyOf(g.so_id)]))} note="Today's GRNs" />
          <Tile tone="pink" label="Approved" value={today.filter((g) => g.status === "approved").length} note="Today" />
          <Tile alarm={late > 0} label="Held over 24h" value={late} note="Must be zero" href={href("held")} />
        </div>
      </section>
      <div className="row">
        <SearchParamInput placeholder="Search GRN, sales order, factory" />
        <Pills current={status} items={FILTERS.map((f) => ({ ...f, href: href(f.key) }))} />
      </div>
      <div className="cards">
        {list.length ? list.map((g) => <GrnCard key={g.id} w={w} g={g} />) : (
          <Empty wide title={w.grns.length ? "No GRNs match" : "No GRNs yet"}>
            {w.grns.length ? "Try another filter." : "Create a GRN when goods arrive from a factory. Only locked sales orders can receive goods."}
          </Empty>
        )}
      </div>
    </>
  );
}
