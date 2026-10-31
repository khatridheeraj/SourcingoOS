"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { deleteOrder } from "../actions";

// The owner's way out for a PO entered by mistake. It asks for a reason, then the order leaves every screen;
// it stays in the activity log and comes back from Orders, Cancelled, Deleted POs.
// warnings: who already has this PO (a factory's panel, an email), said before the second tap.
// blocked: why it can't be deleted (goods bought, shipped); then it says so instead.
export function DeletePo({ orderId, orderNo, buyerPo, warnings, blocked }: {
  orderId: string; orderNo: string; buyerPo: string; warnings: string[]; blocked: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function remove() {
    setError("");
    start(async () => {
      const res = await deleteOrder(orderId, reason);
      if (res.error) return setError(res.error);
      toast(`${orderNo} deleted. Bring it back from Orders, Cancelled.`);
      // Replace, so Back doesn't open the deleted order.
      router.replace("/?status=cancelled#deleted");
    });
  }

  return (
    <section className="panel scroll-mt-20" id="details-delete" aria-labelledby="del-h">
      <div className="row">
        <h2 id="del-h" className="font-bold text-base">Delete this PO</h2>
        {!open && <button type="button" className="btn sm danger ml-auto" onClick={() => setOpen(true)}>Delete PO</button>}
      </div>
      <p className="muted mt-1 text-[13px]">For a PO added by mistake. It leaves every screen and can be brought back.</p>
      {open && (blocked ? (
        <p className="mt-3 text-[13px] font-semibold text-warn" role="status">{blocked}</p>
      ) : (
        <div className="mt-3 flex max-w-md flex-col gap-2">
          {warnings.map((w) => <p key={w} className="text-[13px] font-semibold text-warn">{w}</p>)}
          <label className="text-[13px]" htmlFor="del-why">Why delete PO {buyerPo}?</label>
          <input id="del-why" className="inp" value={reason} maxLength={300} autoFocus placeholder="e.g. Entered twice, wrong buyer"
            onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && reason.trim().length >= 3) remove(); }} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" className="btn min-h-11" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Keep it</button>
            <button type="button" className="btn primary danger min-h-11" disabled={pending || reason.trim().length < 3} onClick={remove}>
              {pending ? "Deleting…" : `Delete ${orderNo}`}
            </button>
          </div>
        </div>
      ))}
      {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}
