"use client";

import { useState, useTransition } from "react";
import { ROLES } from "@/lib/auth-roles";
import { addPerson } from "./actions";

export function AddPerson() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("merchandiser");
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await addPerson(email, role);
      if (res.error) setMsg({ text: res.error });
      else {
        setMsg({ ok: true, text: res.ok ?? "Added." });
        setEmail("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="panel stack">
      <h2 className="font-bold">Add a person</h2>
      <div className="row items-end">
        <label className="field grow min-w-[220px]"><span>Work email</span>
          <input className="inp" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@sourcingo.in" />
        </label>
        <label className="field"><span>Role</span>
          <select className="inp" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button className="btn primary" disabled={pending}>{pending ? "Adding…" : "Add"}</button>
      </div>
      {msg && <div className={msg.ok ? "okbox" : "errbox"} role="status">{msg.text}</div>}
    </form>
  );
}
