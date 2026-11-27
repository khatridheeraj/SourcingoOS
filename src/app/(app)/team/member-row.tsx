"use client";

import { useState, useTransition } from "react";
import { can, PERMS, type PermKey, type Perms, type Role, ROLES, STAFF_ROLES } from "@/lib/auth-roles";
import type { Member } from "@/lib/data";
import { personName } from "@/lib/names";
import { cancelInvite, updateMember } from "./actions";

export function MemberRow({ member, isMe, whatsapp, factoryName, buyerName }: { member: Member; isMe: boolean; whatsapp: string; factoryName?: string; buyerName?: string }) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  const [phone, setPhone] = useState(whatsapp);
  const staff = member.role !== "factory" && member.role !== "buyer";
  // Each switch as it applies now: the owner's choice for this person, else what their role gets.
  const start0 = Object.fromEntries(PERMS.map((p) => [p.key, can({ role: member.role as Role, perms: member.perms }, p.key)])) as Record<PermKey, boolean>;
  const [perms, setPerms] = useState(start0);
  const switches = staff && member.role !== "owner" && role !== "owner";
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = role !== member.role || active !== member.active || phone.trim() !== whatsapp || PERMS.some((p) => perms[p.key] !== start0[p.key]);

  function save() {
    setMsg(null);
    start(async () => {
      // A switch that matches what the new role gets anyway is stored as "follow the role", so a later role change carries it.
      const next: Perms = {};
      for (const p of PERMS) next[p.key] = perms[p.key] === can({ role: role as Role }, p.key) ? undefined : perms[p.key];
      const res = await updateMember(member.user_id, { role, active, whatsapp: staff ? phone : undefined, perms: switches ? next : undefined });
      if (res.whatsapp !== undefined) setPhone(res.whatsapp);
      setMsg(res.error ? { text: res.error } : { ok: true, text: "Saved" });
    });
  }

  return (
    <tr>
      <td className="font-semibold">{personName(member)}{isMe && <span className="muted font-normal"> (you)</span>}</td>
      <td className="muted">{member.email}</td>
      <td>
        {member.role === "factory" ? <span>Factory · {factoryName ?? "a factory"}</span> : member.role === "buyer" ? <span>Buyer · {buyerName ?? "a buyer"}</span> : (
          <select className="inp min-w-[140px]" value={role} onChange={(e) => setRole(e.target.value)} aria-label={`Role for ${member.email}`}>
            {STAFF_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}
      </td>
      <td>
        {staff ? (
          <input className="inp min-w-[150px]" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210" aria-label={`WhatsApp number for ${member.email}`} />
        ) : <span className="muted">Not needed</span>}
      </td>
      <td>
        <div className="perm-list">
          <label className="row text-[13px]"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Can sign in</label>
          {switches && PERMS.map((p) => (
            <label key={p.key} className="row text-[13px]" title={p.hint}>
              <input type="checkbox" checked={perms[p.key]} onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })} /> {p.label}
            </label>
          ))}
          {(member.role === "owner" || role === "owner") && <span className="text-xs muted">Sees everything</span>}
        </div>
      </td>
      <td className="whitespace-nowrap">
        <button className="btn sm primary" disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
        {msg && <span className={`ml-2 text-xs font-semibold ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
      </td>
    </tr>
  );
}

export function InviteRow({ email, role, factoryName }: { email: string; role: string; factoryName?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <tr>
      <td className="muted">Not signed in yet</td>
      <td>{email}</td>
      <td>{ROLES.find((r) => r.value === role)?.label}{factoryName && ` · ${factoryName}`}</td>
      <td className="muted">After they sign in</td>
      <td><span className="chip warn">Waiting</span></td>
      <td>
        <button className="btn sm danger" disabled={pending} onClick={() => start(async () => setError((await cancelInvite(email)).error ?? ""))}>Remove</button>
        {error && <span className="ml-2 text-xs font-semibold text-bad">{error}</span>}
      </td>
    </tr>
  );
}
