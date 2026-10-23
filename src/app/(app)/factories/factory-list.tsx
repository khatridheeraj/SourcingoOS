"use client";

import { useState, useTransition } from "react";
import type { Factory } from "@/lib/data";
import { saveFactory, type FactoryInput } from "./actions";
import { FactoryLink } from "./factory-link";

const blank: FactoryInput = { name: "", city: "", contact_name: "", phone: "", notes: "", active: true, address: "", gstin: "", email: "" };

export function FactoryList({ factories, openStyles }: { factories: Factory[]; openStyles: Record<string, number> }) {
  const [editing, setEditing] = useState<FactoryInput | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError("");
    start(async () => {
      const res = await saveFactory(editing);
      if (res.error) setError(res.error);
      else setEditing(null);
    });
  }

  const set = (k: keyof FactoryInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    editing && setEditing({ ...editing, [k]: k === "active" ? (e.target as HTMLInputElement).checked : k === "gstin" ? e.target.value.toUpperCase() : e.target.value });

  return (
    <div className="stack">
      {!editing && <div><button className="btn primary" onClick={() => { setEditing(blank); setError(""); }}>Add factory</button></div>}
      {editing && (
        <form onSubmit={submit} className="panel stack">
          <h2 className="font-bold">{editing.id ? `Edit ${editing.name}` : "Add factory"}</h2>
          <div className="fgrid">
            <label className="field"><span>Name <i>*</i></span><input className="inp" value={editing.name} onChange={set("name")} required autoFocus /></label>
            <label className="field"><span>City</span><input className="inp" value={editing.city} onChange={set("city")} /></label>
            <label className="field"><span>Contact person</span><input className="inp" value={editing.contact_name} onChange={set("contact_name")} /></label>
            <label className="field"><span>Phone</span><input className="inp" type="tel" value={editing.phone} onChange={set("phone")} /></label>
            <label className="field"><span>Email</span><input className="inp" type="email" value={editing.email} onChange={set("email")} /></label>
            <label className="field"><span>GSTIN</span><input className="inp" maxLength={15} value={editing.gstin} onChange={set("gstin")} placeholder="08ABCDE1234F1Z5" /></label>
            <label className="field sm:col-span-2"><span>Address (printed on its POs)</span><textarea className="inp" rows={2} maxLength={500} value={editing.address} onChange={set("address")} /></label>
            <label className="field"><span>Notes</span><input className="inp" value={editing.notes} onChange={set("notes")} /></label>
          </div>
          <label className="row text-[13px]"><input type="checkbox" checked={editing.active} onChange={set("active")} /> Active (shows when entering orders)</label>
          {error && <div className="errbox" role="alert">{error}</div>}
          <div className="row">
            <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {factories.length === 0 ? (
        <div className="empty"><b>No factories yet</b>Add your factories, or send Claude the confirmed list.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>City</th><th>Contact</th><th>Phone</th><th className="r">Open styles</th><th></th><th></th></tr></thead>
            <tbody>
              {factories.map((f) => (
                <tr key={f.id}>
                  <td className="font-semibold">{f.name}</td>
                  <td>{f.city}</td>
                  <td>{f.contact_name}</td>
                  <td>{f.phone && <a className="link" href={`tel:${f.phone}`}>{f.phone}</a>}</td>
                  <td className="r num">{openStyles[f.id] ?? 0}</td>
                  <td>{!f.active && <span className="chip">Inactive</span>}</td>
                  <td className="r">
                    <div className="row justify-end flex-nowrap">
                    {f.active && <FactoryLink factoryId={f.id} name={f.name} phone={f.phone} />}
                    <button className="btn sm" onClick={() => { setError(""); setEditing({ id: f.id, name: f.name, city: f.city ?? "", contact_name: f.contact_name ?? "", phone: f.phone ?? "", notes: f.notes ?? "", active: f.active, address: f.address ?? "", gstin: f.gstin ?? "", email: f.email ?? "" }); }}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
