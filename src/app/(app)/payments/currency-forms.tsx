"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { CURRENCIES, CURRENCY_NAME, type Currency } from "@/lib/currency";
import { setBuyerCurrency, setCashInHand, setInvoiceRate } from "./actions";

function useSave() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => {
    setError("");
    start(async () => {
      const r = await fn();
      if (r.error) return setError(r.error);
      if (r.ok) toast(`${r.ok}.`);
      after?.();
      router.refresh();
    });
  };
  return { error, pending, run };
}

// The currency a buyer is invoiced in, saved as soon as it is picked.
export function BuyerCurrency({ buyerId, currency }: { buyerId: string; currency: Currency }) {
  const { error, pending, run } = useSave();
  return (
    <label className="field cur-pick">
      <span>Invoiced in</span>
      <select className="inp" value={currency} disabled={pending} onChange={(e) => run(() => setBuyerCurrency(buyerId, e.target.value))}>
        {CURRENCIES.map((c) => <option key={c} value={c}>{c} · {CURRENCY_NAME[c]}</option>)}
      </select>
      {error && <small className="text-bad" role="alert">{error}</small>}
    </label>
  );
}

// An invoice's locked rate: shown, or a small form to lock it (prefilled with today's rate when known).
export function InvoiceRate({ invoiceId, currency, rate, today }: { invoiceId: string; currency: Currency; rate: number | null; today: number | null }) {
  const { error, pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(rate ? String(rate) : today ? String(today) : "");
  if (!open) {
    return (
      <button type="button" className={rate ? "link num" : "btn sm"} onClick={() => setOpen(true)}>
        {rate ? `₹${rate} / ${currency}` : `Lock ${currency} rate`}
      </button>
    );
  }
  return (
    <form className="cur-rate" onSubmit={(e) => { e.preventDefault(); run(() => setInvoiceRate(invoiceId, currency, value), () => setOpen(false)); }}>
      <span className="inp-unit"><i>₹</i><input className="inp num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label={`Rupees for 1 ${currency}`} /><i>/ {currency}</i></span>
      <button className="btn primary sm" disabled={pending}>{pending ? "Saving…" : "Lock"}</button>
      {rate && <button type="button" className="btn ghost sm" disabled={pending} onClick={() => run(() => setInvoiceRate(invoiceId, currency, ""), () => setOpen(false))}>Clear</button>}
      <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      {error && <small className="text-bad" role="alert">{error}</small>}
    </form>
  );
}

// Today's bank balance for the cash view.
export function CashInHand({ amount }: { amount: number | null }) {
  const { error, pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(amount == null ? "" : String(amount));
  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}>{amount == null ? "Add bank balance" : "Update"}</button>;
  return (
    <form className="cur-rate" onSubmit={(e) => { e.preventDefault(); run(() => setCashInHand(value), () => setOpen(false)); }}>
      <span className="inp-unit"><i>₹</i><input className="inp num cash-inp" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Bank balance today" /></span>
      <button className="btn primary sm" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      {error && <small className="text-bad" role="alert">{error}</small>}
    </form>
  );
}
