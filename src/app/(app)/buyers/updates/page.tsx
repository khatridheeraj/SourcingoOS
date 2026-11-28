import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { dm } from "@/lib/buyer-week";
import { dayTimeNear } from "@/lib/format";
import { loadBuyerWeek } from "../../../buyer/week-data";
import { loadUpdateBuyers, sinceFor } from "./load";

const VIA: Record<string, string> = { whatsapp: "on WhatsApp", email: "by email", copy: "copied" };

// Weekly updates: every buyer with an open order hears from Sourcingo once a week, without having to ask.
// One row per buyer with this week's headline; the ones still to send come first.
export default async function BuyerUpdatesPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const { week, buyers } = await loadUpdateBuyers(me?.companyId);
  const heads = await Promise.all(buyers.map((b) => loadBuyerWeek({ buyerId: b.id, since: sinceFor(b) }).then((r) => r.week.headline).catch(() => "")));
  const rows = buyers.map((b, i) => ({ ...b, headline: heads[i] })).sort((a, z) => Number(!!a.sent) - Number(!!z.sent) || a.name.localeCompare(z.name));
  const left = rows.filter((r) => !r.sent).length;

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/buyers">Buyers</Link></nav>
          <h1>Weekly updates</h1>
          <p className="num">
            Week of {dm(week)} · {rows.length === 0 ? "no buyer has an open order" : left === 0 ? `all ${rows.length} sent` : `${left} of ${rows.length} still to send`}
          </p>
        </div>
      </div>
      <section className="card" aria-label="Buyers to update">
        {rows.length === 0 ? (
          <p className="card-empty">Nothing to send this week. Buyers show here once they have an open order.</p>
        ) : (
          <ul className="rows">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/buyers/updates/${r.id}`} className="bu-row">
                  <span className="bu-id">
                    <b>{r.name}</b>
                    <span>{r.headline || `${r.openOrders} open ${r.openOrders === 1 ? "order" : "orders"}`}</span>
                  </span>
                  {r.sent ? <span className="chip ok">Sent {dayTimeNear(r.sent.at)} {VIA[r.sent.via] ?? ""}</span> : <span className="btn sm">Send</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      <details className="howto border-t border-line px-4 py-3">
        <summary>How weekly updates work</summary>
        <p>Each update shows only what the buyer&apos;s own page shows: steps done, photos our team approved, final QC, shipments and money due. It counts from the last update you sent, or the last seven days. Sending it marks it here and clears it from Home for the week.</p>
      </details>
      </section>
    </>
  );
}
