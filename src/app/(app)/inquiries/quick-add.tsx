"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { parseInquiry, type ParseBuyer, type ParsedInquiry } from "@/lib/inquiry-parse";
import { INQUIRY_SOURCES } from "@/lib/inquiries";
import { addDays } from "@/lib/payments";
import { uploadPhotos } from "@/lib/photos";
import { createInquiry, setInquiryPhotos } from "./actions";

type Buyer = ParseBuyer & { label: string };
type Field = keyof ParsedInquiry;
const NEW_BUYER = "__new";
const FOLLOW = [{ d: 1, label: "Tomorrow" }, { d: 3, label: "In 3 days" }, { d: 7, label: "Next week" }];

// Logging an inquiry in seconds: paste the buyer's message (or type a line), and the buyer, quantity and price fill in.
// Every field shows before it saves and can be changed; nothing is sent anywhere.
export function QuickAdd({ buyers, companyId, meId, today, initial = "" }: { buyers: Buyer[]; companyId: string; meId: string; today: string; initial?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [own, setOwn] = useState<Partial<ParsedInquiry>>({});
  const [newBuyer, setNewBuyer] = useState<boolean | null>(null);
  const [follow, setFollow] = useState(1);
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  const read = useMemo(() => parseInquiry(text, buyers), [text, buyers]);
  const v: ParsedInquiry = { ...read, ...own };
  const isNew = newBuyer ?? (!v.buyer_id && !!v.prospect);
  const open = text.trim().length > 0 || photos.length > 0;
  const found = (k: Field) => !(k in own) && !!read[k];
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setOwn({ ...own, [k]: e.target.value });

  function pickBuyer(e: React.ChangeEvent<HTMLSelectElement>) {
    const nb = e.target.value === NEW_BUYER;
    setNewBuyer(nb);
    setOwn({ ...own, buyer_id: nb ? "" : e.target.value });
  }

  function reset() {
    setText("");
    setOwn({});
    setNewBuyer(null);
    setFollow(1);
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setError("");
  }

  function save() {
    setError("");
    if (!v.buyer_id && !(isNew && v.prospect.trim())) return setError(isNew ? "Type the new buyer's name." : "Pick the buyer.");
    const product = v.product.trim() || (photos.length ? "See the photos" : "");
    if (!product) return setError("Say what they want: the product, like satin co-ord sets.");
    start(async () => {
      const res = await createInquiry({
        buyer_id: isNew ? "" : v.buyer_id, prospect: isNew ? v.prospect : "", contact_name: v.contact_name, contact: v.contact,
        source: v.source || "whatsapp", product, est_qty: v.est_qty, unit: v.unit, target_price: v.target_price,
        merchandiser_id: meId, next_follow_up: addDays(today, follow), notes: v.notes,
      });
      if (res.error || !res.id) return setError(res.error ?? "It didn't save. Try again.");
      if (photos.length) {
        try {
          const paths = await uploadPhotos(`${companyId}/inquiries/${res.id}`, photos.map((p) => p.file));
          const saved = await setInquiryPhotos(res.id, paths);
          if (saved.error) toast(`Logged, but the photos didn't save: ${saved.error}`, "bad");
        } catch (err) {
          toast(`Logged, but the photos didn't upload: ${err instanceof Error ? err.message : "try again"}`, "bad");
        }
      }
      toast(`${res.no ?? "Inquiry"} logged. It comes back ${FOLLOW.find((f) => f.d === follow)?.label.toLowerCase()} to follow up.`);
      reset();
      router.refresh();
    });
  }

  const example = `${buyers.find((b) => b.label.length <= 16)?.label ?? "Uptownie"} 1200 satin co-ords @450`;
  const cls = (k: Field) => `inp ${found(k) ? "is-found" : ""}`;
  const anyFound = (["buyer_id", "prospect", "product", "est_qty", "target_price", "contact_name"] as Field[]).some(found);

  return (
    <section className={`qadd ${open ? "is-open" : ""}`} aria-label="Log an inquiry">
      <div className="qadd-box">
        <textarea ref={box} className="qadd-text" rows={open ? Math.min(6, Math.max(2, text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 42)), 0))) : 1} value={text}
          onChange={(e) => { setText(e.target.value); setError(""); }} maxLength={6000}
          placeholder="Paste or type a buyer's ask" aria-label="The buyer's message" />
        {!open && (
          <button type="button" className="btn primary qadd-go" onClick={() => box.current?.focus()}>
            <span aria-hidden>+</span> Log
          </button>
        )}
      </div>

      {!open && <p className="qadd-hint">A WhatsApp message, an email, or a line like: {example}</p>}

      {open && (
        <div className="qadd-body">
          {anyFound && <p className="qadd-read">Green boxes are filled in from the message. Check them, change anything.</p>}
          <div className="qadd-grid">
            <label className="field">
              <span>Buyer</span>
              <select className={cls(isNew ? "prospect" : "buyer_id")} value={isNew ? NEW_BUYER : v.buyer_id} onChange={pickBuyer}>
                <option value="">Pick the buyer</option>
                {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                <option value={NEW_BUYER}>A new buyer, not in the list</option>
              </select>
            </label>
            {isNew && (
              <label className="field">
                <span>New buyer&apos;s name</span>
                <input className={cls("prospect")} value={v.prospect} onChange={set("prospect")} maxLength={120} placeholder="Brand or company" autoFocus={!v.prospect} />
              </label>
            )}
            <label className="field qadd-wide">
              <span>What they want</span>
              <input className={cls("product")} value={v.product} onChange={set("product")} maxLength={200} placeholder="Satin co-ord sets, printed kurtas…" />
            </label>
            <label className="field">
              <span>Quantity</span>
              <div className="row !flex-nowrap !gap-2">
                <input className={cls("est_qty")} inputMode="numeric" value={v.est_qty} onChange={set("est_qty")} placeholder="1200" aria-label="Quantity" />
                <select className="inp !w-[76px] shrink-0" value={v.unit} onChange={set("unit")} aria-label="Unit">
                  <option value="pcs">pcs</option>
                  <option value="m">m</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span>Their target, ₹</span>
              <input className={cls("target_price")} inputMode="decimal" value={v.target_price} onChange={set("target_price")} placeholder="Blank if not given" />
            </label>
            <label className="field">
              <span>Contact</span>
              <input className={cls("contact_name")} value={[v.contact_name, v.contact].filter(Boolean).join(" · ")} maxLength={200} placeholder="Name, phone or email"
                onChange={(e) => {
                  const [name, ...rest] = e.target.value.split(" · ");
                  setOwn({ ...own, contact_name: name, contact: rest.join(" · ") });
                }} />
            </label>
            <label className="field">
              <span>Came by</span>
              <select className="inp" value={v.source || "whatsapp"} onChange={set("source")}>
                {INQUIRY_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          <div className="inq-when" role="group" aria-label="Follow up">
            <span>Follow up</span>
            {FOLLOW.map((f) => (
              <button key={f.d} type="button" className={`chip ${follow === f.d ? "info" : ""}`} aria-pressed={follow === f.d} onClick={() => setFollow(f.d)}>{f.label}</button>
            ))}
          </div>

          <PhotoPicker files={photos} onChange={setPhotos} max={12} disabled={pending} label="Photos or screenshots (optional)" />

          {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
          <div className="qadd-acts">
            <button type="button" className="btn ghost" onClick={reset} disabled={pending}>Clear</button>
            <button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? "Logging…" : "Log inquiry"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
