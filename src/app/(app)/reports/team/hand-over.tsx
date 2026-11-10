"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { handOver } from "./actions";

// Hand some or all of one person's open orders to someone else: tick the orders, pick who takes them, move.
export function HandOver({ fromId, fromName, orders, takers }: {
  fromId: string; fromName: string; orders: { id: string; label: string; late: boolean }[]; takers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<string[]>(orders.map((o) => o.id));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const sel = useRef<HTMLSelectElement>(null);

  if (!takers.length) return null;
  if (!open) return <button type="button" className="btn sm tb-hand" onClick={() => setOpen(true)}>Hand over orders</button>;

  function go() {
    setError("");
    if (!to) { setError("Pick who takes them over."); sel.current?.focus(); return; }
    start(async () => {
      const res = await handOver(fromId, to, picked);
      if (res.error) { setError(res.error); return; }
      toast(`${res.moved} ${res.moved === 1 ? "order" : "orders"} moved to ${takers.find((t) => t.id === to)?.name}.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="tb-hand-box">
      <fieldset>
        <legend className="text-[13px] font-semibold">{fromName}&apos;s open orders</legend>
        <ul className="tb-orders">
          {orders.map((o) => (
            <li key={o.id}>
              <label>
                <input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} />
                <span className="min-w-0">{o.label}{o.late && <em className="why bad"> · past ship date</em>}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <label className="field">
        <span>Hand them to</span>
        <select ref={sel} className="inp" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={error === "Pick who takes them over." || undefined}>
          <option value="">Pick a person</option>
          {takers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      <div className="row gap-2">
        <button type="button" className="btn primary" disabled={pending || !picked.length} onClick={go}>{pending ? "Moving…" : `Move ${picked.length} ${picked.length === 1 ? "order" : "orders"}`}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
