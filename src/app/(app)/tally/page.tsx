import Link from "next/link";
import { day, money, qty } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";
import { compareWithTally, type TallyItem, type TallyLedger, type TallyVoucher } from "@/lib/tally";
import { loadBooks } from "../payments/load";
import { type ImportRow, ImportList, KeyMaker, LedgerLink, PartyLink, SettingsForm } from "./forms";

export const metadata = { title: "Tally · Sourcingo OS" };

const TABS = [{ key: "check", label: "Check" }, { key: "balances", label: "Balances" }, { key: "stock", label: "Stock" }, { key: "setup", label: "Setup" }];

type Settings = {
  enabled: boolean; tally_company: string | null; read_from: string | null; key_hint: string | null; key_created_at: string | null;
  agent_seen_at: string | null; agent_info: { tally?: string; tally_error?: string; version?: string; companies?: string[] }; snapshot_at: string | null;
  snapshot_counts: { from?: string; to?: string; ledgers?: number; vouchers?: number; items?: number };
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 2) return "just now";
  if (m < 90) return `${m} minutes ago`;
  if (m < 36 * 60) return `${Math.round(m / 60)} hours ago`;
  return `${Math.round(m / 1440)} days ago`;
};

// Where the connection stands, in one line, with what to do about it.
function status(s: Settings | null) {
  if (!s?.key_hint) return { tone: "info", text: "Not set up yet. Follow the steps in Setup." };
  if (!s.agent_seen_at) return { tone: "info", text: "Waiting for the office computer. Install the reader there with the sync key." };
  const quiet = Date.now() - Date.parse(s.agent_seen_at) > 30 * 60000;
  if (quiet) return { tone: "warn", text: `The office computer last checked in ${ago(s.agent_seen_at)}. Check it is on and signed in.` };
  if (s.agent_info?.tally !== "online") return { tone: "warn", text: "The office computer is on, but Tally isn't open or isn't answering on port 9000." };
  if (s.agent_info?.tally_error) return { tone: "warn", text: s.agent_info.tally_error };
  if (!s.enabled) return { tone: "info", text: "Connected. Reading is switched off in Setup." };
  return { tone: "ok", text: `Connected. Tally last read ${ago(s.snapshot_at)}.` };
}

