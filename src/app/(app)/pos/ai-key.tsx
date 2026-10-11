"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAiKey } from "./actions";

// The optional AI key. Without it, POs are read for free from their text; with it, the AI also reads scans and photos.
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
  if (!owner) return null;
  if (!status.set && !open) {
    return (
      <p className="muted text-[13px]">
        PO reading is free: it fills in what it finds in Excel, CSV and PDF POs. Scans and photos are typed in.{" "}
        <button type="button" className="link" onClick={() => setOpen(true)}>Add a paid AI key</button> later to read those too.
      </p>
    );
  }

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
      <h2>{status.set ? "Change the AI key" : "Add an AI key"}</h2>
      {!status.set && (
        <p className="mb-3 text-[13px]">
          The AI that reads POs needs a key. At <a className="link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>, add credit under Billing, then create a key under API Keys and paste it here. Only the PO reader can see it.
        </p>
      )}
      <div className="row">
        <input className="inp grow" type="password" autoComplete="off" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} aria-label="AI key" />
        <button className="btn primary" disabled={pending || !key.trim()}>{pending ? "Saving…" : "Save key"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <div className="errbox mt-2">{error}</div>}
    </form>
  );
}
