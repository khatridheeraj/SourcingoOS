"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { fmtDay, money } from "@/lib/model";
import { CHEQUE_LABEL, type ChequeStatus, NEXT_STEPS } from "@/lib/payments";
import { setChequeStatus, setCreditDays } from "./actions";
import { ChequeChip } from "./chips";

export type ChequeLine = {
  id: string; cheque_no: string; bank: string | null; buyer: string; buyerName?: string; cheque_date: string; amount: number;
  status: ChequeStatus; stale: boolean; deposited_on: string | null; cleared_on: string | null; bounced_on: string | null;
  invoices: { id: string; no: string }[]; unallocated: number;
};

const VERB: Partial<Record<ChequeStatus, string>> = { deposited: "Mark deposited", cleared: "Mark cleared", bounced: "Mark bounced", cancelled: "Cancel", in_hand: "Undo deposit" };

// Status changes for one or many cheques, with the date it happened.
export function useChequeStatus() {
  const router = useRouter();
  const { toast, confirm, prompt } = useFeedback();
  const [pending, start] = useTransition();
  const run = async (ids: string[], status: ChequeStatus, on: string, done?: () => void) => {
    // Ask first: a dialog opened inside a transition wouldn't show until it ends.
    let note = "";
    if (status === "bounced") {
      const reason = await prompt("Why did it bounce?", "For example: insufficient funds, signature mismatch", "Mark bounced");
      if (reason === null) return;
      note = reason ? `Bounced: ${reason}` : "";
    } else if (status === "cancelled") {
      const one = ids.length === 1;
      if (!(await confirm(`Cancel ${one ? "this cheque" : `${ids.length} cheques`}? ${one ? "It" : "They"} will stop paying ${one ? "its" : "their"} invoices.`, "Cancel cheque", true))) return;
    }
    start(async () => {
      const r = await setChequeStatus(ids, status, status === "in_hand" ? "" : on, note);
      if (r.error) toast(r.error, "bad");
      else {
        toast(r.ok!);
        done?.();
        router.refresh();
      }
    });
  };
  return { run, pending };
}

