import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { dayNear as day, money, qty, todayIST } from "@/lib/format";
import { rankQuotes } from "@/lib/market";
import { FactoriesTabs } from "../factories-tabs";
import { loadListings, type Listing } from "./load";

const unit = (l: Listing) => (l.product === "fabric" ? "m" : "pcs");

// Styles opened to factories, from the team's side: where quotes are in and a factory is to be chosen, where quotes
// are still awaited, and what was decided lately.
export default async function MarketPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const { listings, error } = await loadListings();
  const today = todayIST();
  const open = listings.filter((l) => !l.closed_at);
  const live = (l: Listing) => l.quotes.filter((q) => !q.withdrawn_at).length;
  const toChoose = open.filter((l) => live(l) > 0);
  const waiting = open.filter((l) => live(l) === 0);
  const decided = listings.filter((l) => l.closed_at).sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));

  const row = (l: Listing) => {
    const ranked = rankQuotes(l.quotes, l.ready_by, l.buyer_rate);
    const won = l.quotes.find((q) => q.id === l.awarded_quote);
    const closed = !l.closed_at && l.closes_on < today;
    return (
      <Link key={l.id} href={`/factories/market/${l.id}`} className="mkt-row">
        <span className="mkt-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
          {l.photo ? <img src={l.photo} alt="" loading="lazy" /> : l.style.slice(0, 2)}
        </span>
        <span className="min-w-0">
          <b className="code">{l.style}</b> <span className="muted">{l.order_no}{l.buyer ? ` · ${l.buyer}` : ""}</span>
          <small className="num">{qty(l.qty)} {unit(l)} · ready by {day(l.ready_by)}{l.closed_at ? "" : ` · quotes ${closed ? "closed" : "close"} ${day(l.closes_on)}`}</small>
        </span>
        <span className="text-right">
          {won ? <span className="chip ok">{won.factory}</span>
            : l.closed_at ? <span className="muted text-[12.5px]">Closed</span>
            : ranked.length ? <><b className="num">{money(ranked[0].rate)}</b><small className="num">{ranked.length} {ranked.length === 1 ? "quote" : "quotes"}</small></>
            : closed ? <span className="chip warn">No quotes</span> : <small>No quotes yet</small>}
        </span>
      </Link>
    );
  };
  const section = (title: string, sub: string, rows: Listing[]) => rows.length > 0 && (
    <section className="card">
      <div className="card-h"><div><h2>{title}</h2><p>{sub}</p></div></div>
      <div>{rows.map(row)}</div>
    </section>
  );

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Factories</h1>
          <p className="hide-phone">Styles open to factories. They see the exact product in Shop orders and quote a price and ready date.</p>
        </div>
        <Link href="/factories/market/new" className="btn primary">Open a style</Link>
      </div>
      <FactoriesTabs at="market" />
      {error && <div className="errbox">{error}</div>}
      {open.length === 0 && decided.length === 0 && (
        <div className="empty"><b>No styles open to factories</b>Open a style of a buyer PO and every factory sees it in its panel to quote on.</div>
      )}
      {section("Choose a factory", "Quotes are in. Best first: on time, then cheapest.", toChoose)}
      {section("Waiting for quotes", "Factories see these in Shop orders now.", waiting)}
      {section("Decided lately", "The last 30 days.", decided)}
      <details className="howto">
        <summary>How Shop orders works</summary>
        <p>Every active factory with a panel login sees the open styles: photo, fabric, sizes, quantity, tech pack, the ready-by date and your target price if you gave one. They never see the buyer or the buyer&apos;s price, and only see how many others quoted, never their prices. Award a quote and the style takes that factory and price; then ask its TNA and send the factory PO as usual.</p>
      </details>
    </>
  );
}
