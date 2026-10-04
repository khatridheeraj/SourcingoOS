import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadBooks } from "@/lib/data";
import { isFinance } from "@/lib/roles";
import { InvoiceForm } from "../../forms";
import { buyerOptions, orderOptions } from "../../options";

export const metadata = { title: "Add invoice · Sourcingo OS" };

export default async function NewInvoice({ searchParams }: PageProps<"/payments/invoices/new">) {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const sp = await searchParams;
  const { books: b, world: w } = await loadBooks();
  return (
    <>
      <Head crumbs={<>Finance › <Link className="link" href="/payments">Payments</Link> › New invoice</>} title="Add invoice"
        sub="Invoices raised with a delivery challan appear here on their own. Add any other invoice you need to collect." />
      <section className="panel">
        <InvoiceForm
          buyers={buyerOptions(w, b)} orders={orderOptions(w)} today={b.today}
          initial={{ id: null, invoice_no: "", buyer_id: String(sp.buyer ?? ""), invoice_date: b.today, amount: "", due_date: "", so_id: "", notes: "" }}
        />
      </section>
    </>
  );
}
