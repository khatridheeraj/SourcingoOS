import Link from "next/link";
import { dayNear as day, money, qty } from "@/lib/format";
import { sizeEntries } from "@/lib/sizes";
import type { Lang } from "../i18n";
import { marketWords } from "../market-words";
import type { MarketStyle } from "./load";
import { QuoteForm } from "./quote-form";

// One style, the way a product page shows it: the photo, everything the buyer's PO says about it, and the quote box.
export function MarketStyleView({ s, lang, canQuote, base = "/factory/market" }: { s: MarketStyle; lang: Lang; canQuote: boolean; base?: string }) {
  const w = marketWords(lang);
  const u = s.product === "fabric" ? "m" : "pcs";
  const sizes = sizeEntries(s.sizes);
  return (
    <>
      <nav className="crumbs"><Link href={base}>{w.back}</Link><span aria-hidden>/</span><span>{s.style}</span></nav>
      <div className="mkt-detail">
        <div className={`mkt-hero ${s.photo ? "" : "none"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
          {s.photo ? <a href={s.photo} target="_blank" rel="noreferrer"><img src={s.photo} alt={s.style} /></a> : <span aria-hidden>{s.style.slice(0, 2)}</span>}
        </div>
        <div className="mkt-info">
          <h1 className="code">{s.style}</h1>
          {(s.description || s.colour) && <p className="muted">{[s.description, s.colour].filter(Boolean).join(" · ")}</p>}
          <dl className="mkt-facts">
            <div><dt>{w.quantity}</dt><dd className="num mkt-big">{qty(s.qty)} {u === "m" ? w.m : w.pcs}</dd></div>
            <div><dt>{w.readyBy}</dt><dd className="num">{day(s.ready_by)}</dd></div>
            {s.target_rate != null && <div><dt>{w.target}</dt><dd className="num">{money(s.target_rate)} <small className="muted">{w.perUnit(u)}</small></dd></div>}
            {s.fabric && <div><dt>{w.fabric}</dt><dd>{s.fabric}</dd></div>}
            {sizes.length > 0 && <div><dt>{w.sizes}</dt><dd className="num">{sizes.map(([z, n]) => `${z} ${qty(n)}`).join(" · ")}</dd></div>}
          </dl>
          {s.links.length > 0 && (
            <div className="finfo">
              {s.links.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="chip info">{f.kind === "cutting" ? w.cutting : w.techPack}{f.name ? `: ${f.name}` : ""}</a>)}
            </div>
          )}
          {s.note && <p className="mkt-note"><b>{w.note}</b> {s.note}</p>}
          {s.state === "won" && <div className="mkt-result ok"><b>{w.won}</b><span>{w.wonSub}</span></div>}
          {s.state === "closed" && <div className="mkt-result"><b>{w.lost}</b><span>{w.lostSub}</span></div>}
          {s.state === "open" && (
            <section className="mkt-quote">
              <h2>{w.quoteTitle}</h2>
              <p className="muted text-[12.5px]">{s.closes_on ? w.closes(day(s.closes_on)) : ""} · {w.quotes(s.quotes)}</p>
              {canQuote ? <QuoteForm id={s.id} unit={u} readyBy={s.ready_by} mine={s.mine} lang={lang} /> : <p className="muted">{w.preview}</p>}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
