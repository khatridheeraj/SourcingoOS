import Link from "next/link";
import { redirect } from "next/navigation";
import { ClaimForm, type ClaimStyle } from "@/components/claim-form";
import { canEditOrders, canEnterDone, getMe } from "@/lib/auth";
import { dayNear as day, money, nowMs, todayIST } from "@/lib/format";
import { buyerPlan, CLAIM_DAYS, CLAIM_REASON, claimClock, factoryPay, type GOrder, type GuaranteeTerms, type Step } from "@/lib/guarantee";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { raiseClaimForBuyer } from "./actions";
import { DecideClaim, type TeamClaim } from "./claim-card";
import { PayButton, TakeBack } from "./pay-button";
import { TermsForm } from "./terms-form";

type Payment = { id: string; order_id: string; kind: "deposit" | "balance" | "factory"; factory_id: string | null; amount: number; paid_on: string; note: string | null };
type LineRow = { id: string; style: string; qty: number; orders: { id: string; order_no: string; buyer_po: string | null } };

// The Sourcingo Guarantee, for the team: buyer claims to decide within 7 days, then (for the owner and Accounts) what
// each PO's plan says is due: deposits, balances on a Final QC pass, and factories to pay within days of their pass.
export default async function GuaranteePage() {
  const me = await getMe();
  if (!canEnterDone(me?.role)) redirect("/");
  const finance = me?.role === "owner" || me?.role === "accounts";
  const edit = canEditOrders(me?.role);
  const today = todayIST();
  const supabase = await createClient();
  const since = new Date(nowMs() - 120 * 86_400_000).toISOString();
  const [{ data: termsRow }, { data: claimRows, error }, plan, pays, lineRes] = await Promise.all([
    supabase.rpc("guarantee_terms"),
    supabase.rpc("guarantee_claims"),
    finance ? supabase.rpc("guarantee_orders") : Promise.resolve({ data: null }),
    finance ? supabase.from("guarantee_payments").select("id, order_id, kind, factory_id, amount, paid_on, note").is("cancelled_at", null)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
    edit ? supabase.from("order_lines").select("id, style, qty, orders!inner(id, order_no, buyer_po, status, updated_at, removed_at)")
      .is("removed_at", null).is("orders.removed_at", null).in("orders.status", ["open", "shipped"]).gte("orders.updated_at", since)
      .order("position").limit(400) : Promise.resolve({ data: [] }),
  ]);
  const terms = (termsRow ?? { live: false, deposit_pct: 30, pay_days: 15 }) as GuaranteeTerms;
  const claims = (claimRows ?? []) as TeamClaim[];
  const { orders = [], buyers = {} } = ((plan as { data: unknown }).data ?? {}) as { orders?: GOrder[]; buyers?: Record<string, string> };
  const payments = ((pays as { data: unknown }).data ?? []) as Payment[];
  const styles: ClaimStyle[] = (((lineRes as { data: unknown }).data ?? []) as LineRow[])
    .map((l) => ({ lineId: l.id, orderId: l.orders.id, qty: l.qty, label: `${l.orders.order_no} · ${l.orders.buyer_po ?? ""} · ${l.style}` }))
    .sort((a, z) => z.label.localeCompare(a.label));

  const paths = [...new Set(claims.flatMap((c) => c.photos))];
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const url = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));

  const open = claims.filter((c) => !c.decision);
  const decided = claims.filter((c) => c.decision);
  const late = open.filter((c) => claimClock(c, today).tone === "bad").length;

  // Each order's steps; orders with something owed now come first.
  const rows = orders.map((o) => {
    const b = buyerPlan(o, terms, today);
    const f = (o.factories ?? []).map((x) => ({ ...x, step: factoryPay(x, terms, today) }));
    const all = [b.deposit, b.balance, ...f.map((x) => x.step)];
    const rank = all.some((s) => s.state === "late") ? 0 : all.some((s) => s.state === "due") ? 1 : all.some((s) => s.state === "waiting") ? 2 : 3;
    return { o, b, f, rank };
  }).sort((a, z) => a.rank - z.rank);
  const owedIn = rows.reduce((n, r) => n + (r.o.priced ? [r.b.deposit, r.b.balance].filter((s) => s.state === "due" || s.state === "late").reduce((m, s) => m + s.left, 0) : 0), 0);
  const owedOut = rows.reduce((n, r) => n + r.f.filter((x) => x.step.state === "due" || x.step.state === "late").reduce((m, x) => m + x.step.left, 0), 0);
  const factoryLate = rows.reduce((n, r) => n + r.f.filter((x) => x.step.state === "late").length, 0);
  const orderNo = new Map(orders.map((o) => [o.order_id, o.order_no]));
  const factoryName = new Map(orders.flatMap((o) => (o.factories ?? []).map((f) => [f.factory_id, f.name] as const)));

  return (
    <>
      <div className="head">
        <div className="grow">
          <div className="row">
            <h1>Sourcingo Guarantee</h1>
            <span className={`chip ${terms.live ? "ok" : ""}`}>{terms.live ? "On for buyers and factories" : "Preview: only the team sees it"}</span>
          </div>
          <p className="muted">
            Buyers pay {terms.deposit_pct}% with the PO and the rest when the goods pass our Final QC. Factories are paid within {terms.pay_days} days
            of their pass. A buyer&apos;s claim is decided within {CLAIM_DAYS} days: a remake, a refund, or a clear reason why not.
          </p>
        </div>
      </div>
      {error && <div className="errbox">{error.message}</div>}

      <section className="panel stack" aria-labelledby="claims-h">
        <div className="row justify-between">
          <div>
            <h2 id="claims-h" className="font-bold">Buyer claims</h2>
            <p className="muted text-[13px] num">
              {open.length ? `${open.length} to decide${late ? `, ${late} past the ${CLAIM_DAYS} days` : ""}` : "Nothing to decide"}
            </p>
          </div>
          {edit && <ClaimForm companyId={me?.companyId ?? ""} styles={styles} raise={raiseClaimForBuyer} forBuyer={false} />}
        </div>
        {open.length > 0 && (
          <ul className="gclaims">
            {open.map((c) => {
              const clock = claimClock(c, today);
              return (
                <li key={c.id} className="gclaim">
                  <div className="gclaim-h">
                    <b className="code">{c.claim_no}</b>
                    <span className="grow">
                      <Link href={`/orders/${c.order_id}`}>{c.order_no}</Link> · {c.buyer} · <span className="code">{c.style}</span>{c.factory ? ` · ${c.factory}` : ""}
                    </span>
                    <span className={`chip ${clock.tone}`}>
                      {clock.left! < 0 ? `${-clock.left!} ${clock.left === -1 ? "day" : "days"} past the promise` : clock.left === 0 ? "Decide today" : `Decide by ${day(c.decide_by, today)}`}
                    </span>
                  </div>
                  <p className="text-[14px]"><b>{CLAIM_REASON[c.reason]}</b>, {c.pieces} pcs · asks for a {c.ask}{c.by_buyer ? "" : " · raised by the team"}</p>
                  <p className="text-[14px] gclaim-detail">{c.detail}</p>
                  {c.photos.length > 0 && <Photos list={c.photos.map((p) => url.get(p)).filter((u): u is string => !!u)} of={c.claim_no} />}
                  <DecideClaim c={c} canDecide={edit} />
                </li>
              );
            })}
          </ul>
        )}
        {decided.length > 0 && (
          <details className="gdecided">
            <summary>{decided.length} decided in the last 4 months</summary>
            <ul className="fmoney-part">
              {decided.map((c) => (
                <li key={c.id}>
                  <span className="fmoney-id">
                    <b><span className="code">{c.claim_no}</span> · {c.order_no} · <span className="code">{c.style}</span></b>
                    <small>{CLAIM_REASON[c.reason]}, {c.pieces} pcs{c.answer ? ` · “${c.answer}”` : ""}</small>
                  </span>
                  <span className="fmoney-amt">
                    <b className={c.decision === "declined" ? undefined : "text-ok"}>
                      {c.decision === "remake" ? "Remake" : c.decision === "refund" ? `Refund ${money(Number(c.amount))}` : "Declined"}
                    </b>
                    {c.factory_claim_no && <small>Factory claim <span className="code">{c.factory_claim_no}</span></small>}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {finance && (
        <section className="panel stack" aria-labelledby="plan-h">
          <div>
            <h2 id="plan-h" className="font-bold">Payment plan</h2>
            <p className="muted text-[13px] num">
              {[owedIn > 0 && `${money(owedIn)} due from buyers`, owedOut > 0 && `${money(owedOut)} due to factories`,
                factoryLate > 0 && `${factoryLate} ${factoryLate === 1 ? "factory" : "factories"} past the ${terms.pay_days} days`].filter(Boolean).join(" · ") || "Nothing due right now"}
            </p>
          </div>
          {rows.length === 0 ? <p className="muted text-[13px]">No open orders.</p> : (
            <ul className="gplan">
              {rows.map(({ o, b, f }) => (
                <li key={o.order_id}>
                  <div className="gplan-h">
                    <Link href={`/orders/${o.order_id}`} className="font-semibold">{o.order_no}</Link>
                    <span className="muted">{[o.buyer_id && buyers[o.buyer_id], o.buyer_po, o.priced ? money(Number(o.value)) : "Buyer rates missing"].filter(Boolean).join(" · ")}</span>
                  </div>
                  <ul className="fmoney-part">
                    {o.priced && b.deposit.amount > 0 && <PlanRow label={`Deposit ${terms.deposit_pct}%`} s={b.deposit}
                      when={b.deposit.state === "paid" ? "Received" : `Due ${day(b.deposit.due, today)}`}
                      act={<PayButton orderId={o.order_id} kind="deposit" factoryId={null} left={b.deposit.left} today={today} label={`${o.order_no} deposit`} />} />}
                    {o.priced && <PlanRow label="Balance" s={b.balance}
                      when={b.balance.state === "paid" ? "Received" : b.balance.due ? `Due: passed Final QC ${day(b.balance.due, today)}` : "Due when every style passes Final QC"}
                      act={<PayButton orderId={o.order_id} kind="balance" factoryId={null} left={b.balance.left} today={today} label={`${o.order_no} balance`} />} />}
                    {f.map((x) => (
                      <PlanRow key={x.factory_id} label={x.name} s={x.step}
                        when={x.step.state === "paid" ? "Paid" : x.step.due ? `Pay by ${day(x.step.due, today)}` : "Paid after its goods pass Final QC"}
                        act={x.cost > 0 ? <PayButton orderId={o.order_id} kind="factory" factoryId={x.factory_id} left={x.step.left} today={today} label={`${o.order_no} ${x.name}`} /> : null} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {payments.length > 0 && (
            <details className="gdecided">
              <summary>Payments recorded here</summary>
              <ul className="fmoney-part">
                {payments.map((p) => (
                  <li key={p.id}>
                    <span className="fmoney-id">
                      <b>{orderNo.get(p.order_id) ?? "Order"} · {p.kind === "factory" ? factoryName.get(p.factory_id ?? "") ?? "Factory" : p.kind === "deposit" ? "Deposit" : "Balance"}</b>
                      <small>{[day(p.paid_on, today), p.note].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="fmoney-amt"><b>{money(Number(p.amount))}</b><TakeBack id={p.id} /></span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {me?.role === "owner" && (
        <section className="panel stack" aria-labelledby="terms-h">
          <div>
            <h2 id="terms-h" className="font-bold">Terms</h2>
            <p className="muted text-[13px]">
              {terms.live ? `On since ${day(terms.from, today)}. It covers orders entered from that day: their buyers see the plan and can raise claims, and their factories see when they are paid.`
                : terms.from ? "Off: buyers and factories don't see it. Orders entered while it was on keep their plan here."
                : "Buyers and factories see none of this yet. Look at it through “See exactly what they will see” on Buyers and Factories. Once on, it covers orders entered from that day; older orders keep their terms."}
            </p>
          </div>
          <TermsForm live={terms.live} depositPct={terms.deposit_pct} payDays={terms.pay_days} />
        </section>
      )}

      <details className="howto">
        <summary>How the Guarantee works</summary>
        <p>The balance falls due the day the last style of a PO passes Final QC (a re-check that passes counts). A factory&apos;s pay falls due {terms.pay_days} days after its own styles pass.</p>
        <p>Payments here are our own record of the plan, so everyone sees what is owed. Book them in Tally as usual; the app never writes to Tally.</p>
        <p>An agreed claim can pass to the factory as a factory claim for the same pieces at the factory&apos;s rate. It shows in Bills to pay, and Accounts books the debit note in Tally.</p>
      </details>
    </>
  );
}

function PlanRow({ label, s, when, act }: { label: string; s: Step; when: string; act: React.ReactNode }) {
  const tone = s.state === "late" ? "text-bad" : s.state === "paid" ? "text-ok" : s.state === "due" ? "text-warn" : "";
  return (
    <li>
      <span className="fmoney-id"><b>{label}</b><small className={tone}>{s.state === "late" ? `Late · ${when}` : when}</small></span>
      <span className="fmoney-amt num">
        {s.paid > 0 && s.state !== "paid" && <small>{money(s.paid)} paid</small>}
        <b>{s.state === "paid" ? money(s.amount) : money(s.left)}</b>
        {s.state !== "paid" && s.state !== "waiting" && act}
      </span>
    </li>
  );
}

function Photos({ list, of }: { list: string[]; of: string }) {
  return (
    <span className="bstep-photos">
      {list.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`${of} photo ${i + 1}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
          <img src={u} alt="" loading="lazy" />
        </a>
      ))}
    </span>
  );
}
