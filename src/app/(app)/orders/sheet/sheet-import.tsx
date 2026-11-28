"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear, qty } from "@/lib/format";
import { blankSheet, readSheet, sheetQty, type SheetBuyer, type SheetFactory } from "@/lib/po-sheet";
import { num } from "@/lib/order-input";
import { addSheetOrders, type SheetSaved } from "./actions";

const LINES_SHOWN = 4;

// Paste or choose a sheet, see every PO it makes with its problems by row, then add the clean ones in one tap.
export function SheetImport({ buyers, factories, team, meId }: { buyers: SheetBuyer[]; factories: SheetFactory[]; team: { id: string; label: string }[]; meId: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [merch, setMerch] = useState(team.some((t) => t.id === meId) ? meId : team[0]?.id ?? "");
  const [saved, setSaved] = useState<SheetSaved[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const sheet = useMemo(() => readSheet(text, buyers, factories), [text, buyers, factories]);
  const done = new Map(saved.map((s) => [s.key, s]));
  const left = sheet.orders.filter((o) => !done.get(o.key)?.id);
  const ready = left.filter((o) => !o.problems.length);
  const styles = sheet.orders.reduce((s, o) => s + o.lines.length, 0);
  const pieces = sheet.orders.reduce((s, o) => s + sheetQty(o), 0);

  async function pick(f: File | undefined) {
    setError("");
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") { setError("Excel files can't be read here yet. In Excel, select the rows and copy them, then paste below. Or save the sheet as CSV."); return; }
    if (f.size > 2_000_000) { setError(`${f.name} is over 2 MB. Paste the rows instead.`); return; }
    setText(await f.text());
    setSaved([]);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([blankSheet()], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "sourcingo-pos.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  function add() {
    setError("");
    if (!merch) { setError("Pick who runs these orders."); return; }
    start(async () => {
      let r: Awaited<ReturnType<typeof addSheetOrders>>;
      try { r = await addSheetOrders(ready, merch); } catch (e) { r = { error: caught(e, "It didn't save. Try again."), saved: [] }; }
      if (r.error) { setError(r.error); return; }
      setSaved((s) => [...s.filter((x) => !r.saved.some((y) => y.key === x.key)), ...r.saved]);
      const ok = r.saved.filter((s) => s.id).length;
      const bad = r.saved.length - ok;
      toast(bad ? `${ok} added. ${bad} didn't go in; see why below.` : `${ok} ${ok === 1 ? "PO" : "POs"} added to Orders.`, bad ? "bad" : undefined);
    });
  }

  return (
    <div className="psheet">
      <section className="panel">
        <h2>1. Paste the rows</h2>
        <p className="muted text-[13px]">Copy from Excel or Google Sheets with the heading row on top: Buyer, PO, PO date, Ship date, Style, Colour, Description, Qty, Rate, Factory, Factory rate. Only Style and Qty are a must. Write a PO&apos;s buyer and dates once; the rows under it take them.</p>
        <textarea className="inp psheet-paste num" rows={7} value={text} spellCheck={false} aria-label="Rows from your sheet"
          placeholder={"Buyer\tPO\tShip date\tStyle\tQty\nBYR-AH\tAFH-120\t20/01/2027\tK-101\t500"}
          onChange={(e) => { setText(e.target.value); setSaved([]); }} />
        <div className="psheet-acts">
          <label className="btn">
            Choose a CSV file
            <input ref={file} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <button type="button" className="link" onClick={download}>Download a blank sheet</button>
          {text && <button type="button" className="link" onClick={() => { setText(""); setSaved([]); setError(""); }}>Clear</button>}
        </div>
        {error && <div className="errbox mt-3" role="alert">{error}</div>}
      </section>

      {sheet.problems.length > 0 && <div className="errbox" role="alert">{sheet.problems.map((p) => <p key={p}>{p}</p>)}</div>}

      {sheet.orders.length > 0 && !sheet.problems.length && (
        <section className="card" aria-labelledby="sheet-h">
          <header className="card-h">
            <div>
              <h2 id="sheet-h">2. Check what goes in</h2>
              <p className="num">{sheet.orders.length} {sheet.orders.length === 1 ? "PO" : "POs"} · {styles} {styles === 1 ? "style" : "styles"} · {qty(pieces)} pcs
                {left.length > ready.length && <> · <span className="text-bad">{left.length - ready.length} to fix</span></>}</p>
            </div>
          </header>
          <ul className="psheet-pos">
            {sheet.orders.map((o) => {
              const s = done.get(o.key);
              return (
                <li key={o.key} className={s?.id ? "is-done" : o.problems.length || s?.error ? "is-bad" : ""}>
                  <div className="psheet-po">
                    <span className="psheet-id">
                      <b>{o.po || "No PO number"}</b>
                      <small>{[o.buyer || "No buyer", o.po_date && `PO ${dayNear(o.po_date)}`, o.ship_date ? `ships ${dayNear(o.ship_date)}` : "no ship date"].filter(Boolean).join(" · ")}</small>
                    </span>
                    {s?.id ? <Link className="chip ok" href={`/orders/${s.id}`}>Added as {s.orderNo ?? "an order"}</Link>
                      : <span className="num muted text-[13px] whitespace-nowrap">{o.lines.length} {o.lines.length === 1 ? "style" : "styles"} · {qty(sheetQty(o))} pcs</span>}
                  </div>
                  <ul className="psheet-lines">
                    {o.lines.slice(0, LINES_SHOWN).map((l) => <Line key={l.row} l={l} />)}
                    {o.lines.length > LINES_SHOWN && (
                      <li><details className="bmore"><summary>{o.lines.length - LINES_SHOWN} more styles</summary><ul className="psheet-lines">{o.lines.slice(LINES_SHOWN).map((l) => <Line key={l.row} l={l} />)}</ul></details></li>
                    )}
                  </ul>
                  {(o.problems.length > 0 || s?.error) && (
                    <ul className="psheet-bad" role="alert">{(s?.error ? [s.error] : o.problems).map((p) => <li key={p}>{p}</li>)}</ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="psheet-foot">
            <label className="field">
              <span>Who runs these orders</span>
              <select className="inp" value={merch} onChange={(e) => setMerch(e.target.value)}>
                {team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn primary" disabled={pending || !ready.length} onClick={add}>
              {pending ? "Adding…" : !ready.length ? (left.length ? "Fix the rows above first" : "All added") : `Add ${ready.length} ${ready.length === 1 ? "PO" : "POs"}${left.length > ready.length ? `, skip ${left.length - ready.length}` : ""}`}
            </button>
          </div>
          <details className="howto psheet-help">
            <summary>What happens next</summary>
            <p>Each PO becomes an order like one typed in New order, with its own PO PDF. A PO number the buyer already sent is refused, so nothing goes in twice. Fabric styles, photos and the buyer&apos;s terms are added on each order afterwards.</p>
          </details>
        </section>
      )}
    </div>
  );
}

function Line({ l }: { l: { row: number; style: string; colour: string; description: string; qty: string; buyer_rate: string; factory: string; factory_rate: string } }) {
  return (
    <li className="psheet-line">
      <span className="psheet-style"><b>{l.style || "—"}</b>{[l.colour, l.description].filter(Boolean).length > 0 && <small>{[l.colour, l.description].filter(Boolean).join(" · ")}</small>}</span>
      <span className="num psheet-nums">
        <b>{l.qty ? `${l.qty} pcs` : "no qty"}</b>
        <small>{[l.buyer_rate && `₹${num(l.buyer_rate)}`, l.factory && `${l.factory}${l.factory_rate ? ` ₹${num(l.factory_rate)}` : ""}`].filter(Boolean).join(" · ")}</small>
      </span>
    </li>
  );
}
