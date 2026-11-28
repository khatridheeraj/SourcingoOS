import { redirect } from "next/navigation";
import { getMe, ROLES } from "@/lib/auth";
import { PERMS } from "@/lib/auth-roles";
import { buyerName, loadBuyers, loadFactories, loadInvites, loadTeam } from "@/lib/data";
import { AddPerson } from "./add-person";
import { InviteRow, MemberRow } from "./member-row";
import { createClient } from "@/lib/supabase/server";
import { TeamTabs } from "./team-tabs";
import "@/components/ops.css";

export default async function TeamPage() {
  const me = await getMe();
  if (me?.role !== "owner") redirect("/");
  const supabase = await createClient();
  const [team, invites, factories, buyers, { data: phones }] = await Promise.all([loadTeam(), loadInvites(), loadFactories(), loadBuyers(),
    supabase.from("team_whatsapp").select("user_id, number").eq("company_id", me.companyId!)]);
  const phoneOf = new Map((phones ?? []).map((p) => [p.user_id as string, (p.number as string | null) ?? ""]));
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Team</h1>
          <p>Add people by their email. They sign in at this site with that email and get a link, no password needed.</p>
        </div>
      </div>
      <TeamTabs at="people" />
      <AddPerson factories={factories.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name }))}
        buyers={buyers.filter((b) => b.active).map((b) => ({ id: b.id, name: buyerName(b) }))} />
      <div className="table-wrap">
        <table className="tbl stack">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>WhatsApp</th><th>Access</th><th></th></tr></thead>
          <tbody>
            {team.map((m) => <MemberRow key={m.user_id} member={m} isMe={m.user_id === me.id} whatsapp={phoneOf.get(m.user_id) ?? ""} factoryName={m.factory_id ? factoryName.get(m.factory_id) : undefined}
              buyerName={m.buyer_id ? buyerOf.get(m.buyer_id) : undefined} />)}
            {invites.map((i) => <InviteRow key={i.email} email={i.email} role={i.role} factoryName={i.factory_id ? factoryName.get(i.factory_id) : i.buyer_id ? buyerOf.get(i.buyer_id) : undefined} />)}
          </tbody>
        </table>
      </div>
      <details className="howto">
        <summary>What each role and switch means</summary>
        <ul className="muted text-[13px]">
          {ROLES.map((r) => <li key={r.value}><b>{r.label}:</b> {r.hint}</li>)}
          {PERMS.map((p) => <li key={p.key}><b>{p.label}:</b> {p.hint}. {p.key === "buyers"
            ? "Owner, Manager, Merchandiser and Accounts have it unless you switch it off. Switch it off for an assistant merchandiser."
            : "Owner and Accounts have it unless you switch it off; tick it to give it to anyone else."}</li>)}
        </ul>
      </details>
    </>
  );
}
