// The buyer's invoices and balance: each invoice still to be paid with its due date and what is left, and those
// paid in full in the last four months. Worked out as in Sourcingo's Payments; cheque details and notes stay inside.
import { dayNear as day, daysBetween, money, todayIST } from "@/lib/format";

export type BuyerInvoice = { invoice_no: string; invoice_date: string; amount: number; due: string | null; left: number; po: string | null };

export function BuyerMoney({ invoices }: { invoices: BuyerInvoice[] }) {
  if (!invoices.length) return null;
  const today = todayIST();
  const open = invoices.filter((i) => Number(i.left) > 0);
  const paid = invoices.filter((i) => Number(i.left) <= 0);
  const toPay = open.reduce((n, i) => n + Number(i.left), 0);
  const pastDue = open.filter((i) => i.due && i.due < today).reduce((n, i) => n + Number(i.left), 0);
  const ref = (i: BuyerInvoice) => [day(i.invoice_date), i.po ? `PO ${i.po}` : ""].filter(Boolean).join(" · ");

  return (
    <section className="card fmoney" aria-labelledby="bmoney-h">
      <header className="card-h">
        <div>
          <h2 id="bmoney-h">Invoices and balance</h2>
          <p className="num">
            {toPay > 0 ? <>{money(toPay)} to pay on {open.length} {open.length === 1 ? "invoice" : "invoices"}</> : "Every invoice paid"}
            {pastDue > 0 && <> · <b className="text-bad">{money(pastDue)} past due</b></>}
          </p>
        </div>
      </header>
      {open.length > 0 && (
        <div className="fmoney-part">
          <h3>To pay</h3>
          <ul>
            {open.map((i) => {
              const late = i.due && i.due < today ? daysBetween(i.due, today) : 0;
              return (
                <li key={i.invoice_no}>
                  <span className="fmoney-id">
                    <b className="code">{i.invoice_no}</b>
                    <small>{ref(i)}</small>
                  </span>
                  <span className="fmoney-amt num">
                    {Number(i.amount) !== Number(i.left) && <small>{money(Number(i.amount))}</small>}
                    <b>{Number(i.amount) !== Number(i.left) ? `${money(Number(i.left))} left` : money(Number(i.left))}</b>
                    {i.due && (late > 0
                      ? <small className="text-bad">{late} {late === 1 ? "day" : "days"} past due</small>
                      : <small>Due {day(i.due)}</small>)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {paid.length > 0 && (
        <div className="fmoney-part">
          <h3>Paid in the last 4 months</h3>
          <ul>
            {paid.map((i) => (
              <li key={i.invoice_no}>
                <span className="fmoney-id"><b className="code">{i.invoice_no}</b><small>{ref(i)}</small></span>
                <span className="fmoney-amt num"><b>{money(Number(i.amount))}</b><small className="text-ok">Paid</small></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="howto fmoney-help">
        <summary>How this works</summary>
        <p>These are Sourcingo&apos;s invoices to you and what is still to be paid on each, after payments and credit notes. A payment can take a few days to show. If something looks wrong, message your Sourcingo merchandiser.</p>
      </details>
    </section>
  );
}
