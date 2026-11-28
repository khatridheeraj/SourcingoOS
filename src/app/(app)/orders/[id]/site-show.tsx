"use client";
import "@/app/trade.css";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { showOnSite } from "./site-actions";

type Style = { id: string; style: string; description: string; photoUrl: string; shown: boolean; caption: string };

// Owner only, once a style has shipped: put its photo in "Made here before" on the website, or take it off. A buyer's
// design stays private until the owner chooses; the website never shows buyer or factory names.
export function SiteShow({ styles }: { styles: Style[] }) {
  const router = useRouter();
  const [captions, setCaptions] = useState<Record<string, string>>(() => Object.fromEntries(styles.map((s) => [s.id, s.caption || s.description])));
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();
  if (!styles.length) return null;
  const shown = styles.filter((s) => s.shown).length;
  const act = (s: Style, show: boolean) => {
    setBusy(s.id);
    start(async () => {
      let r: { error?: string };
      try { r = await showOnSite(s.id, show, captions[s.id] ?? ""); } catch (e) { r = { error: caught(e, "It didn't save. Try again.") }; }
      setBusy("");
      if (r.error) return toast(r.error, "bad");
      toast(show ? `${s.style} now shows on the website` : `${s.style} is off the website`);
      router.refresh();
    });
  };
  return (
    <details className="panel">
      <summary className="cursor-pointer font-semibold">On the website <small className="font-normal text-muted">· {shown ? `${shown} of ${styles.length} photos shown` : "optional"}</small></summary>
      <p className="mt-1 text-[13px] text-muted">Show a shipped style&apos;s photo under &quot;Made here before&quot; on the product pages. Only do it when the buyer is fine with their design being seen. Names never show.</p>
      <ul className="made-list">
        {styles.map((s) => (
          <li key={s.id} className="made-row">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
            <img src={s.photoUrl} alt="" data-zoom data-caption={s.style} />
            <div>
              <b className="text-[13.5px]">{s.style}</b>
              <input className="inp mt-1" aria-label={`Caption for ${s.style}`} value={captions[s.id] ?? ""} maxLength={80} disabled={s.shown}
                onChange={(e) => setCaptions({ ...captions, [s.id]: e.target.value })} placeholder="Block-print cotton kurta" />
            </div>
            <button type="button" className={`btn sm${s.shown ? " ghost" : ""}`} disabled={pending} onClick={() => act(s, !s.shown)}>
              {busy === s.id ? "Saving…" : s.shown ? "Take off" : "Show"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
