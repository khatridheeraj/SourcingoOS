"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Problems } from "@/components/bits";
import { useFeedback } from "@/components/feedback";
import { addDays, fmtDay, money, num } from "@/lib/model";
import { autoSplit, SLACK } from "@/lib/payments";
import { deleteCheque, deleteCreditNote, deleteInvoice, saveCheque, saveCreditNote, saveInvoice, type InvoiceInput } from "./actions";

export type BuyerOpt = { id: string; label: string; creditDays: number | null };

function Field({ label, children, hint, wide }: { label: string; children: React.ReactNode; hint?: React.ReactNode; wide?: boolean }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span>{label}</span>
      {children}
      {hint && <small className="text-xs text-muted">{hint}</small>}
    </label>
  );
}

// ───────── invoice ─────────
export function InvoiceForm({ initial, buyers, orders, today, locked }: {
  initial: InvoiceInput; buyers: BuyerOpt[]; orders: { id: string; buyer_id: string; label: string }[]; today: string; locked?: string;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const set = (k: keyof InvoiceInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const b = buyers.find((x) => x.id === f.buyer_id);
  const autoDue = b?.creditDays != null && f.invoice_date ? addDays(f.invoice_date, b.creditDays) : null;
  const mine = orders.filter((o) => o.buyer_id === f.buyer_id);

  const save = () => {
    const E: string[] = [];
    if (!f.buyer_id) E.push("Choose the buyer.");
    if (!f.invoice_no.trim()) E.push("Enter the invoice number.");
    if (!f.invoice_date) E.push("Set the invoice date.");
    if (f.amount && num(f.amount) < 0) E.push("The amount can't be negative.");
    if (f.due_date && f.invoice_date && f.due_date < f.invoice_date) E.push("The due date can't be before the invoice date.");
    setErr(E);
    if (E.length) return;
    start(async () => {
      const r = await saveInvoice(f);
      if (r.error) return setErr([r.error]);
      toast(r.ok!);
      if (!f.id) router.push(`/payments/invoices/${r.id}`);
      else router.refresh();
    });
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Problems errors={err} />
      <div className="fgrid">
        <Field label="Buyer" hint={locked}>
          <select className="inp" value={f.buyer_id} onChange={(e) => setF((p) => ({ ...p, buyer_id: e.target.value, so_id: "" }))} disabled={!!locked} required>
            <option value="">Choose buyer</option>
            {buyers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Invoice number"><input className="inp code" value={f.invoice_no} onChange={set("invoice_no")} placeholder="SPL/26-27/001" required /></Field>
        <Field label="Invoice date"><input type="date" className="inp" value={f.invoice_date} max={addDays(today, 31)} onChange={set("invoice_date")} required /></Field>
        <Field label="Amount with tax (₹)" hint={f.amount ? money(num(f.amount)) : "Leave empty if you don't have it yet"}>
          <input className="inp num" inputMode="decimal" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value.replace(/[^\d.]/g, "") }))} placeholder="0" />
        </Field>
        <Field label="Due date" hint={f.due_date ? "Its own due date" : autoDue ? `Empty uses ${b!.creditDays} credit days: ${fmtDay(autoDue)}` : "Empty uses the buyer's credit days (not set yet)"}>
          <input type="date" className="inp" value={f.due_date} min={f.invoice_date || undefined} onChange={set("due_date")} />
        </Field>
        <Field label="Sales order (optional)">
          <select className="inp" value={f.so_id} onChange={set("so_id")} disabled={!f.buyer_id}>
            <option value="">None</option>
            {mine.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Notes" wide><textarea className="inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : f.id ? "Save invoice" : "Add invoice"}</button>
      </div>
    </form>
  );
}

export function DeleteButton({ kind, id, label, back }: { kind: "invoice" | "cheque" | "credit"; id: string; label: string; back?: string }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn danger sm" disabled={pending} onClick={async () => {
      if (!(await confirm(`Delete ${label}? This can't be undone.`, "Delete", true))) return;
      start(async () => {
      const r = await (kind === "invoice" ? deleteInvoice(id) : kind === "cheque" ? deleteCheque(id) : deleteCreditNote(id));
      if (r.error) return toast(r.error, "bad");
      toast(r.ok!);
      if (back) router.push(back);
      else router.refresh();
      });
    }}>
      Delete
    </button>
  );
}

