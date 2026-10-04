"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip, Problems } from "@/components/bits";
import { useFeedback } from "@/components/feedback";
import { type Condition, CONDITION_LABEL, fromLocalInput, money, nf, num, toLocalInput } from "@/lib/model";
import { deleteGrn, type GrnInput, saveGrn } from "./actions";

// Read the clock only when a button is pressed.
const nowMs = () => Date.now();

export type GrnOrderOption = {
  id: string; label: string; factory: string; currency: string;
  styles: { id: string; name: string; code: string; colour: string; ordered: number; received: number; rate: number }[];
};
type Lines = Record<string, { qty: string; condition: Condition }>;

export function GrnForm({ id, orders, people, isOwner, initial }: {
  id: string | null; orders: GrnOrderOption[]; people: { id: string; label: string }[]; isOwner: boolean;
  initial: { so_id: string; received_at: string; received_by: string; qc_checked: boolean; qc_note: string; notes: string; lines: Lines };
}) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [f, setF] = useState({ ...initial, received_at: toLocalInput(initial.received_at) });
  const [problems, setProblems] = useState<{ E: string[]; W: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const o = orders.find((x) => x.id === f.so_id);
  const line = (sid: string) => f.lines[sid] ?? { qty: "", condition: "good" as Condition };
  const setLine = (sid: string, patch: Partial<Lines[string]>) => setF({ ...f, lines: { ...f.lines, [sid]: { ...line(sid), ...patch } } });
  const units = o ? o.styles.reduce((a, s) => a + num(line(s.id).qty), 0) : 0;
  const value = o ? o.styles.reduce((a, s) => a + num(line(s.id).qty) * s.rate, 0) : 0;

  const validate = (submit: boolean) => {
    const E: string[] = [];
    const W: string[] = [];
    if (!f.so_id) E.push("Choose the sales order the goods are against.");
    const at = Date.parse(fromLocalInput(f.received_at));
    if (!f.received_at || !Number.isFinite(at)) E.push("Set the date and time the goods arrived.");
    else if (at > nowMs() + 5 * 60e3) E.push("Received time can't be in the future.");
    if (submit && !f.received_by) E.push("Choose who received the goods.");
    let any = false;
    o?.styles.forEach((s) => {
      const l = line(s.id);
      const q = num(l.qty);
      if (q < 0) E.push(`${s.name} (${s.colour}): quantity can't be negative.`);
      if (q > 0) any = true;
      if (q > 0 && s.received + q > s.ordered) E.push(`${s.name} (${s.colour}): ${nf(s.received + q)} received is more than the ${nf(s.ordered)} ordered. Overshipping isn't allowed.`);
      if (q > 0 && l.condition !== "good") W.push(`${s.name} (${s.colour}) marked ${CONDITION_LABEL[l.condition]}. Add details in notes.`);
    });
    if (o && submit && !any) E.push("Enter the received quantity for at least one style.");
    if (submit && !f.qc_checked) W.push("QC not confirmed. This GRN will be flagged as a risk.");
    return { E, W };
  };

  const save = async (status: GrnInput["status"]) => {
    const r = validate(status !== "draft");
    setProblems(r);
    if (r.E.length) {
      toast(`${r.E.length} thing${r.E.length > 1 ? "s" : ""} to fix`, "bad");
      window.scrollTo(0, 0);
      return;
    }
    if (status === "approved" && !(await confirm("Save and approve this GRN? Quantities can't change after this.", "Approve"))) return;
    setBusy(true);
    const res = await saveGrn({
      id, so_id: f.so_id, received_at: fromLocalInput(f.received_at), received_by: f.received_by, qc_checked: f.qc_checked,
      qc_note: f.qc_note, notes: f.notes, status,
      lines: (o?.styles ?? []).map((s) => ({ style_id: s.id, qty: line(s.id).qty, condition: line(s.id).condition })),
    });
    setBusy(false);
    if (res.error) {
      setProblems({ E: [res.error], W: r.W });
      toast(res.error, "bad");
      window.scrollTo(0, 0);
      return;
    }
    toast(res.ok ?? "Saved");
    if (res.id && res.id !== id) router.replace(`/grn/${res.id}`);
    else router.refresh();
  };

  const remove = async () => {
    if (!id || !(await confirm(`Delete draft ${id}? This can't be undone.`, "Delete draft", true))) return;
    setBusy(true);
    const r = await deleteGrn(id);
    setBusy(false);
    toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
    if (r.ok) router.push("/grn");
  };

  return (
    <div className="stack">
      <div className="crumbs">Warehouse › <Link className="link" href="/grn">GRN</Link> › {id ?? "New"}</div>
      <div className="head">
        <div className="grow">
          <h1>{id ? `GRN ${id}` : "Create GRN"} <Chip status="draft" /></h1>
          <p>The 24-hour dispatch clock starts from the received time.</p>
        </div>
      </div>
      {problems && <Problems errors={problems.E} warnings={problems.W} />}
      <section className="panel">
        <div className="fgrid">
          <label className="field"><span>Sales order <i>*</i></span>
            <select className="inp" value={f.so_id} onChange={(e) => setF({ ...f, so_id: e.target.value, lines: {} })}>
              <option value="">Select locked sales order…</option>
              {orders.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            {!orders.length && <small>No locked sales orders are waiting for goods.</small>}
          </label>
          <label className="field"><span>Received at <i>*</i></span>
            <input type="datetime-local" className="inp" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} />
          </label>
          <label className="field"><span>Received by <i>*</i></span>
            <select className="inp" value={f.received_by} onChange={(e) => setF({ ...f, received_by: e.target.value })}>
              <option value="">Select…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <div className="field"><span>Vendor (factory)</span><b style={{ padding: "8px 0" }}>{o?.factory ?? "—"}</b></div>
        </div>
      </section>
      {o ? (
        <section className="panel">
          <h3>Items received</h3>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Style</th><th>Colour</th><th>Ordered</th><th>Already received</th><th>Receiving now</th><th>Condition</th></tr></thead>
              <tbody>
                {o.styles.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.name}</b><br /><span className="code text-muted">{s.code}</span></td>
                    <td>{s.colour}</td>
                    <td className="num">{nf(s.ordered)}</td>
                    <td className="num">{nf(s.received)}</td>
                    <td>
                      <input
                        type="number" min={0} inputMode="numeric" className="inp" value={line(s.id).qty}
                        placeholder={String(Math.max(0, s.ordered - s.received))}
                        aria-label={`Quantity received for ${s.name}`} onChange={(e) => setLine(s.id, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <select className="inp" value={line(s.id).condition} aria-label="Condition" onChange={(e) => setLine(s.id, { condition: e.target.value as Condition })}>
                        {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row mt-2">
            <p className="grow text-xs text-muted">{nf(units)} units · {money(value, o.currency)}</p>
            <button type="button" className="btn sm" onClick={() => setF({ ...f, lines: Object.fromEntries(o.styles.map((s) => [s.id, { qty: String(Math.max(0, s.ordered - s.received)), condition: line(s.id).condition }])) })}>
              Fill remaining quantities
            </button>
          </div>
        </section>
      ) : (
        <div className="empty"><b>Choose a sales order</b>Its styles load here so you can enter what arrived.</div>
      )}
      <section className="panel">
        <div className="stack">
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={f.qc_checked} onChange={(e) => setF({ ...f, qc_checked: e.target.checked })} /> QC inspection done and passed for these goods
          </label>
          <label className="field"><span>QC note</span>
            <input className="inp" value={f.qc_note} placeholder="AQL 2.5 passed, 2 pcs minor stain removed" onChange={(e) => setF({ ...f, qc_note: e.target.value })} />
          </label>
          <label className="field"><span>Notes</span>
            <textarea className="inp" rows={2} value={f.notes} placeholder="Cartons, packing condition, shortages" onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
        </div>
      </section>
      <div className="sticky-actions">
        <span className="grow text-xs text-muted">Received goods must leave within 24 hours.</span>
        {id ? <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete draft</button> : <Link className="btn" href="/grn">Cancel</Link>}
        <button type="button" className="btn" disabled={busy} onClick={() => save("draft")}>Save draft</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save("pending_approval")}>Submit for approval</button>
        {isOwner && <button type="button" className="btn dark" disabled={busy} onClick={() => save("approved")}>Save &amp; approve</button>}
      </div>
    </div>
  );
}
