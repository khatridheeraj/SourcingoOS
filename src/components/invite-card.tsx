"use client";

import { toast } from "@/components/toast";
import { waShare } from "@/lib/referral";

// "Invite someone you know": the person's own link, to send on WhatsApp or copy. Used on the buyer page and the
// factory panel; the words come from the page, so the factory sees them in Hindi or English.
export function InviteCard({ id, title, text, link, message, words }: {
  id: string; title: string; text: string; link: string; message: string;
  words: { share: string; copy: string; copied: string };
}) {
  return (
    <section className="card invite" aria-labelledby={id}>
      <header className="card-h">
        <div className="min-w-0">
          <h2 id={id}>{title}</h2>
          <p>{text}</p>
        </div>
      </header>
      <div className="invite-body">
        <code className="invite-link">{link.replace(/^https?:\/\//, "")}</code>
        <div className="invite-acts">
          <a className="btn wa-link" href={waShare(`${message}\n${link}`)} target="_blank" rel="noopener">{words.share}</a>
          <button type="button" className="btn ghost" onClick={() => { navigator.clipboard?.writeText(link).then(() => toast(words.copied)).catch(() => toast(link)); }}>{words.copy}</button>
        </div>
      </div>
    </section>
  );
}
