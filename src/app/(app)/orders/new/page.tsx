import Link from "next/link";
import { OrderForm } from "../order-form";
import { formOptions } from "../options";

export default async function NewOrderPage() {
  const o = await formOptions();
  return (
    <>
      <div className="head">
        <div className="grow">
          <Link href="/" className="link text-xs">← Orders</Link>
          <h1>New order</h1>
          <p>Enter one buyer PO with all its styles. If the PO is split across factories, pick the factory on each style.</p>
        </div>
      </div>
      {o.buyers.length === 0 ? (
        <div className="empty"><b>No buyers yet</b>Add buyers first in <Link href="/buyers" className="link">Buyers</Link>.</div>
      ) : (
        <OrderForm
          initial={{ buyer_id: "", buyer_po: "", po_date: "", ship_date: "", status: "open", merchandiser_id: o.meId, notes: "" }}
          initialLines={[]}
          buyers={o.buyers}
          factories={o.factories}
          team={o.team}
        />
      )}
    </>
  );
}
