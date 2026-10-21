import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { addDays } from "@/lib/payments";
import { formOptions } from "../../orders/options";
import { InquiryForm } from "../inquiry-form";

export default async function NewInquiryPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const o = await formOptions();
  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/inquiries">Inquiries</Link></nav>
          <h1>New inquiry</h1>
          <p>Log the buyer&apos;s ask now, even if it is only a WhatsApp line. A follow-up date puts it on Home when it is due.</p>
        </div>
      </div>
      <InquiryForm
        companyId={me.companyId}
        initial={{ buyer_id: "", prospect: "", contact_name: "", contact: "", source: "email", product: "", est_qty: "", unit: "pcs",
          target_price: "", merchandiser_id: o.meId, next_follow_up: addDays(todayIST(), 2), notes: "" }}
        buyers={o.buyers}
        team={o.team}
      />
    </>
  );
}
