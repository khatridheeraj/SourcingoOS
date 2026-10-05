import { NO_COMPANY } from "@/lib/names";
import Link from "next/link";
import { getMe } from "@/lib/auth";
import { loadBuyers, loadFactories } from "@/lib/data";
import { day, money, qty, STATUS, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const TABS = [
  { key: "open", label: "Open" },
  { key: "shipped", label: "Shipped" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

type Line = { style: string; qty: number; buyer_rate: number | null; factory_id: string | null };

export default async function OrdersPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? String(sp.status) : "open";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const me = await getMe();
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("id, order_no, buyer_id, buyer_po, ship_date, status, order_lines(style, qty, buyer_rate, factory_id)")
    .eq("company_id", companyId)
    .order("ship_date", { ascending: true, nullsFirst: false })
    .order("order_no");
  if (status !== "all") query = query.eq("status", status);
  const [{ data, error }, buyers, factories, counts] = await Promise.all([
    query,
    loadBuyers(),
    loadFactories(),
    supabase.from("orders").select("status").eq("company_id", companyId),
  ]);

  const buyerById = new Map(buyers.map((b) => [b.id, b]));
  const factoryById = new Map(factories.map((f) => [f.id, f]));
  const today = todayIST();
  const owner = me?.role === "owner";

  const rows = (data ?? []).map((o) => {
    const lines = (o.order_lines ?? []) as Line[];
    const b = buyerById.get(o.buyer_id);
    const factoryNames = [...new Set(lines.map((l) => (l.factory_id ? factoryById.get(l.factory_id)?.name : null)).filter(Boolean))] as string[];
    const missingFactory = lines.some((l) => !l.factory_id);
    return {
      ...o,
      buyer: b ? (owner && b.realName ? `${b.code} · ${b.realName}` : b.code) : "",
      styles: lines.map((l) => l.style),
      pieces: lines.reduce((s, l) => s + l.qty, 0),
      value: lines.every((l) => l.buyer_rate != null) ? lines.reduce((s, l) => s + l.qty * (l.buyer_rate ?? 0), 0) : null,
      factoryNames,
      missingFactory,
      late: o.status === "open" && !!o.ship_date && o.ship_date < today,
    };
  }).filter((r) => !q || [r.order_no, r.buyer, r.buyer_po, ...r.styles, ...r.factoryNames].join(" ").toLowerCase().includes(q));

  const all = counts.data ?? [];
  const openCount = all.filter((o) => o.status === "open").length;
  const open = rows.filter((r) => r.status === "open");
  const late = open.filter((r) => r.late).length;
  const noFactory = open.filter((r) => r.missingFactory).length;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Orders</h1>
          <p>One line per buyer PO. Open orders are sorted by ship date, earliest first.</p>
        </div>
        <Link href="/orders/new" className="btn primary">New order</Link>
      </div>

      {status === "open" && openCount > 0 && (
        <div className="tiles">
          <div className="tile"><span>Open orders</span><b>{openCount}</b></div>
          <div className="tile"><span>Pieces on open orders</span><b>{qty(open.reduce((s, r) => s + r.pieces, 0))}</b></div>
          <div className={`tile ${late ? "alarm" : ""}`}><span>Past ship date</span><b>{late}</b></div>
          <div className={`tile ${noFactory ? "alarm" : ""}`}><span>Styles without a factory</span><b>{noFactory}</b></div>
        </div>
      )}

      <div className="row">
        <div className="filters">
          {TABS.map((t) => (
            <Link key={t.key} className="pill" href={t.key === "open" ? "/" : `/?status=${t.key}`} aria-current={status === t.key ? "page" : undefined}>
              {t.label}{t.key !== "all" ? ` ${all.filter((o) => o.status === t.key).length}` : ` ${all.length}`}
            </Link>
          ))}
        </div>
        <form className="ml-auto w-full sm:w-64">
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          <input className="inp" name="q" defaultValue={q} placeholder="Search PO, style, buyer, factory" aria-label="Search orders" />
        </form>
      </div>

      {error && <div className="errbox">{error.message}</div>}

      {rows.length === 0 ? (
        <div className="empty">
          <b>{q ? "Nothing matches that search" : all.length === 0 ? "No orders yet" : "No orders here"}</b>
          {all.length === 0 && "Add the first one with New order, or send the confirmed sheet and Claude will load it."}
        </div>
      ) : (
        <>
        <ul className="flex flex-col gap-2 sm:hidden">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/orders/${r.id}`} className="panel flex flex-col gap-1 !p-3.5">
                <div className="row justify-between">
                  <b className="code text-accent">{r.order_no}</b>
                  <span className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label}</span>
                </div>
                <div className="font-semibold">{r.buyer_po} <span className="code muted font-normal">{r.buyer}</span></div>
                <div className="muted text-[13px]">{r.styles.length} {r.styles.length === 1 ? "style" : "styles"} · {qty(r.pieces)} pcs{r.value != null && ` · ${money(r.value)}`}</div>
                <div className="row text-[13px]">
                  {r.ship_date ? <span>Ships {day(r.ship_date)}</span> : <span className="muted">No ship date</span>}
                  {r.late && <span className="chip bad">Late</span>}
                  {r.missingFactory && <span className="chip warn">Needs factory</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="table-wrap hidden sm:block">
          <table className="tbl">
            <thead>
              <tr>
                <th>Order</th><th>Buyer</th><th>Buyer PO</th><th>Styles</th><th className="r">Pieces</th>
                <th className="r">Value</th><th>Factory</th><th>Ship date</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="click">
                  <td><Link href={`/orders/${r.id}`} className="link code">{r.order_no}</Link></td>
                  <td className="code whitespace-nowrap">{r.buyer}</td>
                  <td className="whitespace-nowrap">{r.buyer_po}</td>
                  <td>{r.styles.length <= 2 ? r.styles.join(", ") : `${r.styles.slice(0, 2).join(", ")} +${r.styles.length - 2}`}</td>
                  <td className="r num">{qty(r.pieces)}</td>
                  <td className="r num">{money(r.value)}</td>
                  <td>
                    {r.factoryNames.join(", ")}
                    {r.missingFactory && <span className="chip warn ml-1">Needs factory</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {day(r.ship_date)}
                    {r.late && <span className="chip bad ml-1">Late</span>}
                  </td>
                  <td><span className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}
