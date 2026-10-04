import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head } from "@/components/bits";
import { AutoForm } from "@/components/feedback";
import { TnaStyles } from "@/components/tna-styles";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDay, progressCells } from "@/lib/model";
import { isOps } from "@/lib/roles";

export const metadata = { title: "All TNA · Sourcingo OS" };

export default async function AllTna({ searchParams }: PageProps<"/tna/all">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/");
  const { so } = await searchParams;
  const { world: w } = await loadWorld();
  const locked = w.orders.filter((o) => o.status === "locked");
  const o = locked.find((x) => x.id === so) ?? locked[0];
  const open = (id: string) => {
    const c = progressCells(w.orderById.get(id)!, w.today);
    return `${c.filter((x) => x === "c").length}/${c.length} done${c.includes("o") ? " · overdue" : ""}`;
  };

  return (
    <>
      <Head crumbs="Manufacturing › All TNA" title="All TNA" sub="Update activity status on locked sales orders. Dates and activity names can't change after the lock.">
        <AutoForm>
          <label className="field" style={{ minWidth: 260 }}>
            <span>Sales order</span>
            <select name="so" className="inp" defaultValue={o?.id ?? ""}>
              {locked.length ? locked.map((x) => (
                <option key={x.id} value={x.id}>{x.id} · #{x.buyer_po_number} · {w.buyerCode(x.buyer_id)} · {w.factoryName(x.factory_id)} · {open(x.id)}</option>
              )) : <option value="">No locked sales orders yet</option>}
            </select>
          </label>
        </AutoForm>
      </Head>
      {o ? (
        <div className="stack">
          <div className="row">
            <Link className="btn sm" href={`/orders/${o.id}`}>Open full sales order</Link>
            <span className="text-xs text-muted">Buyer delivery {fmtDay(o.buyer_date)} · Factory delivery {fmtDay(o.factory_date)}</span>
          </div>
          <TnaStyles key={o.id} w={w} o={o} canEdit />
        </div>
      ) : (
        <Empty title="Nothing to track yet">A sales order appears here once the owner locks its TNA.</Empty>
      )}
    </>
  );
}
