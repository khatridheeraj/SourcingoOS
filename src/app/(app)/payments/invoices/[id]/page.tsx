import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCode, Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadBooks } from "@/lib/data";
import { fmtDay, money } from "@/lib/model";
import { isFinance } from "@/lib/roles";
import { ChequeChip, InvoiceChip } from "../../chips";
import { AddCreditNote, DeleteButton, InvoiceForm } from "../../forms";
import { buyerOptions, orderOptions } from "../../options";

export const metadata = { title: "Invoice · Sourcingo OS" };

export default async function InvoicePage({ params }: PageProps<"/payments/invoices/[id]">) {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const { id } = await params;
  const { books: b, world: w } = await loadBooks();
  const i = b.invoiceRowById.get(id);
  if (!i) notFound();
  const credits = b.creditNotes.filter((c) => c.invoice_id === i.id);
  const days = b.buyerById.get(i.buyer_id)?.credit_days;
  const locked = i.cheques.length || credits.length ? "Has cheques or credit notes, so the buyer is fixed" : undefined;

  return (
    <div className="stack">
      <Head crumbs={<>Finance › <Link className="link" href="/payments?tab=invoices">Payments</Link> › Invoice</>}
        title={<><span className="code">{i.invoice_no}</span> <InvoiceChip i={i} /></>}
        sub={<><BuyerCode buyer={w.buyerById.get(i.buyer_id)} /> · invoice dated {fmtDay(i.invoice_date)}</>}>
        {i.state !== "paid" && i.net != null && <Link className="btn primary" href={`/payments/cheques/new?buyer=${i.buyer_id}&invoice=${i.id}`}>+ Record cheque</Link>}
      </Head>

      <section className="panel">
        <div className="dl">
          <div><span>Amount with tax</span><b>{i.amount == null ? <span className="text-warn">Not entered yet</span> : money(i.amount)}</b></div>
          {i.credit > 0 && <div><span>Credit notes</span><b>− {money(i.credit)}</b></div>}
          <div><span>To collect</span><b>{i.net == null ? "—" : money(i.net)}</b></div>
          <div><span>Covered by cheques</span><b>{money(i.covered)}</b></div>
          <div><span>Cleared</span><b>{money(i.received)}</b></div>
          <div><span>Left to collect</span><b className={i.overdue ? "text-bad" : ""}>{money(i.outstanding)}</b></div>
          <div><span>Due</span><b className={i.overdue ? "text-bad" : ""}>{i.due ? fmtDay(i.due) : "Set credit days for this buyer"}{!i.due_date && i.due && <small className="text-xs text-muted"> ({days} days)</small>}</b></div>
          {i.so_id && <div><span>Sales order</span><b><Link className="link" href={`/orders/${i.so_id}`}>{i.so_id}</Link></b></div>}
          {i.dc_id && <div><span>Delivery challan</span><b><Link className="link" href={`/dc/${i.dc_id}`}>{i.dc_id}</Link></b></div>}
        </div>
        {i.notes && <p className="mt-3 whitespace-pre-line text-[12.5px]"><b>Notes:</b> {i.notes}</p>}
      </section>

      <section className="panel stack">
        <h3>Cheques</h3>
        {i.cheques.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Cheque</th><th>Cheque date</th><th>Cheque amount</th><th>For this invoice</th><th>Status</th></tr></thead>
              <tbody>
                {i.cheques.map(({ cheque: c, amount }) => (
                  <tr key={c.id}>
                    <td><Link className="code font-semibold text-accent" href={`/payments/cheques/${c.id}`}>{c.cheque_no}</Link>{c.bank && <><br /><span className="text-xs text-muted">{c.bank}</span></>}</td>
                    <td className="num">{fmtDay(c.cheque_date)}</td>
                    <td className="num">{money(c.amount)}</td>
                    <td className="num">{money(amount)}</td>
                    <td><ChequeChip c={{ ...c, stale: b.cheques.find((x) => x.id === c.id)?.stale ?? false }} today={b.today} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">{i.net == null ? "Enter the amount below, then record the buyer's cheque." : "No cheque yet."}</p>
        )}
      </section>

      <section className="panel stack">
        <h3>Credit notes</h3>
        {credits.length > 0 && (
          <div className="list-rows">
            {credits.map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: "space-between" }}>
                <span><b className="code">{c.credit_note_no}</b> <span className="text-xs text-muted">{fmtDay(c.note_date)}{c.notes ? ` · ${c.notes}` : ""}</span></span>
                <span className="row"><b className="num">− {money(c.amount)}</b><DeleteButton kind="credit" id={c.id} label={`credit note ${c.credit_note_no}`} /></span>
              </div>
            ))}
          </div>
        )}
        {i.net == null ? (
          <p className="text-muted">Enter the invoice amount first.</p>
        ) : (
          <details>
            <summary className="link">Add a credit note</summary>
            <div className="mt-3"><AddCreditNote invoiceId={i.id} today={b.today} max={i.uncovered} /></div>
          </details>
        )}
      </section>

      <details className="panel" open={i.amount == null}>
        <summary>{i.amount == null ? "Enter the amount" : "Edit invoice"}</summary>
        <div className="mt-3">
          <InvoiceForm
            buyers={buyerOptions(w, b)} orders={orderOptions(w)} today={b.today} locked={locked}
            initial={{ id: i.id, invoice_no: i.invoice_no, buyer_id: i.buyer_id, invoice_date: i.invoice_date, amount: i.amount == null ? "" : String(i.amount),
              due_date: i.due_date ?? "", so_id: i.so_id ?? "", notes: i.notes ?? "" }}
          />
        </div>
        {!i.dc_id && !i.cheques.length && !credits.length && (
          <div className="mt-3 border-t border-line pt-3"><DeleteButton kind="invoice" id={i.id} label={`invoice ${i.invoice_no}`} back="/payments?tab=invoices" /></div>
        )}
      </details>
    </div>
  );
}
