import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { isOps } from "@/lib/roles";
import { GrnForm } from "../grn-form";
import { grnOrderOptions, receiverOptions } from "../options";

export const metadata = { title: "Create GRN · Sourcingo OS" };

export default async function NewGrn({ searchParams }: PageProps<"/grn/new">) {
  const me = await getMe();
  if (!me || !isOps(me.role)) redirect("/grn");
  const { so } = await searchParams;
  const { world: w } = await loadWorld();
  const orders = grnOrderOptions(w, null);
  return (
    <GrnForm
      id={null}
      orders={orders}
      people={receiverOptions(w)}
      isOwner={me.role === "owner"}
      initial={{ so_id: orders.some((o) => o.id === so) ? String(so) : "", received_at: new Date(w.now).toISOString(), received_by: me.id, qc_checked: false, qc_note: "", notes: "", lines: {} }}
    />
  );
}
