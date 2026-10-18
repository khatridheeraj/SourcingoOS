"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, money } from "@/lib/format";
import { settleCheques } from "./actions";

export type SettleRow = {
  id: string; cheque_no: string; buyer: string; amount: number; cheque_date: string;
  kind: "cleared" | "paid_other"; on: string; why: string; invoices: { id: string; no: string }[];
};

// Cheques Tally already shows settled, ticked by default, marked in one tap. Tally itself is never changed.
export function TallySettle({ rows }: { rows: SettleRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pending, start] = useTransition();
  const chosen = rows.filter((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((p) => { const s = new Set(p); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const cleared = chosen.filter((r) => r.kind === "cleared").length;

  function go() {
    setError(""); setOk("");
    start(async () => {
      const r = await settleCheques(chosen.map((x) => ({
        id: x.id, status: x.kind, on: x.on,
        note: x.kind === "cleared" ? `Cleared: ${x.why} (from Tally)` : `Paid another way: ${x.why} (from Tally). Give the cheque back to the buyer.`,
      })));
      if (r.error) setError(r.error);
      else { setOk(r.ok!); setSel(new Set()); router.refresh(); }
    });
  }

  return (
    <section id="tally-settle" className="panel stack scroll-mt-20">
      <div className="row">
        <div className="grow">
          <h2>Tally shows these cheques settled ({rows.length})</h2>
          <p className="text-xs muted">
            Cleared: a receipt in Tally names the cheque and its amount. Paid another way: Tally shows the invoice fully paid by NEFT, RTGS or another
            payment, so this cheque was never needed. Give those back to the buyer.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-7"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th>Cheque</th><th>Buyer</th><th className="r">Amount</th><th>Invoices</th><th>Tally shows</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" aria-label={`Select cheque ${r.cheque_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td><Link className="link code" href={`/payments/cheques/${r.id}`}>{r.cheque_no}</Link><div className="text-xs muted">dated {day(r.cheque_date)}</div></td>
                <td className="whitespace-nowrap">{r.buyer}</td>
                <td className="r num whitespace-nowrap">{money(r.amount)}</td>
                <td>{r.invoices.map((i, k) => <span key={i.id}>{k > 0 && ", "}<Link className="link code" href={`/payments/invoices/${i.id}`}>{i.no}</Link></span>)}</td>
                <td>
                  <span className={`chip ${r.kind === "cleared" ? "ok" : "info"}`}>{r.kind === "cleared" ? `Cleared ${day(r.on)}` : `Paid another way ${day(r.on)}`}</span>
                  <div className="text-xs muted">{r.why}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <div className="errbox" role="alert">{error}</div>}
      {ok && <div className="okbox" role="status">{ok}</div>}
      <div className="row">
        <button type="button" className="btn primary" disabled={pending || !chosen.length} onClick={go}>
          {pending ? "Marking…" : `Mark ${chosen.length} as Tally shows`}
        </button>
        {chosen.length > 0 && (
          <span className="text-xs muted">
            {money(chosen.reduce((a, r) => a + r.amount, 0))}
            {cleared ? ` · ${cleared} cleared` : ""}{chosen.length - cleared ? ` · ${chosen.length - cleared} paid another way` : ""}
          </span>
        )}
      </div>
    </section>
  );
}
