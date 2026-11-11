import Link from "next/link";
import { redirect } from "next/navigation";
import { NO_COMPANY } from "@/lib/names";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { dayNear as day, dueDate, qty, todayIST } from "@/lib/format";
import { openDefaults } from "@/lib/market";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { OpenStyleForm } from "./open-form";

type Line = { id: string; order_id: string; style: string; colour: string | null; description: string | null; qty: number; product: string | null; photo_path: string | null; factory_id: string | null };

// Pick a style of an open buyer PO to open to factories. Styles already on a released factory PO are not offered.
export default async function OpenStylePage({ searchParams }: PageProps<"/factories/market/new">) {
  const sp = await searchParams;
  const onlyOrder = typeof sp.order === "string" ? sp.order : "";
  const [me, supabase, buyers, factories] = await Promise.all([getMe(), createClient(), loadBuyers(), loadFactories()]);
  if (!canEditOrders(me?.role)) redirect("/");
  const company = me?.companyId ?? NO_COMPANY;
  let oq = supabase.from("orders").select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date").eq("company_id", company)
    .eq("status", "open").is("removed_at", null).order("ship_date", { nullsFirst: false }).limit(200);
  if (onlyOrder) oq = oq.eq("id", onlyOrder);
  const { data: orders, error } = await oq;
  const ids = (orders ?? []).map((o) => o.id);
  const [{ data: lineRows }, { data: pos }, { data: openRows }] = ids.length ? await Promise.all([
    supabase.from("order_lines").select("id, order_id, style, colour, description, qty, product, photo_path, factory_id").in("order_id", ids).is("removed_at", null).order("position"),
    supabase.from("factory_pos").select("order_id, factory_id").in("order_id", ids).not("released_at", "is", null),
    supabase.from("market_listings").select("id, line_id").in("order_id", ids).is("closed_at", null),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const released = new Set((pos ?? []).map((p) => `${p.order_id}:${p.factory_id}`));
  const listingOf = new Map((openRows ?? []).map((r) => [r.line_id as string, r.id as string]));
  const lines = ((lineRows ?? []) as Line[]).filter((l) => !(l.factory_id && released.has(`${l.order_id}:${l.factory_id}`)));
  const paths = lines.map((l) => l.photo_path).filter((p): p is string => !!p);
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryOf = new Map(factories.map((f) => [f.id, f.name]));
  const today = todayIST();
  const blocks = (orders ?? []).map((o) => ({ o, lines: lines.filter((l) => l.order_id === o.id) })).filter((b) => b.lines.length);

  return (
    <>
      <nav className="crumbs"><Link href="/factories/market">Quotes</Link><span aria-hidden>/</span><span>Open a style</span></nav>
      <div className="head">
        <div className="grow">
          <h1>Open a style to factories</h1>
          <p className="hide-phone">Every factory sees the style&apos;s photo, fabric, sizes, quantity and tech pack, never the buyer or the buyer&apos;s price.</p>
        </div>
      </div>
      {error && <div className="errbox">{error.message}</div>}
      {blocks.length === 0 && <div className="empty"><b>No style to open</b>Every style of the open orders is already on a released factory PO.</div>}
      {blocks.map(({ o, lines: ls }) => {
        const due = dueDate(o);
        return (
          <section key={o.id} className="card">
            <div className="card-h">
              <div>
                <h2><Link href={`/orders/${o.id}?tab=styles`} className="code">{o.order_no}</Link> <span className="muted font-normal">· {buyerOf.get(o.buyer_id) ?? ""}{o.buyer_po ? ` · PO ${o.buyer_po}` : ""}</span></h2>
                <p>{due ? `Ships ${day(due)}` : "No ship date yet"}</p>
              </div>
            </div>
            {ls.map((l) => {
              const listing = listingOf.get(l.id);
              const photo = l.photo_path ? urlOf.get(l.photo_path) : undefined;
              const d = openDefaults(due ?? null, l.product === "fabric", today);
              return (
                <div key={l.id} className="mkt-pick">
                  <div className="mkt-row">
                    <span className="mkt-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                      {photo ? <img src={photo} alt="" loading="lazy" /> : l.style.slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <b className="code">{l.style}</b>{l.colour ? <span className="muted"> · {l.colour}</span> : null}
                      <small className="num">{qty(l.qty)} {l.product === "fabric" ? "m" : "pcs"} · {l.factory_id ? `now with ${factoryOf.get(l.factory_id) ?? "a factory"}` : "no factory yet"}{photo ? "" : " · no photo"}</small>
                    </span>
                    {listing && <Link href={`/factories/market/${listing}`} className="chip info">Open to factories</Link>}
                  </div>
                  {!listing && <OpenStyleForm lineId={l.id} style={l.style} unit={l.product === "fabric" ? "m" : "pc"} readyBy={d.readyBy} closesOn={d.closesOn} today={today} hasPhoto={!!photo} />}
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
