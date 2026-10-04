"use client";

import { useState, useTransition } from "react";
import { ROLES } from "@/lib/auth-roles";
import type { Member } from "@/lib/data";
import { personName } from "@/lib/names";
import { cancelInvite, updateMember } from "./actions";

export function MemberRow({ member, isMe }: { member: Member; isMe: boolean }) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = role !== member.role || active !== member.active;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateMember(member.user_id, { role, active });
      setMsg(res.error ? { text: res.error } : { ok: true, text: "Saved" });
    });
  }

  return (
    <tr>
      <td className="font-semibold">{personName(member)}{isMe && <span className="muted font-normal"> (you)</span>}</td>
      <td className="muted">{member.email}</td>
      <td>
        <select className="inp min-w-[140px]" value={role} onChange={(e) => setRole(e.target.value)} aria-label={`Role for ${member.email}`}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </td>
      <td>
        <label className="row text-[13px]"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Can sign in</label>
      </td>
      <td className="whitespace-nowrap">
        <button className="btn sm primary" disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
        {msg && <span className={`ml-2 text-xs font-semibold ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
      </td>
    </tr>
  );
}

export function InviteRow({ email, role }: { email: string; role: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <tr>
      <td className="muted">Not signed in yet</td>
      <td>{email}</td>
      <td>{ROLES.find((r) => r.value === role)?.label}</td>
      <td><span className="chip warn">Waiting</span></td>
      <td>
        <button className="btn sm danger" disabled={pending} onClick={() => start(async () => setError((await cancelInvite(email)).error ?? ""))}>Remove</button>
        {error && <span className="ml-2 text-xs font-semibold text-bad">{error}</span>}
      </td>
    </tr>
  );
}
