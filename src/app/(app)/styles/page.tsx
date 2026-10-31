import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { day, qty, qtyU, STATUS, todayIST } from "@/lib/format";
import { styleProgress, type StepRow } from "@/lib/progress";
import { sizeEntries } from "@/lib/sizes";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const PAGE = 48;

type Row = {
  id: string; style: string; description: string | null; colour: string | null; qty: number; product: string; factory_id: string | null; photo_path: string | null;
  fabric: string | null; sizes: Record<string, number> | null;
  orders: { id: string; order_no: string; buyer_id: string; buyer_po: string; status: string; ship_date: string | null; revised_ship_date: string | null };
};

// Every style the company has made or is making, as a picture gallery to search by style, buyer, factory or fabric.
export default async function StylesPage({ searchParams }: PageProps<"/styles">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim().replace(/[,()%*\\]/g, " ").slice(0, 60);
  const buyer = /^[0-9a-f-]{36}$/i.test(str(sp.buyer)) ? str(sp.buyer) : "";
  const factory = /^[0-9a-f-]{36}$/i.test(str(sp.factory)) ? str(sp.factory) : "";
  const all = sp.show === "all";
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const supabase = await createClient();
  const [buyers, factories] = await Promise.all([loadBuyers(), loadFactories()]);

  let query = supabase.from("order_lines")
    .select("id, style, description, colour, qty, factory_id, photo_path, fabric, sizes, product, orders!inner(id, order_no, buyer_id, buyer_po, status, ship_date, revised_ship_date)", { count: "exact" })
    .eq("company_id", me.companyId).is("removed_at", null);
  if (!all) query = query.eq("orders.status", "open");
  if (buyer) query = query.eq("orders.buyer_id", buyer);
  if (factory) query = query.eq("factory_id", factory);
  if (q) query = query.or(["style", "description", "colour", "fabric"].map((c) => `${c}.ilike.*${q}*`).join(","));
  const { data, count, error } = await query.order("created_at", { ascending: false }).order("position").order("id").range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as unknown as Row[];

  const paths = rows.map((r) => r.photo_path).filter(Boolean) as string[];
  const ids = rows.map((r) => r.id);
  const [{ data: signed }, { data: packs }, { data: steps }] = await Promise.all([
    paths.length ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("line_files").select("line_id").in("line_id", ids).eq("kind", "tech_pack").is("removed_at", null) : Promise.resolve({ data: [] }),
    // Each style's own steps: the order's stage is its slowest style's, which would show a style that is ahead as behind.
    ids.length ? supabase.from("line_stages").select("line_id, stage, planned_on, done_on").in("line_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const today = todayIST();
  const stepRows = (steps ?? []) as StepRow[];
  const urlOf = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  const hasPack = new Set((packs ?? []).map((p) => p.line_id));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryOf = new Map(factories.map((f) => [f.id, f.name]));
  const total = count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  // Nothing to search yet (a new company, or no open orders): no search box and filters over an empty page.
  const filtered = !!(q || buyer || factory);
  const bare = !filtered && total === 0;
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(buyer ? { buyer } : {}), ...(factory ? { factory } : {}), ...(all ? { show: "all" } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/styles?${p}`;
  };

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Style catalogue</h1>
          <p>{qty(total)} {total === 1 ? "style" : "styles"}{all ? "" : " on open orders"}.{total ? " Tap one to open its order and TNA." : ""}</p>
        </div>
        <nav className="seg" aria-label="Show">
          <Link href={qs({ show: "", page: "" })} aria-current={!all ? "page" : undefined}>Open orders</Link>
          <Link href={qs({ show: "all", page: "" })} aria-current={all ? "page" : undefined}>All orders</Link>
        </nav>
      </div>

      {!bare && <form className="cat-filters" action="/styles">
        {all && <input type="hidden" name="show" value="all" />}
        <input className="inp" type="search" name="q" defaultValue={q} placeholder="Search style, description, colour or fabric" aria-label="Search styles" enterKeyHint="search" />
        <select className="inp" name="buyer" defaultValue={buyer} aria-label="Buyer">
          <option value="">All buyers</option>
          {buyers.filter((b) => b.active || b.id === buyer).map((b) => <option key={b.id} value={b.id}>{buyerName(b)}</option>)}
        </select>
        <select className="inp" name="factory" defaultValue={factory} aria-label="Factory">
          <option value="">All factories</option>
          {factories.filter((f) => f.active || f.id === factory).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className="btn">Show</button>
      </form>}

      {error && <div className="errbox">{error.message}</div>}
      {rows.length === 0 ? (
        <div className="empty">
          <b>{filtered ? "No styles found" : "No styles yet"}</b>
          {filtered ? <>Try another search, or <Link href={qs({ q: "", buyer: "", factory: "", page: "" })} className="link">clear the filters</Link>.</> : all ? "Styles appear here as orders are entered." : "Styles appear here as orders are entered. Shipped orders' styles are under All orders."}
        </div>
      ) : (
        <ul className="cat-grid">
          {rows.map((r) => {
            const o = r.orders;
            const url = r.photo_path ? urlOf.get(r.photo_path) : null;
            const sizes = sizeEntries(r.sizes);
            const st = STATUS[o.status];
            const pr = o.status === "open" ? styleProgress([r.id], stepRows, o.revised_ship_date || o.ship_date, today) : null;
            return (
              <li key={r.id}>
                <Link href={`/orders/${o.id}#style-${r.id}`} className="cat-card">
                  <div className="cat-img">
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                    {url ? <img src={url} alt={`${r.style} ${r.colour ?? ""}`} loading="lazy" /> : <span>{r.style}</span>}
                    {/* No chip for a style with no step done and nothing late: a "not done yet" chip tells nobody anything. */}
                    {pr ? (pr.behind || pr.done > 0) && <em className={`chip ${pr.behind ? "warn" : "info"}`}>{pr.text}</em> : st ? <em className={st.cls}>{st.label}</em> : null}
                  </div>
                  <div className="cat-body">
                    <b className="code">{r.style}</b>
                    <span className="cat-desc">{[r.description, r.colour].filter(Boolean).join(" · ") || "—"}</span>
                    <span className="cat-meta">{buyerOf.get(o.buyer_id)} · {r.factory_id ? factoryOf.get(r.factory_id) : "No factory"}</span>
                    <span className="cat-meta">{o.order_no} · {qtyU(r.qty, r.product)}{(o.revised_ship_date || o.ship_date) ? ` · ships ${day(o.revised_ship_date || o.ship_date)}` : ""}</span>
                    {(r.fabric || sizes.length > 0 || hasPack.has(r.id)) && (
                      <span className="cat-tags">
                        {r.fabric && <i>{r.fabric}</i>}
                        {sizes.length > 0 && <i>{sizes.map(([s]) => s).join(" ")}</i>}
                        {hasPack.has(r.id) && <i className="ok">Tech pack</i>}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav className="row justify-center" aria-label="Pages">
          {page > 1 && <Link className="btn sm" href={qs({ page: String(page - 1) })}>Previous</Link>}
          <span className="muted text-[13px]">Page {page} of {pages}</span>
          {page < pages && <Link className="btn sm" href={qs({ page: String(page + 1) })}>Next</Link>}
        </nav>
      )}
    </>
  );
}
