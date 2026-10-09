import Link from "next/link";
import { day, money } from "@/lib/format";
import { addDays, buyerTotals, INVOICE_LABEL, type InvoiceRow, paymentTodos } from "@/lib/payments";
import { type ChequeLine, ChequeTable, CreditDays } from "./forms";
import { loadBooks } from "./load";

const TABS = [{ key: "today", label: "To do" }, { key: "invoices", label: "Invoices" }, { key: "cheques", label: "Cheques" }, { key: "buyers", label: "Buyers" }];
const INV_FILTERS = [
  { key: "unpaid", label: "Not paid" }, { key: "open", label: "No cheque" }, { key: "overdue", label: "Overdue" },
  { key: "covered", label: "Cheque received" }, { key: "paid", label: "Paid" }, { key: "cancelled", label: "Cancelled" }, { key: "all", label: "All" },
];
const CHQ_FILTERS = [
  { key: "pending", label: "Not cleared" }, { key: "deposit", label: "To deposit" }, { key: "in_hand", label: "In hand" },
  { key: "deposited", label: "Deposited" }, { key: "cleared", label: "Cleared" }, { key: "bounced", label: "Bounced" }, { key: "cancelled", label: "Cancelled" }, { key: "all", label: "All" },
];
const TONE: Record<string, string> = { cancelled: "", paid: "ok", covered: "info", part: "warn", open: "" };

