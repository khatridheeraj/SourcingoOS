"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptSender, ignoreSender } from "../actions";

// An email from a sender no buyer is known by. The owner reads it as a PO (and can remember the sender) or ignores it.
export function HeldSender({ id, from, buyers }: { id: string; from: string; buyers: { id: string; label: string }[] }) {
  const router = useRouter();
  const [buyer, setBuyer] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, done: string) => start(async () => {
    setError("");
    const res = await fn();
    if (res.error) return setError(res.error);
    setNote(done);
    router.refresh();
  });

  return (
    <section className="panel stack" aria-labelledby="held-h">
      <div>
        <h2 id="held-h">Unknown sender</h2>
        <p className="muted text-[13.5px]">
          {from || "This sender"} is not a known sender for any buyer, so this email was not read. Only you can see it.
          Open the files below. If it is a buyer PO, accept it and it will be read.
        </p>
      </div>
      <label className="field">
        <span>Remember this sender for</span>
        <select className="inp" value={buyer} onChange={(e) => setBuyer(e.target.value)}>
          <option value="">Don&apos;t remember, just this email</option>
          {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <small>Next time, emails from this sender are read straight away.</small>
      </label>
      <div className="row">
        <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => acceptSender(id, buyer), "Accepted. Reading it now. Reload in a minute.")}>
          {pending ? "Working…" : "Accept and read"}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => ignoreSender(id), "Ignored.")}>Ignore</button>
        {note && !error && <span className="text-[13px] font-semibold text-ok">{note}</span>}
        {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
      </div>
    </section>
  );
}
