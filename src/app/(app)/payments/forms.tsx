"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { day, money } from "@/lib/format";
import { addDays, autoSplit, CHEQUE_LABEL, CHEQUE_TONE, type ChequeStatus, NEXT_STEPS, SLACK } from "@/lib/payments";
import { type InvoiceInput, saveCheque, saveCreditNote, saveInvoice, setChequeStatus, setCreditDays } from "./actions";

export type BuyerOpt = { id: string; label: string; creditDays: number | null };
const num = (s: string | number | null | undefined) => Number(String(s ?? "").replace(/[,₹\s]/g, "")) || 0;
const clean = (s: string) => s.replace(/[^\d.]/g, "");

function Field({ label, children, hint, wide, req }: { label: string; children: React.ReactNode; hint?: React.ReactNode; wide?: boolean; req?: boolean }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span>{label}{req && <i> *</i>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Message({ error, ok }: { error: string; ok: string }) {
  if (error) return <div className="errbox" role="alert">{error}</div>;
  if (ok) return <div className="okbox" role="status">{ok}</div>;
  return null;
}

// ---------------------------------------------------------------- invoice
export function InvoiceForm({ initial, buyers, today, locked }: { initial: InvoiceInput; buyers: BuyerOpt[]; today: string; locked?: string }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof InvoiceInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const b = buyers.find((x) => x.id === f.buyer_id);
  const autoDue = b?.creditDays != null && f.invoice_date ? addDays(f.invoice_date, b.creditDays) : null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setOk("");
    if (!f.buyer_id) return setError("Choose the buyer.");
    if (!f.invoice_no.trim()) return setError("Enter the invoice number.");
    if (!f.amount) return setError("Enter the invoice amount, including tax.");
    if (f.due_date && f.due_date < f.invoice_date) return setError("The due date can't be before the invoice date.");
    setError("");
    start(async () => {
      const r = await saveInvoice(f);
      if (r.error) return setError(r.error);
      if (!f.id) router.push(`/payments/invoices/${r.id}`);
      else { setOk(r.ok!); router.refresh(); }
    });
  }

  return (
    <form className="stack" onSubmit={save}>
      <div className="fgrid">
        <Field label="Buyer" hint={locked} req>
          <select className="inp" value={f.buyer_id} onChange={set("buyer_id")} disabled={!!locked} aria-label="Buyer">
            <option value="">Choose buyer</option>
            {buyers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Invoice number" req><input className="inp code" value={f.invoice_no} onChange={set("invoice_no")} placeholder="SPL/26-27/001" /></Field>
        <Field label="Invoice date" req><input type="date" className="inp" value={f.invoice_date} max={addDays(today, 31)} onChange={set("invoice_date")} required /></Field>
        <Field label="Amount with tax (₹)" hint={f.amount ? money(num(f.amount)) : undefined} req>
          <input className="inp num" inputMode="decimal" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: clean(e.target.value) }))} />
        </Field>
        <Field label="Due date" hint={f.due_date ? "This invoice's own due date" : autoDue ? `Empty uses ${b!.creditDays} credit days: ${day(autoDue)}` : "Empty uses the buyer's credit days (not set yet)"}>
          <input type="date" className="inp" value={f.due_date} min={f.invoice_date || undefined} onChange={set("due_date")} />
        </Field>
        <Field label="Notes" wide><textarea className="inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </div>
      <Message error={error} ok={ok} />
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : f.id ? "Save invoice" : "Add invoice"}</button>
      </div>
    </form>
  );
}

// A wrong invoice is cancelled, never deleted. It stays in the list as Cancelled.
export function CancelInvoice({ invoice }: { invoice: InvoiceInput }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="stack">
      <button type="button" className="btn danger sm self-start" disabled={pending} onClick={() => {
        if (!confirm(`Cancel invoice ${invoice.invoice_no}? It stays on record as cancelled and stops counting in what buyers owe.`)) return;
        start(async () => {
          const r = await saveInvoice({ ...invoice, cancelled: true });
          if (r.error) setError(r.error);
          else router.refresh();
        });
      }}>Cancel this invoice</button>
      {error && <div className="errbox" role="alert">{error}</div>}
    </div>
  );
}

