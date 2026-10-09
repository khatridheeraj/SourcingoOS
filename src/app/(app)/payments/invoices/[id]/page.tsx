import Link from "next/link";
import { notFound } from "next/navigation";
import { day, money } from "@/lib/format";
import { INVOICE_LABEL } from "@/lib/payments";
import { AddCreditNote, CancelCreditNote, CancelInvoice, ChequeChip, InvoiceForm } from "../../forms";
import { PaymentHistory } from "../../history";
import { loadBooks } from "../../load";
import { buyerOptions } from "../../options";

export default async function InvoicePage({ params }: PageProps<"/payments/invoices/[id]">) {
  const { books: b, buyerLabel } = await loadBooks();
  const { id } = await params;
  const i = b.invoiceRowById.get(id);
  if (!i) notFound();
  const credits = b.creditNotes.filter((c) => c.invoice_id === i.id);
  const days = b.buyerById.get(i.buyer_id)?.credit_days;
  const cancelled = i.state === "cancelled";
  const live = i.cheques.filter((c) => c.cheque.status !== "bounced" && c.cheque.status !== "cancelled");
  const locked = live.length || credits.length ? "Has cheques or credit notes, so the buyer is fixed" : undefined;
  const input = { id: i.id, invoice_no: i.invoice_no, buyer_id: i.buyer_id, invoice_date: i.invoice_date, amount: String(i.amount), due_date: i.due_date ?? "", notes: i.notes ?? "" };

  return (
    <div className="stack">
      <div className="head">
        <div className="grow">
          <Link href="/payments?tab=invoices" className="link text-xs">← Payments</Link>
          <h1><span className="code">{i.invoice_no}</span> <span className={`chip ${cancelled ? "" : i.overdue ? "bad" : i.state === "paid" ? "ok" : "info"} align-middle`}>{i.overdue ? "Overdue" : INVOICE_LABEL[i.state]}</span></h1>
          <p><span className="code">{buyerLabel(i.buyer_id)}</span> · dated {day(i.invoice_date)}</p>
        </div>
        {!cancelled && i.uncovered > 0 && <Link className="btn primary" href={`/payments/cheques/new?invoice=${i.id}`}>Record cheque</Link>}
      </div>

      {cancelled && <div className="warnbox">This invoice is cancelled. It stays on record but no longer counts in what the buyer owes.</div>}

      <section className="panel">
        <div className="tiles">
          <div className="tile"><span>Amount with tax</span><b>{money(i.amount)}</b>{i.credit > 0 && <small className="muted text-xs">less {money(i.credit)} credit notes = {money(i.net)}</small>}</div>
          <div className="tile"><span>Paid by cheques</span><b>{money(i.covered)}</b><small className="muted text-xs">{money(i.received)} cleared</small></div>
          <div className={`tile ${i.overdue ? "alarm" : ""}`}><span>Left to collect</span><b>{money(i.outstanding)}</b></div>
          <div className="tile"><span>Due</span><b className="!text-lg">{i.due ? day(i.due) : "Not set"}</b><small className="muted text-xs">{i.due_date ? "Own due date" : days != null ? `${days} credit days` : "Set credit days in Payments › Buyers"}</small></div>
        </div>
        {i.notes && <p className="mt-3 whitespace-pre-line text-[13px]"><b>Notes:</b> {i.notes}</p>}
      </section>

      <section className="panel stack">
        <h2>Cheques</h2>
        {i.cheques.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Cheque</th><th>Cheque date</th><th className="r">Cheque amount</th><th className="r">For this invoice</th><th>Status</th></tr></thead>
              <tbody>
                {i.cheques.map(({ cheque: c, amount }) => (
                  <tr key={c.id}>
                    <td><Link className="link code" href={`/payments/cheques/${c.id}`}>{c.cheque_no}</Link>{c.bank && <div className="text-xs muted">{c.bank}</div>}</td>
                    <td>{day(c.cheque_date)}</td>
                    <td className="r num">{money(c.amount)}</td>
                    <td className="r num">{money(amount)}</td>
                    <td><ChequeChip c={b.cheques.find((x) => x.id === c.id)!} today={b.today} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No cheque yet.</p>
        )}
      </section>

      <section className="panel stack">
        <h2>Credit notes</h2>
        {credits.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {credits.map((c) => (
              <li key={c.id} className="row justify-between py-2">
                <span><b className="code">{c.credit_note_no}</b> <span className="text-xs muted">{day(c.note_date)}{c.notes ? ` · ${c.notes}` : ""}</span></span>
                <span className="row"><b className="num">less {money(c.amount)}</b>{!cancelled && <CancelCreditNote note={c} />}</span>
              </li>
            ))}
          </ul>
        )}
        {!cancelled && (
          <details>
            <summary className="link cursor-pointer">Add a credit note</summary>
            <div className="mt-3"><AddCreditNote invoiceId={i.id} today={b.today} max={i.uncovered} /></div>
          </details>
        )}
      </section>

      {!cancelled && (
        <details className="panel">
          <summary className="cursor-pointer font-bold">Edit or cancel this invoice</summary>
          <div className="mt-3 stack">
            <InvoiceForm buyers={buyerOptions(b, buyerLabel)} today={b.today} locked={locked} initial={input} />
            <div className="border-t border-line pt-3">
              {live.length ? <p className="text-xs muted">To cancel this invoice, first take it off its cheques.</p> : <CancelInvoice invoice={input} />}
            </div>
          </div>
        </details>
      )}

      <PaymentHistory view="invoice" rowIds={[i.id, ...credits.map((c) => c.id)]} />
    </div>
  );
}
