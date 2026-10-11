"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, money } from "@/lib/format";
import { bringIn, makeSyncKey, saveTallySettings, setLedger, type TallySettingsInput } from "./actions";

function Message({ error, ok }: { error: string; ok: string }) {
  if (error) return <div className="errbox" role="alert">{error}</div>;
  if (ok) return <div className="okbox" role="status">{ok}</div>;
  return null;
}

// ---------------------------------------------------------------- settings and key (owner)
export function SettingsForm({ initial, hasKey }: { initial: TallySettingsInput; hasKey: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveTallySettings(f);
        setError(r.error ?? "");
        setOk(r.ok ?? "");
        if (r.ok) router.refresh();
      });
    }}>
      <div className="fgrid">
        <label className="field">
          <span>Company name in Tally<i> *</i></span>
          <input className="inp" value={f.tally_company} onChange={(e) => setF({ ...f, tally_company: e.target.value })} placeholder="SOURCINGO PRIVATE LIMITED" />
          <small>Exactly as Tally shows it at the top of Gateway of Tally. Use the test copy first if you have one.</small>
        </label>
        <label className="field">
          <span>Read vouchers from</span>
          <input className="inp" type="date" value={f.read_from} onChange={(e) => setF({ ...f, read_from: e.target.value })} />
          <small>Leave empty to read from the start of last financial year.</small>
        </label>
      </div>
      <label className="row text-[13.5px]">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        <span><b>Read Tally</b> every 15 minutes while Tally is open on the office computer{!hasKey && " (make a sync key below first)"}</span>
      </label>
      <Message error={error} ok={ok} />
      <div><button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button></div>
    </form>
  );
}

export function KeyMaker({ hint, made }: { hint: string | null; made: string | null }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="stack">
      <p className="text-[13.5px]">
        {hint ? <>A key ending <b className="code">…{hint}</b> was made {made ? day(made.slice(0, 10)) : ""}. A new key stops the old one working.</> : "The office computer needs this key to send Tally's books to the app."}
      </p>
      {key ? (
        <div className="warnbox stack">
          <b>Copy this key now. It won&apos;t be shown again.</b>
          <code className="code break-all select-all">{key}</code>
          <div><button type="button" className="btn sm" onClick={() => { navigator.clipboard?.writeText(key); setCopied(true); }}>{copied ? "Copied" : "Copy key"}</button></div>
        </div>
      ) : (
        <div>
          <button type="button" className="btn" disabled={pending} onClick={() => {
            if (hint && !confirm("Make a new key? The office computer will stop reading until it gets the new one.")) return;
            start(async () => {
              const r = await makeSyncKey();
              setError(r.error ?? "");
              if (r.key) { setKey(r.key); router.refresh(); }
            });
          }}>{pending ? "Making…" : hint ? "Make a new key" : "Make sync key"}</button>
        </div>
      )}
      {error && <div className="errbox" role="alert">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- linking ledgers
export function LedgerLink({ kind, id, value, options, listId }: { kind: "buyer" | "factory"; id: string; value: string | null; options?: string[]; listId: string }) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const dirty = v.trim() !== (value ?? "");
  return (
    <form className="row gap-1.5" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await setLedger(kind, id, v);
        setError(r.error ?? "");
        if (r.ok) router.refresh();
      });
    }}>
      <input className="inp min-w-[180px] flex-1" list={listId} value={v} onChange={(e) => setV(e.target.value)} placeholder="Not linked" aria-label="Tally ledger" />
      {options && <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
      {dirty && <button className="btn sm primary" disabled={pending}>Save</button>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </form>
  );
}

// A Tally party that isn't any buyer yet: pick which buyer it is.
export function PartyLink({ party, buyers }: { party: string; buyers: { id: string; label: string }[] }) {
  const router = useRouter();
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="row gap-1.5" onSubmit={(e) => {
      e.preventDefault();
      if (!id) return;
      start(async () => {
        const r = await setLedger("buyer", id, party);
        setError(r.error ?? "");
        if (r.ok) router.refresh();
      });
    }}>
      <select className="inp sm:w-56" value={id} onChange={(e) => setId(e.target.value)} aria-label={`Buyer for ${party}`}>
        <option value="">Choose the buyer…</option>
        {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
      {id && <button className="btn sm primary" disabled={pending}>Link</button>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </form>
  );
}

// ---------------------------------------------------------------- bringing entries into Payments
export type ImportRow = { guid: string; kind: string; number: string | null; date: string; party: string | null; amount: number; buyer: string | null; against: string | null };

export function ImportList({ rows }: { rows: ImportRow[] }) {
  const router = useRouter();
  const ready = rows.filter((r) => r.buyer && r.number);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ready.map((r) => r.guid)));
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const toggle = (g: string) => setPicked((p) => { const s = new Set(p); if (s.has(g)) s.delete(g); else s.add(g); return s; });
  const count = rows.filter((r) => picked.has(r.guid)).length;
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>
            <th><input type="checkbox" aria-label="Tick all" checked={count > 0 && count === ready.length} onChange={(e) => setPicked(new Set(e.target.checked ? ready.map((r) => r.guid) : []))} /></th>
            <th>Entry</th><th>Date</th><th>Tally party</th><th>Buyer</th><th className="r">Amount</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.guid}>
                <td><input type="checkbox" aria-label={`Bring in ${r.number}`} disabled={!r.buyer || !r.number} checked={picked.has(r.guid)} onChange={() => toggle(r.guid)} /></td>
                <td className="whitespace-nowrap">
                  <span className="code">{r.number || "No number"}</span>
                  <div className="text-xs muted">{r.kind === "sales" ? "Sales invoice" : `Credit note${r.against ? ` against ${r.against}` : ""}`}</div>
                </td>
                <td className="whitespace-nowrap">{day(r.date)}</td>
                <td>{r.party ?? <span className="muted">None</span>}</td>
                <td className="code whitespace-nowrap">{r.buyer ?? <span className="chip warn">Link the party first</span>}</td>
                <td className="r num whitespace-nowrap">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Message error={error} ok={ok} />
      {skipped.length > 0 && <div className="warnbox"><b>Left out:</b><ul className="ml-4 list-disc">{skipped.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      <div className="row">
        <button type="button" className="btn primary" disabled={pending || !count} onClick={() => start(async () => {
          const r = await bringIn(rows.filter((x) => picked.has(x.guid)).map((x) => x.guid));
          setError(r.error ?? "");
          setOk(r.ok ?? "");
          setSkipped(r.skipped ?? []);
          if (r.ok) router.refresh();
        })}>{pending ? "Adding…" : `Add ${count} to Payments`}</button>
        <span className="text-xs muted">They come in exactly as Tally has them. Credit notes need their invoice in Payments first; ticked invoices come in before them.</span>
      </div>
    </div>
  );
}
