"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Attachments } from "@/components/attachments";
import { Chip, Problems } from "@/components/bits";
import { useFeedback } from "@/components/feedback";
import { CATEGORIES_FOR, type FileItem } from "@/lib/file-kinds";
import {
  addDays, CURRENCIES, DEFAULT_CHECKPOINTS, type Draft, type DraftStyle, draftQty, fmtDay, money, nf, num, SIZES, SOURCES, validateDraft,
} from "@/lib/model";
import { backToDraft, deleteDraft, lockOrder, saveOrder, submitOrder, type Result } from "../actions";

type Opt = { id: string; label: string };
export type EditorOptions = {
  buyers: (Opt & { terms: string; address: string })[];
  factories: Opt[];
  merchandisers: Opt[];
  managers: Opt[];
  people: Opt[];
  templates: { id: string; name: string; order_type: "garment" | "fabric"; steps: { name: string; days: number }[]; is_default: boolean }[];
};

const uid = () => crypto.randomUUID();
const newStyle = (garment: boolean): DraftStyle => ({
  id: uid(), name: "", code: "", fabric: "", colour: "", use_sizes: garment, sizes: Object.fromEntries(SIZES.map((z) => [z, ""])),
  qty: "", buyer_rate: "", factory_rate: "", internal_note: "",
  checkpoints: DEFAULT_CHECKPOINTS.map((name) => ({ id: uid(), name, due_date: "" })),
});

