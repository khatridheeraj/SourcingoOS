"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { setRecordPublic } from "./actions";

// Copy the public link, for an email or a chat.
export function CopyLink({ url }: { url: string }) {
  return (
    <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(url).then(() => toast("Link copied.")).catch(() => toast("Couldn't copy. The link is " + url)); }}>
      Copy link
    </button>
  );
}

// The owner's switch: show our record on the website, with a "sure?" step either way.
export function PublicSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function save() {
    setError("");
    start(async () => {
      const res = await setRecordPublic(!on);
      if (res.error) return setError(res.error);
      toast(on ? "Our record is off the website." : "Our record is on the website now.");
      setSure(false);
      router.refresh();
    });
  }
  return (
    <div className="stack">
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        {sure ? (
          <>
            <span className="text-[13px]">{on ? "Take it off the website?" : "Anyone with the link, and every website visitor, sees these numbers. Show it?"}</span>
            <button type="button" className="btn primary sm" disabled={pending} onClick={save}>{pending ? "Saving…" : on ? "Yes, take it off" : "Yes, show it"}</button>
            <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setSure(false)}>No</button>
          </>
        ) : (
          <button type="button" className={on ? "btn ghost" : "btn"} onClick={() => setSure(true)}>{on ? "Take off the website" : "Show on the website"}</button>
        )}
      </div>
    </div>
  );
}
