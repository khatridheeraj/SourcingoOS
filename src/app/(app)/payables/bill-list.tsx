"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { day, dayNear, money } from "@/lib/format";
import { type Due, GROUPS, isMsme45, MSME_DAYS, MSME_LABEL, type Payable } from "@/lib/payables";
import { saveBillNote } from "./actions";
import { ClaimForm } from "./claim-form";

// claimed: open claims (debit notes not yet in Tally) that come off what to pay.
export type BillRow = Payable & { key: string; name: string; due: Due; claimed: number; claims: { claim_no: string; amount: number }[] };
const toPay = (r: BillRow) => Math.max(0, r.open - r.claimed);

const dm = (d: string) => dayNear(d);

// Holding or releasing a bill moves it to another group, which rebuilds its row closed, and keyboard focus fell to the
// top of the page. The bill's key waits here until its new row mounts, which opens itself and focuses the button again.
let reopen: string | null = null;

// The text of a payment list, one supplier a line, ready for WhatsApp or the bank.
function listText(rows: BillRow[], today: string) {
  const by = new Map<string, BillRow[]>();
  for (const r of rows) by.set(r.name, [...(by.get(r.name) ?? []), r]);
  const total = rows.reduce((a, r) => a + toPay(r), 0);
  const lines = [...by].map(([name, bs], i) =>
    `${i + 1}. ${name}: ${money(Math.round(bs.reduce((a, r) => a + toPay(r), 0)))} (${bs.map((b) => `${b.bill} ${money(Math.round(toPay(b)))}${b.claimed ? ` after claim ${b.claims.map((c) => c.claim_no).join(", ")}` : ""}${b.due_on ? `, due ${dm(b.due_on)}` : ""}`).join("; ")})`);
  return [`*Payments to make, ${dm(today)}*`, ...lines, `*Total ${money(Math.round(total))}* on ${rows.length} ${rows.length === 1 ? "bill" : "bills"}`].join("\n");
}

// Bills grouped by when they fall due. Tick bills to make a payment list to share; open one to hold it or add a note.
export function BillList({ rows, today }: { rows: BillRow[]; today: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const chosen = rows.filter((r) => picked.has(r.key));
  const sum = chosen.reduce((a, r) => a + toPay(r), 0);
  const toggle = (keys: string[], on: boolean) => setPicked((s) => {
    const n = new Set(s);
    for (const k of keys) if (on) n.add(k); else n.delete(k);
    return n;
  });
  const text = listText(chosen, today);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it in your chat.");
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.", "bad");
    }
  }

  return (
    <>
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.due.key === g.key);
        if (!list.length) return null;
        const pickable = list.filter((r) => r.bill);
        const all = pickable.length > 0 && pickable.every((r) => picked.has(r.key));
        const total = list.reduce((a, r) => a + r.open, 0);
        return (
          <section key={g.key} className="card" aria-labelledby={`g-${g.key}`}>
            <header className="card-h">
              <div className="min-w-0">
                <h2 id={`g-${g.key}`}>{g.title} <span className={`chip ${g.key === "overdue" ? "bad" : g.key === "week" ? "warn" : g.key === "hold" ? "info" : ""}`}>{list.length}</span></h2>
                <p>{g.hint}</p>
              </div>
              <div className="bills-sum">
                <b className="num">{money(Math.round(total))}</b>
                {pickable.length > 0 && (
                  <button type="button" className="btn sm" onClick={() => toggle(pickable.map((r) => r.key), !all)}>{all ? "Untick all" : "Tick all"}</button>
                )}
              </div>
            </header>
            <ul className="bills">
              {list.map((r) => <Bill key={r.key} r={r} today={today} picked={picked.has(r.key)} onPick={(on) => toggle([r.key], on)} />)}
            </ul>
          </section>
        );
      })}
      {chosen.length > 0 && (
        <div className="sticky-actions bills-bar" role="region" aria-label="Payment list">
          <div className="grow">
            <b>{chosen.length} {chosen.length === 1 ? "bill" : "bills"} · <span className="num">{money(Math.round(sum))}</span></b>
            <div className="text-xs muted">{new Set(chosen.map((r) => r.ledger)).size} {new Set(chosen.map((r) => r.ledger)).size === 1 ? "supplier" : "suppliers"}. Share the list with whoever makes the payments.</div>
          </div>
          <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
          <button type="button" className="btn" onClick={copy}>Copy</button>
          <button type="button" className="btn ghost" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
    </>
  );
}

