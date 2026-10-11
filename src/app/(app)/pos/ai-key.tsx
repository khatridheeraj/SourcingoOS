"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAiKey } from "./actions";

// The AI key that reads POs. Until it is in, POs wait here unread; the owner pastes it once.
export function AiKey({ owner, status }: { owner: boolean; status: { set: boolean; last4?: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (status.set && !open) {
    return owner ? (
      <p className="muted text-[13px]">
        AI reading is on (key ending {status.last4}). <button type="button" className="link" onClick={() => setOpen(true)}>Change key</button>
      </p>
    ) : null;
  }
  if (!owner) return <div className="errbox">PO reading isn&apos;t switched on yet: the owner still needs to add the AI key. Files you add wait here until then.</div>;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await setAiKey(key);
      if (res.error) return setError(res.error);
      setKey("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <form className="panel" onSubmit={save}>
      <h2>{status.set ? "Change the AI key" : "Switch on PO reading"}</h2>
      {!status.set && (
        <p className="mb-3 text-[13px]">
          The AI that reads POs needs a key. At <a className="link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>, add a few dollars of credit under Billing, then create a key under API Keys and paste it here. Only the PO reader can see it.
        </p>
      )}
      <div className="row">
        <input className="inp grow" type="password" autoComplete="off" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} aria-label="AI key" />
        <button className="btn primary" disabled={pending || !key.trim()}>{pending ? "Saving…" : "Save key"}</button>
        {status.set && <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
      {error && <div className="errbox mt-2">{error}</div>}
    </form>
  );
}
