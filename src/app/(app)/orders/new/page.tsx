import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { qty } from "@/lib/format";
import { INQUIRY_COLUMNS, isOpenInquiry, type Inquiry } from "@/lib/inquiries";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "../order-form";
import { formOptions } from "../options";

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const sp = await searchParams;
  // Made from a buyer inquiry: its buyer, merchandiser and what was asked for come in, and the inquiry is marked converted on save.
  const inquiryId = typeof sp.inquiry === "string" && /^[0-9a-f-]{36}$/i.test(sp.inquiry) ? sp.inquiry : "";
  const supabase = await createClient();
  const { data: inq } = inquiryId ? await supabase.from("inquiries").select(INQUIRY_COLUMNS).eq("id", inquiryId).maybeSingle<Inquiry>() : { data: null };
  const from = inq && isOpenInquiry(inq.status) && inq.buyer_id ? inq : null;
  const o = await formOptions({ buyerId: from?.buyer_id ?? undefined, merchandiserId: from?.merchandiser_id ?? undefined });
  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb">
            {from ? <Link href={`/inquiries/${from.id}`}>{from.inquiry_no}</Link> : <Link href="/">Orders</Link>}
          </nav>
          <h1>New order</h1>
          <p>
            {from ? <>From inquiry <b>{from.inquiry_no}</b> ({from.product}{from.est_qty ? `, ${qty(from.est_qty)} ${from.unit}` : ""}). Enter the buyer&apos;s PO number and its styles.</>
              : "Type in a buyer PO that came on WhatsApp, by phone or by hand, with all its styles. Attach the buyer's file if there is one; the order also makes its own PO PDF."}
          </p>
        </div>
      </div>
      {inq && !from && (
        <div className="warnbox">
          {inq.inquiry_no} {inq.status === "converted" ? "is already an order" : !inq.buyer_id ? "is from a buyer not in the app yet. Add the buyer, pick them on the inquiry, then make the order" : "isn't open"}, so this order won&apos;t be linked to it.
        </div>
      )}
      {o.buyers.length === 0 ? (
        <div className="empty"><b>No buyers yet</b>Add buyers first in <Link href="/buyers" className="link">Buyers</Link>.</div>
      ) : (
        <OrderForm
          initial={{ buyer_id: from?.buyer_id ?? "", buyer_po: "", po_date: "", ship_date: "", status: "open", merchandiser_id: from?.merchandiser_id ?? o.meId,
            notes: from ? [`From ${from.inquiry_no}: ${from.product}`, from.notes].filter(Boolean).join("\n") : "", buyer_terms: "" }}
          initialLines={from ? [{ style: "", description: from.product.slice(0, 200), colour: "", qty: from.est_qty && from.unit === "pcs" ? String(from.est_qty) : "",
            buyer_rate: from.quoted_price != null ? String(from.quoted_price) : "", factory_id: "", factory_rate: "" }] : []}
          inquiryId={from?.id}
          companyId={me?.companyId ?? undefined}
          buyers={o.buyers}
          factories={o.factories}
          team={o.team}
        />
      )}
    </>
  );
}
