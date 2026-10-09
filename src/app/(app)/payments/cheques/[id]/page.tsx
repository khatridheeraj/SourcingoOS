import Link from "next/link";
import { notFound } from "next/navigation";
import { day, money } from "@/lib/format";
import { daysBetween, INVOICE_LABEL, SLACK } from "@/lib/payments";
import { ChequeChip, ChequeForm, ChequeSteps } from "../../forms";
import { PaymentHistory } from "../../history";
import { loadBooks } from "../../load";
import { buyerOptions, openInvoices } from "../../options";

export default async function ChequePage({ params, searchParams }: PageProps<"/payments/cheques/[id]">) {
  const { books: b, buyerLabel, owner } = await loadBooks();
  const { id } = await params;
  const { saved } = await searchParams;
  const c = b.cheques.find((x) => x.id === id);
  if (!c) notFound();
  const t = b.today;
  const editable = c.status !== "bounced" && c.status !== "cancelled";
  const left = Number(c.amount) - c.allocated;
  const until = c.status === "in_hand" && c.cheque_date > t ? daysBetween(t, c.cheque_date) : 0;

  return (
    <div className="stack">
      <div className="head">
        <div className="grow">
          <Link href="/payments?tab=cheques" className="link text-xs">← Payments</Link>
          <h1>Cheque <span className="code">{c.cheque_no}</span> <span className="align-middle"><ChequeChip c={c} today={t} /></span></h1>
          <p><span className="code">{buyerLabel(c.buyer_id)}</span> · {money(c.amount)}{c.bank ? ` · ${c.bank}` : ""}</p>
        </div>
      </div>
      {saved && <div className="okbox">Cheque {c.cheque_no} saved.</div>}

      <section className="panel stack">
        <div className="tiles">
          <div className="tile"><span>Date on cheque</span><b className="!text-lg">{day(c.cheque_date)}</b>{until > 0 && <small className="muted text-xs">{until === 1 ? "tomorrow" : `in ${until} days`}</small>}</div>
          <div className={`tile ${c.stale ? "alarm" : ""}`}><span>Valid until</span><b className="!text-lg">{day(c.expires)}</b></div>
          <div className="tile"><span>Received</span><b className="!text-lg">{day(c.received_on) || "Not noted"}</b></div>
          <div className="tile"><span>{c.bounced_on ? "Bounced" : c.cleared_on ? "Cleared" : "Deposited"}</span><b className="!text-lg">{day(c.bounced_on ?? c.cleared_on ?? c.deposited_on) || "Not yet"}</b></div>
        </div>
        {c.notes && <p className="whitespace-pre-line text-[13px]"><b>Notes:</b> {c.notes}</p>}
        <ChequeSteps id={c.id} status={c.status} chequeDate={c.cheque_date} today={t} isOwner={owner} />
      </section>

      <section className="panel stack">
        <h2>Pays</h2>
        {c.invoices.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Invoice date</th><th>Due</th><th className="r">From this cheque</th><th>Invoice status</th></tr></thead>
              <tbody>
                {c.invoices.map(({ invoice, amount }) => {
                  const r = b.invoiceRowById.get(invoice.id)!;
                  return (
                    <tr key={invoice.id}>
                      <td><Link className="link code" href={`/payments/invoices/${invoice.id}`}>{invoice.invoice_no}</Link></td>
                      <td>{day(invoice.invoice_date)}</td>
                      <td>{day(r.due)}</td>
                      <td className="r num">{money(amount)}</td>
                      <td><span className={`chip ${r.state === "paid" ? "ok" : r.overdue ? "bad" : "info"}`}>{r.overdue ? "Overdue" : INVOICE_LABEL[r.state]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Not set against any invoice yet.</p>
        )}
        {left > SLACK && editable && <p className="text-[13px] text-warn">{money(left)} of this cheque isn&apos;t set against an invoice yet.</p>}
        {!editable && c.invoices.length > 0 && <p className="text-xs muted">This cheque no longer pays these invoices. Record a new cheque for them.</p>}
      </section>

      {editable && (
        <details className="panel" open={c.invoices.length === 0}>
          <summary className="cursor-pointer font-bold">{c.invoices.length === 0 ? "Set against invoices" : "Edit cheque or change which invoices it pays"}</summary>
          <div className="mt-3">
            <ChequeForm buyers={buyerOptions(b, buyerLabel)} invoices={openInvoices(b, c.id)} today={t} fixed={c.status !== "in_hand" && !owner}
              initial={{ id: c.id, buyer_id: c.buyer_id, cheque_no: c.cheque_no, bank: c.bank ?? "", cheque_date: c.cheque_date, amount: String(c.amount),
                received_on: c.received_on ?? "", notes: c.notes ?? "", split: Object.fromEntries(c.invoices.map((x) => [x.invoice.id, String(x.amount)])) }} />
          </div>
        </details>
      )}

      <PaymentHistory view="cheque" rowIds={[c.id]} />
    </div>
  );
}
