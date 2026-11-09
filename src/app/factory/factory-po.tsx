"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { dayAtNear as dayAt } from "@/lib/format";
import { acceptPoInPanel } from "./actions";
import { errorText, words, type Lang } from "./i18n";

// A factory PO Sourcingo has sent: its number, when it was sent, the link that opens it with photos and terms.
export type PanelPo = { order_id: string; po_no: string; token: string; sent_at: string; accepted_at: string | null; accepted_via: string | null; styles: number };

// The PO on top of its order in the panel: open it, and accept it with one tap while it waits.
export function FactoryPo({ po, lang }: { po: PanelPo; lang: Lang }) {
  const router = useRouter();
  const w = words(lang);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const waiting = !po.accepted_at;

  function accept() {
    setError("");
    start(async () => {
      const r = await acceptPoInPanel(po.order_id);
      if (r.error) return setError(errorText(lang, r.error));
      toast(w.poAcceptedToast(po.po_no));
      router.refresh();
    });
  }

  return (
    <div className={`fpo${waiting ? " wait" : ""}`}>
      <div className="fpo-id">
        <b>{w.purchaseOrder}</b>
        <span className="num">{w.poSent(po.po_no, dayAt(po.sent_at), po.styles)}</span>
        {waiting ? <span className="chip warn">{w.poWaiting}</span> : <span className="fpo-ok">{w.poAccepted(dayAt(po.accepted_at!))}</span>}
      </div>
      <div className="fpo-acts">
        <a className="btn" href={`/po/${po.token}`} target="_blank" rel="noreferrer">{w.openPo}</a>
        {waiting && <button type="button" className="btn primary" disabled={pending} onClick={accept}>{pending ? w.accepting : w.acceptPo}</button>}
      </div>
      {error && <p className="fpo-err text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}
