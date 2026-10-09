import Link from "next/link";
import { ChequeForm } from "../../forms";
import { loadBooks } from "../../load";
import { buyerOptions, openInvoices } from "../../options";

export default async function NewChequePage({ searchParams }: PageProps<"/payments/cheques/new">) {
  const { books: b, buyerLabel } = await loadBooks();
  const sp = await searchParams;
  const open = openInvoices(b, null);
  const inv = open.find((i) => i.id === sp.invoice);
  const buyer = inv?.buyer_id ?? (b.buyerById.has(String(sp.buyer ?? "")) ? String(sp.buyer) : "");
  return (
    <>
      <div className="head">
        <div className="grow">
          <Link href="/payments?tab=cheques" className="link text-xs">← Payments</Link>
          <h1>Record cheque</h1>
          <p>Note each cheque a buyer hands over, post-dated or not, and the invoices it pays.</p>
        </div>
      </div>
      <ChequeForm buyers={buyerOptions(b, buyerLabel)} invoices={open} today={b.today}
        initial={{ id: null, buyer_id: buyer, cheque_no: "", bank: "", cheque_date: b.today, amount: inv ? String(inv.left) : "", received_on: b.today, notes: "",
          split: inv ? { [inv.id]: String(inv.left) } : {} }} />
    </>
  );
}
