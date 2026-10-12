"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addBuyer } from "../../buyers/actions";

// For a PO from a buyer that isn't in the list yet: the owner adds the buyer here and it is picked on the order below.
export function NewBuyer({ name, code }: { name: string; code: string }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [realName, setRealName] = useState(name);
  const [buyerCode, setBuyerCode] = useState(code);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}>Add as a new buyer</button>;
  return (
    <form
      className="row mt-1"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError("");
          const res = await addBuyer(buyerCode, realName);
          if (res.error || !res.id) return setError(res.error ?? "Couldn't add the buyer.");
          router.replace(`${path}?buyer=${res.id}`);
          router.refresh();
        });
      }}
    >
      <input className="inp" value={realName} onChange={(e) => setRealName(e.target.value)} placeholder="Buyer's real name" aria-label="Buyer's real name" required autoFocus />
      <input className="inp code w-36" value={buyerCode} onChange={(e) => setBuyerCode(e.target.value)} placeholder="BYR-OZ" aria-label="Buyer code" required />
      <button type="submit" className="btn primary sm" disabled={pending}>{pending ? "Adding…" : "Add buyer"}</button>
      <button type="button" className="btn sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
    </form>
  );
}