export function AddCreditNote({ invoiceId, today, max }: { invoiceId: string; today: string; max: number }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [f, setF] = useState({ credit_note_no: "", note_date: today, amount: "", notes: "" });
  const [err, setErr] = useState<string[]>([]);
  const [pending, start] = useTransition();
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      const E: string[] = [];
      if (!f.credit_note_no.trim()) E.push("Enter the credit note number.");
      if (num(f.amount) <= 0) E.push("Enter the credit note amount.");
      else if (num(f.amount) > max) E.push(`That is more than the ${money(max)} left on this invoice without a cheque.`);
      setErr(E);
      if (E.length) return;
      start(async () => {
        const r = await saveCreditNote({ id: null, invoice_id: invoiceId, ...f });
        if (r.error) return setErr([r.error]);
        toast(r.ok!);
        setF({ credit_note_no: "", note_date: today, amount: "", notes: "" });
        router.refresh();
      });
    }}>
      <Problems errors={err} />
      <div className="fgrid">
        <Field label="Credit note number"><input className="inp code" value={f.credit_note_no} onChange={(e) => setF({ ...f, credit_note_no: e.target.value })} placeholder="SPL/CN/26-27/001" /></Field>
        <Field label="Date"><input type="date" className="inp" value={f.note_date} max={today} onChange={(e) => setF({ ...f, note_date: e.target.value })} /></Field>
        <Field label="Amount (₹)"><input className="inp num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
        <Field label="Reason"><input className="inp" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Short shipment, rate difference…" /></Field>
      </div>
      <div><button className="btn" disabled={pending}>{pending ? "Adding…" : "Add credit note"}</button></div>
    </form>
  );
}

// ───────── cheque ─────────
export type OpenInvoice = { id: string; buyer_id: string; invoice_no: string; invoice_date: string; due: string | null; net: number; left: number };
export type ChequeDraft = {
  id: string | null; buyer_id: string; cheque_no: string; bank: string; cheque_date: string; amount: string; received_on: string; notes: string;
  split: Record<string, string>;
};

