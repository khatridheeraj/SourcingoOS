import Link from "next/link";
import { InvoiceForm } from "../../forms";
import { loadBooks } from "../../load";
import { buyerOptions } from "../../options";

export default async function NewInvoicePage({ searchParams }: PageProps<"/payments/invoices/new">) {
  const { books: b, buyerLabel } = await loadBooks();
  const sp = await searchParams;
  const buyer = b.buyerById.has(String(sp.buyer ?? "")) ? String(sp.buyer) : "";
  return (
    <>
      <div className="head">
        <div className="grow">
          <Link href="/payments?tab=invoices" className="link text-xs">← Payments</Link>
          <h1>Add invoice</h1>
          <p>Enter each invoice you raise on a buyer, with the amount including tax.</p>
        </div>
      </div>
      <div className="panel">
        <InvoiceForm buyers={buyerOptions(b, buyerLabel)} today={b.today}
          initial={{ id: null, invoice_no: "", buyer_id: buyer, invoice_date: b.today, amount: "", due_date: "", notes: "" }} />
      </div>
    </>
  );
}
