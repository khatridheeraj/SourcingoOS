"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { decideNote, type TeamNote } from "@/components/help/actions";
import { NoteFiles, STATUS_TONE } from "@/components/help/help-chat";
import { toast } from "@/components/toast";
import { roleLabel, type Role } from "@/lib/auth-roles";
import { dayTimeAt } from "@/lib/format";

const KIND = { problem: "Not working", wrong_data: "Wrong data", idea: "Idea", question: "Question" };
const STATUS = { new: "Waiting", planned: "Going ahead", later: "Later", done: "Done", declined: "Not doing" };
const OUTCOMES: { status: TeamNote["status"]; label: string; done: string }[] = [
  { status: "planned", label: "Go ahead", done: "Going ahead. Claude picks it up tomorrow morning." },
  { status: "done", label: "Done", done: "Closed as done." },
  { status: "later", label: "Later", done: "Kept for later." },
  { status: "declined", label: "Not doing", done: "Closed as not doing." },
];

// One note for the owner: what was sent, from where, Claude's suggestion, and the decision with a reply.
export function NoteDecide({ n }: { n: TeamNote }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const card = useRef<HTMLElement>(null);

  function decide(status: TeamNote["status"], msg: string, byKeys: boolean) {
    setError("");
    start(async () => {
      const res = await decideNote(n.id, status, reply);
      if (res.error) return setError(res.error);
      setReply("");
      toast(msg);
      // A decided note leaves its tab and the pressed button goes with it, which dropped keyboard focus to the
      // page top. Move it to the next note's reply box (or this one's, or the tabs). Not on a phone: that pops
      // the keyboard up for nothing.
      if (byKeys || window.matchMedia("(pointer: fine)").matches) keepFocus(card.current);
      router.refresh();
    });
  }

  return (
    <article ref={card} className={`note${n.status === "new" ? "" : " decided"}`}>
      <div className="note-h">
        <span className={`chip ${n.kind === "idea" ? "ok" : n.kind === "question" ? "info" : "warn"}`}>{KIND[n.kind]}</span>
        {n.status !== "new" && <span className={`chip ${STATUS_TONE[n.status]}`}>{STATUS[n.status]}</span>}
        <span className="note-when">#{n.no} · {dayTimeAt(new Date(n.created_at))}</span>
      </div>
      <div className="text-[13px] text-muted">
        <b className="font-medium text-foreground">{n.sender ?? "Someone"}</b>
        {n.sender_role && ` · ${roleLabel(n.sender_role as Role)}`}
        {n.page_title && <> · {n.page?.startsWith("/") ? <Link href={n.page} className="link">{n.page_title}</Link> : n.page_title}</>}
      </div>
      <p className="note-body">{n.body}</p>
      <NoteFiles files={n.files} label={`note ${n.no}`} />
      {n.suggestion ? (
        <div className="note-idea"><span>Claude suggests</span><p className="whitespace-pre-wrap">{n.suggestion}</p></div>
      ) : n.status === "new" && (
        <p className="text-[12.5px] text-faint">Claude reads new notes every morning and writes a suggestion here.</p>
      )}
      {n.reply && (
        <div className="note-reply"><span>Your reply{n.replied_by ? ` (${n.replied_by})` : ""}</span><p>{n.reply}</p></div>
      )}
      <textarea className="inp" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000}
        placeholder={n.reply ? "Write another reply (optional)" : "Reply to the sender (optional)"} aria-label={`Reply to note ${n.no}`} />
      {error && <div className="errbox">{error}</div>}
      <div className="note-acts">
        {OUTCOMES.map((o) => (
          <button key={o.status} type="button" className={`btn sm${o.status === "planned" && n.status === "new" ? " primary" : ""}`}
            disabled={pending || (o.status === n.status && !reply.trim())} onClick={(e) => decide(o.status, o.done, e.detail === 0)}>
            {o.label}
          </button>
        ))}
      </div>
    </article>
  );
}

function keepFocus(art: HTMLElement | null) {
  if (!art) return;
  const sib = (art.nextElementSibling ?? art.previousElementSibling) as HTMLElement | null;
  const next = sib?.querySelector("textarea")?.getAttribute("aria-label");
  const t0 = Date.now();
  const tick = () => {
    // Wait for the refreshed list: the note either leaves this tab or (after 3 s) is taken to stay.
    if (art.isConnected && Date.now() - t0 < 3000) return void setTimeout(tick, 100);
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    const target = (next && document.querySelector<HTMLElement>(`textarea[aria-label="${next}"]`))
      || (art.isConnected ? art.querySelector("textarea") : null)
      || document.querySelector<HTMLElement>('nav.seg a[aria-current="page"]');
    target?.focus({ preventScroll: false });
  };
  setTimeout(tick, 100);
}
