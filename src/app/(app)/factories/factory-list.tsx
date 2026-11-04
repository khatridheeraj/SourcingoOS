"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import type { Factory } from "@/lib/data";
import { saveFactory, type FactoryInput } from "./actions";
import { checkFactory } from "./check";
import { FactoryLink } from "./factory-link";

const blank: FactoryInput = { name: "", city: "", contact_name: "", phone: "", notes: "", active: true, address: "", gstin: "", email: "" };
type Bad = { field?: keyof FactoryInput; msg: string } | null;

export function FactoryList({ factories, openStyles }: { factories: Factory[]; openStyles: Record<string, number> }) {
  const [editing, setEditing] = useState<FactoryInput | null>(null);
  const [bad, setBad] = useState<Bad>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  // Where keyboard focus goes once the form closes: the saved factory's Edit button, or Add factory.
  const back = useRef<string | null>(null);

  // The form opens above the list; a factory far down the list would otherwise open it off screen.
  const open = (f: FactoryInput) => { setBad(null); setEditing(f); requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "start" })); };
  const close = (to: string) => { setEditing(null); setBad(null); back.current = to; };
  useEffect(() => {
    if (!back.current || editing) return;
    const name = back.current;
    back.current = null;
    const el = document.querySelector<HTMLElement>(`[data-edit="${CSS.escape(name)}"]`) ?? document.querySelector<HTMLElement>("[data-add-factory]");
    el?.focus({ preventScroll: true });
  }, [editing]);

  function point(field?: keyof FactoryInput) {
    const el = field && formRef.current?.elements.namedItem(field);
    if (el instanceof HTMLElement) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center" }); }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const wrong = checkFactory(editing);
    if (wrong) { setBad({ field: wrong.field, msg: wrong.error }); return point(wrong.field); }
    setBad(null);
    const f = editing;
    start(async () => {
      const res = await saveFactory(f);
      if (res.error) { setBad({ field: res.field, msg: res.error }); point(res.field); return; }
      const name = f.name.trim().replace(/\s+/g, " ");
      toast(f.id ? `${name} saved.` : `${name} added.`);
      close(f.id ?? name);
    });
  }

  const set = (k: keyof FactoryInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!editing) return;
    const v = k === "active" ? (e.target as HTMLInputElement).checked : k === "gstin" ? e.target.value.replace(/\s+/g, "").toUpperCase() : e.target.value;
    setEditing({ ...editing, [k]: v });
    setBad((x) => (x?.field === k ? null : x));
  };
  const at = (k: keyof FactoryInput) => ({ name: k, "aria-invalid": bad?.field === k || undefined });
  const err = (k: keyof FactoryInput) => bad?.field === k ? <small className="text-bad" role="alert">{bad.msg}</small> : null;

  return (
    <div className="stack">
      {!editing && <div><button className="btn primary" data-add-factory onClick={() => open(blank)}>Add factory</button></div>}
      {editing && (
        <form ref={formRef} onSubmit={submit} className="panel stack scroll-mt-20" noValidate>
          <h2 className="font-bold">{editing.id ? `Edit ${editing.name}` : "Add factory"}</h2>
          <div className="fgrid">
            <label className="field"><span>Name <i>*</i></span><input className="inp" value={editing.name} onChange={set("name")} required autoFocus {...at("name")} />{err("name")}</label>
            <label className="field"><span>City</span><input className="inp" value={editing.city} onChange={set("city")} /></label>
            <label className="field"><span>Contact person</span><input className="inp" value={editing.contact_name} onChange={set("contact_name")} /></label>
            <label className="field"><span>Phone</span><input className="inp" type="tel" value={editing.phone} onChange={set("phone")} /></label>
            <label className="field"><span>Email</span><input className="inp" type="email" value={editing.email} onChange={set("email")} {...at("email")} />{err("email")}</label>
            <label className="field"><span>GSTIN</span><input className="inp code" maxLength={24} value={editing.gstin} onChange={set("gstin")} placeholder="08ABCDE1234F1Z5" autoCapitalize="characters" {...at("gstin")} />{err("gstin")}</label>
            <label className="field sm:col-span-2"><span>Address (printed on its POs)</span><textarea className="inp" rows={2} maxLength={500} value={editing.address} onChange={set("address")} /></label>
            <label className="field"><span>Notes</span><input className="inp" value={editing.notes} onChange={set("notes")} /></label>
          </div>
          <label className="row text-[13px]"><input type="checkbox" checked={editing.active} onChange={set("active")} /> Active (shows when entering orders)</label>
          {bad && !bad.field && <div className="errbox" role="alert">{bad.msg}</div>}
          <div className="row">
            <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" className="btn" onClick={() => close(editing.id ?? "add")}>Cancel</button>
          </div>
        </form>
      )}

      {factories.length === 0 ? (
        <div className="empty"><b>No factories yet</b>Add your factories, or send Claude the confirmed list.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl stack">
            <thead><tr><th>Name</th><th>City</th><th>Contact</th><th>Phone</th><th className="r">Open styles</th><th></th><th></th></tr></thead>
            <tbody>
              {factories.map((f) => (
                <tr key={f.id}>
                  <td className="font-semibold">{f.name}</td>
                  <td>{f.city}</td>
                  <td data-label={f.contact_name ? "Contact" : undefined}>{f.contact_name}</td>
                  <td>{f.phone && <a className="link" href={`tel:${f.phone}`}>{f.phone}</a>}</td>
                  <td className="r num" data-label="Open styles">{openStyles[f.id] ?? 0}</td>
                  <td>{!f.active && <span className="chip">Inactive</span>}</td>
                  <td className="r">
                    <div className="row justify-end flex-nowrap">
                    {f.active && <FactoryLink factoryId={f.id} name={f.name} phone={f.phone} />}
                    <button className="btn sm" data-edit={f.id} onClick={() => { open({ id: f.id, name: f.name, city: f.city ?? "", contact_name: f.contact_name ?? "", phone: f.phone ?? "", notes: f.notes ?? "", active: f.active, address: f.address ?? "", gstin: f.gstin ?? "", email: f.email ?? "" }); }}>Edit</button>
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
