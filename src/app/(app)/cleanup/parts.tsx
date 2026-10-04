"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateInquiry } from "@/app/(app)/inquiries/actions";
import { useFeedback } from "@/components/feedback";
import { addDays, fmtDay } from "@/lib/model";
import type { TnaTemplate } from "@/lib/tna";
import { applyRunningTemplate, fillFactoryRate, fillOrder, fillSampleDue, markShipped } from "./actions";

type Opt = { id: string; label: string };
type R = { ok?: string; error?: string };

function useRun() {
  const { toast } = useFeedback();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<R>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
      if (!r.error) { after?.(); router.refresh(); }
    });
  return { pending, run };
}

export function ShippedList({ rows, canClose }: { rows: { id: string; label: string; date: string | null }[]; canClose: boolean }) {
  const { confirm } = useFeedback();
  const { pending, run } = useRun();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const all = sel.size === rows.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>
            {canClose && <th style={{ width: 36 }}><input type="checkbox" aria-label="Tick all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
            <th>Order</th><th>Buyer date</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "sel" : ""}>
                {canClose && <td><input type="checkbox" aria-label={`Tick ${r.id}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                <td><a className="code text-accent" href={`/orders/${r.id}`}>{r.id}</a> <span className="text-muted">{r.label}</span></td>
                <td className="num whitespace-nowrap">{fmtDay(r.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canClose ? (
        <div className="row">
          <input className="inp" style={{ maxWidth: 360 }} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): shipped before the app" aria-label="Note" />
          <button type="button" className="btn primary" disabled={pending || !sel.size} onClick={async () => {
            if (!(await confirm(`Mark ${sel.size} order${sel.size === 1 ? "" : "s"} as shipped? They leave the running list and stop raising alerts.`, "Mark shipped"))) return;
            run(() => markShipped([...sel], note), () => setSel(new Set()));
          }}>{pending ? "Saving…" : `Mark ${sel.size || ""} shipped`}</button>
        </div>
      ) : (
        <p className="text-xs text-muted">The owner or a merchandiser manager closes these. Still running? Ask them to check with the factory.</p>
      )}
    </div>
  );
}

export function TemplatePicker({ soId, factoryDate, templates }: { soId: string; factoryDate: string | null; templates: TnaTemplate[] }) {
  const { pending, run } = useRun();
  const [tid, setTid] = useState(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "");
  const [fd, setFd] = useState(factoryDate ?? "");
  const t = templates.find((x) => x.id === tid);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <select className="inp" style={{ maxWidth: 280 }} value={tid} onChange={(e) => setTid(e.target.value)} aria-label={`TNA template for ${soId}`}>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {!factoryDate && <input type="date" className="inp" style={{ maxWidth: 170 }} value={fd} onChange={(e) => setFd(e.target.value)} aria-label="Factory delivery date" />}
        <button type="button" className="btn sm primary" disabled={pending || !tid || !fd} onClick={() => run(() => applyRunningTemplate(soId, tid, fd))}>
          {pending ? "Adding…" : "Add TNA"}
        </button>
      </div>
      {t && fd && (
        <small className="text-xs text-muted">
          {t.steps.map((s) => `${s.name} ${fmtDay(addDays(fd, -s.days))}`).join(" · ")}
        </small>
      )}
      {!factoryDate && !fd && <small className="text-xs text-warn">No factory date on this order. Enter it; the steps are dated back from it.</small>}
    </div>
  );
}

export function OrderFill({ soId, need, people, managers, factories }: {
  soId: string; need: { merch: boolean; manager: boolean; factory: boolean; factoryDate: boolean; buyerDate: boolean };
  people: Opt[]; managers: Opt[]; factories: Opt[];
}) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ merchandiser_id: "", manager_id: "", factory_id: "", factory_date: "", buyer_date: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="row">
      {need.merch && <select className="inp" style={{ maxWidth: 200 }} value={v.merchandiser_id} onChange={set("merchandiser_id")} aria-label="Merchandiser">
        <option value="">Merchandiser…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>}
      {need.manager && <select className="inp" style={{ maxWidth: 200 }} value={v.manager_id} onChange={set("manager_id")} aria-label="Manager">
        <option value="">Manager…</option>{managers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>}
      {need.factory && <select className="inp" style={{ maxWidth: 200 }} value={v.factory_id} onChange={set("factory_id")} aria-label="Factory">
        <option value="">Factory…</option>{factories.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>}
      {need.factoryDate && <label className="row text-xs text-muted">Factory date <input type="date" className="inp" style={{ maxWidth: 160 }} value={v.factory_date} onChange={set("factory_date")} /></label>}
      {need.buyerDate && <label className="row text-xs text-muted">Buyer date <input type="date" className="inp" style={{ maxWidth: 160 }} value={v.buyer_date} onChange={set("buyer_date")} /></label>}
      <button type="button" className="btn sm primary" disabled={pending || !Object.values(v).some(Boolean)} onClick={() => run(() => fillOrder(soId, v))}>
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function RateFill({ styleId, currency }: { styleId: string; currency: string }) {
  const { pending, run } = useRun();
  const [v, setV] = useState("");
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => fillFactoryRate(styleId, v)); }}>
      <input type="number" inputMode="decimal" min="0" step="0.01" className="inp" style={{ maxWidth: 120 }} value={v} onChange={(e) => setV(e.target.value)} placeholder={`Rate (${currency})`} aria-label="Factory rate" />
      <button className="btn sm primary" disabled={pending || !v}>{pending ? "…" : "Save"}</button>
    </form>
  );
}

export function DateFill({ id, kind, min }: { id: string; kind: "sample" | "inquiry"; min?: string }) {
  const { pending, run } = useRun();
  const [v, setV] = useState("");
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => (kind === "sample" ? fillSampleDue(id, v) : updateInquiry(id, "next_follow_up", v))); }}>
      <input type="date" className="inp" style={{ maxWidth: 160 }} min={min} value={v} onChange={(e) => setV(e.target.value)} aria-label={kind === "sample" ? "Due date" : "Next follow-up"} />
      <button className="btn sm primary" disabled={pending || !v}>{pending ? "…" : "Save"}</button>
      {kind === "inquiry" && <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => updateInquiry(id, "status", "lost"))}>Mark lost</button>}
    </form>
  );
}
