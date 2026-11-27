import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { formOptions } from "../options";
import { SheetImport } from "./sheet-import";

// Many buyer POs at once, from rows pasted out of Excel or Google Sheets, or a CSV file.
export default async function OrdersSheetPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  const o = await formOptions();
  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Orders</Link></nav>
          <h1>Add POs from a sheet</h1>
          <p>Paste the rows of a buyer&apos;s sheet, or your own. Each PO number becomes one order with its styles. Nothing is added until you check it here.</p>
        </div>
      </div>
      {o.buyers.length === 0 ? (
        <div className="empty"><b>No buyers yet</b>Add buyers first in <Link href="/buyers" className="link">Buyers</Link>.</div>
      ) : (
        <SheetImport buyers={o.buyers} factories={o.factories.map((f) => ({ id: f.id, name: f.name, label: f.label }))} team={o.team} meId={o.meId} />
      )}
    </>
  );
}
