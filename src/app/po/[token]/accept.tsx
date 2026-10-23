"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptPo } from "./actions";

// One tap to accept, with the name of who accepted. Hindi under each line, as on the factory panel.
export function AcceptPo({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="po-accept-box no-print">
      <div>
        <b>Please accept this purchase order</b>
        <p>No signature needed. Tap Accept, or reply &quot;Accepted&quot; to our email.</p>
        <p lang="hi">कृपया यह PO स्वीकार करें। Accept दबाएँ या हमारे ईमेल पर &quot;Accepted&quot; लिखकर जवाब दें।</p>
      </div>
      <div className="row">
        <input className="inp grow" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
        <button type="button" className="btn primary" disabled={pending} onClick={() => start(async () => {
          setError("");
          const r = await acceptPo(token, name);
          if (r.error) return setError(r.error);
          router.refresh();
        })}>{pending ? "Accepting…" : "Accept PO"}</button>
      </div>
      {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}
