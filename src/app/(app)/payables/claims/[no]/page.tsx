import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { CLAIM_REASON } from "@/lib/claims";
import { day, money, qty } from "@/lib/format";
import { tidyLedger } from "@/lib/payables";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "../../../payments/load";
import { PrintButton } from "../../../goods/[id]/packing/print-button";
import { loadClaims } from "../../load";
import { CancelClaim } from "./cancel-claim";

// One factory claim as a debit note to print or send the factory: who, which bill, what went wrong and how much.
export default async function ClaimPage({ params }: PageProps<"/payables/claims/[no]">) {
  const { no } = await params;
  const me = await getMe();
  if (!isFinance(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const { claims } = await loadClaims(supabase);
  const c = claims.find((x) => x.claim_no === decodeURIComponent(no));
  if (!c) notFound();
  const [{ data: co }, { data: f }] = await Promise.all([
    supabase.from("companies").select("name, legal_name, address, gstin").eq("id", me.companyId).maybeSingle(),
    supabase.from("factories").select("name, address, gstin").eq("company_id", me.companyId).eq("tally_ledger", c.ledger).order("active", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rate = c.pieces ? Number(c.amount) / c.pieces : null;

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/payables?view=claims">Claims</Link> / {c.claim_no}</nav>
          <h1>Debit note {c.claim_no}</h1>
          <p>
            {c.state === "open" ? "Not in Tally yet. Book the same debit note in Tally against the bill; until then Bills to pay keeps the amount back."
              : c.state === "booked" ? `In Tally${c.booked?.number ? ` as ${c.booked.number}` : ""}, ${day(c.booked!.on)}.`
              : `Cancelled${c.cancel_reason ? `: ${c.cancel_reason}` : ""}.`}
          </p>
        </div>
        {c.state !== "cancelled" && <PrintButton />}
      </div>

      <article className={`challan ${c.state === "cancelled" ? "opacity-60" : ""}`}>
        <header className="challan-top">
          <div>
            <b className="challan-co">{co?.legal_name || co?.name}</b>
            {co?.address && <p className="whitespace-pre-line">{co.address}</p>}
            {co?.gstin && <p>GSTIN {co.gstin}</p>}
          </div>
          <div className="challan-title">
            <h2>Debit note{c.state === "cancelled" ? " (cancelled)" : ""}</h2>
            <dl>
              <div><dt>No.</dt><dd className="code">{c.claim_no}</dd></div>
              <div><dt>Date</dt><dd>{day(c.claim_date)}</dd></div>
              {c.order_no && <div><dt>Our order</dt><dd className="code">{c.order_no}</dd></div>}
            </dl>
          </div>
        </header>

        <section className="challan-parties">
          <div>
            <span className="challan-label">To</span>
            <b>{f?.name ?? tidyLedger(c.ledger)}</b>
            {f?.address && <p className="whitespace-pre-line">{f.address}</p>}
            {f?.gstin && <p>GSTIN {f.gstin}</p>}
          </div>
          <div>
            <span className="challan-label">Against</span>
            <dl>
              <div><dt>Your bill</dt><dd>{c.bill ?? "—"}</dd></div>
              <div><dt>Reason</dt><dd>{CLAIM_REASON[c.reason]}</dd></div>
            </dl>
          </div>
        </section>

        <div className="table-wrap">
          <table className="tbl challan-tbl">
            <thead><tr><th>Details</th><th className="text-right">Pieces</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              <tr>
                <td className="whitespace-pre-line">{c.note}</td>
                <td className="num text-right">{c.pieces ? qty(c.pieces) : "—"}</td>
                <td className="num text-right">{rate ? money(Math.round(rate * 100) / 100) : "—"}</td>
                <td className="num text-right">{money(Number(c.amount))}</td>
              </tr>
            </tbody>
            <tfoot><tr><td colSpan={3}>Total debited to your account</td><td className="num text-right">{money(Number(c.amount))}</td></tr></tfoot>
          </table>
        </div>
        <p className="challan-note">We have debited your account by this amount. It will be adjusted against {c.bill ? `bill ${c.bill}` : "your next payment"}.</p>
      </article>

      {c.state === "open" && <div className="no-print"><CancelClaim id={c.id} /></div>}
    </>
  );
}
