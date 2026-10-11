import { redirect } from "next/navigation";
import { getMe, ROLES } from "@/lib/auth";
import { loadFactories, loadInvites, loadTeam } from "@/lib/data";
import { AddPerson } from "./add-person";
import { InviteRow, MemberRow } from "./member-row";

export default async function TeamPage() {
  const me = await getMe();
  if (me?.role !== "owner") redirect("/");
  const [team, invites, factories] = await Promise.all([loadTeam(), loadInvites(), loadFactories()]);
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Team</h1>
          <p>Add people by their email. They sign in at this site with that email and get a link, no password needed.</p>
        </div>
      </div>
      <AddPerson factories={factories.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name }))} />
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th></th></tr></thead>
          <tbody>
            {team.map((m) => <MemberRow key={m.user_id} member={m} isMe={m.user_id === me.id} factoryName={m.factory_id ? factoryName.get(m.factory_id) : undefined} />)}
            {invites.map((i) => <InviteRow key={i.email} email={i.email} role={i.role} factoryName={i.factory_id ? factoryName.get(i.factory_id) : undefined} />)}
          </tbody>
        </table>
      </div>
      <ul className="muted text-[13px]">
        {ROLES.map((r) => <li key={r.value}><b>{r.label}:</b> {r.hint}</li>)}
      </ul>
    </>
  );
}