export function ChequeForm({ initial, buyers, invoices, today, fixed }: {
  initial: ChequeDraft; buyers: BuyerOpt[]; invoices: OpenInvoice[]; today: string; fixed?: boolean;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const set = (k: keyof ChequeDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const open = useMemo(
    () => invoices.filter((i) => i.buyer_id === f.buyer_id && (i.left > SLACK || f.split[i.id])).sort((a, z) => (a.due ?? a.invoice_date).localeCompare(z.due ?? z.invoice_date)),
    [invoices, f.buyer_id, f.split],
  );
  const split = Object.values(f.split).reduce((a, v) => a + num(v), 0);
  const amount = num(f.amount);
  const rest = Math.round((amount - split) * 100) / 100;

  const save = () => {
    const E: string[] = [];
    if (!f.buyer_id) E.push("Choose the buyer the cheque is from.");
    if (!f.cheque_no.trim()) E.push("Enter the cheque number.");
    if (!f.cheque_date) E.push("Set the date written on the cheque.");
    if (amount <= 0) E.push("Enter the cheque amount.");
    if (rest < 0) E.push(`You've set ${money(split)} against invoices, more than the ${money(amount)} cheque.`);
    for (const i of open) {
      const v = num(f.split[i.id]);
      if (v > i.left + SLACK) E.push(`${i.invoice_no} has only ${money(i.left)} left to cover.`);
    }
    setErr(E);
    if (E.length) return;
    start(async () => {
      const r = await saveCheque({
        id: f.id, buyer_id: f.buyer_id, cheque_no: f.cheque_no, bank: f.bank, cheque_date: f.cheque_date, amount: f.amount,
        received_on: f.received_on, notes: f.notes, allocations: Object.entries(f.split).filter(([, v]) => num(v) > 0).map(([invoice_id, a]) => ({ invoice_id, amount: a })),
      });
      if (r.error) return setErr([r.error]);
      toast(rest > 0 ? `${r.ok}. ${money(rest)} isn't set against an invoice yet.` : r.ok!);
      router.push(`/payments/cheques/${r.id}`);
      router.refresh();
    });
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Problems errors={err} />
      <section className="panel stack">
        <h3>Cheque</h3>
        <div className="fgrid">
          <Field label="From buyer" hint={fixed ? "Fixed once deposited" : undefined}>
            <select className="inp" value={f.buyer_id} disabled={fixed} onChange={(e) => setF((p) => ({ ...p, buyer_id: e.target.value, split: {} }))}>
              <option value="">Choose buyer</option>
              {buyers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Cheque number"><input className="inp code" value={f.cheque_no} disabled={fixed} onChange={set("cheque_no")} inputMode="numeric" /></Field>
          <Field label="Date on the cheque" hint={f.cheque_date > today ? "Post-dated: deposit on or after this date" : undefined}>
            <input type="date" className="inp" value={f.cheque_date} disabled={fixed} onChange={set("cheque_date")} />
          </Field>
          <Field label="Amount (₹)" hint={amount ? money(amount) : undefined}>
            <input className="inp num" inputMode="decimal" value={f.amount} disabled={fixed} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value.replace(/[^\d.]/g, "") }))} />
          </Field>
          <Field label="Bank"><input className="inp" value={f.bank} onChange={set("bank")} placeholder="HDFC Bank, Jaipur" /></Field>
          <Field label="Received on"><input type="date" className="inp" value={f.received_on} max={today} onChange={set("received_on")} /></Field>
          <Field label="Notes" wide><textarea className="inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
        </div>
      </section>
      <section className="panel stack">
        <div className="row">
          <h3 className="flex-1">Pays these invoices</h3>
          {open.length > 0 && amount > 0 && (
            <button type="button" className="btn sm" onClick={() => setF((p) => ({ ...p, split: autoSplit(amount, open.map((i) => ({ id: i.id, left: i.left }))) }))}>
              Fill oldest first
            </button>
          )}
        </div>
        {!f.buyer_id ? (
          <p className="text-muted">Choose the buyer to see their unpaid invoices.</p>
        ) : !open.length ? (
          <p className="text-muted">This buyer has no invoices waiting for a cheque. You can still save the cheque and set it against an invoice later.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th style={{ width: 28 }} /><th>Invoice</th><th>Date</th><th>Due</th><th>Left to cover</th><th>From this cheque (₹)</th></tr></thead>
              <tbody>
                {open.map((i) => {
                  const on = num(f.split[i.id]) > 0;
                  return (
                    <tr key={i.id} className={on ? "sel" : ""}>
                      <td>
                        <input type="checkbox" aria-label={`Pay ${i.invoice_no}`} checked={on} onChange={() => setF((p) => {
                          const s = { ...p.split };
                          if (on) delete s[i.id];
                          else s[i.id] = String(amount > 0 ? Math.max(0, Math.min(i.left, rest)) : i.left);
                          return { ...p, split: s };
                        })} />
                      </td>
                      <td className="code">{i.invoice_no}</td>
                      <td className="num whitespace-nowrap">{fmtDay(i.invoice_date)}</td>
                      <td className={`num whitespace-nowrap ${i.due && i.due < today ? "text-bad" : ""}`}>{fmtDay(i.due)}</td>
                      <td className="num whitespace-nowrap">{money(i.left)}{i.left !== i.net && <><br /><span className="text-xs text-muted">of {money(i.net)}</span></>}</td>
                      <td><input className="inp num" inputMode="decimal" style={{ maxWidth: 130 }} value={f.split[i.id] ?? ""} placeholder="0"
                        onChange={(e) => setF((p) => ({ ...p, split: { ...p.split, [i.id]: e.target.value.replace(/[^\d.]/g, "") } }))} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {amount > 0 && (
          <p className={`text-[12.5px] ${rest < 0 ? "font-semibold text-bad" : "text-muted"}`}>
            {money(split)} of {money(amount)} set against invoices
            {rest > 0 ? ` · ${money(rest)} left over` : rest < 0 ? ` · ${money(-rest)} too much` : " · fully used"}
          </p>
        )}
      </section>
      <div className="row sticky-actions">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : f.id ? "Save cheque" : "Record cheque"}</button>
      </div>
    </form>
  );
}
