"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { cancelClaim } from "../../actions";

// Cancel a claim raised by mistake. It stays on the list, marked cancelled, with the reason.
export function CancelClaim({ id }: { id: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <details className="howto">
      <summary>Cancel this claim</summary>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) { setError("Say why the claim is cancelled."); return; }
        start(async () => {
          const r = await cancelClaim(id, reason);
          if (r.error) { setError(r.error); return; }
          toast(r.ok!);
          router.refresh();
        });
      }}>
        <input className="inp" value={reason} maxLength={300} aria-label="Why cancel" aria-invalid={error ? true : undefined} placeholder="e.g. raised twice; factory replaced the pieces" onChange={(e) => { setReason(e.target.value); if (error) setError(""); }} />
        {error && <p className="text-xs text-bad" role="alert">{error}</p>}
        <div><button className="btn sm" disabled={pending}>Cancel claim</button></div>
      </form>
    </details>
  );
}
