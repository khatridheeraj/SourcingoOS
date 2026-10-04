import { Head } from "@/components/bits";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PersonRow, type Person } from "./person-row";

export const metadata = { title: "People & roles · Sourcingo OS" };

export default async function TeamPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "owner") redirect("/");

  const supabase = await createClient();
  const [people, factories, buyers, registry] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, active, factory_id, buyer_id, created_at").order("created_at"),
    supabase.from("factories").select("id, name, city").eq("active", true).order("name"),
    supabase.from("buyers").select("id, code").order("code"),
    supabase.from("buyer_registry").select("buyer_id, real_name"),
  ]);

  const realName = new Map((registry.data ?? []).map((r) => [r.buyer_id, r.real_name]));
  const factoryOpts = (factories.data ?? []).map((f) => ({ id: f.id, label: f.city ? `${f.name} · ${f.city}` : f.name }));
  const buyerOpts = (buyers.data ?? []).map((b) => ({ id: b.id, label: realName.has(b.id) ? `${b.code} · ${realName.get(b.id)}` : b.code }));

  const all = (people.data ?? []) as Person[];
  const waiting = all.filter((p) => !p.active);
  const active = all.filter((p) => p.active);

  return (
    <>
      <Head crumbs="CRM › People & roles" title="People & roles" sub={<>Anyone can sign up with their email. Nobody sees anything until you give them a role here.</>} />

      {people.error && <p className="warnbox">Couldn&apos;t load people: {people.error.message}</p>}

      <section className="rounded-xl border border-line bg-surface px-5">
        <h2 className="pt-4 font-bold">Waiting for approval ({waiting.length})</h2>
        {waiting.length ? (
          waiting.map((p) => <PersonRow key={p.id} person={p} isMe={p.id === me.id} factories={factoryOpts} buyers={buyerOpts} />)
        ) : (
          <p className="pb-4 text-sm text-muted">Nobody is waiting. Share the sign-in page with your team, factories or buyers.</p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface px-5">
        <h2 className="pt-4 font-bold">With access ({active.length})</h2>
        {active.map((p) => (
          <PersonRow key={p.id} person={p} isMe={p.id === me.id} factories={factoryOpts} buyers={buyerOpts} />
        ))}
      </section>
    </>
  );
}