export function ChequeTable({ rows, today, showBuyer = true }: { rows: ChequeLine[]; today: string; showBuyer?: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [on, setOn] = useState(today);
  const { run, pending } = useChequeStatus();
  const chosen = rows.filter((r) => sel.has(r.id));
  // Only steps every chosen cheque can take.
  const steps = (["deposited", "cleared", "bounced", "cancelled", "in_hand"] as ChequeStatus[]).filter(
    (s) => chosen.length > 0 && chosen.every((r) => NEXT_STEPS[r.status].includes(s) && !(r.status === "in_hand" && (s === "deposited" || s === "cleared") && r.cheque_date > on)),
  );
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));

  return (
    <>
      {chosen.length > 0 && (
        <div className="panel row" style={{ position: "sticky", top: 64, zIndex: 5 }}>
          <b>{chosen.length} selected · {money(chosen.reduce((a, r) => a + r.amount, 0))}</b>
          <label className="row text-[12.5px] text-muted" style={{ gap: 6 }}>
            on <input type="date" className="inp" value={on} max={today} onChange={(e) => setOn(e.target.value)} style={{ width: 150 }} />
          </label>
          {steps.map((s) => (
            <button key={s} type="button" disabled={pending} className={`btn sm ${s === "cleared" || s === "deposited" ? "primary" : s === "bounced" || s === "cancelled" ? "danger" : ""}`}
              onClick={() => run(chosen.map((r) => r.id), s, on, () => setSel(new Set()))}>
              {VERB[s]}
            </button>
          ))}
          {!steps.length && <span className="text-xs text-muted">Nothing fits all of these. Choose cheques at the same step, and only post-dated ones whose date has come.</span>}
          <button type="button" className="btn sm" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th>Cheque</th>{showBuyer && <th>Buyer</th>}<th>Cheque date</th><th>Amount</th><th>Against invoices</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const next = NEXT_STEPS[r.status].filter((s) => s === "deposited" || s === "cleared")[0];
              return (
                <tr key={r.id} className={sel.has(r.id) ? "sel" : ""}>
                  <td><input type="checkbox" aria-label={`Select cheque ${r.cheque_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td>
                    <Link href={`/payments/cheques/${r.id}`} className="code font-semibold text-accent">{r.cheque_no}</Link>
                    {r.bank && <><br /><span className="text-xs text-muted">{r.bank}</span></>}
                  </td>
                  {showBuyer && <td><span className="code tip" title={r.buyerName}>{r.buyer}</span></td>}
                  <td className="num whitespace-nowrap">{fmtDay(r.cheque_date)}</td>
                  <td className="num whitespace-nowrap">
                    {money(r.amount)}
                    {r.unallocated > 0 && <><br /><span className="text-xs text-warn">{money(r.unallocated)} not set against an invoice</span></>}
                  </td>
                  <td>{r.invoices.length ? r.invoices.map((i, n) => <span key={i.id}>{n > 0 && ", "}<Link className="link" href={`/payments/invoices/${i.id}`}>{i.no}</Link></span>) : <span className="text-muted">—</span>}</td>
                  <td>
                    <ChequeChip c={r} today={today} />
                    <br /><span className="text-xs text-muted">{r.cleared_on ? `cleared ${fmtDay(r.cleared_on)}` : r.bounced_on ? `bounced ${fmtDay(r.bounced_on)}` : r.deposited_on ? `deposited ${fmtDay(r.deposited_on)}` : ""}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {next && (r.status !== "in_hand" || r.cheque_date <= today) && (
                      <button type="button" disabled={pending} className="btn sm" onClick={() => run([r.id], next, today)}>
                        {next === "deposited" ? "Deposited" : "Cleared"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Status buttons on a cheque's own page.
export function ChequeSteps({ id, status, chequeDate, today, isOwner }: { id: string; status: ChequeStatus; chequeDate: string; today: string; isOwner: boolean }) {
  const [on, setOn] = useState(today);
  const { run, pending } = useChequeStatus();
  const early = (s: ChequeStatus) => status === "in_hand" && (s === "deposited" || s === "cleared") && on < chequeDate;
  const steps = (isOwner
    ? (["in_hand", "deposited", "cleared", "bounced", "cancelled"] as ChequeStatus[]).filter((s) => s !== status)
    : NEXT_STEPS[status]).filter((s) => !early(s));
  const wait = status === "in_hand" && on < chequeDate && <span className="text-xs text-muted">Post-dated: it can go to the bank from {fmtDay(chequeDate)}.</span>;
  if (!steps.length && wait) return <p>{wait}</p>;
  if (!steps.length) return <p className="text-xs text-muted">This cheque is {CHEQUE_LABEL[status].toLowerCase()}. Only the owner can correct it.</p>;
  return (
    <div className="row">
      <label className="row text-[12.5px] text-muted" style={{ gap: 6 }}>
        Date <input type="date" className="inp" value={on} max={today} onChange={(e) => setOn(e.target.value)} style={{ width: 150 }} />
      </label>
      {steps.map((s) => (
        <button key={s} type="button" disabled={pending} className={`btn ${s === "cleared" || s === "deposited" ? "primary" : s === "bounced" || s === "cancelled" ? "danger" : ""}`} onClick={() => run([id], s, on)}>
          {!NEXT_STEPS[status].includes(s) ? `Correct to ${CHEQUE_LABEL[s].toLowerCase()}` : VERB[s]}
        </button>
      ))}
      {wait}
    </div>
  );
}

export function CreditDays({ buyerId, value }: { buyerId: string; value: number | null }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [v, setV] = useState(value == null ? "" : String(value));
  const [pending, start] = useTransition();
  const dirty = v !== (value == null ? "" : String(value));
  return (
    <form className="row" style={{ gap: 6 }} onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await setCreditDays(buyerId, v);
        if (r.error) toast(r.error, "bad");
        else { toast(r.ok!); router.refresh(); }
      });
    }}>
      <input className="inp num" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} placeholder="—" aria-label="Credit days" style={{ width: 70 }} />
      <span className="text-xs text-muted">days</span>
      {dirty && <button className="btn sm primary" disabled={pending}>Save</button>}
    </form>
  );
}