export function AddCreditNote({ invoiceId, today, max }: { invoiceId: string; today: string; max: number }) {
  const router = useRouter();
  const blank = { credit_note_no: "", note_date: today, amount: "", notes: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      if (!f.credit_note_no.trim()) return setError("Enter the credit note number.");
      if (num(f.amount) <= 0) return setError("Enter the credit note amount.");
      if (num(f.amount) > max + SLACK) return setError(`That is more than the ${money(max)} on this invoice that no cheque pays yet.`);
      setError("");
      start(async () => {
        const r = await saveCreditNote({ id: null, invoice_id: invoiceId, ...f });
        if (r.error) return setError(r.error);
        setF(blank);
        router.refresh();
      });
    }}>
      <div className="fgrid">
        <Field label="Credit note number" req><input className="inp code" value={f.credit_note_no} onChange={(e) => setF({ ...f, credit_note_no: e.target.value })} placeholder="SPL/CN/26-27/001" /></Field>
        <Field label="Date" req><input type="date" className="inp" value={f.note_date} max={today} onChange={(e) => setF({ ...f, note_date: e.target.value })} /></Field>
        <Field label="Amount (₹)" req><input className="inp num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: clean(e.target.value) })} /></Field>
        <Field label="Reason"><input className="inp" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Short shipment, rate difference…" /></Field>
      </div>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div><button className="btn" disabled={pending}>{pending ? "Adding…" : "Add credit note"}</button></div>
    </form>
  );
}

export function CancelCreditNote({ note }: { note: { id: string; credit_note_no: string; invoice_id: string; note_date: string; amount: number; notes: string | null } }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn sm" disabled={pending} onClick={() => {
        if (!confirm(`Cancel credit note ${note.credit_note_no}? The invoice goes back to its full amount.`)) return;
        start(async () => {
          const r = await saveCreditNote({ ...note, amount: String(note.amount), notes: note.notes ?? "", cancelled: true });
          if (r.error) setError(r.error);
          else router.refresh();
        });
      }}>Cancel</button>
      {error && <span className="text-[12.5px] text-bad">{error}</span>}
    </>
  );
}

// ---------------------------------------------------------------- cheque
export type OpenInvoice = { id: string; buyer_id: string; invoice_no: string; invoice_date: string; due: string | null; net: number; left: number };
export type ChequeDraft = {
  id: string | null; buyer_id: string; cheque_no: string; bank: string; cheque_date: string; amount: string; received_on: string; notes: string;
  split: Record<string, string>;
};

