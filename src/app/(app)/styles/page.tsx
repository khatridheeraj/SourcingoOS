import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip, Empty, Head, Pills } from "@/components/bits";
import { AutoForm, SearchParamInput } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { loadCovers } from "@/lib/files";
import { money, nf, unitOf } from "@/lib/model";
import { isInternal } from "@/lib/roles";

export const metadata = { title: "Style catalogue · Sourcingo OS" };

const FILTERS = [
  { key: "all", label: "All" }, { key: "draft", label: "Draft" }, { key: "tna_review", label: "TNA review" },
  { key: "locked", label: "In production" }, { key: "shipped", label: "Shipped" },
];

export default async function Styles({ searchParams }: PageProps<"/styles">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const sp = await searchParams;
  const status = FILTERS.some((f) => f.key === sp.status) ? String(sp.status) : "all";
  const buyer = String(sp.buyer ?? "");
  const q = String(sp.q ?? "").trim().toLowerCase();
  const { world: w } = await loadWorld();
  const items = w.orders
    .filter((o) => (status === "all" || o.status === status) && (!buyer || o.buyer_id === buyer))
    .flatMap((o) => o.styles.map((st) => ({ o, st })))
    .filter(({ st }) => !q || [st.name, st.code, st.fabric, st.colour].join(" ").toLowerCase().includes(q));
  const covers = await loadCovers(items.map(({ st }) => st.id));
  const href = (s: string) => `/styles?${new URLSearchParams(Object.entries({ status: s, buyer, q }).filter(([, v]) => v))}`;

  return (
    <>
      <Head crumbs="Styles › Style catalogue" title="Style catalogue" sub="Every style across all sales orders, with codes, fabric and status." />
      <div className="row">
        <SearchParamInput placeholder="Search style name, code, fabric, colour" />
        <AutoForm>
          <input type="hidden" name="status" value={status} />
          {q && <input type="hidden" name="q" value={q} />}
          <select name="buyer" className="inp" defaultValue={buyer} aria-label="Buyer" style={{ maxWidth: 220 }}>
            <option value="">All buyers</option>
            {w.buyers.map((b) => <option key={b.id} value={b.id}>{b.real_name ? `${b.code} · ${b.real_name}` : b.code}</option>)}
          </select>
        </AutoForm>
        <Pills current={status} items={FILTERS.map((f) => ({ ...f, href: href(f.key) }))} />
      </div>
      <div className="cat">
        {items.length ? items.map(({ o, st }) => (
          <Link key={st.id} href={`/orders/${o.id}`} className="cat-card">
            <div className="cat-img">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage link */}
              {covers.has(st.id) ? <img src={covers.get(st.id)} alt="" loading="lazy" /> : (st.name || "?").slice(0, 2).toUpperCase()}
              <Chip status={o.status} />
            </div>
            <div className="cat-body">
              <b>{st.name || "Unnamed style"}</b>
              <span className="code text-muted">{st.code || "—"}</span>
              <span>{st.colour || "—"} · {st.fabric || "—"}</span>
              <span className="text-muted">{w.buyerCode(o.buyer_id)} · {w.factoryName(o.factory_id)}</span>
              <span><b className="num">{money(st.buyer_rate, o.currency)}</b> <span className="text-muted">× {nf(st.qty)} {unitOf(o)}</span></span>
            </div>
          </Link>
        )) : (
          <Empty wide title={w.orders.length ? "No styles match" : "No styles yet"}>
            {w.orders.length ? "Try another filter." : "Styles appear here when you add them to a sales order."}
          </Empty>
        )}
      </div>
    </>
  );
}
