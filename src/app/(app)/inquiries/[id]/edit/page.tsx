import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { INQUIRY_COLUMNS, isOpenInquiry, type Inquiry } from "@/lib/inquiries";
import { createClient } from "@/lib/supabase/server";
import { formOptions } from "../../../orders/options";
import { InquiryForm } from "../../inquiry-form";

const s = (v: unknown) => (v == null ? "" : String(v));

export default async function EditInquiryPage({ params }: PageProps<"/inquiries/[id]/edit">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const { data: i } = await supabase.from("inquiries").select(INQUIRY_COLUMNS).eq("id", id).maybeSingle<Inquiry>();
  if (!i) notFound();
  if (!isOpenInquiry(i.status)) redirect(`/inquiries/${id}`);
  const o = await formOptions({ buyerId: i.buyer_id ?? undefined, merchandiserId: i.merchandiser_id ?? undefined });
  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/inquiries">Inquiries</Link> / <Link href={`/inquiries/${id}`}>{i.inquiry_no}</Link></nav>
          <h1>Edit {i.inquiry_no}</h1>
        </div>
      </div>
      <InquiryForm
        id={id}
        companyId={me.companyId}
        initial={{ buyer_id: s(i.buyer_id), prospect: s(i.prospect), contact_name: s(i.contact_name), contact: s(i.contact), source: i.source,
          product: i.product, est_qty: s(i.est_qty), unit: i.unit, target_price: s(i.target_price), merchandiser_id: s(i.merchandiser_id),
          next_follow_up: s(i.next_follow_up), notes: s(i.notes) }}
        buyers={o.buyers}
        team={o.team}
      />
    </>
  );
}
