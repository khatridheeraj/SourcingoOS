"use client";

import { openOrderSheet } from "@/components/order-sheet";
import { openQcSheet } from "@/components/qc-sheet";
import { areaOf, type Journey, STAGES, stageIndex } from "@/lib/journey";
import { MarkShipped } from "../mark-shipped";

// The top of every order: the road from buyer PO to shipped, and one clear next step with its button.
// Each stage on the road opens the part of the order its work is in.
export function OrderJourney({ orderId, orderNo, j, canEdit, canRecordQc, shipBlocker, children }: { orderId: string; orderNo: string; j: Journey; canEdit: boolean; canRecordQc: boolean; shipBlocker: string | null; children?: React.ReactNode }) {
  const at = stageIndex(j.stage);
  const a = j.next.action;
  const go = (hash: string) => {
    window.location.hash = hash;
    // The area opens on the hash change; then bring what was asked for into view.
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  function act() {
    if (a.kind === "start") openOrderSheet(orderId, "start", a.factoryId);
    else if (a.kind === "update") openOrderSheet(orderId, "update");
    else if (a.kind === "qc") { if (canRecordQc) openQcSheet(orderId, "final"); else go("qc"); }
    else if (a.kind === "po") go("details-po");
    else if (a.kind === "review") go("tna");
    else if (a.kind === "samples") go("samples");
    else if (a.kind === "dispatch") go("dispatch");
  }

  return (
    <section className={`jr tone-${j.next.tone}`} aria-label="Where this order is">
      <ol className="jr-rail">
        {STAGES.map((s, i) => (
          <li key={s.key} data-state={i < at ? "done" : i === at ? "now" : "todo"}>
            <a href={`#${areaOf(s.key, canEdit)}`} title={s.hint}>
            <span className="jr-dot" aria-hidden>{i < at ? <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : i + 1}</span>
            <span className="jr-label">{s.label}</span>
            <span className="sr-only">{i < at ? " (done)" : i === at ? " (now)" : ""}</span>
            </a>
          </li>
        ))}
      </ol>
      <div className="jr-next">
        <div className="jr-text">
          <span className="jr-kicker">{j.stage === "done" ? "Finished" : j.next.action.kind === "none" ? `Waiting${j.next.who ? ` on ${j.next.who}` : ""}` : "Next step"}</span>
          <b>{j.next.title}</b>
          <p>{j.next.detail}</p>
        </div>
        <div className="jr-acts">
          {a.kind === "ship" ? (
            <MarkShipped orderId={orderId} orderNo={orderNo} blocked={shipBlocker} />
          ) : a.kind !== "none" && (
            <button type="button" className="btn primary jr-btn" onClick={act}>{j.next.label}</button>
          )}
          {children && <div className="jr-more">{children}</div>}
        </div>
      </div>
    </section>
  );
}
