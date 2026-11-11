"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear, qty } from "@/lib/format";
import { goodsReadySeen } from "../factory-ask-actions";

export type GoodsReady = {
  id: string; readyOn: string; pieces: number; styles: string; cartons: number; note: string; photos: string[];
  at: string; seenAt: string; seenNote: string;
};

// The factory says its goods are ready, with photos. The orders team plans Final QC and pickup and marks it seen,
// with a word back the factory reads in its panel. Once seen it stays for a while as a record.
export function GoodsReadyBox({ orderId, notices, canEdit }: { orderId: string; notices: GoodsReady[]; canEdit: boolean }) {
  if (!notices.length) return null;
  return <div className="fask-team">{notices.map((n) => <ReadyRow key={n.id} orderId={orderId} n={n} canEdit={canEdit} />)}</div>;
}

function ReadyRow({ orderId, n, canEdit }: { orderId: string; n: GoodsReady; canEdit: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const waiting = !n.seenAt;

  function seen() {
    setError("");
    start(async () => {
      try {
        const res = await goodsReadySeen(orderId, n.id, note);
        if (res.error) { setError(res.error); return; }
        toast("Marked seen. The factory sees your note.");
        router.refresh();
      } catch (e) {
        setError(caught(e, "It didn't save. Try again."));
      }
    });
  }

  return (
    <div className={`fask-ask${waiting ? " open" : ""}`}>
      <p className="fask-what">
        <b>{waiting ? "Factory says goods are ready" : "Goods ready, seen"}</b>
        {" · "}<span className="num">{qty(n.pieces)} pcs in {qty(n.cartons)} {n.cartons === 1 ? "carton" : "cartons"} from <b>{dayNear(n.readyOn)}</b></span>
      </p>
      <p className="fask-why num">{n.styles}</p>
      {n.note && <p className="fask-why">&ldquo;{n.note}&rdquo;</p>}
      {n.photos.length > 0 && (
        <div className="fready-photos">
          {n.photos.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`Goods photo ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage link */}
              <img src={u} alt="" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {n.seenNote && <p className="fask-why"><b>Note</b> {n.seenNote}</p>}
      {waiting && canEdit && (
        <div className="fask-act">
          <input className="inp" value={note} maxLength={300} disabled={pending} placeholder="A word for the factory, e.g. Final QC on Friday"
            aria-label="Note for the factory" onChange={(e) => setNote(e.target.value)} />
          <div className="fask-btns">
            <button type="button" className="btn sm" disabled={pending} onClick={seen}>{pending ? "Saving…" : "Mark seen"}</button>
          </div>
        </div>
      )}
      {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}
