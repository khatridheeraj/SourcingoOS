"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { markNotificationsRead } from "@/app/me-actions";
import { fmtDateTime } from "@/lib/format";

export type Note = { id: number; kind: string; title: string; body: string | null; href: string | null; created_at: string; read_at: string | null };

export function NotificationList({ notes, hi = false }: { notes: Note[]; hi?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = notes.filter((n) => !n.read_at).length;
  const read = (ids: number[] | null) => start(async () => { await markNotificationsRead(ids); router.refresh(); });
  if (!notes.length) return <div className="empty"><b>{hi ? "कोई सूचना नहीं" : "No notifications yet"}</b>{hi ? "नए PO, QC और देरी की खबर यहाँ आएगी।" : "Delays, approvals, factory answers and QC results land here."}</div>;
  return (
    <div className="stack">
      {unread > 0 && <div><button type="button" className="btn sm" disabled={pending} onClick={() => read(null)}>{hi ? "सब पढ़ लिया" : `Mark all ${unread} read`}</button></div>}
      <ul className="notes panel" style={{ padding: 8 }}>
        {notes.map((n) => (
          <li key={n.id} className={n.read_at ? "" : "unread"}>
            <span className="dot" />
            <div className="grow" style={{ flex: 1, minWidth: 0 }}>
              {n.href ? (
                <Link href={n.href} onClick={() => !n.read_at && read([n.id])}><b>{n.title}</b></Link>
              ) : <b>{n.title}</b>}
              {n.body && <div className="text-[13px]">{n.body}</div>}
              <small>{fmtDateTime(n.created_at)}</small>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
