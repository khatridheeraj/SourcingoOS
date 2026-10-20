"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideNote, type TeamNote } from "@/components/help/actions";
import { NoteFiles, STATUS_TONE } from "@/components/help/help-chat";
import { toast } from "@/components/toast";
import { roleLabel, type Role } from "@/lib/auth-roles";

const KIND = { problem: "Not working", wrong_data: "Wrong data", idea: "Idea", question: "Question" };
const STATUS = { new: "Waiting", planned: "Going ahead", later: "Later", done: "Done", declined: "Not doing" };
const OUTCOMES: { status: TeamNote["status"]; label: string; done: string }[] = [
  { status: "planned", label: "Go ahead", done: "Going ahead. Claude picks it up tomorrow morning." },
  { status: "done", label: "Done", done: "Closed as done." },
  { status: "later", label: "Later", done: "Kept for later." },
  { status: "declined", label: "Not doing", done: "Closed as not doing." },
];
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// One note for the owner: what was sent, from where, Claude's suggestion, and the decision with a reply.
export function NoteDecide({ n }: { n: TeamNote }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function decide(status: TeamNote["status"], msg: string) {
    setError("");
    start(async () => {
      const res = await decideNote(n.id, status, reply);
      if (res.error) return setError(res.error);
      setReply("");
      toast(msg);
      router.refresh();
    });
  }

  return (
    <article className={`note${n.status === "new" ? "" : " decided"}`}>
      <div className="note-h">
        <span className={`chip ${n.kind === "idea" ? "ok" : n.kind === "question" ? "info" : "warn"}`}>{KIND[n.kind]}</span>
        {n.status !== "new" && <span className={`chip ${STATUS_TONE[n.status]}`}>{STATUS[n.status]}</span>}
        <span className="note-when">#{n.no} · {at.format(new Date(n.created_at))}</span>
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
            disabled={pending || (o.status === n.status && !reply.trim())} onClick={() => decide(o.status, o.done)}>
            {o.label}
          </button>
        ))}
      </div>
    </article>
  );
}
