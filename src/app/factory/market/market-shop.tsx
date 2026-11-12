import Link from "next/link";
import { dayNear as day, money, qty, todayIST } from "@/lib/format";
import { daysBetween } from "@/lib/format";
import type { Lang } from "../i18n";
import { marketWords } from "../market-words";
import type { MarketStyle } from "./load";

const unit = (s: { product: string }) => (s.product === "fabric" ? "m" : "pcs");

// The shop: one card per style, photo first, like a catalogue. Open styles first, then the ones this factory quoted
// on that are now decided.
export function MarketShop({ styles, lang, base = "/factory/market" }: { styles: MarketStyle[]; lang: Lang; base?: string }) {
  const w = marketWords(lang);
  const today = todayIST();
  const open = styles.filter((s) => s.state === "open");
  const done = styles.filter((s) => s.state !== "open");
  const card = (s: MarketStyle) => {
    const u = unit(s);
    const left = daysBetween(today, s.closes_on);
    return (
      <li key={s.id}>
        <Link href={`${base}/${s.id}`} className="mkt-card">
          <div className="mkt-photo">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
            {s.photo ? <img src={s.photo} alt="" loading="lazy" /> : <span aria-hidden>{s.style.slice(0, 2)}</span>}
            {s.state === "won" && <span className="chip ok">{w.won}</span>}
            {s.state === "closed" && <span className="chip">{w.lost}</span>}
          </div>
          <div className="mkt-body">
            <b className="code">{s.style}</b>
            <span className="mkt-sub">{[s.description, s.colour].filter(Boolean).join(" · ") || (s.product === "fabric" ? w.fabricStyle : "")}</span>
            <span className="mkt-qty num">{qty(s.qty)} {u === "m" ? w.m : w.pcs}</span>
            <span className="mkt-meta num">{w.readyBy} {day(s.ready_by)}</span>
            {s.state === "open" && (s.mine
              ? <span className="mkt-mine num">{w.yourQuote} {money(s.mine.rate)}</span>
              : <span className={`mkt-meta ${left <= 1 ? "text-warn font-semibold" : ""}`}>{left <= 0 ? w.closesToday : w.closes(day(s.closes_on))}</span>)}
            {s.state === "open" && <span className="mkt-meta">{w.quotes(s.quotes)}</span>}
          </div>
        </Link>
      </li>
    );
  };
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{w.title}</h1>
          <p>{w.intro}</p>
        </div>
      </div>
      {open.length === 0 ? <div className="empty"><b>{w.none}</b>{w.noneSub}</div> : <ul className="mkt-grid">{open.map(card)}</ul>}
      {done.length > 0 && <ul className="mkt-grid">{done.map(card)}</ul>}
      <details className="howto"><summary>{w.how}</summary><p>{w.howBody}</p></details>
    </>
  );
}
