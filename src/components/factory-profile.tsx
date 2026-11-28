"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import "./factory-bits.css";
import { toast } from "@/components/toast";
import { dayNear } from "@/lib/format";
import { canAskVisit, MAKES, MIN_PHOTOS, type FactoryProfile, type Step, type Visit } from "@/lib/onboarding";
import { uploadPhotos } from "@/lib/photos";

type Result = Promise<{ error?: string }>;
type Save = (p: Record<string, unknown>) => Result;

const WORDS = {
  en: {
    ready: "Get ready for orders", readySub: "Four steps. Once our team has visited, your factory is offered new orders that fit it.",
    steps: { about: "Tell us what you make", photos: `Add ${MIN_PHOTOS} photos of your floor`, capacity: "Give your free capacity", visit: "Sourcingo visits you" },
    title: "Your factory", teamTitle: "Profile",
    makes: "What you make", people: "People", machines: "Machines", pieces: "Pieces a month", about: "About", address: "Address", gstin: "GSTIN",
    aboutPh: "Fabrics, prints, embroidery, who you make for", other: "Other",
    save: "Save", saving: "Saving…", saved: "Saved.", edit: "Change", cancel: "Cancel",
    photos: "Floor photos", photosSub: "Cutting, stitching, finishing and packing. No signboards or labels: buyers never see your name.",
    addPhotos: "Add photos", uploading: "Adding…", remove: "Remove",
    visit: "Visit", askVisit: "Ask for a visit", from: "Any day from", note: "Note (timings, landmark)", send: "Send",
    asked: (d: string) => `You asked for a visit from ${d}. We will fix a day with you.`,
    booked: (d: string) => `Sourcingo visits on ${d}.`, verified: (d: string) => `Visited ${d}. Your record shows “Verified by Sourcingo”.`,
    askFirst: "Finish the steps above, then ask for a visit.", needNumbers: "Give people and pieces as whole numbers.",
    notGiven: "Not given",
  },
  hi: {
    ready: "ऑर्डर के लिए तैयार हों", readySub: "चार कदम। हमारी टीम के आने के बाद आपकी फैक्ट्री को उसके लायक नए ऑर्डर मिलते हैं।",
    steps: { about: "बताएँ आप क्या बनाते हैं", photos: `फैक्ट्री की ${MIN_PHOTOS} फोटो लगाएँ`, capacity: "खाली क्षमता बताएँ", visit: "Sourcingo आपकी फैक्ट्री आएगा" },
    title: "आपकी फैक्ट्री", teamTitle: "",
    makes: "आप क्या बनाते हैं", people: "कारीगर", machines: "मशीनें", pieces: "महीने में पीस", about: "जानकारी", address: "पता", gstin: "GSTIN",
    aboutPh: "कपड़ा, प्रिंट, कढ़ाई, किसके लिए बनाते हैं", other: "दूसरा",
    save: "भेजें", saving: "भेज रहे हैं…", saved: "भेज दिया।", edit: "बदलें", cancel: "रद्द करें",
    photos: "फैक्ट्री की फोटो", photosSub: "कटिंग, सिलाई, फिनिशिंग और पैकिंग। बोर्ड या लेबल न दिखें: खरीदार आपका नाम कभी नहीं देखते।",
    addPhotos: "फोटो लगाएँ", uploading: "लगा रहे हैं…", remove: "हटाएँ",
    visit: "विज़िट", askVisit: "विज़िट के लिए कहें", from: "किस दिन से", note: "नोट (समय, पता)", send: "भेजें",
    asked: (d: string) => `आपने ${d} से विज़िट के लिए कहा है। हम आपसे दिन तय करेंगे।`,
    booked: (d: string) => `Sourcingo ${d} को आएगा।`, verified: (d: string) => `${d} को विज़िट हुई। आपके रिकॉर्ड पर “Verified by Sourcingo” है।`,
    askFirst: "ऊपर के कदम पूरे करें, फिर विज़िट के लिए कहें।", needNumbers: "कारीगर और पीस सिर्फ़ अंकों में लिखें।",
    notGiven: "नहीं बताया",
  },
} as const;

const n = (v: number | null | undefined) => (v == null ? "" : v.toLocaleString("en-IN"));

