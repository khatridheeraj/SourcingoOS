import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { isOps } from "@/lib/roles";
import { NewOrderForm } from "./new-order-form";

export const metadata = { title: "New sales order · Sourcingo OS" };

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/orders");
  const sp = await searchParams;
  const { world: w } = await loadWorld();
  const buyers = w.buyers.map((b) => ({ id: b.id, label: b.real_name ? `${b.code} · ${b.real_name}` : b.code }));
  const inquiries = w.inquiries
    .filter((i) => (i.status === "new" || i.status === "quoted") && !i.so_id)
    .map((i) => ({ id: i.id, buyer_id: i.buyer_id, label: `${i.id} · ${i.product_type}`, fabric: i.unit === "m" }));
  const pick = inquiries.find((i) => i.id === sp.inquiry);

  return (
    <>
      <Head crumbs="Sales › Sales orders › New" title="New sales order" sub="Start with the buyer and their PO number. You'll add styles, quantities and the TNA next." />
      <section className="panel max-w-3xl">
        <NewOrderForm buyers={buyers} inquiries={inquiries} initial={{ inquiry_id: pick?.id ?? "", buyer_id: pick?.buyer_id ?? String(sp.buyer ?? ""), fabric: !!pick?.fabric }} />
      </section>
    </>
  );
}
