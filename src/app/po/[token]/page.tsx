import type { Metadata } from "next";
import { FactoryPoDoc } from "@/components/factory-po-doc";
import { PrintPo } from "@/app/(app)/orders/[id]/factory-po/[factoryId]/print-po";
import { AcceptPo } from "./accept";
import { poByToken } from "./data";
import { dayTimeNear } from "@/lib/format";

export const metadata: Metadata = { title: "Purchase order", robots: { index: false, follow: false } };

// "30 Sep, 1:30 pm" (never "Sept"), with the year only when it isn't this year.
const at = (ts: string) => dayTimeNear(ts);

// A factory PO as the factory sees it from the email: the PO with its style photos and terms, Save as PDF,
// and Accept. Only someone with the link can open it, and it never names the buyer.
export default async function PublicPoPage({ params }: PageProps<"/po/[token]">) {
  const { token } = await params;
  const { data: d, error } = await poByToken("po_doc", token);
  if (!d) {
    return (
      <main className="mx-auto w-full max-w-[420px] px-4 py-16">
        <div className="panel !p-8 shadow-[var(--shadow-md)]">
          <div className="brand !p-0 mb-6"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>Purchase order</small></div>
          <h1 className="text-[20px] tracking-tight">This PO link doesn&apos;t open</h1>
          {error === "Unknown PO." ? (
            <>
              <p className="muted mt-2 text-[14px]">Ask Sourcingo for the PO again.</p>
              <p className="muted mt-1 text-[14px]">यह PO लिंक नहीं खुलता। Sourcingo से PO दोबारा माँगें।</p>
            </>
          ) : <p className="muted mt-2 text-[14px]">{error}</p>}
        </div>
      </main>
    );
  }
  const accepted = d.accepted_at ? `${at(d.accepted_at)}${d.accepted_via === "email" ? " by email" : d.accepted_via === "link" ? " on this link" : ""}` : null;
  return (
    <main className="po-public mx-auto w-full max-w-[1100px] px-4 py-6 sm:py-10">
      <div className="head no-print">
        <div className="grow">
          <div className="brand !p-0 mb-3"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>Purchase order</small></div>
          <h1>PO {d.po_no} for {d.factory.name}</h1>
          <p>From {d.company.name}. Tap a photo to see it full size.</p>
        </div>
        <PrintPo />
      </div>
      {accepted ? (
        <div className="okbox no-print mb-4"><b>Accepted {accepted}.</b> Thank you. धन्यवाद, यह PO स्वीकार हो गया है।</div>
      ) : <AcceptPo token={token} />}
      <FactoryPoDoc d={{
        poNo: d.po_no, date: d.date, draft: false,
        company: { name: d.company.name, address: d.company.address, shipAddress: d.company.ship_address, gstin: d.company.gstin, phone: d.company.phone, email: d.company.email },
        factory: d.factory,
        lines: d.lines.map((l) => ({ ...l, rate: l.rate == null ? null : Number(l.rate) })),
        paymentDays: d.payment_days, delivery: d.delivery ?? "As agreed", accepted,
      }} />
    </main>
  );
}
