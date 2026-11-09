import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BuyerView } from "../../../../buyer/buyer-view";
import { BuyerLink } from "../../../buyers/buyer-link";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// "See what they see": a buyer's own page, exactly as the buyer's link opens it, looked at from inside the app.
// Nothing on it can be pressed, and nobody is signed out.
export default async function BuyerPreviewPage({ params }: PageProps<"/preview/buyer/[id]">) {
  const { id } = await params;
  const me = await getMe();
  if (!me?.companyId) redirect("/login");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: b }, { data: n }] = await Promise.all([
    supabase.from("buyers").select("id, code, active").eq("company_id", me.companyId).eq("id", id).maybeSingle(),
    supabase.from("buyer_names").select("real_name").eq("buyer_id", id).maybeSingle(),
  ]);
  if (!b) notFound();
  const name = n?.real_name || b.code;

  return (
    <>
      <div className="preview-bar">
        <div>
          <span className="eyebrow">See what they see</span>
          <h2>{name}&apos;s page</h2>
          <p>This is exactly what {name} sees when they open their link. Buttons are switched off here.</p>
        </div>
        <div className="preview-acts">
          {canEditOrders(me.role) && b.active && <BuyerLink buyerId={b.id} name={name} size="md" seePage={false} />}
          <Link className="btn" href="/buyers">All buyers</Link>
        </div>
      </div>
      <div className="preview-ro" aria-label={`${name}'s page`}>
        <BuyerView preview={b.id} />
      </div>
    </>
  );
}
