"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { handle, NOTE_MAX, NOTE_PHOTOS, pieces, tagged, type Person } from "@/lib/notes";
import { uploadPhotos } from "@/lib/photos";
import { clearMention, postOrderNote } from "../note-actions";

export type Note = {
  id: string; body: string; by: string; byMe: boolean; when: string;
  // Names of the people it tags, and whether it still waits on me.
  tags: string[]; forMe: boolean; photos: string[];
};

const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

// The team's conversation about one order: notes oldest first like a chat, and a box to write one, tag people and add
// photos. A tagged person sees the note on Home until they reply here or tap Done.
export function OrderTalk({ orderId, companyId, meId, notes, team, canWrite }: {
  orderId: string; companyId: string; meId: string; notes: Note[]; team: Person[]; canWrite: boolean;
}) {
  const others = team.filter((p) => p.id !== meId);
  const router = useRouter();
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState<{ text: string; field?: "body" } | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const waiting = notes.filter((n) => n.forMe).length;
  const shown = notes.slice(-8);
  const earlier = notes.slice(0, -8);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  // Tapping a name puts @Name in the text too, so the note reads the way it will be sent.
  function tag(p: Person) {
    const on = picked.includes(p.id);
    toggle(p.id);
    const word = `@${handle(p.name)}`;
    if (!on && !body.toLowerCase().includes(word.toLowerCase())) setBody((b) => `${b}${b && !/\s$/.test(b) ? " " : ""}${word} `);
    box.current?.focus();
  }

  function send() {
    setError(null);
    const text = body.trim();
    if (!text) { setError({ text: "Write the note first.", field: "body" }); box.current?.focus(); return; }
    if (text.length > NOTE_MAX) { setError({ text: `Keep the note under ${NOTE_MAX.toLocaleString("en-IN")} characters (it has ${text.length.toLocaleString("en-IN")}).`, field: "body" }); box.current?.focus(); return; }
    start(async () => {
      try {
        const id = crypto.randomUUID();
        const photos = files.length ? await uploadPhotos(`${companyId}/${orderId}/notes/${id}`, files.map((f) => f.file)) : [];
        const mentions = tagged(text, picked, team);
        const res = await postOrderNote({ id, orderId, body: text, mentions, photos });
        if (res.error) { setError({ text: res.error, field: res.field }); if (res.field) box.current?.focus(); return; }
        setBody(""); setPicked([]); setFiles([]);
        const names = others.filter((p) => mentions.includes(p.id)).map((p) => handle(p.name));
        toast(names.length ? `Sent. ${names.join(", ")} will see it on Home.` : "Note added.");
        router.refresh();
      } catch (e) {
        setError({ text: caught(e, "The note didn't send. Try again.") });
      }
    });
  }

  function done(noteId?: string) {
    start(async () => {
      const res = await clearMention(orderId, noteId);
      if (res.error) { toast(res.error, "bad"); return; }
      router.refresh();
    });
  }

  const row = (n: Note) => (
    <li key={n.id} className={`talk-row${n.forMe ? " for-me" : ""}`} id={`talk-${n.id}`}>
      <span className="talk-av" aria-hidden>{initials(n.by)}</span>
      <div className="min-w-0">
        <div className="talk-meta"><b>{n.byMe ? "You" : n.by}</b><span>{n.when}</span></div>
        <p className="talk-body">
          {pieces(n.body, team).map((p, i) => (p.tag ? <span key={i} className="talk-tag">{p.text}</span> : <span key={i}>{p.text}</span>))}
        </p>
        {n.photos.length > 0 && (
          <div className="floor-photos">
            {n.photos.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" aria-label={`Photo ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                <img src={url} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {n.tags.length > 0 && <p className="talk-to">To {n.tags.join(", ")}</p>}
        {n.forMe && (
          <div className="talk-acts">
            <span className="why warn">Waiting on you</span>
            <button type="button" className="btn sm" disabled={pending} onClick={() => done(n.id)}>Done</button>
          </div>
        )}
      </div>
    </li>
  );

  return (
    <section className="panel scroll-mt-20" id="talk" aria-labelledby="talk-h">
      <div className="row mb-1">
        <h2 id="talk-h" className="font-bold text-base">Team notes</h2>
        {waiting > 1 && <button type="button" className="btn sm ml-auto" disabled={pending} onClick={() => done()}>Mark all {waiting} done</button>}
      </div>
      {notes.length === 0 ? (
        <p className="muted mb-2 text-[13px]">No notes on this order yet. Write one below and tag whoever needs to act.</p>
      ) : (
        <>
          {earlier.length > 0 && (
            <details className="mb-1">
              <summary className="link cursor-pointer text-[13px]">{earlier.length} earlier {earlier.length === 1 ? "note" : "notes"}</summary>
              <ul className="talk-list">{earlier.map(row)}</ul>
            </details>
          )}
          <ul className="talk-list">{shown.map(row)}</ul>
        </>
      )}
      {canWrite && (
        <form className="talk-new" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="field">
            <span>New note</span>
            <textarea ref={box} className="inp" rows={3} value={body} maxLength={NOTE_MAX + 200}
              placeholder="What happened, or what someone needs to do. Type @ and a name to tag them."
              aria-invalid={error?.field === "body" || undefined} aria-describedby={error ? "talk-err" : undefined}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
          </label>
          {error && <p id="talk-err" className="mt-1 text-[13px] font-semibold text-bad" role="alert">{error.text}</p>}
          {others.length > 0 && (
            <div className="talk-people" role="group" aria-label="Tag someone">
              <span className="muted text-[12.5px]">Tag</span>
              {others.map((p) => (
                <button key={p.id} type="button" className="chip-pick" aria-pressed={picked.includes(p.id)} onClick={() => tag(p)}>{handle(p.name)}</button>
              ))}
            </div>
          )}
          <PhotoPicker files={files} onChange={setFiles} max={NOTE_PHOTOS} disabled={pending} label="Photos" />
          <button type="submit" className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send note"}</button>
        </form>
      )}
      <details className="howto mt-4 border-t border-line pt-3">
        <summary>How team notes work</summary>
        <p>Use notes for anything the team would otherwise say on WhatsApp about this order: a problem at the factory, a buyer&apos;s request, a reminder. Tag someone with the Tag buttons or by typing @ and their first name. The note then shows on their Home until they reply here or tap Done. Notes can&apos;t be changed or deleted, so write a new one if something changes. Factories and buyers never see them.</p>
      </details>
    </section>
  );
}
