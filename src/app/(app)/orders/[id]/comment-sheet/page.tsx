import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canRecordQc, getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CommentSheetForm, type SheetStyle } from "./comment-sheet-form";

// Quality writes a sample comment sheet for one style of the order: the points in plain words, formatted into
// area / observation / correction, saved as a QC check with the PDF, and downloaded to send to the factory.
export default async function CommentSheetPage({ params, searchParams }: PageProps<"/orders/[id]/comment-sheet">) {
  const { id } = await params;
  const { line } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canRecordQc(me?.role) || !me?.companyId) redirect(`/orders/${id}`);
  const supabase = await createClient();
  const { data: o } = await supabase.from("orders")
    .select("id, order_no, buyer_id, status, order_lines(id, style, colour, qty, factory_id, position, product)")
    .eq("id", id).is("order_lines.removed_at", null).maybeSingle();
  if (!o) notFound();
  const lines = (o.order_lines ?? []) as { id: string; style: string; colour: string | null; qty: number; factory_id: string | null; position: number; product: string }[];
  const factoryIds = [...new Set(lines.map((l) => l.factory_id).filter((x): x is string => !!x))];
  const [{ data: b }, { data: fs }] = await Promise.all([
    supabase.from("buyers").select("code").eq("id", o.buyer_id).maybeSingle(),
    factoryIds.length ? supabase.from("factories").select("id, name").in("id", factoryIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const factoryName = new Map((fs ?? []).map((f) => [f.id, f.name]));
  const styles: SheetStyle[] = lines.filter((l) => l.product !== "fabric").sort((a, z) => a.position - z.position)
    .map((l) => ({ id: l.id, style: l.style, colour: l.colour ?? "", factory: l.factory_id ? factoryName.get(l.factory_id) ?? "" : "" }));
  const startLine = typeof line === "string" && styles.some((s) => s.id === line) ? line : styles[0]?.id ?? "";

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href={`/orders/${o.id}#qc`}>{o.order_no}</Link><span aria-hidden>/</span><span>Comment sheet</span></nav>
          <h1>Sample comment sheet</h1>
          <p>Write the points as you would say them. The sheet is saved as a QC check on the style, and the PDF downloads to send to the factory.</p>
        </div>
      </div>
      {o.status !== "open" ? (
        <p className="warnbox">This order is {o.status}. Comment sheets are written on open orders.</p>
      ) : styles.length === 0 ? (
        <p className="warnbox">This order has no garment styles to write a sheet for.</p>
      ) : (
        <CommentSheetForm orderId={o.id} orderNo={o.order_no} companyId={me.companyId} buyer={b?.code ?? ""} styles={styles} startLine={startLine}
          today={todayIST()} checkedBy={me.fullName || me.email} />
      )}
    </>
  );
}