function Bill({ r, today, picked, onPick }: { r: BillRow; today: string; picked: boolean; onPick: (on: boolean) => void }) {
  const msme = isMsme45(r.msme);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const d = box.current;
    if (reopen !== r.key || !d) return;
    reopen = null;
    d.open = true;
    d.querySelector<HTMLElement>(".bill-hold button")?.focus({ preventScroll: true });
    d.scrollIntoView({ block: "nearest" });
  }, [r.key, r.hold]);
  return (
    <li className={picked ? "on" : undefined}>
      {r.bill ? (
        <label className="bill-tick" aria-label={`Add ${r.bill} to the payment list`}>
          <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} />
        </label>
      ) : <span className="bill-tick" aria-hidden />}
      <details className="bill" ref={box}>
        <summary>
          <span className="bill-main">
            <span className="bill-who">{r.name}</span>
            <span className="bill-sub dots">
              <span>
                <span>{r.bill ? <span className="code">{r.bill}</span> : "No bill in the app"}</span>
                {r.bill_date && <span>billed {dm(r.bill_date)}</span>}
                {r.due_on && <span>due {dm(r.due_on)}{r.due_on.slice(0, 4) !== r.bill_date?.slice(0, 4) ? ` ${r.due_on.slice(0, 4)}` : ""}</span>}
                {r.amount != null && r.amount !== r.open && <span>{money(Math.round(r.open))} left of {money(Math.round(r.amount))}</span>}
              </span>
            </span>
            {(msme || r.order_no || r.note || r.claimed > 0) && (
              <span className="bill-tags">
                {msme && <span className="chip warn">{MSME_LABEL[r.msme!]} · {MSME_DAYS} days</span>}
                {r.order_no && <span className="chip code">{r.order_no}</span>}
                {r.claimed > 0 && <span className="chip warn">Claim {money(Math.round(r.claimed))} · pay {money(Math.round(toPay(r)))}</span>}
                {r.note && <span className="bill-note">{r.note}</span>}
              </span>
            )}
          </span>
          <span className="bill-amt">
            <b className="num">{money(Math.round(r.open))}</b>
            {r.due.tone ? <span className={`chip ${r.due.tone}`}>{r.due.text}</span> : <span className="text-xs muted">{r.due.text}</span>}
          </span>
        </summary>
        <BillMore r={r} today={today} />
      </details>
    </li>
  );
}

function BillMore({ r, today }: { r: BillRow; today: string }) {
  const router = useRouter();
  const [note, setNote] = useState(r.note ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const save = (hold: boolean) => {
    // Holding needs a reason: say so at the note box and put the keyboard there, before anything is sent.
    if (hold && !note.trim()) {
      setError("Say why the bill is on hold in the note, so Accounts knows when to release it.");
      input.current?.focus();
      return;
    }
    send(hold);
  };
  const send = (hold: boolean) => start(async () => {
    const res = await saveBillNote(r.ledger, r.bill!, hold, note);
    if (res.error) { setError(res.error); return; }
    setError("");
    toast(res.ok!);
    if (hold !== r.hold) reopen = r.key;
    // "Save note" goes away once the note is saved: keep the keyboard on the note, not the top of the page.
    else if (document.activeElement?.closest(".bill-hold button")) input.current?.focus();
    router.refresh();
  });
  const facts: string[] = [];
  if (!r.bill) {
    facts.push("Tally shows this much more owed than the bills it was read for. It is from bills before April, an opening balance, or a journal. Check the ledger in Tally.");
  } else {
    if (r.settled > 0) facts.push(`${money(Math.round(r.settled))} paid or adjusted against this bill in Tally${r.last_paid ? `, last payment ${day(r.last_paid)}` : ""}.`);
    if (r.on_account > 0) facts.push(`${money(Math.round(r.on_account))} covered by payments made on account (no bill named in Tally), set against the oldest bills first.`);
    if (isMsme45(r.msme) && r.agreed_due && r.agreed_due !== r.due_on) {
      facts.push(`Agreed ${r.days} days would be ${day(r.agreed_due)}, but a ${r.msme} enterprise must be paid within ${MSME_DAYS} days, so it is due ${day(r.due_on)}.`);
    } else {
      facts.push(`${r.days} days from the bill date${r.days === 60 ? " (the usual terms)" : ""}.`);
    }
    for (const c of r.claims) facts.push(`Claim ${c.claim_no} for ${money(Math.round(c.amount))} isn't in Tally yet, so it comes off what to pay. Book the debit note in Tally against ${r.bill}.`);
    if (isMsme45(r.msme) && r.due.key === "overdue") facts.push("Past the MSME limit: interest at three times the bank rate runs, and the amount can't be claimed as an expense until the year it is paid (income tax 43B(h)).");
  }
  return (
    <div className="bill-more">
      <ul>{facts.map((f) => <li key={f}>{f}</li>)}</ul>
      {r.order_id && <Link className="link text-[13px]" href={`/orders/${r.order_id}#dispatch`}>Open {r.order_no}&apos;s dispatch</Link>}
      {r.bill && (
        <form className="bill-hold" onSubmit={(e) => { e.preventDefault(); save(r.hold); }}>
          <input ref={input} className="inp" value={note} maxLength={300} aria-invalid={error ? true : undefined} onChange={(e) => { setNote(e.target.value); if (error) setError(""); }} placeholder="Note, e.g. short by 120 pcs, debit note to come" aria-label="Note on this bill" />
          <div className="row">
            {r.hold
              ? <button type="button" className="btn sm primary" disabled={pending} onClick={() => save(false)}>Release for payment</button>
              : <button type="button" className="btn sm" disabled={pending} onClick={() => save(true)}>Hold this bill</button>}
            {note !== (r.note ?? "") && <button className="btn sm" disabled={pending}>Save note</button>}
          </div>
          {error && <p className="text-xs text-bad">{error}</p>}
        </form>
      )}
      {r.bill && <ClaimForm ledger={r.ledger} bill={r.bill} orderId={r.order_id} today={today} open={toPay(r)} />}
    </div>
  );
}