export default async function TallyPage({ searchParams }: PageProps<"/tally">) {
  const { me, owner, books: b, buyerLabel } = await loadBooks();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? String(sp.tab) : "check";
  const companyId = me.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const [set, led, vch, items, buyers, factories] = await Promise.all([
    supabase.from("tally_settings").select("enabled, tally_company, read_from, key_hint, key_created_at, agent_seen_at, agent_info, snapshot_at, snapshot_counts").eq("company_id", companyId).maybeSingle(),
    supabase.from("tally_ledgers").select("name, parent, balance, gstin").eq("company_id", companyId).is("gone_at", null).order("name"),
    supabase.from("tally_vouchers").select("guid, vtype, kind, number, vdate, party, amount, reference, bills").eq("company_id", companyId).is("gone_at", null).in("kind", ["sales", "credit_note", "receipt"]).order("vdate"),
    supabase.from("tally_items").select("name, parent, unit, qty, value").eq("company_id", companyId).is("gone_at", null).order("name"),
    supabase.from("buyers").select("id, tally_ledger").eq("company_id", companyId),
    supabase.from("factories").select("id, name, tally_ledger, active").eq("company_id", companyId).order("name"),
  ]);
  const s = set.data as Settings | null;
  const ledgers = (led.data ?? []) as TallyLedger[];
  const vouchers = (vch.data ?? []) as TallyVoucher[];
  const error = set.error ?? led.error ?? vch.error ?? items.error ?? buyers.error ?? factories.error;
  const read = !!s?.snapshot_at;
  const c = compareWithTally({
    books: b, vouchers, ledgers,
    buyers: (buyers.data ?? []).map((x) => ({ id: x.id, ledger: x.tally_ledger })),
    factories: (factories.data ?? []).map((x) => ({ id: x.id, ledger: x.tally_ledger })),
    from: s?.snapshot_counts?.from ?? null, to: s?.snapshot_counts?.to ?? null,
  });
  const st = status(s);
  const buyerOpts = [...b.buyerById.values()].map((x) => ({ id: x.id, label: buyerLabel(x.id) }));
  const factoryName = new Map((factories.data ?? []).map((f) => [f.id, f.name as string]));
  const debtors = ledgers.filter((l) => /debtor/i.test(l.parent ?? "")).map((l) => l.name);
  const creditors = ledgers.filter((l) => /creditor/i.test(l.parent ?? "")).map((l) => l.name);
  const toCheck = c.onlyInTally.length + c.differs.length + c.onlyInApp.length + c.receiptsNoCheque.length + c.chequesNoReceipt.length;

  let body: React.ReactNode;
  if (tab === "setup") {
    body = (
      <>
        {owner ? (
          <section className="panel stack">
            <h2>Settings</h2>
            <SettingsForm hasKey={!!s?.key_hint} initial={{ tally_company: s?.tally_company ?? "", read_from: s?.read_from ?? "", enabled: s?.enabled ?? false }} />
          </section>
        ) : (
          <section className="panel"><p className="text-[13.5px]">Reading is <b>{s?.enabled ? "on" : "off"}</b>{s?.tally_company && <> for <b>{s.tally_company}</b></>}. Only the owner can change this.</p></section>
        )}
        {owner && (
          <section className="panel stack">
            <h2>Sync key</h2>
            <KeyMaker hint={s?.key_hint ?? null} made={s?.key_created_at ?? null} />
          </section>
        )}
        <section className="panel stack">
          <h2>On the office computer, once</h2>
          <ol className="ml-5 list-decimal space-y-1.5 text-[13.5px]">
            <li>Open TallyPrime and the company.</li>
            <li>Press <b>F1 (Help) › Settings › Connectivity › Client/Server configuration</b>. Set <b>TallyPrime acts as</b> to <b>Both</b> and <b>Port</b> to <b>9000</b>, then Ctrl+A.</li>
            <li>Install the Sourcingo Tally reader there and paste the sync key when it asks. Claude can do this step once connected to that computer.</li>
            <li>Keep Tally open during the day. The reader checks every minute and reads Tally every 15 minutes. It never changes anything in Tally.</li>
          </ol>
          {s?.agent_info?.version && <p className="text-xs muted">Reader version {s.agent_info.version} · last check-in {ago(s.agent_seen_at)}{s.agent_info.companies?.length ? ` · open in Tally: ${s.agent_info.companies.join(", ")}` : ""}</p>}
        </section>
      </>
    );
  } else if (tab === "stock") {
    const list = (items.data ?? []) as TallyItem[];
    body = !list.length ? (
      <div className="empty"><b>No stock items in Tally</b>{read ? "Tally has no stock items, or stock isn't kept there." : "Shows once Tally has been read."}</div>
    ) : (
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Stock item</th><th>Group</th><th className="r">Quantity</th><th className="r">Value</th></tr></thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.name}><td>{i.name}</td><td className="muted">{i.parent}</td><td className="r num">{qty(Number(i.qty))} {i.unit}</td><td className="r num">{money(Number(i.value))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (tab === "balances") {
    body = (
      <>
        <section className="panel stack">
          <h2>What buyers owe</h2>
          <p className="text-xs muted">Tally&apos;s balance counts everything in its books, including opening balances and anything before the app. The app counts its unpaid invoices less cleared cheques.</p>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Buyer</th><th>Ledger in Tally</th><th className="r">Tally balance</th><th className="r">App: left to collect</th><th className="r">Difference</th></tr></thead>
              <tbody>
                {c.balances.map((r) => (
                  <tr key={r.buyerId}>
                    <td className="code whitespace-nowrap">{buyerLabel(r.buyerId)}</td>
                    <td><LedgerLink kind="buyer" id={r.buyerId} value={r.ledger} listId="debtors" />{r.ledger && !r.found && read && <div className="text-xs text-bad">Not found in Tally</div>}</td>
                    <td className="r num whitespace-nowrap">{r.tally == null ? "" : money(r.tally)}</td>
                    <td className="r num whitespace-nowrap">{money(r.app)}</td>
                    <td className={`r num whitespace-nowrap ${r.diff != null && Math.abs(r.diff) > 1 ? "font-semibold text-warn" : ""}`}>{r.diff == null ? "" : Math.abs(r.diff) <= 1 ? "Matches" : money(r.diff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="debtors">{debtors.map((o) => <option key={o} value={o} />)}</datalist>
        </section>
        <section className="panel stack">
          <h2>What we owe factories</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Factory</th><th>Ledger in Tally</th><th className="r">We owe (Tally)</th></tr></thead>
              <tbody>
                {c.factories.map((r) => (
                  <tr key={r.factoryId}>
                    <td>{factoryName.get(r.factoryId)}</td>
                    <td><LedgerLink kind="factory" id={r.factoryId} value={r.ledger} listId="creditors" />{r.ledger && !r.found && read && <div className="text-xs text-bad">Not found in Tally</div>}</td>
                    <td className="r num whitespace-nowrap">{r.weOwe == null ? "" : money(r.weOwe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="creditors">{creditors.map((o) => <option key={o} value={o} />)}</datalist>
        </section>
      </>
    );
  } else if (!read) {
    body = <div className="empty"><b>Tally hasn&apos;t been read yet</b>Once the office computer is connected, this page lists every invoice, credit note and receipt that differs between Tally and Payments.</div>;
  } else {
    const noteAgainst = (v: TallyVoucher) => v.bills?.[0]?.name ?? v.reference ?? null;
    const importRows: ImportRow[] = c.onlyInTally.map(({ v, buyerId }) => ({
      guid: v.guid, kind: v.kind, number: v.number, date: v.vdate, party: v.party, amount: Number(v.amount ?? 0),
      buyer: buyerId ? buyerLabel(buyerId) : null, against: v.kind === "credit_note" ? noteAgainst(v) : null,
    }));
    body = (
      <>
        {toCheck === 0 && !c.unlinked.length && <div className="okbox">Payments and Tally agree on every invoice, credit note and cleared cheque from {day(s?.snapshot_counts?.from)} to {day(s?.snapshot_counts?.to)}.</div>}
        {c.unlinked.length > 0 && (
          <section className="panel stack">
            <h2>Tally parties not linked to a buyer ({c.unlinked.length})</h2>
            <p className="text-xs muted">Say which buyer each one is, so their invoices can come into Payments. Ledgers with the same name as a buyer are linked by themselves.</p>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Ledger in Tally</th><th>Buyer</th></tr></thead>
                <tbody>{c.unlinked.map((p) => <tr key={p}><td>{p}</td><td><PartyLink party={p} buyers={buyerOpts} /></td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}
        {importRows.length > 0 && (
          <section className="panel stack">
            <h2>In Tally, not in Payments ({importRows.length})</h2>
            <ImportList key={importRows.map((r) => r.guid + (r.buyer ?? "")).join()} rows={importRows} />
          </section>
        )}
        {c.differs.length > 0 && (
          <section className="panel stack">
            <h2>Different in Tally and Payments ({c.differs.length})</h2>
            <p className="text-xs muted">Correct whichever side is wrong. Tally is never changed from here.</p>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Entry</th><th>Date in Tally</th><th className="r">Tally</th><th className="r">Payments</th><th>What differs</th></tr></thead>
                <tbody>
                  {c.differs.map((d) => (
                    <tr key={d.v.guid}>
                      <td><Link className="link code" href={`/payments/invoices/${d.id}`}>{d.appNo}</Link><div className="text-xs muted">{d.v.kind === "sales" ? "Invoice" : "Credit note"}</div></td>
                      <td className="whitespace-nowrap">{day(d.v.vdate)}</td>
                      <td className="r num whitespace-nowrap">{money(Number(d.v.amount ?? 0))}</td>
                      <td className="r num whitespace-nowrap">{money(d.appAmount)}</td>
                      <td className="text-[13px]">
                        {d.appAmount === 0 && Number(d.v.amount) > 0 ? "Cancelled in Payments, still in Tally" : Math.abs(Number(d.v.amount ?? 0) - d.appAmount) > 1 ? `Amount differs by ${money(Math.abs(Number(d.v.amount ?? 0) - d.appAmount))}` : ""}
                        {d.tallyBuyer && d.tallyBuyer !== d.appBuyer && <div>Tally has it on {buyerLabel(d.tallyBuyer)}, Payments on {buyerLabel(d.appBuyer)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {c.onlyInApp.length > 0 && (
          <section className="panel stack">
            <h2>In Payments, not in Tally ({c.onlyInApp.length})</h2>
            <p className="text-xs muted">Enter these in Tally, or check the number matches Tally&apos;s exactly.</p>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Entry</th><th>Buyer</th><th>Date</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {c.onlyInApp.map((r) => (
                    <tr key={r.kind + r.no}>
                      <td><Link className="link code" href={`/payments/invoices/${r.id}`}>{r.no}</Link><div className="text-xs muted">{r.kind === "invoice" ? "Invoice" : "Credit note"}</div></td>
                      <td className="code whitespace-nowrap">{buyerLabel(r.buyerId)}</td>
                      <td className="whitespace-nowrap">{day(r.date)}</td>
                      <td className="r num whitespace-nowrap">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {(c.chequesNoReceipt.length > 0 || c.receiptsNoCheque.length > 0) && (
          <section className="panel stack">
            <h2>Cheques and receipts</h2>
            <p className="text-xs muted">A cleared cheque should be a receipt in Tally for the same buyer and amount.</p>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Where</th><th>Buyer</th><th>Number</th><th>Date</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {c.chequesNoReceipt.map((ch) => (
                    <tr key={ch.id}>
                      <td><span className="chip warn">Cleared in app, no receipt in Tally</span></td>
                      <td className="code whitespace-nowrap">{buyerLabel(ch.buyer_id)}</td>
                      <td><Link className="link code" href={`/payments/cheques/${ch.id}`}>{ch.cheque_no}</Link></td>
                      <td className="whitespace-nowrap">{day(ch.cleared_on ?? ch.cheque_date)}</td>
                      <td className="r num whitespace-nowrap">{money(Number(ch.amount))}</td>
                    </tr>
                  ))}
                  {c.receiptsNoCheque.map(({ v, buyerId }) => (
                    <tr key={v.guid}>
                      <td><span className="chip info">Receipt in Tally, no cleared cheque in app</span></td>
                      <td className="code whitespace-nowrap">{buyerId ? buyerLabel(buyerId) : v.party}</td>
                      <td className="code">{v.number}</td>
                      <td className="whitespace-nowrap">{day(v.vdate)}</td>
                      <td className="r num whitespace-nowrap">{money(Number(v.amount ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Tally</h1>
          <p>TallyPrime&apos;s books, read from the office computer and set beside Payments. Nothing here changes Tally.</p>
        </div>
      </div>
      <div className={st.tone === "ok" ? "okbox" : st.tone === "warn" ? "warnbox" : "panel text-[13.5px]"}>{st.text}</div>
      {error && <div className="errbox">Couldn&apos;t load everything: {error.message}</div>}
      {read && (
        <div className="tiles">
          <Link className="tile" href="/tally"><span>To check</span><b>{toCheck}</b><small className="muted text-xs">{day(s?.snapshot_counts?.from)} to {day(s?.snapshot_counts?.to)}</small></Link>
          <Link className="tile" href="/tally"><span>Only in Tally</span><b>{c.onlyInTally.length}</b><small className="muted text-xs">invoices and credit notes</small></Link>
          <Link className="tile" href="/tally?tab=balances"><span>Buyers owe (Tally)</span><b>{money(Math.round(c.balances.reduce((a, r) => a + (r.tally ?? 0), 0)))}</b><small className="muted text-xs">linked buyers</small></Link>
          <Link className="tile" href="/tally?tab=balances"><span>We owe factories (Tally)</span><b>{money(Math.round(c.factories.reduce((a, r) => a + (r.weOwe ?? 0), 0)))}</b><small className="muted text-xs">linked factories</small></Link>
        </div>
      )}
      <nav className="filters" aria-label="Tally">
        {TABS.map((x) => (
          <Link key={x.key} className="pill" href={`/tally?tab=${x.key}`} aria-current={tab === x.key ? "page" : undefined}>
            {x.label}{x.key === "check" && read && toCheck + c.unlinked.length ? ` ${toCheck + c.unlinked.length}` : ""}
          </Link>
        ))}
      </nav>
      {body}
      {!owner && <p className="text-xs muted">Buyers are shown by code.</p>}
    </>
  );
}
