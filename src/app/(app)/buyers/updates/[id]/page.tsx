import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { dm } from "@/lib/buyer-week";
import { dayTimeNear } from "@/lib/format";
import { BuyerWeekCard } from "../../../../buyer/buyer-week";
import { loadBuyerWeek } from "../../../../buyer/week-data";
import { loadUpdateBuyers, sinceFor } from "../load";
import { SendWeek } from "./send-week";

const VIA: Record<string, string> = { whatsapp: "on WhatsApp", email: "by email", copy: "as copied text" };

// One buyer's update for this week, exactly as it will read, with the buttons that send it.
export default async function BuyerUpdatePage({ params }: PageProps<"/buyers/updates/[id]">) {
  const { id } = await params;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const { buyers } = await loadUpdateBuyers(me?.companyId);
  const b = buyers.find((x) => x.id === id);
  if (!b) notFound();
  const { week, photoUrls } = await loadBuyerWeek({ buyerId: b.id, since: sinceFor(b), photos: 8 });
  // The next buyer still waiting, in the list's order, so a Monday run is one tap after another.
  const next = buyers.filter((x) => !x.sent && x.id !== b.id).sort((a, z) => a.name.localeCompare(z.name))[0]?.id ?? null;

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/buyers">Buyers</Link> / <Link href="/buyers/updates">Weekly updates</Link></nav>
          <h1>{b.name}</h1>
          <p>{b.sent ? `Sent ${dayTimeNear(b.sent.at)} ${VIA[b.sent.via] ?? ""}` : `Not sent yet this week · counts from ${dm(week.since)}`}</p>
        </div>
        <Link className="btn" href={`/preview/buyer/${b.id}`}>See their page</Link>
      </div>
      {week.empty ? (
        <div className="empty"><b>Nothing to send</b>{b.name} has no open order and nothing went out since {dm(week.since)}.</div>
      ) : (
        <div className="bu-grid">
          <BuyerWeekCard week={week} photoUrls={photoUrls} title={`${b.name}'s update`} />
          <SendWeek buyerId={b.id} name={b.name} week={week} nextId={next} sent={!!b.sent} />
        </div>
      )}
    </>
  );
}
