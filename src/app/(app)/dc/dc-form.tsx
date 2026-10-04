"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip, Problems } from "@/components/bits";
import { useFeedback } from "@/components/feedback";
import { fromLocalInput, money, nf, num, toLocalInput } from "@/lib/model";
import { type DcInput, deleteDc, saveDc } from "./actions";

// Read the clock only when a button is pressed.
const nowMs = () => Date.now();

export type DcGrnOption = {
  id: string; label: string; receivedAt: string; address: string; currency: string;
  lines: { style_id: string; name: string; code: string; colour: string; avail: number; rate: number }[];
};

export function DcForm({ id, grns, initial }: {
  id: string | null; grns: DcGrnOption[];
  initial: Omit<DcInput, "id" | "lines" | "status"> & { lines: Record<string, string> };
}) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const fresh = !id && !initial.grn_id;
  const [f, setF] = useState({ ...initial, dispatched_at: toLocalInput(initial.dispatched_at) });
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const g = grns.find((x) => x.id === f.grn_id);
  const qty = (sid: string) => f.lines[sid] ?? "";
  const units = g ? g.lines.reduce((a, l) => a + num(qty(l.style_id)), 0) : 0;
  const value = g ? g.lines.reduce((a, l) => a + num(qty(l.style_id)) * l.rate, 0) : 0;

  const pickGrn = (gid: string) => {
    const n = grns.find((x) => x.id === gid);
    setF({ ...f, grn_id: gid, address: f.address || n?.address || "", lines: Object.fromEntries((n?.lines ?? []).map((l) => [l.style_id, String(l.avail)])) });
  };

  const validate = (dispatch: boolean) => {
    const E: string[] = [];
    if (!g) E.push("Choose the GRN you're dispatching from. You can only dispatch goods that have a GRN.");
    let any = false;
    g?.lines.forEach((l) => {
      const q = num(qty(l.style_id));
      if (q < 0) E.push(`${l.name} (${l.colour}): quantity can't be negative.`);
      if (q > 0) any = true;
      if (q > l.avail) E.push(`${l.name} (${l.colour}): only ${nf(l.avail)} available from this GRN.`);
    });
    if (g && !any) E.push("Enter a dispatch quantity for at least one style.");
    if (dispatch) {
      if (!f.courier.trim()) E.push("Enter the courier or transporter name.");
      if (!f.tracking.trim()) E.push("Enter the tracking / LR number.");
      if (!f.address.trim()) E.push("Enter the destination address.");
      if (!f.invoice_no.trim()) E.push("Enter the buyer invoice number. Invoice and dispatch go together.");
      if (!f.invoice_date) E.push("Set the invoice date.");
      const at = Date.parse(fromLocalInput(f.dispatched_at));
      if (!f.dispatched_at || !Number.isFinite(at)) E.push("Set the dispatch date and time.");
      else if (g && at < Date.parse(g.receivedAt)) E.push("Dispatch time can't be before the goods were received.");
      else if (at > nowMs() + 5 * 60e3) E.push("Dispatch time can't be in the future.");
    }
    return E;
  };

  const save = async (status: DcInput["status"]) => {
    const E = validate(status === "dispatched");
    setProblems(E);
    if (E.length) {
      toast(`${E.length} thing${E.length > 1 ? "s" : ""} to fix`, "bad");
      window.scrollTo(0, 0);
      return;
    }
    if (status === "dispatched" && !(await confirm(`Mark as dispatched via ${f.courier} (${f.tracking})? This can't be undone.`, "Mark dispatched"))) return;
    setBusy(true);
    const r = await saveDc({
      ...f, id, status, dispatched_at: fromLocalInput(f.dispatched_at),
      lines: (g?.lines ?? []).map((l) => ({ style_id: l.style_id, qty: qty(l.style_id) })),
    });
    setBusy(false);
    if (r.error) {
      setProblems([r.error]);
      toast(r.error, "bad");
      window.scrollTo(0, 0);
      return;
    }
    toast(r.ok ?? "Saved");
    if (r.id && r.id !== id) router.replace(`/dc/${r.id}`);
    else router.refresh();
  };

  const remove = async () => {
    if (!id || !(await confirm(`Delete draft ${id}? This can't be undone.`, "Delete draft", true))) return;
    setBusy(true);
    const r = await deleteDc(id);
    setBusy(false);
    toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
    if (r.ok) router.push("/dc");
  };

  const field = (k: "courier" | "tracking" | "invoice_no", label: string, placeholder = "") => (
    <label className="field"><span>{label} <i>*</i></span>
      <input className="inp" value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="stack">
      <div className="crumbs">Warehouse › <Link className="link" href="/dc">Delivery challans</Link> › {id ?? "New"}</div>
      <div className="head">
        <div className="grow">
          <h1>{id ? `DC ${id}` : "Create DC"} <Chip status="draft" /></h1>
          <p>Raise the buyer invoice and dispatch together.</p>
        </div>
      </div>
      {problems && <Problems errors={problems} />}
      <section className="panel">
        <div className="fgrid">
          <label className="field"><span>GRN <i>*</i></span>
            <select className="inp" value={f.grn_id} onChange={(e) => pickGrn(e.target.value)}>
              <option value="">Select GRN…</option>
              {grns.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            {fresh && !grns.length && <small>No submitted GRN has goods waiting.</small>}
          </label>
          <label className="field"><span>Dispatch at <i>*</i></span>
            <input type="datetime-local" className="inp" value={f.dispatched_at} onChange={(e) => setF({ ...f, dispatched_at: e.target.value })} />
          </label>
          {field("courier", "Courier / transporter", "Delhivery, VRL, Blue Dart")}
          {field("tracking", "Tracking / LR number")}
          {field("invoice_no", "Buyer invoice number", "SRC/26-27/0142")}
          <label className="field"><span>Invoice date <i>*</i></span>
            <input type="date" className="inp" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} />
          </label>
        </div>
        <label className="field mt-3"><span>Destination address <i>*</i></span>
          <textarea className="inp" rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </label>
      </section>
      {g ? (
        g.lines.length ? (
          <section className="panel">
            <h3>Items</h3>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Style</th><th>Colour</th><th>Available</th><th>Dispatch qty</th><th>Value</th></tr></thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.style_id}>
                      <td><b>{l.name}</b><br /><span className="code text-muted">{l.code}</span></td>
                      <td>{l.colour}</td>
                      <td className="num">{nf(l.avail)}</td>
                      <td><input type="number" min={0} className="inp" value={qty(l.style_id)} aria-label={`Dispatch quantity for ${l.name}`} onChange={(e) => setF({ ...f, lines: { ...f.lines, [l.style_id]: e.target.value } })} /></td>
                      <td className="num">{money(num(qty(l.style_id)) * l.rate, g.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">{nf(units)} units · {money(value, g.currency)}</p>
          </section>
        ) : (
          <div className="empty"><b>Nothing left to dispatch on this GRN</b></div>
        )
      ) : (
        <div className="empty"><b>Choose a GRN</b>Its items load here.</div>
      )}
      <div className="sticky-actions">
        <span className="grow text-xs text-muted">Mark dispatched only after the goods have left with the courier.</span>
        {id ? <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete draft</button> : <Link className="btn" href="/dc">Cancel</Link>}
        <button type="button" className="btn" disabled={busy} onClick={() => save("draft")}>Save draft</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save("dispatched")}>Mark dispatched</button>
      </div>
    </div>
  );
}
