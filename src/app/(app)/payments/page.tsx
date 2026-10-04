import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertList, BuyerCode, Download, Empty, Head, Pills, Tile } from "@/components/bits";
import { AutoForm, ClickRow, SearchParamInput } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadBooks } from "@/lib/data";
import { addDays, fmtDay, money } from "@/lib/model";
import { buyerTotals, type InvoiceRow, paymentAlerts } from "@/lib/payments";
import { isFinance } from "@/lib/roles";
import { InvoiceChip } from "./chips";
import { ChequeTable, CreditDays, type ChequeLine } from "./parts";

export const metadata = { title: "Payments · Sourcingo OS" };

const TABS = [{ key: "attention", label: "Needs attention" }, { key: "invoices", label: "Invoices" }, { key: "cheques", label: "Cheques" }, { key: "buyers", label: "Buyers" }];
const INV_FILTERS = [
  { key: "unpaid", label: "Not paid" }, { key: "open", label: "No cheque" }, { key: "overdue", label: "Overdue" },
  { key: "covered", label: "Cheque received" }, { key: "paid", label: "Paid" }, { key: "all", label: "All" },
];
const CHQ_FILTERS = [
  { key: "pending", label: "Not cleared" }, { key: "deposit", label: "To deposit" }, { key: "in_hand", label: "In hand" },
  { key: "deposited", label: "Deposited" }, { key: "cleared", label: "Cleared" }, { key: "bounced", label: "Bounced" }, { key: "all", label: "All" },
];

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const sp = await searchParams;
  const p = (k: string) => String(sp[k] ?? "").trim();
  const tab = TABS.some((t) => t.key === p("tab")) ? p("tab") : "attention";
  const { books: b, world: w, error } = await loadBooks();
  const t = b.today;
  const q = p("q").toLowerCase();
  const buyer = p("buyer");
  const name = (id: string) => {
    const x = w.buyerById.get(id);
    return x?.real_name ? `${x.code} ${x.real_name}` : x?.code ?? "";
  };

  const unpaid = b.invoices.filter((i) => i.state !== "paid" && i.state !== "no_amount");
  const outstanding = unpaid.reduce((a, i) => a + i.outstanding, 0);
  const uncoveredInv = unpaid.filter((i) => i.uncovered > 0);
  const overdueInv = unpaid.filter((i) => i.overdue);
  const holding = b.cheques.filter((c) => c.status === "in_hand" || c.status === "deposited");
  const soon = unpaid.filter((i) => i.due && i.due >= t && i.due <= addDays(t, 30));
  const alerts = paymentAlerts(b, (id) => w.buyerCode(id));
  const rs = (n: number) => money(Math.round(n));
  const keep = (extra: Record<string, string>) =>
    `/payments?${new URLSearchParams(Object.entries({ tab, q, buyer, ...extra }).filter(([, v]) => v))}`;

  const buyerFilter = (
    <details className="panel" open={!!buyer}>
      <summary>Filter by buyer</summary>
      <AutoForm className="fgrid mt-3">
        <input type="hidden" name="tab" value={tab} />
        {p("status") && <input type="hidden" name="status" value={p("status")} />}
        {q && <input type="hidden" name="q" value={q} />}
        <label className="field"><span>Buyer</span>
          <select name="buyer" className="inp" defaultValue={buyer}>
            <option value="">All buyers</option>
            {w.buyers.filter((x) => b.invoices.some((i) => i.buyer_id === x.id) || b.cheques.some((c) => c.buyer_id === x.id)).map((x) => (
              <option key={x.id} value={x.id}>{x.real_name ? `${x.code} · ${x.real_name}` : x.code}</option>
            ))}
          </select>
        </label>
        <div className="field"><span>&nbsp;</span><Link className="btn" href={`/payments?tab=${tab}`}>Clear filters</Link></div>
      </AutoForm>
    </details>
  );

  let body: React.ReactNode;
  if (tab === "invoices") {
    const status = INV_FILTERS.some((f) => f.key === p("status")) ? p("status") : "unpaid";
    const match = (i: InvoiceRow) =>
      status === "all" ? true
      : status === "unpaid" ? i.state !== "paid"
      : status === "open" ? i.uncovered > 0 || i.state === "no_amount"
      : status === "overdue" ? i.overdue
      : i.state === status;
    const list = b.invoices
      .filter(match)
      .filter((i) => !buyer || i.buyer_id === buyer)
      .filter((i) => !q || [i.invoice_no, i.so_id, i.dc_id, i.notes, name(i.buyer_id), ...i.cheques.map((c) => c.cheque.cheque_no)].join(" ").toLowerCase().includes(q))
      .sort((a, z) => (status === "unpaid" || status === "open" || status === "overdue" ? (a.due ?? "9").localeCompare(z.due ?? "9") : z.invoice_date.localeCompare(a.invoice_date)));
    body = (
      <>
        {buyerFilter}
        <div className="row">
          <SearchParamInput placeholder="Search invoice, cheque, order, buyer" />
          <Pills current={status} items={INV_FILTERS.map((f) => ({ ...f, href: keep({ status: f.key }), n: f.key === "overdue" ? overdueInv.length : 0 }))} />
        </div>
        {!list.length ? (
          <Empty title={b.invoices.length ? "No invoices match" : "No invoices yet"}>
            {b.invoices.length ? "Try another filter." : "Invoices appear here when a delivery challan is dispatched, or add one yourself."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Buyer</th><th>Date</th><th>Due</th><th>Amount</th><th>Cheques</th><th>Left to collect</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((i) => (
                  <ClickRow key={i.id} href={`/payments/invoices/${i.id}`}>
                    <td>
                      <Link href={`/payments/invoices/${i.id}`} className="code font-semibold text-accent">{i.invoice_no}</Link>
                      {(i.so_id || i.dc_id) && <><br /><span className="text-xs text-muted">{[i.so_id, i.dc_id].filter(Boolean).join(" · ")}</span></>}
                    </td>
                    <td><BuyerCode buyer={w.buyerById.get(i.buyer_id)} /></td>
                    <td className="num whitespace-nowrap">{fmtDay(i.invoice_date)}</td>
                    <td className={`num whitespace-nowrap ${i.overdue ? "font-semibold text-bad" : ""}`}>{i.due ? fmtDay(i.due) : <span className="text-muted">Set credit days</span>}</td>
                    <td className="num whitespace-nowrap">
                      {i.net == null ? <span className="text-warn">Enter amount</span> : money(i.net)}
                      {i.credit > 0 && <><br /><span className="text-xs text-muted">after {money(i.credit)} credit note</span></>}
                    </td>
                    <td className="whitespace-nowrap">{i.cheques.length ? i.cheques.map((c) => <div key={c.cheque.id} className="code text-xs">{c.cheque.cheque_no} · {fmtDay(c.cheque.cheque_date)}</div>) : <span className="text-muted">—</span>}</td>
                    <td className="num whitespace-nowrap">{i.state === "paid" ? "—" : money(i.outstanding)}{i.uncovered > 0 && i.covered > 0 && <><br /><span className="text-xs text-muted">{money(i.uncovered)} without cheque</span></>}</td>
                    <td><InvoiceChip i={i} /></td>
                  </ClickRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  } else if (tab === "cheques") {
    const status = CHQ_FILTERS.some((f) => f.key === p("status")) ? p("status") : "pending";
    const list = b.cheques
      .filter((c) =>
        status === "all" ? true
        : status === "pending" ? c.status === "in_hand" || c.status === "deposited"
        : status === "deposit" ? c.status === "in_hand" && c.cheque_date <= t
        : c.status === status)
      .filter((c) => !buyer || c.buyer_id === buyer)
      .filter((c) => !q || [c.cheque_no, c.bank, c.notes, name(c.buyer_id), ...c.invoices.map((x) => x.invoice.invoice_no)].join(" ").toLowerCase().includes(q))
      .sort((a, z) => (status === "cleared" || status === "all" ? z.cheque_date.localeCompare(a.cheque_date) : a.cheque_date.localeCompare(z.cheque_date)));
    const rows: ChequeLine[] = list.map((c) => ({
      id: c.id, cheque_no: c.cheque_no, bank: c.bank, buyer: w.buyerCode(c.buyer_id), buyerName: w.buyerById.get(c.buyer_id)?.real_name,
      cheque_date: c.cheque_date, amount: c.amount, status: c.status, stale: c.stale, deposited_on: c.deposited_on, cleared_on: c.cleared_on,
      bounced_on: c.bounced_on, invoices: c.invoices.map((x) => ({ id: x.invoice.id, no: x.invoice.invoice_no })), unallocated: Math.max(0, c.amount - c.allocated),
    }));
    body = (
      <>
        {buyerFilter}
        <div className="row">
          <SearchParamInput placeholder="Search cheque, bank, invoice, buyer" />
          <Pills current={status} items={CHQ_FILTERS.map((f) => ({ ...f, href: keep({ status: f.key }), n: f.key === "deposit" ? b.toDeposit.length : 0 }))} />
        </div>
        {!rows.length ? (
          <Empty title={b.cheques.length ? "No cheques match" : "No cheques yet"}>
            {b.cheques.length ? "Try another filter." : "Record each cheque a buyer gives you, and set it against their invoices."}
          </Empty>
        ) : (
          <>
            <p className="text-xs text-muted">Tick cheques to mark several deposited, cleared or bounced at once.</p>
            <ChequeTable rows={rows} today={t} />
          </>
        )}
      </>
    );
  } else if (tab === "buyers") {
    const totals = new Map(buyerTotals(b).map((r) => [r.buyer_id, r]));
    const list = w.buyers
      .filter((x) => totals.has(x.id) || b.invoices.some((i) => i.buyer_id === x.id))
      .sort((a, z) => (totals.get(z.id)?.outstanding ?? 0) - (totals.get(a.id)?.outstanding ?? 0));
    const rest = w.buyers.filter((x) => !list.includes(x));
    body = (
      <>
        <p className="text-xs text-muted">Credit days set when an invoice falls due, counted from the invoice date. An invoice with its own due date keeps it.</p>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Buyer</th><th>Payment terms</th><th>Credit days</th><th>Unpaid invoices</th><th>Left to collect</th><th>No cheque yet</th><th>Overdue</th><th>Cheques held</th></tr></thead>
            <tbody>
              {[...list, ...rest].map((x) => {
                const r = totals.get(x.id);
                return (
                  <tr key={x.id}>
                    <td><BuyerCode buyer={x} />{x.real_name && <><br /><span className="text-xs text-muted">{x.real_name}</span></>}</td>
                    <td className="text-xs">{x.default_payment_terms || "—"}</td>
                    <td><CreditDays buyerId={x.id} value={b.buyerById.get(x.id)?.credit_days ?? null} /></td>
                    <td className="num">{r?.open ? <Link className="link" href={`/payments?tab=invoices&buyer=${x.id}`}>{r.open}</Link> : "—"}</td>
                    <td className="num whitespace-nowrap">{r?.outstanding ? money(r.outstanding) : "—"}</td>
                    <td className="num whitespace-nowrap">{r?.uncovered ? money(r.uncovered) : "—"}</td>
                    <td className={`num whitespace-nowrap ${r?.overdue ? "font-semibold text-bad" : ""}`}>{r?.overdue ? money(r.overdue) : "—"}</td>
                    <td className="num whitespace-nowrap">
                      {r?.inHand ? <Link className="link" href={`/payments?tab=cheques&buyer=${x.id}`}>{money(r.inHand)}</Link> : "—"}
                      {r?.next && <><br /><span className="text-xs text-muted">next {fmtDay(r.next)}</span></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  } else {
    const top = buyerTotals(b).slice(0, 8);
    body = (
      <div className="two">
        <section className="panel">
          <h2>Needs attention</h2>
          <AlertList alerts={alerts} limit={40} more="· see the Invoices and Cheques tabs" />
        </section>
        <div className="stack">
          <section className="panel">
            <h3>Cheques to deposit</h3>
            {b.toDeposit.length ? (
              <div className="list-rows">
                {b.toDeposit.sort((a, z) => a.cheque_date.localeCompare(z.cheque_date)).slice(0, 8).map((c) => (
                  <Link key={c.id} href={`/payments/cheques/${c.id}`} className="row" style={{ justifyContent: "space-between" }}>
                    <span><b className="code">{c.cheque_no}</b> <span className="text-xs text-muted">{w.buyerCode(c.buyer_id)} · dated {fmtDay(c.cheque_date)}</span></span>
                    <b className="num">{money(c.amount)}</b>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-muted">Nothing to take to the bank today.</p>
            )}
            {(() => {
              const next = b.cheques.filter((c) => c.status === "in_hand" && c.cheque_date > t).sort((a, z) => a.cheque_date.localeCompare(z.cheque_date))[0];
              return next ? <p className="mt-2 text-xs text-muted">Next: cheque {next.cheque_no} ({w.buyerCode(next.buyer_id)}, {money(next.amount)}) on {fmtDay(next.cheque_date)}.</p> : null;
            })()}
          </section>
          <section className="panel">
            <h3>By buyer</h3>
            {top.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Buyer</th><th>Left to collect</th><th>No cheque</th></tr></thead>
                  <tbody>
                    {top.map((r) => (
                      <ClickRow key={r.buyer_id} href={`/payments?tab=invoices&buyer=${r.buyer_id}`}>
                        <td><BuyerCode buyer={w.buyerById.get(r.buyer_id)} /></td>
                        <td className={`num whitespace-nowrap ${r.overdue ? "text-bad" : ""}`}>{rs(r.outstanding)}</td>
                        <td className="num whitespace-nowrap">{r.uncovered ? rs(r.uncovered) : "—"}</td>
                      </ClickRow>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted">Nothing outstanding.</p>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head crumbs="Finance › Payments" title="Payments" sub="Buyer invoices, credit notes and cheques. Only Accounts and the owner see this page.">
        <Download href="/reports/export/payments">Export CSV</Download>
        <Link className="btn" href="/payments/invoices/new">+ Add invoice</Link>
        <Link className="btn primary" href="/payments/cheques/new">+ Record cheque</Link>
      </Head>
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      <div className="tiles">
        <Tile tone="blue" money label="Left to collect" value={rs(outstanding)} note={`${unpaid.length} unpaid invoices`} href="/payments?tab=invoices" />
        <Tile tone="green" money label="Cheques held" value={rs(holding.reduce((a, c) => a + c.amount, 0))} note={`${b.toDeposit.length} to deposit now · ${b.awaitingClear.length} awaiting clearance`} href="/payments?tab=cheques" />
        <Tile tone="yellow" money label="No cheque yet" value={rs(uncoveredInv.reduce((a, i) => a + i.uncovered, 0))} note={`${uncoveredInv.length} invoices`} href="/payments?tab=invoices&status=open" />
        <Tile tone="pink" money label="Due in 30 days" value={rs(soon.reduce((a, i) => a + i.outstanding, 0))} note={`${soon.length} invoices`} href="/payments?tab=invoices" />
        <Tile alarm={overdueInv.length > 0} money label="Overdue" value={rs(overdueInv.reduce((a, i) => a + i.outstanding, 0))} note={`${overdueInv.length} invoices past due, not yet cleared`} href="/payments?tab=invoices&status=overdue" />
      </div>
      <Pills current={tab} items={TABS.map((x) => ({ ...x, href: `/payments?tab=${x.key}`, n: x.key === "attention" ? alerts.filter((a) => a.sev === "bad").length : 0 }))} />
      {body}
    </>
  );
}
