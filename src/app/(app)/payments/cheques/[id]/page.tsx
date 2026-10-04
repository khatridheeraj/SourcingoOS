import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCode, Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadBooks } from "@/lib/data";
import { daysBetween, fmtDay, money } from "@/lib/model";
import { isFinance } from "@/lib/roles";
import { ChequeChip, InvoiceChip } from "../../chips";
import { ChequeForm, DeleteButton } from "../../forms";
import { buyerOptions, openInvoices } from "../../options";
import { ChequeSteps } from "../../parts";
import { History } from "@/components/history";

export const metadata = { title: "Cheque · Sourcingo OS" };

export default async function ChequePage({ params }: PageProps<"/payments/cheques/[id]">) {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const { id } = await params;
  const { books: b, world: w } = await loadBooks();
  const c = b.cheques.find((x) => x.id === id);
  if (!c) notFound();
  const isOwner = me?.role === "owner";
  const editable = c.status !== "bounced" && c.status !== "cancelled";
  const left = c.amount - c.allocated;
  const t = b.today;

  return (
    <div className="stack">
      <Head crumbs={<>Finance › <Link className="link" href="/payments?tab=cheques">Payments</Link> › Cheque</>}
        title={<>Cheque <span className="code">{c.cheque_no}</span> <ChequeChip c={c} today={t} /></>}
        sub={<><BuyerCode buyer={w.buyerById.get(c.buyer_id)} /> · {money(c.amount)}{c.bank ? ` · ${c.bank}` : ""}</>} />

      <section className="panel stack">
        <div className="dl">
          <div><span>Date on cheque</span><b>{fmtDay(c.cheque_date)}{c.status === "in_hand" && c.cheque_date > t && <small className="text-xs text-muted"> · {daysBetween(t, c.cheque_date) === 1 ? "tomorrow" : `in ${daysBetween(t, c.cheque_date)} days`}</small>}</b></div>
          <div><span>Valid until</span><b className={c.stale ? "text-bad" : ""}>{fmtDay(c.expires)}</b></div>
          <div><span>Received</span><b>{fmtDay(c.received_on)}</b></div>
          <div><span>Deposited</span><b>{fmtDay(c.deposited_on)}</b></div>
          <div><span>Cleared</span><b>{fmtDay(c.cleared_on)}</b></div>
          {c.bounced_on && <div><span>Bounced</span><b className="text-bad">{fmtDay(c.bounced_on)}</b></div>}
          <div><span>Set against invoices</span><b>{money(c.allocated)}{left > 0 && <small className="text-xs text-warn"> · {money(left)} unused</small>}</b></div>
        </div>
        {c.notes && <p className="whitespace-pre-line text-[12.5px]"><b>Notes:</b> {c.notes}</p>}
        <ChequeSteps id={c.id} status={c.status} chequeDate={c.cheque_date} today={t} isOwner={isOwner} />
      </section>

      {c.invoices.length > 0 && (
        <section className="panel stack">
          <h3>Pays</h3>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Invoice date</th><th>Due</th><th>From this cheque</th><th>Invoice status</th></tr></thead>
              <tbody>
                {c.invoices.map(({ invoice, amount }) => {
                  const r = b.invoiceRowById.get(invoice.id)!;
                  return (
                    <tr key={invoice.id}>
                      <td><Link className="code font-semibold text-accent" href={`/payments/invoices/${invoice.id}`}>{invoice.invoice_no}</Link></td>
                      <td className="num">{fmtDay(invoice.invoice_date)}</td>
                      <td className="num">{fmtDay(r.due)}</td>
                      <td className="num">{money(amount)}</td>
                      <td><InvoiceChip i={r} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(c.status === "bounced" || c.status === "cancelled") && <p className="text-xs text-muted">This cheque no longer pays these invoices. Record a new cheque for them.</p>}
        </section>
      )}

      {editable && (
        <details className="panel" open={left > 0 && c.allocated === 0}>
          <summary>{c.allocated === 0 ? "Set against invoices" : "Edit cheque"}</summary>
          <div className="mt-3">
            <ChequeForm
              buyers={buyerOptions(w, b)} invoices={openInvoices(b, c.id)} today={t} fixed={c.status !== "in_hand"}
              initial={{ id: c.id, buyer_id: c.buyer_id, cheque_no: c.cheque_no, bank: c.bank ?? "", cheque_date: c.cheque_date, amount: String(c.amount),
                received_on: c.received_on ?? "", notes: c.notes ?? "", split: Object.fromEntries(c.invoices.map((x) => [x.invoice.id, String(x.amount)])) }}
            />
          </div>
        </details>
      )}
      {(c.status === "in_hand" || isOwner) && (
        <div><DeleteButton kind="cheque" id={c.id} label={`cheque ${c.cheque_no}`} back="/payments?tab=cheques" /></div>
      )}
      <History table="cheques" id={c.id} w={w} />
    </div>
  );
}
