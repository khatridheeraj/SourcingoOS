"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { sendFeedback } from "@/app/me-actions";
import { useFeedback } from "@/components/feedback";

// The bell: unread notifications, opens the list.
export function Bell({ unread, href = "/notifications" }: { unread: number; href?: string }) {
  return (
    <Link href={href} className="bell" aria-label={unread ? `${unread} unread notifications` : "Notifications"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

const KINDS = [
  { value: "problem", label: "Something is wrong" },
  { value: "idea", label: "An idea" },
  { value: "question", label: "A question" },
];

// "Tell us" from any screen: the page it was sent from goes with it.
export function FeedbackButton({ label = "Feedback", hi = false }: { label?: string; hi?: boolean }) {
  const path = usePathname();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("problem");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const t = (en: string, h: string) => (hi ? h : en);
  return (
    <>
      <button type="button" className="fb-btn" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("Send feedback", "सुझाव भेजें")}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await sendFeedback(kind, msg, path);
                toast(r.error ?? (hi ? "धन्यवाद। Sourcingo इसे देखेगा।" : r.ok ?? ""), r.error ? "bad" : undefined);
                if (!r.error) { setOpen(false); setMsg(""); }
              });
            }}
          >
            <b className="text-[15px]">{t("Tell the owner", "Sourcingo को बताएं")}</b>
            <div className="seg" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {KINDS.map((k) => (
                <button key={k.value} type="button" className={kind === k.value ? "on" : ""} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
                  {hi ? { problem: "कुछ गलत है", idea: "सुझाव", question: "सवाल" }[k.value] : k.label}
                </button>
              ))}
            </div>
            <textarea className="inp" rows={4} autoFocus maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)}
              placeholder={t("What happened, or what would help?", "क्या हुआ, या क्या मदद करेगा?")} />
            <div className="row">
              <button type="button" className="btn" onClick={() => setOpen(false)}>{t("Cancel", "रद्द करें")}</button>
              <button className="btn primary" disabled={pending || !msg.trim()}>{pending ? "…" : t("Send", "भेजें")}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
