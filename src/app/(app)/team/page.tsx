import { redirect } from "next/navigation";
import { getMe, ROLES } from "@/lib/auth";
import { loadInvites, loadTeam } from "@/lib/data";
import { AddPerson } from "./add-person";
import { InviteRow, MemberRow } from "./member-row";

export default async function TeamPage() {
  const me = await getMe();
  if (me?.role !== "owner") redirect("/");
  const [team, invites] = await Promise.all([loadTeam(), loadInvites()]);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Team</h1>
          <p>Add people by their email. They sign in at this site with that email and get a link, no password needed.</p>
        </div>
      </div>
      <AddPerson />
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th></th></tr></thead>
          <tbody>
            {team.map((m) => <MemberRow key={m.user_id} member={m} isMe={m.user_id === me.id} />)}
            {invites.map((i) => <InviteRow key={i.email} email={i.email} role={i.role} />)}
          </tbody>
        </table>
      </div>
      <ul className="muted text-[13px]">
        {ROLES.map((r) => <li key={r.value}><b>{r.label}:</b> {r.hint}</li>)}
      </ul>
    </>
  );
}