function InvoiceChip({ i }: { i: InvoiceRow }) {
  if (i.overdue && i.state === "covered") return <span className="chip warn">Past due, cheque not cleared</span>;
  if (i.overdue) return <span className="chip bad">Overdue</span>;
  return <span className={`chip ${TONE[i.state]}`}>{INVOICE_LABEL[i.state]}</span>;
}

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const { books: b, buyerLabel, buyerCode, error, owner } = await loadBooks();
  const sp = await searchParams;
  const p = (k: string) => String(sp[k] ?? "").trim();
  const tab = TABS.some((t) => t.key === p("tab")) ? p("tab") : "today";
  const q = p("q").toLowerCase();
  const buyer = p("buyer");
  const t = b.today;

  const unpaid = b.invoices.filter((i) => i.state === "open" || i.state === "part" || i.state === "covered");
  const uncovered = unpaid.filter((i) => i.uncovered > 0);
  const overdue = unpaid.filter((i) => i.overdue);
  const held = b.cheques.filter((c) => c.status === "in_hand" || c.status === "deposited");
  const todos = paymentTodos(b, buyerCode, money, day);
  const rs = (v: number) => money(Math.round(v));
  const link = (extra: Record<string, string>) => `/payments?${new URLSearchParams(Object.entries({ tab, q, buyer, ...extra }).filter(([, v]) => v))}`;

  const filters = (items: { key: string; label: string }[], current: string, placeholder: string) => (
    <div className="row">
      <div className="filters">
        {items.map((f) => <Link key={f.key} className="pill" href={link({ status: f.key })} aria-current={current === f.key ? "page" : undefined}>{f.label}</Link>)}
      </div>
      <form className="ml-auto flex w-full gap-2 sm:w-auto">
        <input type="hidden" name="tab" value={tab} />
        {p("status") && <input type="hidden" name="status" value={p("status")} />}
        <select name="buyer" className="inp sm:w-44" defaultValue={buyer} aria-label="Buyer">
          <option value="">All buyers</option>
          {[...b.buyerById.values()].filter((x) => b.invoices.some((i) => i.buyer_id === x.id) || b.cheques.some((c) => c.buyer_id === x.id)).map((x) => (
            <option key={x.id} value={x.id}>{buyerLabel(x.id)}</option>
          ))}
        </select>
        <input className="inp sm:w-56" name="q" defaultValue={q} placeholder={placeholder} aria-label="Search" />
        <button className="btn">Go</button>
      </form>
    </div>
  );

  let body: React.ReactNode;
  if (tab === "invoices") {
    const status = INV_FILTERS.some((f) => f.key === p("status")) ? p("status") : "unpaid";
    const list = b.invoices
      .filter((i) =>
        status === "all" ? true
        : status === "unpaid" ? unpaid.includes(i)
        : status === "open" ? i.uncovered > 0
        : status === "overdue" ? i.overdue
        : i.state === status)
      .filter((i) => !buyer || i.buyer_id === buyer)
      .filter((i) => !q || [i.invoice_no, i.notes, buyerLabel(i.buyer_id), ...i.cheques.map((c) => c.cheque.cheque_no)].join(" ").toLowerCase().includes(q))
      .sort((a, z) => (["unpaid", "open", "overdue"].includes(status) ? (a.due ?? "9").localeCompare(z.due ?? "9") : z.invoice_date.localeCompare(a.invoice_date)));
    body = (
      <>
        {filters(INV_FILTERS, status, "Invoice or cheque number")}
        {!list.length ? (
          <div className="empty"><b>{b.invoices.length ? "No invoices here" : "No invoices yet"}</b>{b.invoices.length ? "Try another filter." : "Add each invoice you raise on a buyer."}</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Buyer</th><th>Date</th><th>Due</th><th className="r">Amount</th><th>Cheques</th><th className="r">Left to collect</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="click">
                    <td><Link href={`/payments/invoices/${i.id}`} className="link code">{i.invoice_no}</Link></td>
                    <td className="code whitespace-nowrap">{buyerLabel(i.buyer_id)}</td>
                    <td className="whitespace-nowrap">{day(i.invoice_date)}</td>
                    <td className={`whitespace-nowrap ${i.overdue ? "font-semibold text-bad" : ""}`}>{i.due ? day(i.due) : <span className="muted">No credit days</span>}</td>
                    <td className="r num whitespace-nowrap">
                      {money(i.net)}
                      {i.credit > 0 && <div className="text-xs muted">after {money(i.credit)} credit note</div>}
                    </td>
                    <td className="whitespace-nowrap">{i.cheques.length ? i.cheques.map((c) => <div key={c.cheque.id} className="code text-xs">{c.cheque.cheque_no} · {day(c.cheque.cheque_date)}</div>) : <span className="muted">None</span>}</td>
                    <td className="r num whitespace-nowrap">{i.state === "paid" || i.state === "cancelled" ? "" : money(i.outstanding)}</td>
                    <td><InvoiceChip i={i} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  } else if (tab === "cheques") {
    const status = CHQ_FILTERS.some((f) => f.key === p("status")) ? p("status") : "pending";
    const rows: ChequeLine[] = b.cheques
      .filter((c) =>
        status === "all" ? true
        : status === "pending" ? c.status === "in_hand" || c.status === "deposited"
        : status === "deposit" ? c.status === "in_hand" && c.cheque_date <= t
        : c.status === status)
      .filter((c) => !buyer || c.buyer_id === buyer)
      .filter((c) => !q || [c.cheque_no, c.bank, c.notes, buyerLabel(c.buyer_id), ...c.invoices.map((x) => x.invoice.invoice_no)].join(" ").toLowerCase().includes(q))
      .sort((a, z) => (status === "cleared" || status === "all" ? z.cheque_date.localeCompare(a.cheque_date) : a.cheque_date.localeCompare(z.cheque_date)))
      .map((c) => ({
        id: c.id, cheque_no: c.cheque_no, bank: c.bank, buyer: buyerLabel(c.buyer_id), cheque_date: c.cheque_date, amount: Number(c.amount), status: c.status,
        stale: c.stale, deposited_on: c.deposited_on, cleared_on: c.cleared_on, bounced_on: c.bounced_on,
        invoices: c.invoices.map((x) => ({ id: x.invoice.id, no: x.invoice.invoice_no })), unallocated: Math.max(0, Number(c.amount) - c.allocated),
      }));
    body = (
      <>
        {filters(CHQ_FILTERS, status, "Cheque, bank or invoice")}
        {!rows.length ? (
          <div className="empty"><b>{b.cheques.length ? "No cheques here" : "No cheques yet"}</b>{b.cheques.length ? "Try another filter." : "Record each cheque a buyer gives you."}</div>
        ) : (
          <>
            <p className="text-xs muted">Tick cheques to mark several deposited, cleared or bounced at once.</p>
            <ChequeTable rows={rows} today={t} />
          </>
        )}
      </>
    );
  } else if (tab === "buyers") {
    const totals = new Map(buyerTotals(b).map((r) => [r.buyer_id, r]));
    const list = [...b.buyerById.values()].sort((a, z) => (totals.get(z.id)?.outstanding ?? 0) - (totals.get(a.id)?.outstanding ?? 0) || a.code.localeCompare(z.code));
    body = (
      <>
        <p className="text-xs muted">Credit days decide when an invoice falls due, counted from the invoice date. An invoice with its own due date keeps it.</p>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Buyer</th><th>Credit days</th><th className="r">Unpaid invoices</th><th className="r">Left to collect</th><th className="r">No cheque yet</th><th className="r">Overdue</th><th className="r">Cheques held</th></tr></thead>
            <tbody>
              {list.map((x) => {
                const r = totals.get(x.id);
                return (
                  <tr key={x.id}>
                    <td className="code whitespace-nowrap">{buyerLabel(x.id)}</td>
                    <td><CreditDays buyerId={x.id} value={x.credit_days} /></td>
                    <td className="r num">{r?.open ? <Link className="link" href={`/payments?tab=invoices&buyer=${x.id}`}>{r.open}</Link> : ""}</td>
                    <td className="r num whitespace-nowrap">{r?.outstanding ? money(r.outstanding) : ""}</td>
                    <td className="r num whitespace-nowrap">{r?.uncovered ? money(r.uncovered) : ""}</td>
                    <td className={`r num whitespace-nowrap ${r?.overdue ? "font-semibold text-bad" : ""}`}>{r?.overdue ? money(r.overdue) : ""}</td>
                    <td className="r num whitespace-nowrap">{r?.held ? <Link className="link" href={`/payments?tab=cheques&buyer=${x.id}`}>{money(r.held)}</Link> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  } else {
    const next = b.cheques.filter((c) => c.status === "in_hand" && c.cheque_date > t).sort((a, z) => a.cheque_date.localeCompare(z.cheque_date))[0];
    body = (
      <section className="panel stack">
        <h2>To do</h2>
        {todos.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {todos.slice(0, 60).map((a, k) => (
              <li key={k}>
                <Link href={a.href} className="flex items-start gap-3 py-2.5 hover:bg-surface-2">
                  <span className={`chip ${a.sev === "bad" ? "bad" : a.sev === "warn" ? "warn" : "info"} mt-0.5`}>{a.sev === "bad" ? "Urgent" : a.sev === "warn" ? "Today" : "Set up"}</span>
                  <span><b className="font-semibold">{a.title}</b><span className="block text-[13px] muted">{a.detail}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing to do on payments today.</p>
        )}
        {next && <p className="text-xs muted">Next post-dated cheque: {next.cheque_no} ({buyerCode(next.buyer_id)}, {money(next.amount)}) can go to the bank on {day(next.cheque_date)}.</p>}
      </section>
    );
  }

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Payments</h1>
          <p>Invoices raised on buyers and the cheques that pay them. Only Accounts and the owner see this page.</p>
        </div>
        <Link className="btn" href="/payments/invoices/new">Add invoice</Link>
        <Link className="btn primary" href="/payments/cheques/new">Record cheque</Link>
      </div>
      {error && <div className="errbox">Couldn&apos;t load everything: {error.message}</div>}
      <div className="tiles">
        <Link className="tile" href="/payments?tab=invoices"><span>Left to collect</span><b>{rs(unpaid.reduce((a, i) => a + i.outstanding, 0))}</b><small className="muted text-xs">{unpaid.length} unpaid invoices</small></Link>
        <Link className="tile" href="/payments?tab=cheques"><span>Cheques held</span><b>{rs(held.reduce((a, c) => a + Number(c.amount), 0))}</b><small className="muted text-xs">{b.toDeposit.length} to deposit · {b.awaitingClear.length} awaiting clearance</small></Link>
        <Link className="tile" href="/payments?tab=invoices&status=open"><span>No cheque yet</span><b>{rs(uncovered.reduce((a, i) => a + i.uncovered, 0))}</b><small className="muted text-xs">{uncovered.length} invoices</small></Link>
        <Link className="tile" href="/payments?tab=invoices"><span>Due in 30 days</span><b>{rs(unpaid.filter((i) => i.due && i.due >= t && i.due <= addDays(t, 30)).reduce((a, i) => a + i.outstanding, 0))}</b></Link>
        <Link className={`tile ${overdue.length ? "alarm" : ""}`} href="/payments?tab=invoices&status=overdue"><span>Overdue</span><b>{rs(overdue.reduce((a, i) => a + i.outstanding, 0))}</b><small className="muted text-xs">{overdue.length} invoices past due</small></Link>
      </div>
      <nav className="filters" aria-label="Payments">
        {TABS.map((x) => (
          <Link key={x.key} className="pill" href={`/payments?tab=${x.key}`} aria-current={tab === x.key ? "page" : undefined}>
            {x.label}{x.key === "today" && todos.length ? ` ${todos.length}` : ""}
          </Link>
        ))}
      </nav>
      {body}
      {!owner && <p className="text-xs muted">Buyers are shown by code.</p>}
    </>
  );
}
