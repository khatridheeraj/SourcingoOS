// A factory's bills and payments, read from Sourcingo's accounts (Tally): what is still to be paid on each bill,
// and the payments and debit notes of the last four months. No due dates, holds or the team's notes.
import { dayAtNear as dayAt, dayNear as day, money } from "@/lib/format";
import { words, type Lang } from "./i18n";

export type FactoryMoneyData = {
  linked: boolean; read_at?: string | null;
  bills: { bill: string | null; bill_date: string | null; amount: number | null; open: number }[];
  paid: { kind: "payment" | "debit_note"; on: string; amount: number; number: string | null; bills: string[] }[];
};

export function FactoryMoney({ data, lang }: { data: FactoryMoneyData; lang: Lang }) {
  const w = words(lang);
  if (!data.linked || (!data.bills.length && !data.paid.length)) return null;
  const open = data.bills.reduce((n, b) => n + Number(b.open), 0);
  return (
    <section className="card fmoney" aria-labelledby="fmoney-h">
      <header className="card-h">
        <div>
          <h2 id="fmoney-h">{w.money}</h2>
          <p className="num">{open > 0 ? w.moneyOpen(money(open), data.bills.length) : w.moneyAllPaid}</p>
        </div>
        {data.read_at && <span className="muted text-[12px]">{w.moneyRead(dayAt(data.read_at))}</span>}
      </header>
      {data.bills.length > 0 && (
        <div className="fmoney-part">
          <h3>{w.billsToPay}</h3>
          <ul>
            {data.bills.map((b, i) => (
              <li key={b.bill ?? `earlier-${i}`}>
                <span className="fmoney-id"><b className="code">{b.bill ?? w.earlierBalance}</b>{b.bill_date && <small>{day(b.bill_date)}</small>}</span>
                <span className="fmoney-amt num">
                  {b.amount != null && Number(b.amount) !== Number(b.open) && <small>{money(Number(b.amount))}</small>}
                  <b>{b.amount != null && Number(b.amount) !== Number(b.open) ? w.billLeft(money(Number(b.open))) : money(Number(b.open))}</b>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="fmoney-part">
        <h3>{w.paidRecently}</h3>
        {data.paid.length ? (
          <ul>
            {data.paid.map((p, i) => (
              <li key={`${p.on}-${i}`}>
                <span className="fmoney-id">
                  <b>{p.kind === "payment" ? w.payment : `${w.debitNote}${p.number ? ` ${p.number}` : ""}`}</b>
                  <small>{[day(p.on), p.bills.length ? w.forBills(p.bills.join(", ")) : ""].filter(Boolean).join(" · ")}</small>
                </span>
                <span className="fmoney-amt num"><b className={p.kind === "payment" ? "text-ok" : undefined}>{money(Number(p.amount))}</b></span>
              </li>
            ))}
          </ul>
        ) : <p className="muted text-[13px]">{w.noPayments}</p>}
      </div>
      <details className="howto fmoney-help">
        <summary>{w.howItWorks}</summary>
        <p>{w.moneyHelp}</p>
      </details>
    </section>
  );
}
