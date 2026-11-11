import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { dayAtNear, dayNear as day, money, qty, todayIST } from "@/lib/format";
import { rankQuotes } from "@/lib/market";
import { loadListings } from "../load";
import { AwardButton, CloseListing } from "./quote-actions";

// One style open to factories: what they see, and every quote side by side, best first.
export default async function ListingPage({ params }: PageProps<"/factories/market/[id]">) {
  const { id } = await params;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const { listings } = await loadListings(id);
  const l = listings[0];
  if (!l) notFound();
  const today = todayIST();
  const u = l.product === "fabric" ? "m" : "pc";
  const ranked = rankQuotes(l.quotes, l.ready_by, l.buyer_rate);
  const awarded = l.quotes.find((q) => q.id === l.awarded_quote);
  const open = !l.closed_at;
  const withdrawn = l.quotes.filter((q) => q.withdrawn_at).length;

  return (
    <>
      <nav className="crumbs"><Link href="/factories/market">Quotes</Link><span aria-hidden>/</span><span>{l.style}</span></nav>
      <div className="mkt-detail">
        <div className={`mkt-hero ${l.photo ? "" : "none"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
          {l.photo ? <img src={l.photo} alt={l.style} /> : <span aria-hidden>{l.style.slice(0, 2)}</span>}
        </div>
        <div className="mkt-info">
          <h1 className="code">{l.style}</h1>
          <p className="muted"><Link href={`/orders/${l.order_id}?tab=styles`} className="link">{l.order_no}</Link>{l.buyer ? ` · ${l.buyer}` : ""}{l.buyer_po ? ` · PO ${l.buyer_po}` : ""}{[l.description, l.colour].filter(Boolean).length ? ` · ${[l.description, l.colour].filter(Boolean).join(" · ")}` : ""}</p>
          <dl className="mkt-facts">
            <div><dt>Quantity</dt><dd className="num mkt-big">{qty(l.qty)} {l.product === "fabric" ? "m" : "pcs"}</dd></div>
            <div><dt>Ready by</dt><dd className="num">{day(l.ready_by)}</dd></div>
            <div><dt>Quotes {open && l.closes_on >= today ? "close" : "closed"}</dt><dd className="num">{day(l.closes_on)}</dd></div>
            {l.buyer_rate != null && <div><dt>Buyer price</dt><dd className="num">{money(l.buyer_rate)} <small className="muted">per {u}</small></dd></div>}
            {l.target_rate != null && <div><dt>Target shown to factories</dt><dd className="num">{money(l.target_rate)} <small className="muted">per {u}</small></dd></div>}
          </dl>
          {l.note && <p className="mkt-note"><b>Note to factories</b>{l.note}</p>}
          {awarded && <div className="mkt-result ok"><b>Given to {awarded.factory} at {money(awarded.rate)} per {u}</b><span>Next: ask its TNA and send the factory PO from the <Link href={`/orders/${l.order_id}?tab=styles`} className="link">order</Link>.</span></div>}
          {!open && !awarded && <div className="mkt-result"><b>Closed without a factory</b><span>{dayAtNear(l.closed_at)}</span></div>}
        </div>
      </div>

      <section className="card">
        <div className="card-h">
          <div><h2>Quotes</h2><p>{ranked.length ? "Best first: on time, then cheapest, then the factory we know better." : open ? "No quotes yet. Factories see this style in Shop orders now." : "No quotes came in."}{withdrawn ? ` ${withdrawn} taken back.` : ""}</p></div>
          {open && <CloseListing id={l.id} />}
        </div>
        {ranked.length > 0 && (
          <div className="mkt-quotes">
            {ranked.map((q) => (
              <div key={q.id} className="mkt-q">
                <div className="mkt-q-who">
                  <b>{q.factory}{q.city ? <span className="muted font-normal"> · {q.city}</span> : null}</b>
                  <small className="num">
                    Ready {day(q.ready_on)}{q.daysLate > 0 ? <span className="text-warn font-semibold"> · {q.daysLate} {q.daysLate === 1 ? "day" : "days"} after ready-by</span> : " · on time"}
                    {" · "}{q.styles_with_us ? `${q.styles_with_us} ${q.styles_with_us === 1 ? "style" : "styles"} with us` : "New to us"}
                    {" · quoted "}{dayAtNear(q.updated_at || q.created_at)}
                  </small>
                  {q.note && <small>{q.note}</small>}
                </div>
                <div className="mkt-q-rate num">
                  {money(q.rate)}<small className="muted font-normal"> /{u}</small>
                  {q.margin != null && <small className={`block text-[12.5px] font-normal ${q.margin < 0 ? "text-bad font-semibold" : "muted"}`}>{q.margin < 0 ? `Below cost by ${money(-q.margin)}` : `Margin ${money(q.margin)} (${q.marginPct}%)`}</small>}
                </div>
                {open && (
                  <div className="mkt-q-act">
                    <AwardButton listingId={l.id} quoteId={q.id} factory={q.factory} primary={q.best} />
                    {q.best && <span className="chip info">Suggested</span>}
                  </div>
                )}
                {awarded?.id === q.id && <div className="mkt-q-act"><span className="chip ok">Awarded</span></div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
