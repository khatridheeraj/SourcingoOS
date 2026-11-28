import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, canEditOrders, getMe } from "@/lib/auth";
import { paperKinds, profileScore } from "@/lib/buyer-profile";
import { loadBuyerFiles } from "@/lib/buyer-profile-load";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { BuyerPapers } from "@/components/buyer-profile-form";
import { addBuyerDoc, removeBuyerDoc, saveBuyerProfile } from "../profile-actions";
import { BuyerStatus } from "./buyer-status";
import { DetailsArea } from "./details-area";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One buyer's record: how complete it is, its details and its papers. Taken when the buyer is added, so invoices,
// export papers and shipments never wait on them. Needs Buyer details (docs/ACCESS.md).
export default async function BuyerPage({ params, searchParams }: PageProps<"/buyers/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  if (!UUID.test(id)) notFound();
  if (!can(me, "buyers")) redirect("/buyers");
  const supabase = await createClient();
  const [{ data: b }, { data: n }, files, { count: open }] = await Promise.all([
    supabase.from("buyers").select("id, code, active").eq("company_id", me?.companyId ?? "").eq("id", id).maybeSingle(),
    supabase.from("buyer_names").select("real_name").eq("buyer_id", id).maybeSingle(),
    loadBuyerFiles(supabase, [id]),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", id).eq("status", "open"),
  ]);
  if (!b) notFound();
  const f = files.get(id)!;
  const name = n?.real_name || b.code;
  const s = profileScore(f.profile, f.basics, f.docs);
  const paths = f.docs.map((d) => d.path);
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const urls = Object.fromEntries((signed ?? []).filter((x) => x.signedUrl && x.path).map((x) => [x.path!, x.signedUrl as string]));
  const main = f.profile.contacts.find((c) => c.whatsapp || c.phone) ?? null;
  const editing = sp.edit === "1" || f.profile.updated_at == null;

  return (
    <>
      <div className="head">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/buyers">Buyers</Link></nav>
          <h1>{name}</h1>
          <p><span className="code">{b.code}</span> · {open ?? 0} open {open === 1 ? "order" : "orders"}{f.profile.legal_name && f.profile.legal_name !== name ? ` · ${f.profile.legal_name}` : ""}</p>
        </div>
        <div className="row">
          <Link className="btn" href={`/buyers/${id}/people`}>People</Link>
          <Link className="btn" href={`/preview/buyer/${id}`}>See their page</Link>
        </div>
      </div>

      <BuyerStatus buyerId={id} buyer={name} done={s.done} total={s.total} ready={s.ready} missing={s.missing} optional={s.optional}
        asked={f.profile.asked_at} filled={f.profile.buyer_filled_at} canAsk={me?.role !== "accounts" && b.active}
        phone={main?.whatsapp || main?.phone || null} email={f.profile.contacts.find((c) => c.email)?.email ?? null} />

      <section className="panel" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <DetailsArea profile={f.profile} basics={f.basics} missing={s.missing.map((i) => i.key)} startEditing={editing}
          save={saveBuyerProfile.bind(null, id)} />
      </section>

      <section className="panel" aria-labelledby="papers-h">
        <h2 id="papers-h">Papers</h2>
        <BuyerPapers folder={`${me?.companyId}/buyer-files/${id}`} docs={f.docs} urls={urls} kinds={paperKinds(f.profile.country)}
          add={addBuyerDoc.bind(null, id)} remove={removeBuyerDoc.bind(null, id)} removable="all" />
      </section>
    </>
  );
}
