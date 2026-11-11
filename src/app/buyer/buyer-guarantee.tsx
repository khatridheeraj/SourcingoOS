// The Sourcingo Guarantee under one PO, in the buyer's words: what it pays and when (the balance only once the goods
// pass our Final QC), and its claims with the day we decide by. Never a factory, a cost or a rate.
import { ClaimForm, type ClaimStyle } from "@/components/claim-form";
import { dayNear as day, money } from "@/lib/format";
import { buyerPlan, CLAIM_REASON, decisionText, type BuyerClaim, type GOrder, type GuaranteeTerms } from "@/lib/guarantee";
import { raiseClaim } from "./actions";

export type BuyerGuaranteeData = { shown: boolean; terms?: GuaranteeTerms; orders?: GOrder[]; claims?: BuyerClaim[] };

export function BuyerGuarantee({ data, orderId, styles, companyId, canWrite, today, url, help }: {
  help: boolean; data: BuyerGuaranteeData; orderId: string; styles: ClaimStyle[]; companyId: string; canWrite: boolean; today: string; url: Map<string | null, string | null>;
}) {
  const o = data.orders?.find((x) => x.order_id === orderId);
  if (!data.shown || !data.terms || !o) return null;
  const t = data.terms;
  const plan = buyerPlan(o, t, today);
  const claims = (data.claims ?? []).filter((c) => c.order_id === orderId);
  const state = (s: typeof plan.deposit, due: string) =>
    s.state === "paid" ? <small className="text-ok">Received, thank you</small> : <small>{due}</small>;

  return (
    <div className="bguar">
      <h3>
        <svg viewBox="0 0 16 16" aria-hidden><path d="M8 1.5l5.5 2v4.2c0 3.2-2.3 5.7-5.5 6.8-3.2-1.1-5.5-3.6-5.5-6.8V3.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M5.6 8.1l1.7 1.7 3.2-3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Sourcingo Guarantee
      </h3>
      {o.priced && Number(o.value) > 0 && (
        <ul className="fmoney-part">
          {plan.deposit.amount > 0 && (
            <li>
              <span className="fmoney-id"><b>Deposit, {t.deposit_pct}% of the PO</b>{state(plan.deposit, "Due with the PO")}</span>
              <span className="fmoney-amt num"><b>{money(plan.deposit.amount)}</b></span>
            </li>
          )}
          <li>
            <span className="fmoney-id">
              <b>Balance</b>
              {state(plan.balance, plan.balance.due ? `Your goods passed our Final QC ${day(plan.balance.due, today)}` : "Only once your goods pass our Final QC")}
            </span>
            <span className="fmoney-amt num">
              <b>{money(plan.balance.state === "paid" ? plan.balance.amount : plan.balance.left)}</b>
              {plan.balance.paid > 0 && plan.balance.state !== "paid" && <small>{money(plan.balance.paid)} received</small>}
            </span>
          </li>
        </ul>
      )}
      {claims.length > 0 && (
        <ul className="fmoney-part bclaims">
          {claims.map((c) => {
            const photos = c.photos.map((p) => url.get(p)).filter((u): u is string => !!u);
            return (
              <li key={c.id}>
                <span className="fmoney-id">
                  <b>Claim <span className="code">{c.claim_no}</span> · <span className="code">{c.style}</span></b>
                  <small>{CLAIM_REASON[c.reason]}, {c.pieces} pcs · {c.detail}</small>
                  {c.answer && <small>Sourcingo: “{c.answer}”</small>}
                  {photos.length > 0 && (
                    <span className="bstep-photos">
                      {photos.map((u, i) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`Claim ${c.claim_no} photo ${i + 1}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                          <img src={u} alt="" loading="lazy" />
                        </a>
                      ))}
                    </span>
                  )}
                </span>
                <span className="fmoney-amt">
                  {c.decision ? <b className={c.decision === "declined" ? undefined : "text-ok"}>{decisionText(c, money)}</b>
                    : <><b>We decide by {day(c.decide_by, today)}</b><small>Within 7 days, as promised</small></>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && t.live && <div className="bguar-act"><ClaimForm companyId={companyId} styles={styles} raise={raiseClaim} forBuyer /></div>}
      {help && <details className="howto bguar-help">
        <summary>What the Guarantee means</summary>
        <p>You pay the balance only after our own team has checked your goods at Final QC and they passed. If something is still wrong when they reach you, raise a claim with photos: we decide within 7 days, and either remake the pieces at our cost, refund them, or explain clearly why not.</p>
      </details>}
    </div>
  );
}
