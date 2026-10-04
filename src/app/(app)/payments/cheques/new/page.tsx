import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadBooks } from "@/lib/data";
import { isFinance } from "@/lib/roles";
import { ChequeForm } from "../../forms";
import { buyerOptions, openInvoices } from "../../options";

export const metadata = { title: "Record cheque · Sourcingo OS" };

export default async function NewCheque({ searchParams }: PageProps<"/payments/cheques/new">) {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const sp = await searchParams;
  const { books: b, world: w } = await loadBooks();
  const open = openInvoices(b, null);
  const inv = open.find((i) => i.id === sp.invoice);
  const buyer = inv?.buyer_id ?? (w.buyerById.has(String(sp.buyer ?? "")) ? String(sp.buyer) : "");
  return (
    <>
      <Head crumbs={<>Finance › <Link className="link" href="/payments?tab=cheques">Payments</Link> › New cheque</>} title="Record cheque"
        sub="Note each cheque the buyer hands over, post-dated or not, and the invoices it pays." />
      <ChequeForm
        buyers={buyerOptions(w, b)} invoices={open} today={b.today}
        initial={{ id: null, buyer_id: buyer, cheque_no: "", bank: "", cheque_date: b.today, amount: inv ? String(inv.left) : "", received_on: b.today, notes: "",
          split: inv ? { [inv.id]: String(inv.left) } : {} }}
      />
    </>
  );
}