export function ChequeForm({ initial, buyers, invoices, today, fixed }: { initial: ChequeDraft; buyers: BuyerOpt[]; invoices: OpenInvoice[]; today: string; fixed?: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof ChequeDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const open = useMemo(
    () => invoices.filter((i) => i.buyer_id === f.buyer_id && (i.left > SLACK || f.split[i.id])).sort((a, z) => (a.due ?? a.invoice_date).localeCompare(z.due ?? z.invoice_date)),
    [invoices, f.buyer_id, f.split],
  );
  const split = Object.values(f.split).reduce((a, v) => a + num(v), 0);
  const amount = num(f.amount);
  const rest = Math.round((amount - split) * 100) / 100;

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.buyer_id) return setError("Choose the buyer the cheque is from.");
    if (!f.cheque_no.trim()) return setError("Enter the cheque number.");
    if (!f.cheque_date) return setError("Set the date written on the cheque.");
    if (amount <= 0) return setError("Enter the cheque amount.");
    if (rest < 0) return setError(`You've set ${money(split)} against invoices, more than the ${money(amount)} cheque.`);
    const over = open.find((i) => num(f.split[i.id]) > i.left + SLACK);
    if (over) return setError(`${over.invoice_no} has only ${money(over.left)} left to pay.`);
    setError("");
    start(async () => {
      const r = await saveCheque({
        id: f.id, buyer_id: f.buyer_id, cheque_no: f.cheque_no, bank: f.bank, cheque_date: f.cheque_date, amount: f.amount,
        received_on: f.received_on, notes: f.notes,
        allocations: Object.entries(f.split).filter(([, v]) => num(v) > 0).map(([invoice_id, a]) => ({ invoice_id, amount: a })),
      });
      if (r.error) return setError(r.error);
      router.push(`/payments/cheques/${r.id}?saved=1`);
      router.refresh();
    });
  }

  return (
    <form className="stack" onSubmit={save}>
      <section className="panel stack">
        <h2>Cheque</h2>
        <div className="fgrid">
          <Field label="From buyer" hint={fixed ? "Fixed once deposited" : undefined} req>
            <select className="inp" value={f.buyer_id} disabled={fixed} onChange={(e) => setF((p) => ({ ...p, buyer_id: e.target.value, split: {} }))} aria-label="From buyer">
              <option value="">Choose buyer</option>
              {buyers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Cheque number" req><input className="inp code" value={f.cheque_no} disabled={fixed} onChange={set("cheque_no")} inputMode="numeric" /></Field>
          <Field label="Date on the cheque" hint={f.cheque_date > today ? "Post-dated: deposit on or after this date" : undefined} req>
            <input type="date" className="inp" value={f.cheque_date} disabled={fixed} onChange={set("cheque_date")} />
          </Field>
          <Field label="Amount (₹)" hint={amount ? money(amount) : undefined} req>
            <input className="inp num" inputMode="decimal" value={f.amount} disabled={fixed} onChange={(e) => setF((p) => ({ ...p, amount: clean(e.target.value) }))} />
          </Field>
          <Field label="Bank"><input className="inp" value={f.bank} onChange={set("bank")} placeholder="HDFC Bank, Jaipur" /></Field>
          <Field label="Received on"><input type="date" className="inp" value={f.received_on} max={today} onChange={set("received_on")} /></Field>
          <Field label="Notes" wide><textarea className="inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
        </div>
      </section>
      <section className="panel stack">
        <div className="row">
          <h2 className="flex-1">Pays these invoices</h2>
          {open.length > 0 && amount > 0 && (
            <button type="button" className="btn sm" onClick={() => setF((p) => ({ ...p, split: autoSplit(amount, open.map((i) => ({ id: i.id, left: i.left }))) }))}>
              Fill oldest first
            </button>
          )}
        </div>
        {!f.buyer_id ? (
          <p className="muted">Choose the buyer to see their unpaid invoices.</p>
        ) : !open.length ? (
          <p className="muted">This buyer has no invoices waiting for a cheque. You can still save the cheque and set it against an invoice later.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th className="r">Left to pay</th><th className="r">From this cheque (₹)</th></tr></thead>
              <tbody>
                {open.map((i) => (
                  <tr key={i.id}>
                    <td className="code">{i.invoice_no}</td>
                    <td className="whitespace-nowrap">{day(i.invoice_date)}</td>
                    <td className={`whitespace-nowrap ${i.due && i.due < today ? "text-bad" : ""}`}>{day(i.due)}</td>
                    <td className="r num whitespace-nowrap">{money(i.left)}</td>
                    <td className="r">
                      <input className="inp num ml-auto max-w-[140px]" inputMode="decimal" value={f.split[i.id] ?? ""} placeholder="0" aria-label={`Amount for ${i.invoice_no}`}
                        onChange={(e) => setF((p) => ({ ...p, split: { ...p.split, [i.id]: clean(e.target.value) } }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {amount > 0 && (
          <p className={`text-[12.5px] ${rest < 0 ? "font-semibold text-bad" : "muted"}`}>
            {money(split)} of {money(amount)} set against invoices
            {rest > 0 ? ` · ${money(rest)} not set against an invoice yet` : rest < 0 ? ` · ${money(-rest)} too much` : " · all of it used"}
          </p>
        )}
      </section>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : f.id ? "Save cheque" : "Record cheque"}</button>
      </div>
    </form>
  );
}

export function ChequeChip({ c, today }: { c: { status: ChequeStatus; cheque_date: string; stale: boolean }; today: string }) {
  if (c.stale) return <span className="chip bad">Expired</span>;
  if (c.status === "in_hand" && c.cheque_date <= today) return <span className="chip warn">Deposit now</span>;
  return <span className={`chip ${CHEQUE_TONE[c.status]}`}>{CHEQUE_LABEL[c.status]}</span>;
}

const VERB: Record<ChequeStatus, string> = { deposited: "Mark deposited", cleared: "Mark cleared", bounced: "Mark bounced", cancelled: "Cancel cheque", in_hand: "Undo deposit" };

function useChequeStatus() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pending, start] = useTransition();
  const run = (ids: string[], status: ChequeStatus, on: string, done?: () => void) => {
    let note = "";
    if (status === "bounced") {
      const reason = prompt("Why did it bounce? For example: insufficient funds, signature mismatch");
      if (reason === null) return;
      note = reason.trim() ? `Bounced: ${reason.trim()}` : "";
    } else if (status === "cancelled") {
      if (!confirm(ids.length === 1 ? "Cancel this cheque? It stops paying its invoices and stays on record as cancelled." : `Cancel ${ids.length} cheques? They stop paying their invoices.`)) return;
    }
    setError(""); setOk("");
    start(async () => {
      const r = await setChequeStatus(ids, status, status === "in_hand" ? "" : on, note);
      if (r.error) setError(r.error);
      else { setOk(r.ok!); done?.(); router.refresh(); }
    });
  };
  return { run, pending, error, ok };
}

export type ChequeLine = {
  id: string; cheque_no: string; bank: string | null; buyer: string; cheque_date: string; amount: number; status: ChequeStatus; stale: boolean;
  deposited_on: string | null; cleared_on: string | null; bounced_on: string | null; invoices: { id: string; no: string }[]; unallocated: number;
};

// Tick cheques and mark them deposited, cleared or bounced together, with the date it happened.
export function ChequeTable({ rows, today }: { rows: ChequeLine[]; today: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [on, setOn] = useState(today);
  const { run, pending, error, ok } = useChequeStatus();
  const chosen = rows.filter((r) => sel.has(r.id));
  const steps = (["deposited", "cleared", "bounced", "cancelled", "in_hand"] as ChequeStatus[]).filter(
    (s) => chosen.length > 0 && chosen.every((r) => NEXT_STEPS[r.status].includes(s) && !(r.status === "in_hand" && (s === "deposited" || s === "cleared") && r.cheque_date > on)),
  );
  const toggle = (id: string) => setSel((p) => { const s = new Set(p); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));

  return (
    <div className="stack">
      {chosen.length > 0 && (
        <div className="panel row sticky top-14 z-10">
          <b>{chosen.length} selected · {money(chosen.reduce((a, r) => a + r.amount, 0))}</b>
          <label className="row text-[12.5px] muted">on <input type="date" className="inp w-[150px]" value={on} max={today} onChange={(e) => setOn(e.target.value)} aria-label="Date" /></label>
          {steps.map((s) => (
            <button key={s} type="button" disabled={pending} className={`btn sm ${s === "cleared" || s === "deposited" ? "primary" : s === "bounced" || s === "cancelled" ? "danger" : ""}`}
              onClick={() => run(chosen.map((r) => r.id), s, on, () => setSel(new Set()))}>{VERB[s]}</button>
          ))}
          {!steps.length && <span className="text-xs muted">No step fits all of these. Pick cheques at the same stage, and only post-dated ones whose date has come.</span>}
          <button type="button" className="btn sm" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <Message error={error} ok={ok} />
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-7"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th>Cheque</th><th>Buyer</th><th>Cheque date</th><th className="r">Amount</th><th>Pays invoices</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" aria-label={`Select cheque ${r.cheque_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td>
                  <Link href={`/payments/cheques/${r.id}`} className="link code">{r.cheque_no}</Link>
                  {r.bank && <div className="text-xs muted">{r.bank}</div>}
                </td>
                <td className="code whitespace-nowrap">{r.buyer}</td>
                <td className="whitespace-nowrap">{day(r.cheque_date)}</td>
                <td className="r num whitespace-nowrap">
                  {money(r.amount)}
                  {r.unallocated > SLACK && <div className="text-xs text-warn">{money(r.unallocated)} not set against an invoice</div>}
                </td>
                <td>{r.invoices.length ? r.invoices.map((i, k) => <span key={i.id}>{k > 0 && ", "}<Link className="link code" href={`/payments/invoices/${i.id}`}>{i.no}</Link></span>) : <span className="muted">None</span>}</td>
                <td className="whitespace-nowrap">
                  <ChequeChip c={r} today={today} />
                  <div className="text-xs muted">{r.cleared_on ? `cleared ${day(r.cleared_on)}` : r.bounced_on ? `bounced ${day(r.bounced_on)}` : r.deposited_on ? `deposited ${day(r.deposited_on)}` : ""}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Status buttons on a cheque's own page.
export function ChequeSteps({ id, status, chequeDate, today, isOwner }: { id: string; status: ChequeStatus; chequeDate: string; today: string; isOwner: boolean }) {
  const [on, setOn] = useState(today);
  const { run, pending, error, ok } = useChequeStatus();
  const early = (s: ChequeStatus) => status === "in_hand" && (s === "deposited" || s === "cleared") && on < chequeDate;
  const steps = (isOwner ? (["in_hand", "deposited", "cleared", "bounced", "cancelled"] as ChequeStatus[]).filter((s) => s !== status) : NEXT_STEPS[status]).filter((s) => !early(s));
  const wait = status === "in_hand" && on < chequeDate ? <span className="text-xs muted">Post-dated: it can go to the bank from {day(chequeDate)}.</span> : null;
  return (
    <div className="stack">
      {steps.length ? (
        <div className="row">
          <label className="row text-[12.5px] muted">Date <input type="date" className="inp w-[150px]" value={on} max={today} onChange={(e) => setOn(e.target.value)} aria-label="Date" /></label>
          {steps.map((s) => (
            <button key={s} type="button" disabled={pending} className={`btn ${s === "cleared" || s === "deposited" ? "primary" : s === "bounced" || s === "cancelled" ? "danger" : ""}`} onClick={() => run([id], s, on)}>
              {NEXT_STEPS[status].includes(s) ? VERB[s] : `Correct to ${CHEQUE_LABEL[s].toLowerCase()}`}
            </button>
          ))}
          {wait}
        </div>
      ) : wait ? <p>{wait}</p> : (
        <p className="text-xs muted">This cheque is {CHEQUE_LABEL[status].toLowerCase()}. Only the owner can correct it.</p>
      )}
      <Message error={error} ok={ok} />
    </div>
  );
}

export function CreditDays({ buyerId, value }: { buyerId: string; value: number | null }) {
  const router = useRouter();
  const [v, setV] = useState(value == null ? "" : String(value));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const dirty = v !== (value == null ? "" : String(value));
  return (
    <form className="row gap-1.5" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await setCreditDays(buyerId, v);
        if (r.error) setError(r.error);
        else { setError(""); router.refresh(); }
      });
    }}>
      <input className="inp num w-[70px]" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder="—" aria-label="Credit days" />
      <span className="text-xs muted">days</span>
      {dirty && <button className="btn sm primary" disabled={pending}>Save</button>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </form>
  );
}
