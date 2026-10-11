"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readAgain, setAside } from "../actions";

export function PoActions({ id, status, canReread }: { id: string; status: string; canReread: boolean }) {
  const router = useRouter();
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
    <div className="row">
      {canReread && (
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => readAgain(id), "Reading again. Reload in a minute.")}>Read again</button>
      )}
      {status === "not_po" ? (
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => setAside(id, false), "")}>Put back to check</button>
      ) : status !== "added" && (
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => setAside(id, true), "")}>Set aside, not a new PO</button>
      )}
      {note && !error && <span className="text-[13px] font-semibold text-ok">{note}</span>}
      {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
    </div>
  );
}