export function Editor({ initial, options, isOwner, today, files }: {
  initial: Draft; options: EditorOptions; isOwner: boolean; today: string; files: Record<string, FileItem[]>;
}) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [d, setD] = useState<Draft>(initial);
  const [saveText, setSaveText] = useState("All changes saved");
  const [problems, setProblems] = useState<{ E: string[]; W: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(d);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const dirty = useRef(false);
  const review = d.status === "tna_review";
  const garment = d.order_type === "garment";

  const doSave = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saving.current) await saving.current;
    if (!dirty.current) return true;
    dirty.current = false;
    setSaveText("Saving…");
    const run = saveOrder(latest.current).then((r) => {
      if (r.error) {
        dirty.current = true;
        setSaveText(`Not saved: ${r.error}`);
        return false;
      }
      setSaveText(dirty.current ? "Unsaved changes…" : "All changes saved");
      return true;
    }).catch(() => {
      dirty.current = true;
      setSaveText("Not saved. Check your connection.");
      return false;
    });
    saving.current = run;
    const ok = await run;
    saving.current = null;
    return ok;
  }, []);

  const update = (fn: (x: Draft) => Draft) => {
    setD((prev) => {
      const next = fn(prev);
      latest.current = next;
      return next;
    });
    dirty.current = true;
    setSaveText("Unsaved changes…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(doSave, 1200);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => update((x) => ({ ...x, [k]: v }));
  const setStyle = (i: number, patch: Partial<DraftStyle>) =>
    update((x) => ({ ...x, styles: x.styles.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  // Save before leaving; warn if a save is still pending.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) { void doSave(); e.preventDefault(); }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      if (dirty.current) void doSave();
    };
  }, [doSave]);

  const after = (r: Result, then?: () => void) => {
    if (r.errors?.length || r.warnings?.length) setProblems({ E: r.errors ?? [], W: r.warnings ?? [] });
    if (r.error) toast(r.error, "bad");
    if (r.errors?.length) { toast(`${r.errors.length} thing${r.errors.length > 1 ? "s" : ""} to fix`, "bad"); window.scrollTo(0, 0); }
    if (r.ok) { toast(r.ok); then?.(); }
  };
  const act = async (fn: () => Promise<Result>, then?: () => void) => {
    setBusy(true);
    try {
      if (!(await doSave())) { toast("Couldn't save your latest changes. Fix that first.", "bad"); return; }
      after(await fn(), then);
    } finally {
      setBusy(false);
    }
  };
  const check = () => {
    const r = validateDraft(d, today);
    setProblems(r);
    if (r.E.length) { toast(`${r.E.length} thing${r.E.length > 1 ? "s" : ""} to fix`, "bad"); window.scrollTo(0, 0); }
    return r;
  };

  const submit = () => { if (!check().E.length) act(() => submitOrder(d.id), () => { setD((x) => ({ ...x, status: "tna_review" })); router.refresh(); }); };
  const lock = async () => {
    if (check().E.length) return;
    if (!(await confirm(`Lock the TNA for ${d.id}? Styles, quantities, rates and dates can't change after this, and the factory gets the final PO.`, "Lock TNA"))) return;
    act(() => lockOrder(d.id), () => router.refresh());
  };
  const unsubmit = () => act(() => backToDraft(d.id), () => { setD((x) => ({ ...x, status: "draft" })); setProblems(null); router.refresh(); });
  const remove = async () => {
    if (!(await confirm(`Delete draft ${d.id}? This can't be undone.`, "Delete draft", true))) return;
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    setBusy(true);
    const r = await deleteDraft(d.id);
    setBusy(false);
    after(r, () => router.push("/orders"));
  };

  const total = d.styles.reduce((a, s) => a + draftQty(s, d.order_type), 0);
  const value = d.styles.reduce((a, s) => a + draftQty(s, d.order_type) * num(s.buyer_rate), 0);
  const unit = garment ? "pcs" : "m";

  const sel = (k: keyof Draft, opts: Opt[], blank = "Select…") => (
    <select className="inp" value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value as never)}>
      <option value="">{blank}</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
  const txt = (k: keyof Draft, placeholder = "") => (
    <input className="inp" value={String(d[k] ?? "")} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
  );
  const date = (k: keyof Draft) => <input type="date" className="inp" value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} />;

  return (
    <div className="stack">
      <div className="crumbs">Sales › <Link className="link" href="/orders">Sales orders</Link> › {d.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{review ? "Sales order" : "New sales order"} {d.id} <Chip status={d.status} /></h1>
          <p>
            {review
              ? isOwner ? "Check the TNA, then lock it to issue the final PO to the factory." : "Sent to the owner for the TNA lock. You can still edit until it's locked."
              : "Draft. Changes save automatically."}
            {d.inquiry_id && <> From inquiry <span className="code">{d.inquiry_id}</span>.</>}
          </p>
        </div>
      </div>
      {problems && <Problems errors={problems.E} warnings={problems.W} />}

      <section className="panel">
        <h2>Order details</h2>
        <div className="stack">
          <div className="fgrid">
            <label className="field"><span>Customer (buyer code) <i>*</i></span>
              <select
                className="inp"
                value={d.buyer_id}
                onChange={(e) => {
                  const b = options.buyers.find((x) => x.id === e.target.value);
                  update((x) => ({ ...x, buyer_id: e.target.value, payment_terms: x.payment_terms || b?.terms || "", delivery_address: x.delivery_address || b?.address || "" }));
                }}
              >
                <option value="">Select buyer code…</option>
                {options.buyers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Buyer PO / reference <i>*</i></span>{txt("buyer_po_number", "As printed on the buyer's PO")}</label>
            <label className="field"><span>Sales order date <i>*</i></span>{date("so_date")}</label>
            <label className="field"><span>Order source</span>
              <select className="inp" value={d.order_source} onChange={(e) => set("order_source", e.target.value)}>
                <option value="">Select…</option>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="fgrid">
            <label className="field"><span>Order type <i>*</i></span>
              <select
                className="inp"
                value={d.order_type}
                onChange={(e) => {
                  const t = e.target.value as Draft["order_type"];
                  update((x) => ({ ...x, order_type: t, styles: x.styles.map((s) => ({ ...s, use_sizes: t === "garment" })) }));
                }}
              >
                <option value="garment">Garment (pieces)</option>
                <option value="fabric">Fabric (meters)</option>
              </select>
            </label>
            <label className="field"><span>Currency <i>*</i></span>
              <select className="inp" value={d.currency} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field"><span>Factory <i>*</i></span>{sel("factory_id", options.factories, "Select factory…")}
              {!options.factories.length && <small>Add factories in Master data first.</small>}
            </label>
            <label className="field"><span>Payment terms <i>*</i></span>{txt("payment_terms", "45 days post-receipt")}</label>
          </div>
          <div className="fgrid">
            <label className="field"><span>Buyer delivery date <i>*</i></span>{date("buyer_date")}<small>The buyer&apos;s deadline (exp. ship)</small></label>
            <label className="field"><span>Factory delivery date <i>*</i></span>{date("factory_date")}<small>On or before the buyer date</small></label>
            <label className="field"><span>Merchandiser predicted date <i>*</i></span>{date("merch_date")}<small>Based on factory feedback</small></label>
            <label className="field"><span>Tags</span>{txt("tags", "SS27, repeat order, urgent")}</label>
          </div>
          <div className="fgrid">
            <label className="field"><span>Demand POC (merchandiser) <i>*</i></span>{sel("merchandiser_id", options.merchandisers)}</label>
            <label className="field"><span>Merchandiser manager <i>*</i></span>{sel("manager_id", options.managers)}<small>Escalation point</small></label>
            <label className="field"><span>Fabric POC</span>{sel("fabric_poc_id", options.people)}</label>
            <label className="field"><span>Quality POC</span>{sel("quality_poc_id", options.people)}</label>
          </div>
          <label className="field"><span>Delivery address (buyer warehouse)</span>
            <textarea className="inp" rows={2} value={d.delivery_address} onChange={(e) => set("delivery_address", e.target.value)} />
          </label>
          <label className="field"><span>Current status remarks</span>
            <textarea className="inp" rows={2} value={d.remarks} placeholder="Fabric booked, lab dips awaited from mill" onChange={(e) => set("remarks", e.target.value)} />
          </label>
          <label className="field"><span>Buyer T&amp;Cs, inspection windows, penalty clauses</span>
            <textarea className="inp" rows={2} value={d.terms} placeholder="Inspection 3 days before dispatch. 2% penalty per week of delay." onChange={(e) => set("terms", e.target.value)} />
          </label>
        </div>
      </section>

      <div className="head">
        <div className="grow">
          <h2>Item details &amp; TNA</h2>
          <p>One card per style and colour. TNA dates must run in order.</p>
        </div>
        <span className="chip">{d.styles.length} style{d.styles.length === 1 ? "" : "s"} · {nf(total)} {unit} · {money(value, d.currency)}</span>
      </div>
      <TemplateBar
        templates={options.templates.filter((t) => t.order_type === d.order_type)}
        factoryDate={d.factory_date}
        onApply={async (t) => {
          const filled = d.styles.some((s) => s.checkpoints.some((c) => c.due_date));
          if (filled && !(await confirm(`Replace the checkpoints on all ${d.styles.length} styles with "${t.name}"?`, "Replace"))) return;
          update((x) => ({
            ...x,
            styles: x.styles.map((s) => ({ ...s, checkpoints: t.steps.map((st) => ({ id: uid(), name: st.name, due_date: addDays(x.factory_date, -st.days) })) })),
          }));
          toast(`"${t.name}" applied, dated back from ${fmtDay(d.factory_date)}. Adjust any date if needed.`);
        }}
      />

      {d.styles.map((st, i) => (
        <StyleCard
          key={st.id}
          st={st}
          i={i}
          d={d}
          onChange={(patch) => setStyle(i, patch)}
          onRemove={async () => {
            const n = files[st.id]?.length ?? 0;
            const also = n ? ` Its ${n === 1 ? "file" : `${n} files`} will be removed too.` : "";
            if ((n || (d.styles.length > 1 && (st.name || st.code))) && !(await confirm(`Remove style ${i + 1}${st.name ? ` "${st.name}"` : ""}?${also}`, "Remove", true))) return;
            update((x) => ({ ...x, styles: x.styles.filter((_, j) => j !== i) }));
          }}
          onDuplicate={() => {
            update((x) => {
              const c: DraftStyle = {
                ...st, id: uid(), colour: "", qty: "", sizes: Object.fromEntries(SIZES.map((z) => [z, ""])),
                checkpoints: st.checkpoints.map((cp) => ({ ...cp, id: uid() })),
              };
              const styles = [...x.styles];
              styles.splice(i + 1, 0, c);
              return { ...x, styles };
            });
            toast(`Copied "${st.name || "style"}". Enter the new colour and quantities.`);
          }}
          onCopyTna={() => {
            setStyle(i, { checkpoints: d.styles[0].checkpoints.map((cp) => ({ ...cp, id: uid() })) });
            toast("Checkpoints copied from Style 1");
          }}
          toast={toast}
          files={files[st.id] ?? []}
          beforeUpload={doSave}
        />
      ))}
      <div><button type="button" className="btn" onClick={() => update((x) => ({ ...x, styles: [...x.styles, newStyle(garment)] }))}>+ Add style / colour</button></div>

      <div className="sticky-actions">
        <span className="grow text-xs text-muted" aria-live="polite">{saveText}</span>
        <button type="button" className="btn danger" disabled={busy} onClick={remove} hidden={review}>Delete draft</button>
        {review ? (
          <button type="button" className="btn" disabled={busy} onClick={unsubmit}>Back to draft</button>
        ) : (
          <button type="button" className="btn primary" disabled={busy} onClick={submit}>Send for TNA lock</button>
        )}
        {isOwner && <button type="button" className="btn dark" disabled={busy} onClick={lock}>🔒 Lock TNA &amp; issue final PO</button>}
      </div>
    </div>
  );
}

// Fill every style's TNA from a template, dated back from the factory delivery date.
function TemplateBar({ templates, factoryDate, onApply }: {
  templates: EditorOptions["templates"]; factoryDate: string; onApply: (t: EditorOptions["templates"][number]) => void;
}) {
  const [tid, setTid] = useState(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === tid);
  if (!templates.length) return null;
  return (
    <section className="panel" id="plan" style={{ padding: 14 }}>
      <div className="row">
        <b className="text-[14px]">Plan the TNA from a template</b>
        <select className="inp" style={{ maxWidth: 300 }} value={tid} onChange={(e) => setTid(e.target.value)} aria-label="TNA template">
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button type="button" className="btn sm primary" disabled={!t || !factoryDate} onClick={() => t && onApply(t)}>Apply to all styles</button>
        {!factoryDate && <span className="text-xs text-warn">Set the factory delivery date first.</span>}
      </div>
      {t && factoryDate && <p className="mt-2 text-xs text-muted">{t.steps.map((s) => `${s.name} ${fmtDay(addDays(factoryDate, -s.days))}`).join(" · ")}</p>}
    </section>
  );
}

function StyleCard({ st, i, d, onChange, onRemove, onDuplicate, onCopyTna, toast, files, beforeUpload }: {
  st: DraftStyle; i: number; d: Draft; onChange: (p: Partial<DraftStyle>) => void; onRemove: () => void; onDuplicate: () => void;
  onCopyTna: () => void; toast: (m: string, k?: "bad") => void; files: FileItem[]; beforeUpload: () => Promise<boolean>;
}) {
  const [newCp, setNewCp] = useState("");
  const garment = d.order_type === "garment";
  const q = draftQty(st, d.order_type);
  const sizes = garment && st.use_sizes;
  const cps = st.checkpoints;
  const setCp = (j: number, patch: Partial<DraftStyle["checkpoints"][number]>) => onChange({ checkpoints: cps.map((c, k) => (k === j ? { ...c, ...patch } : c)) });
  const move = (j: number, by: number) => {
    const next = [...cps];
    [next[j], next[j + by]] = [next[j + by], next[j]];
    onChange({ checkpoints: next });
  };

  return (
    <article className="style-card">
      <div className="style-head">
        <h3>Style {i + 1}{st.name ? `: ${st.name}` : ""}{st.colour && <span className="font-normal text-muted"> ({st.colour})</span>}</h3>
        <button type="button" className="btn sm" onClick={onDuplicate}>Duplicate for another colour</button>
        <button type="button" className="btn sm danger" onClick={onRemove}>Remove</button>
      </div>
      <div className="style-body">
        <div className="fgrid">
          <label className="field"><span>Style name <i>*</i></span><input className="inp" value={st.name} placeholder="Name the buyer uses" onChange={(e) => onChange({ name: e.target.value })} /></label>
          <label className="field"><span>Style code <i>*</i></span><input className="inp" value={st.code} placeholder="SKU / style ID" onChange={(e) => onChange({ code: e.target.value })} /></label>
          <label className="field"><span>Fabric type <i>*</i></span><input className="inp" value={st.fabric} placeholder="Cotton cambric 60s" onChange={(e) => onChange({ fabric: e.target.value })} /></label>
          <label className="field"><span>Colour <i>*</i></span><input className="inp" value={st.colour} onChange={(e) => onChange({ colour: e.target.value })} /></label>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {garment && (
            <label className="row text-[12.5px]" style={{ gap: 6 }}>
              <input type="checkbox" checked={st.use_sizes} onChange={(e) => onChange({ use_sizes: e.target.checked })} /> Size-wise quantity (S to 3XL)
            </label>
          )}
          {sizes && (
            <div className="sizes">
              {SIZES.map((z) => (
                <label key={z} className="field"><span>{z}</span>
                  <input type="number" min={0} inputMode="numeric" className="inp" value={st.sizes[z] ?? ""} onChange={(e) => onChange({ sizes: { ...st.sizes, [z]: e.target.value } })} />
                </label>
              ))}
              <div className="field"><span>Total</span><div className="tot">{nf(q)} pcs</div></div>
            </div>
          )}
          <div className="fgrid">
            {!sizes && (
              <label className="field"><span>Quantity ({garment ? "pcs" : "m"}) <i>*</i></span>
                <input type="number" min={0} className="inp" value={st.qty} onChange={(e) => onChange({ qty: e.target.value })} />
              </label>
            )}
            <label className="field"><span>Buyer rate per {garment ? "piece" : "meter"} ({d.currency}) <i>*</i></span>
              <input type="number" min={0} step="0.01" className="inp" value={st.buyer_rate} onChange={(e) => onChange({ buyer_rate: e.target.value })} />
            </label>
            <label className="field"><span>Factory rate ({d.currency})</span>
              <input type="number" min={0} step="0.01" className="inp" value={st.factory_rate} onChange={(e) => onChange({ factory_rate: e.target.value })} />
              <small>What Sourcingo pays. The buyer never sees it.</small>
            </label>
            <div className="field"><span>Style value</span><div className="code" style={{ padding: "8px 0" }}>{money(q * num(st.buyer_rate), d.currency)}
              {num(st.factory_rate) > 0 && num(st.buyer_rate) > 0 && <span className="text-muted"> · margin {money(q * (num(st.buyer_rate) - num(st.factory_rate)), d.currency)}</span>}
            </div></div>
          </div>
        </div>
        <label className="field"><span>Internal note (not visible to factory or buyer)</span>
          <textarea className="inp" rows={2} value={st.internal_note} placeholder="Scope for improvement, sampling risks" onChange={(e) => onChange({ internal_note: e.target.value })} />
        </label>
        <Attachments target="style" id={st.id} files={files} upload={CATEGORIES_FOR.style} canDeleteAll beforeUpload={beforeUpload}
          title="Tech pack, cutting program & photos" hint="The factory sees tech packs, cutting programs, photos and QC reports once the order is sent for the TNA lock. “Other” stays internal." />
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <span className="sub" style={{ flex: 1 }}>TNA checkpoints</span>
            {i > 0 && <button type="button" className="btn sm" onClick={onCopyTna}>Copy checkpoints from Style 1</button>}
          </div>
          <div className="cps">
            {cps.map((cp, j) => (
              <div key={cp.id} className="cp">
                <span className="n">{j + 1}</span>
                <input className="inp" value={cp.name} aria-label="Checkpoint name" onChange={(e) => setCp(j, { name: e.target.value })} />
                <input
                  type="date"
                  className="inp"
                  value={cp.due_date}
                  aria-label={`${cp.name} date`}
                  onChange={(e) => {
                    const v = e.target.value;
                    const prev = cps.slice(0, j).reverse().find((c) => c.due_date);
                    if (v && prev && v < prev.due_date) {
                      toast(`${cp.name} can't be before the previous checkpoint (${prev.name}: ${fmtDay(prev.due_date)})`, "bad");
                      return;
                    }
                    setCp(j, { due_date: v });
                  }}
                />
                <div className="ctl">
                  <button type="button" className="btn icon" disabled={j === 0} onClick={() => move(j, -1)} aria-label="Move up">↑</button>
                  <button type="button" className="btn icon" disabled={j === cps.length - 1} onClick={() => move(j, 1)} aria-label="Move down">↓</button>
                  <button type="button" className="btn icon danger" onClick={() => onChange({ checkpoints: cps.filter((_, k) => k !== j) })} aria-label="Remove checkpoint">×</button>
                </div>
              </div>
            ))}
          </div>
          <form
            className="row"
            style={{ flexWrap: "nowrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCp.trim()) { toast("Type the checkpoint name first.", "bad"); return; }
              onChange({ checkpoints: [...cps, { id: uid(), name: newCp.trim(), due_date: "" }] });
              toast(`Checkpoint "${newCp.trim()}" added`);
              setNewCp("");
            }}
          >
            <input className="inp" value={newCp} onChange={(e) => setNewCp(e.target.value)} placeholder="Custom checkpoint, e.g. Lab dip approval, Embroidery, Wash" />
            <button className="btn sm">+ Add checkpoint</button>
          </form>
        </div>
      </div>
    </article>
  );
}
