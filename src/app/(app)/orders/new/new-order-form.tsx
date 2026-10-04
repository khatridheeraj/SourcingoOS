"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createOrder } from "../actions";

type Opt = { id: string; label: string };

export function NewOrderForm({ buyers, inquiries, initial }: {
  buyers: Opt[]; inquiries: (Opt & { buyer_id: string; fabric: boolean })[]; initial: { inquiry_id: string; buyer_id: string; fabric: boolean };
}) {
  const router = useRouter();
  const [f, setF] = useState({ buyer_id: initial.buyer_id, po: "", order_type: initial.fabric ? "fabric" : "garment", inquiry_id: initial.inquiry_id } as {
    buyer_id: string; po: string; order_type: "garment" | "fabric"; inquiry_id: string;
  });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const forBuyer = inquiries.filter((i) => !f.buyer_id || i.buyer_id === f.buyer_id);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    start(async () => {
      const r = await createOrder(f);
      if (r.id) router.push(`/orders/${r.id}`);
      if (r.error) setError(r.error);
    });
  };

  return (
    <form onSubmit={submit} className="stack">
      <div className="fgrid">
        <label className="field">
          <span>From inquiry</span>
          <select
            className="inp"
            value={f.inquiry_id}
            onChange={(e) => {
              const inq = inquiries.find((i) => i.id === e.target.value);
              setF({ ...f, inquiry_id: e.target.value, buyer_id: inq?.buyer_id ?? f.buyer_id, order_type: inq ? (inq.fabric ? "fabric" : "garment") : f.order_type });
            }}
          >
            <option value="">No inquiry (direct order)</option>
            {forBuyer.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
          <small>Its merchandiser and notes carry over.</small>
        </label>
        <label className="field">
          <span>Customer (buyer code) <i>*</i></span>
          <select className="inp" required value={f.buyer_id} onChange={(e) => setF({ ...f, buyer_id: e.target.value, inquiry_id: "" })}>
            <option value="">Select buyer code…</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Buyer PO / reference <i>*</i></span>
          <input className="inp" required value={f.po} onChange={(e) => setF({ ...f, po: e.target.value })} placeholder="As printed on the buyer's PO" />
        </label>
        <label className="field">
          <span>Order type <i>*</i></span>
          <select className="inp" value={f.order_type} onChange={(e) => setF({ ...f, order_type: e.target.value as "garment" | "fabric" })}>
            <option value="garment">Garment (pieces)</option>
            <option value="fabric">Fabric (meters)</option>
          </select>
        </label>
      </div>
      {error && <p className="errbox" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create and add styles"}</button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