// A factory's profile and its way to the first order: what it makes, floor photos, then a visit. The factory fills it
// from its panel; the team reads and corrects it on the factory's record and books the visit.
export function FactoryProfileCard({ profile, photoUrls, steps, visit, folder, mode, lang = "en", canEdit, today, save, ask, book, onboarding = false }: {
  profile: FactoryProfile; photoUrls: Record<string, string>; steps: Step[]; visit: Visit; folder: string;
  mode: "team" | "factory"; lang?: "en" | "hi"; canEdit: boolean; today: string;
  save: Save; ask?: (from: string, note: string) => Result; book?: (on: string | null) => Result;
  // A new factory with no orders yet: the steps lead the card and the form starts open.
  onboarding?: boolean;
}) {
  const w = WORDS[mode === "team" ? "en" : lang];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(onboarding && canEdit && !steps[0].done);
  const [f, setF] = useState({
    makes: profile.makes, people: n(profile.people), machines: n(profile.machines), pieces_month: n(profile.pieces_month),
    about: profile.about ?? "", address: profile.address ?? "", gstin: profile.gstin ?? "",
  });
  const [other, setOther] = useState("");
  const [visitDay, setVisitDay] = useState(mode === "team" ? (profile.visit_on ?? profile.visit_from ?? "") : (profile.visit_from ?? today));
  const [note, setNote] = useState(profile.visit_note ?? "");
  
  const run = (fn: () => Result, after?: () => void) => start(async () => {
    setError("");
    const r = await fn();
    if (r.error) return setError(r.error);
    toast(w.saved);
    after?.();
    router.refresh();
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const nums = [f.people, f.machines, f.pieces_month].map((x) => x.replace(/[,\s]/g, ""));
    if (nums.some((x) => x && !/^\d{1,8}$/.test(x))) return setError(w.needNumbers);
    const makes = [...f.makes, ...(other.trim() ? [other.trim()] : [])];
    run(() => save({ makes, people: nums[0], machines: nums[1], pieces_month: nums[2], about: f.about, address: f.address, gstin: f.gstin }), () => { setEditing(false); setOther(""); });
  }

  function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    start(async () => {
      setError("");
      try {
        const paths = await uploadPhotos(folder, Array.from(files).slice(0, 12 - profile.photos.length));
        const r = await save({ photos: [...profile.photos, ...paths] });
        if (r.error) return setError(r.error);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  const facts: [string, string][] = [
    [w.makes, profile.makes.join(", ")], [w.pieces, n(profile.pieces_month)], [w.people, n(profile.people)], [w.machines, n(profile.machines)],
    [w.gstin, profile.gstin ?? ""], [w.address, profile.address ?? ""],
  ];

  return (
    <section id="profile" className="panel stack scroll-mt-20" aria-labelledby="prof-h">
      {onboarding ? (
        <div>
          <h2 id="prof-h" className="font-bold">{w.ready}</h2>
          <p className="muted text-[13px]">{w.readySub}</p>
          <ol className="ready-steps">
            {steps.map((s) => (
              <li key={s.key} className={s.done ? "done" : ""}>
                <i aria-hidden>{s.done ? "✓" : ""}</i>
                <span>{s.key === "capacity" && !s.done ? <a className="link" href="#capacity">{w.steps[s.key]}</a> : w.steps[s.key]}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <h2 id="prof-h" className="font-bold">{mode === "team" ? w.teamTitle : w.title}</h2>
      )}

      {editing ? (
        <form className="stack" onSubmit={submit} noValidate>
          <fieldset className="field">
            <span>{w.makes}</span>
            <div className="row cert-pick">
              {[...MAKES, ...f.makes.filter((m) => !(MAKES as readonly string[]).includes(m))].map((m) => (
                <button key={m} type="button" className="btn sm" aria-pressed={f.makes.includes(m)}
                  onClick={() => setF((x) => ({ ...x, makes: x.makes.includes(m) ? x.makes.filter((y) => y !== m) : [...x.makes, m] }))}>{m}</button>
              ))}
            </div>
            <input className="inp mt-2" value={other} maxLength={40} placeholder={w.other} aria-label={`${w.makes}: ${w.other}`} onChange={(e) => setOther(e.target.value)} />
          </fieldset>
          <div className="fgrid">
            <label className="field"><span>{w.pieces}</span><input className="inp num" inputMode="numeric" value={f.pieces_month} onChange={(e) => setF({ ...f, pieces_month: e.target.value })} /></label>
            <label className="field"><span>{w.people}</span><input className="inp num" inputMode="numeric" value={f.people} onChange={(e) => setF({ ...f, people: e.target.value })} /></label>
            <label className="field"><span>{w.machines}</span><input className="inp num" inputMode="numeric" value={f.machines} onChange={(e) => setF({ ...f, machines: e.target.value })} /></label>
            <label className="field"><span>{w.gstin}</span><input className="inp code" value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></label>
          </div>
          <label className="field"><span>{w.address}</span><input className="inp" value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label className="field"><span>{w.about}</span><textarea className="inp" rows={3} value={f.about} maxLength={600} placeholder={w.aboutPh} onChange={(e) => setF({ ...f, about: e.target.value })} /></label>
          {error && <div className="errbox" role="alert">{error}</div>}
          <div className="row cert-go">
            <button className="btn primary" disabled={pending}>{pending ? w.saving : w.save}</button>
            {steps[0].done && <button type="button" className="btn" disabled={pending} onClick={() => { setEditing(false); setError(""); }}>{w.cancel}</button>}
          </div>
        </form>
      ) : (
        <div className="stack gap-2">
          <dl className="facts">
            {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={v ? "" : "muted"}>{v || w.notGiven}</dd></div>)}
          </dl>
          {profile.about && <p className="text-[14px]">{profile.about}</p>}
          {canEdit && <div><button type="button" className="btn sm" onClick={() => setEditing(true)}>{w.edit}</button></div>}
        </div>
      )}

      <div className="stack gap-2">
        <div>
          <h3 className="text-[14px] font-semibold">{w.photos} <span className="muted font-normal num">{profile.photos.length}</span></h3>
          {mode === "factory" && <p className="muted text-[13px]">{w.photosSub}</p>}
        </div>
        {profile.photos.length > 0 && (
          <ul className="floor-photos">
            {profile.photos.map((p) => (
              <li key={p}>
                {photoUrls[p] ? <a href={photoUrls[p]} target="_blank" rel="noreferrer"><img src={photoUrls[p]} alt="" loading="lazy" /></a> : <span />}
                {canEdit && <button type="button" className="btn ghost sm" disabled={pending} aria-label={w.remove}
                  onClick={() => run(() => save({ photos: profile.photos.filter((x) => x !== p) }))}>×</button>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && profile.photos.length < 12 && (
          <label className={`btn ${onboarding && steps[0].done && !steps[1].done ? "primary" : ""} self-start`}>
            {pending ? w.uploading : w.addPhotos}
            <input type="file" accept="image/*" multiple hidden disabled={pending} onChange={(e) => addPhotos(e.target.files)} />
          </label>
        )}
      </div>

      <div className="stack gap-2">
        <h3 className="text-[14px] font-semibold">{w.visit}</h3>
        {visit.state === "verified" && <p className="text-[14px]">{w.verified(dayNear(visit.on!))}</p>}
        {visit.state === "booked" && <p className="text-[14px]">{mode === "team" ? `Visit booked for ${dayNear(visit.on!)}. Save the visit on this page once you have been.` : w.booked(dayNear(visit.on!))}</p>}
        {visit.state === "asked" && <p className="text-[14px] text-warn">{mode === "team" ? `Asked for a visit from ${dayNear(visit.on ?? today)}. Book the day and tell the factory.` : w.asked(dayNear(visit.on ?? today))}{profile.visit_note ? ` “${profile.visit_note}”` : ""}</p>}
        {mode === "factory" && visit.state !== "verified" && (
          !canAskVisit(steps) ? (visit.state === "none" && <p className="muted text-[13px]">{w.askFirst}</p>)
          : canEdit && ask ? (
            <div className="stack gap-2">
              <div className="fgrid">
                <label className="field"><span>{w.from}</span><input className="inp" type="date" min={today} value={visitDay} onChange={(e) => setVisitDay(e.target.value)} /></label>
                <label className="field"><span>{w.note}</span><input className="inp" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              </div>
              <div className="cert-go"><button type="button" className={`btn ${visit.state === "none" ? "primary" : ""}`} disabled={pending || !visitDay} onClick={() => run(() => ask(visitDay, note))}>{visit.state === "none" ? w.askVisit : w.send}</button></div>
            </div>
          ) : null
        )}
        {mode === "team" && visit.state === "none" && <p className="muted text-[13px]">The factory hasn&apos;t asked for a visit yet. Book one here if you are going anyway.</p>}
        {mode === "team" && canEdit && book && visit.state !== "verified" && (
          <div className="row flex-nowrap visit-book">
            <label className="field grow"><span>Visit on</span><input className="inp" type="date" min={today} value={visitDay} onChange={(e) => setVisitDay(e.target.value)} /></label>
            <button type="button" className="btn self-end" disabled={pending || !visitDay} onClick={() => run(() => book(visitDay))}>Book visit</button>
          </div>
        )}
        {!editing && error && <div className="errbox" role="alert">{error}</div>}
      </div>
    </section>
  );
}
