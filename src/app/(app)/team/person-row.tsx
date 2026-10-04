"use client";

import { useActionState, useState } from "react";
import { ROLES, type Role } from "@/lib/roles";
import { saveProfile, type SaveState } from "./actions";

export type Person = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role | null;
  active: boolean;
  factory_id: string | null;
  buyer_id: string | null;
  created_at: string;
};
type Option = { id: string; label: string };

const input = "rounded-lg border border-line bg-surface px-3 py-2 text-sm";

export function PersonRow({ person, isMe, factories, buyers }: { person: Person; isMe: boolean; factories: Option[]; buyers: Option[] }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveProfile, {});
  const [role, setRole] = useState<string>(person.role ?? "");

  return (
    <form action={action} className="flex flex-col gap-3 border-b border-line py-4 last:border-0">
      <input type="hidden" name="id" value={person.id} />
      <div className="flex flex-wrap items-baseline gap-x-3">
        <b>{person.full_name || person.email}</b>
        {person.full_name && <span className="text-sm text-muted">{person.email}</span>}
        {isMe && <span className="text-sm text-muted">(you)</span>}
        <span className="ml-auto text-xs text-muted">
          Joined {new Date(person.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Role
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={input}>
            <option value="">No role</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {role === "factory" ? (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Factory
            <select name="factory_id" defaultValue={person.factory_id ?? ""} className={input} required>
              <option value="">Select factory…</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        ) : role === "buyer" ? (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Buyer
            <select name="buyer_id" defaultValue={person.buyer_id ?? ""} className={input} required>
              <option value="">Select buyer…</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="self-center text-xs text-muted">{ROLES.find((r) => r.value === role)?.hint}</p>
        )}

        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="active" defaultChecked={person.active} className="size-4" />
          Has access
        </label>
      </div>

      {role === "factory" && !factories.length && <p className="text-sm text-warn">Add the factory first, then link this person to it.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Saving…" : person.active ? "Save" : "Approve"}
        </button>
        {state.error && <p className="text-sm text-bad">{state.error}</p>}
        {state.ok && <p className="text-sm text-muted">{state.ok}</p>}
      </div>
    </form>
  );
}
