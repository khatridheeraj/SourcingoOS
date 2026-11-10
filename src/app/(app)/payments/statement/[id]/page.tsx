import Link from "next/link";
import { notFound } from "next/navigation";
import { day, money } from "@/lib/format";
import { buyerStatement } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../../../goods/[id]/packing/print-button";
import { loadBooks } from "../../load";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// A buyer's statement of account, to print or send on WhatsApp before a payment follow-up: each invoice still unpaid,
// what was billed, credited and received, the balance, the due date and how late; cheques we hold; recent payments.
export default async function StatementPage({ params }: PageProps<"/payments/statement/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { me, books, buyerLabel } = await loadBooks();
  if (!books.buyerById.has(id)) notFound();
  const today = books.today;
  const s = buyerStatement(books, id, today);
  const buyer = buyerLabel(id);
  const supabase = await createClient();
  const [{ data: co }, { data: b }] = await Promise.all([
    supabase.from("companies").select("name, legal_name, address, gstin, phone, email").eq("id", me.companyId!).maybeSingle(),
    supabase.from("buyers").select("city, delivery_address").eq("id", id).maybeSingle(),
  ]);
  const from = co?.legal_name || co?.name || "";
  const text = [
    `*Statement of account, ${day(today)}*`,
    `${buyer}`,
    ...s.open.map((i) => `${i.invoice_no} of ${day(i.invoice_date)}: ${money(i.outstanding)}${i.late ? `, ${i.late} days past due` : i.due ? `, due ${day(i.due)}` : ""}`),
    `*Balance ${money(s.total)}*${s.overdue ? `, of which ${money(s.overdue)} is past due` : ""}.`,
    s.heldTotal ? `Cheques with us: ${money(s.heldTotal)}.` : "",
    from ? `${from}` : "",
  ].filter(Boolean).join("\n");

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/payments?tab=buyers">Payments</Link> / {buyer}</nav>
          <h1>Statement for {buyer}</h1>
          <p>{s.open.length ? <>{plural(s.open.length, "invoice")} unpaid, <b className={s.overdue ? "text-bad" : ""}>{money(s.total)}</b>{s.overdue ? ` (${money(s.overdue)} past due)` : ""}.</> : "Nothing to collect: every invoice is paid."} Print it, or send it on WhatsApp before the follow-up call.</p>
        </div>
        <div className="row">
          <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
          <PrintButton />
        </div>
      </div>

      <article className="challan">
        <header className="challan-top">
          <div>
            <b className="challan-co">{from}</b>
            {co?.address && <p className="whitespace-pre-line">{co.address}</p>}
            {co?.gstin && <p>GSTIN {co.gstin}</p>}
          </div>
          <div className="challan-title">
            <h2>Statement of account</h2>
            <dl>
              <div><dt>Date</dt><dd>{day(today)}</dd></div>
              <div><dt>Balance</dt><dd className="num">{money(s.total)}</dd></div>
            </dl>
          </div>
        </header>
        <section className="challan-parties">
          <div>
            <span className="challan-label">To</span>
            <b>{buyer}</b>
            {b?.delivery_address ? <p className="whitespace-pre-line">{b.delivery_address}</p> : b?.city ? <p>{b.city}</p> : null}
          </div>
        </section>

        <div className="table-wrap">
          <table className="tbl challan-tbl">
            <thead><tr><th>Invoice</th><th>Date</th><th className="text-right">Amount</th><th className="text-right">Credit notes</th><th className="text-right">Received</th><th className="text-right">Balance</th><th>Due</th></tr></thead>
            <tbody>
              {s.open.length === 0 && <tr><td colSpan={7}>No invoice is waiting for payment.</td></tr>}
              {s.open.map((i) => (
                <tr key={i.id}>
                  <td className="code nw">{i.invoice_no}</td>
                  <td className="nw">{day(i.invoice_date)}</td>
                  <td className="num text-right">{money(Number(i.amount))}</td>
                  <td className="num text-right">{i.credit ? money(i.credit) : ""}</td>
                  <td className="num text-right">{i.received ? money(i.received) : ""}</td>
                  <td className="num text-right">{money(i.outstanding)}</td>
                  <td className={`nw ${i.late ? "text-bad" : ""}`}>{i.due ? `${day(i.due)}${i.late ? ` · ${i.late} days late` : ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
            {s.open.length > 0 && (
              <tfoot><tr><td colSpan={5}>Balance due{s.overdue ? ` (${money(s.overdue)} past due)` : ""}</td><td className="num text-right">{money(s.total)}</td><td /></tr></tfoot>
            )}
          </table>
        </div>

        {s.held.length > 0 && (
          <>
            <h3 className="challan-h">Cheques with us</h3>
            <div className="table-wrap">
              <table className="tbl challan-tbl">
                <thead><tr><th>Cheque</th><th>Bank</th><th>Dated</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {s.held.map((c) => (
                    <tr key={c.id}>
                      <td className="code">{c.cheque_no}</td><td>{c.bank || "—"}</td><td className="nw">{day(c.cheque_date)}</td>
                      <td>{c.status === "deposited" ? "Deposited, not cleared" : c.cheque_date > today ? "Post-dated" : "To deposit"}</td>
                      <td className="num text-right">{money(Number(c.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {s.paid.length > 0 && (
          <>
            <h3 className="challan-h">Paid in the last 90 days</h3>
            <div className="table-wrap">
              <table className="tbl challan-tbl">
                <thead><tr><th>Invoice</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {s.paid.map((i) => <tr key={i.id}><td className="code">{i.invoice_no}</td><td className="nw">{day(i.invoice_date)}</td><td className="num text-right">{money(i.net)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="challan-note">Received means a cleared cheque or a payment booked against the invoice. Please tell us if anything here doesn&apos;t match your books.{co?.phone ? ` ${co.phone}` : ""}{co?.email ? ` · ${co.email}` : ""}</p>
      </article>
    </>
  );
}
