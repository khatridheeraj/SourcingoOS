"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { ErrorFix } from "@/components/fix-link";
import { releaseFactoryPo, sendBackPoLock } from "../orders/actions";

// One thing waiting on the owner personally: a factory PO sent for approval, or an email from an unknown sender.
export type Approval = {
  key: string;
  kind: "po" | "email";
  href: string;
  code?: string;
  title: string;
  what: string;
  who: string;
  waited: string;
  // Over a day: shown in amber, as it holds someone up.
  old: boolean;
  orderId?: string;
  factoryId?: string;
  factoryName?: string;
  // Why it can't be approved from here (the plan, the buyer's PO, photos); the PO page shows how to sort it.
  blocker?: string | null;
  testTo?: string | null;
};

// Moves focus into a confirm panel when it opens (a stable ref, so it doesn't steal focus on every render).
const focusOnce = (el: HTMLElement | null) => el?.focus();

// Everything waiting on the owner, in one list at the top of Home, with approve and send back on each line
// (Dheeraj, 30 Oct 2026: "pending approvals from my end placed separately").
export function Approvals({ items }: { items: Approval[] }) {
  return (
    <section className="card approvals" aria-labelledby="appr-h">
      <header className="card-h">
        <div className="min-w-0">
          <h2 id="appr-h">Your approvals {items.length > 0 && <span className="appr-count num">{items.length}</span>}</h2>
          <p>{items.length ? "Waiting on you, oldest first. Nobody else can do these." : "Nothing is waiting on your approval."}</p>
        </div>
      </header>
      {items.length > 0 && (
        <ul className="tasks">
          {items.map((a) => <Row key={a.key} a={a} />)}
        </ul>
      )}
    </section>
  );
}

function Row({ a }: { a: Approval }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "approve" | "back">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>, done: string) => start(async () => {
    setError("");
    const r = await fn();
    if (r.error) return setError(r.error);
    setMode("");
    toast(done);
    router.refresh();
  });

  return (
    <li className="task appr">
      <span className={`sev ${a.old ? "warn" : ""}`} aria-hidden />
      <div className="task-text">
        <Link href={a.href} className="task-title">{a.code && <span className="code">{a.code}</span>}{a.title}</Link>
        <b className="appr-what">{a.what}</b>
        <span><em className={`why ${a.old ? "warn" : ""}`}>Waiting {a.waited}</em> · {a.who}</span>
        {a.blocker && <span className="appr-block">{a.blocker}</span>}
      </div>
      <div className="task-acts">
        {a.kind === "email" || a.blocker ? (
          <Link href={a.href} className="btn sm">{a.kind === "email" ? "Accept or ignore" : "Check"}</Link>
        ) : mode === "" && (
          <>
            <button type="button" className="btn sm" onClick={() => setMode("back")}>Send back</button>
            <button type="button" className="btn sm accent" onClick={() => setMode("approve")}>Approve</button>
          </>
        )}
      </div>
      {mode === "approve" && a.orderId && a.factoryId && (
        <div className="appr-confirm">
          {/* Focus lands on the question, not the button, so a second Enter can't approve by accident. */}
          <p tabIndex={-1} ref={focusOnce} style={{ outline: "none" }}>Approving locks the plan and emails the PO to {a.testTo ? `the test inbox ${a.testTo}` : a.factoryName} within the hour.</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={pending}
              onClick={() => act(() => releaseFactoryPo(a.orderId!, a.factoryId!), `Approved. The PO goes to ${a.testTo ? "the test inbox" : a.factoryName} within the hour`)}>
              {pending ? "Approving…" : "Approve and send PO"}
            </button>
            <Link href={a.href} className="btn">See the PO</Link>
            <button type="button" className="btn" disabled={pending} onClick={() => setMode("")}>Cancel</button>
          </div>
        </div>
      )}
      {mode === "back" && a.orderId && a.factoryId && (
        <form className="appr-confirm" onSubmit={(e) => {
          e.preventDefault();
          if (!pending && note.trim()) act(() => sendBackPoLock(a.orderId!, a.factoryId!, note), "Sent back to the team");
        }}>
          {/* Enter sends it back, Escape closes it, so it works from the keyboard alone. */}
          <input className="inp" value={note} maxLength={300} autoFocus aria-label="What to change" onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && !pending) setMode(""); }} placeholder="What should change?" />
          <div className="row">
            <button type="submit" className="btn danger" disabled={pending || !note.trim()}>{pending ? "Sending…" : "Send back"}</button>
            <button type="button" className="btn" disabled={pending} onClick={() => setMode("")}>Cancel</button>
          </div>
        </form>
      )}
      {error && a.orderId && <ErrorFix error={error} orderId={a.orderId} factoryId={a.factoryId} className="appr-err text-[13px] font-semibold text-bad" />}
    </li>
  );
}
