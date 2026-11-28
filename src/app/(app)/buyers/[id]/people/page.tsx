import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { istDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { People, type Person } from "./people";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The people at a buyer who follow its orders, each with their own link.
export default async function BuyerPeoplePage({ params }: PageProps<"/buyers/[id]/people">) {
  const { id } = await params;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: b }, { data: n }, { data: rows }] = await Promise.all([
    supabase.from("buyers").select("id, code, active").eq("company_id", me?.companyId ?? "").eq("id", id).maybeSingle(),
    supabase.from("buyer_names").select("real_name").eq("buyer_id", id).maybeSingle(),
    supabase.from("buyer_people").select("id, name, job, phone, email, created_at, stopped_at").eq("buyer_id", id).order("stopped_at", { nullsFirst: true }).order("created_at"),
  ]);
  if (!b) notFound();
  const name = n?.real_name || b.code;
  const people: Person[] = (rows ?? []).map((r) => ({ id: r.id, name: r.name, job: r.job, phone: r.phone, email: r.email, stopped: !!r.stopped_at, added: istDate(r.created_at) }));

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/buyers">Buyers</Link></nav>
          <h1>{name}&apos;s people</h1>
          <p>Everyone at {name} who follows orders gets their own link, so each message shows who wrote it.</p>
        </div>
        <Link className="btn" href={`/preview/buyer/${b.id}`}>See their page</Link>
      </div>
      {b.active ? <People buyerId={b.id} buyer={name} people={people} /> : (
        <div className="empty"><b>{name} is switched off</b>Switch the buyer back on in Buyers to give its people links.</div>
      )}
    </>
  );
}
