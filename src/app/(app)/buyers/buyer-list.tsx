"use client";

import { useState, useTransition } from "react";
import type { Buyer } from "@/lib/data";
import { saveBuyer, type BuyerInput } from "./actions";

const blank: BuyerInput = { code: "", realName: "", city: "", notes: "", active: true };

export function BuyerList({ buyers, owner, openOrders }: { buyers: Buyer[]; owner: boolean; openOrders: Record<string, number> }) {
  const [editing, setEditing] = useState<BuyerInput | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError("");
    start(async () => {
      const res = await saveBuyer(editing);
      if (res.error) setError(res.error);
      else setEditing(null);
    });
  }

  const set = (k: keyof BuyerInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    editing && setEditing({ ...editing, [k]: k === "active" ? e.target.checked : e.target.value });

  return (
    <div className="stack">
      {owner && !editing && (
        <div><button className="btn primary" onClick={() => { setEditing(blank); setError(""); }}>Add buyer</button></div>
      )}
      {editing && (
        <form onSubmit={submit} className="panel stack">
          <h2 className="font-bold">{editing.id ? `Edit ${editing.code}` : "Add buyer"}</h2>
          <div className="fgrid">
            <label className="field"><span>Code <i>*</i></span>
              <input className="inp code" value={editing.code} onChange={set("code")} placeholder="BYR-OZ" required autoFocus />
              <small>What the team sees.</small>
            </label>
            <label className="field"><span>Real name <i>*</i></span>
              <input className="inp" value={editing.realName} onChange={set("realName")} required />
              <small>Only you see this.</small>
            </label>
            <label className="field"><span>City</span><input className="inp" value={editing.city} onChange={set("city")} /></label>
            <label className="field"><span>Notes</span><input className="inp" value={editing.notes} onChange={set("notes")} /></label>
          </div>
          <label className="row text-[13px]"><input type="checkbox" checked={editing.active} onChange={set("active")} /> Active (shows when entering new orders)</label>
          {error && <div className="errbox" role="alert">{error}</div>}
          <div className="row">
            <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {buyers.length === 0 ? (
        <div className="empty"><b>No buyers yet</b>{owner ? "Add your buyers, or send Claude the confirmed list." : "The owner adds buyers."}</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Code</th>{owner && <th>Real name</th>}<th>City</th><th className="r">Open orders</th><th>Notes</th><th></th>{owner && <th></th>}</tr></thead>
            <tbody>
              {buyers.map((b) => (
                <tr key={b.id}>
                  <td className="code font-semibold">{b.code}</td>
                  {owner && <td>{b.realName}</td>}
                  <td>{b.city}</td>
                  <td className="r num">{openOrders[b.id] ?? 0}</td>
                  <td className="muted">{b.notes}</td>
                  <td>{!b.active && <span className="chip">Inactive</span>}</td>
                  {owner && (
                    <td className="r">
                      <button className="btn sm" onClick={() => { setError(""); setEditing({ id: b.id, code: b.code, realName: b.realName ?? "", city: b.city ?? "", notes: b.notes ?? "", active: b.active }); }}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
