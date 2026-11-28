"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NEXT_COOKIE } from "@/lib/next-path";
import { likelyTypo, refusal, RESEND_WAIT } from "@/lib/sign-in";

function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LoginForm({ linkError, next }: { linkError: boolean; next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(
    linkError ? "That link was already used or has run out. If you opened it on another device, you're signed in there. To sign in here, send a new one and open it on this device." : "",
  );
  // The wait is for one address: a corrected address can be sent to straight away.
  const [until, setUntil] = useState({ email: "", at: 0 });
  const [now, setNow] = useState(() => Date.now());
  const left = until.email === email.trim().toLowerCase() ? Math.max(0, Math.ceil((until.at - now) / 1000)) : 0;
  const typo = likelyTypo(email);

  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);

  function wait(seconds: number) {
    if (seconds <= 0) return;
    setNow(Date.now());
    setUntil({ email: email.trim().toLowerCase(), at: Date.now() + seconds * 1000 });
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (left > 0) return;
    setState("sending");
    setError("");
    // Bring them back to the page they opened, if the link is tapped in this browser.
    document.cookie = next === "/today" ? `${NEXT_COOKIE}=; path=/; max-age=0` : `${NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=3600; samesite=lax`;
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      const r = refusal(error.message);
      setError(r.text);
      wait(r.wait);
      setState("idle");
    } else {
      wait(RESEND_WAIT);
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-accent-soft p-4 text-sm">
          <p>Check <b>{email.trim()}</b> for a sign-in link.</p>
          <p className="muted mt-1 text-[13px]">Open it on this device to sign in here. It can take a minute; look in Spam too.</p>
        </div>
        <button type="button" className="btn w-full" disabled={left > 0} onClick={() => send()}>
          {left > 0 ? <>Send again in <span className="num">{clock(left)}</span></> : "Send again"}
        </button>
        <button type="button" className="link text-sm" onClick={() => setState("idle")}>Wrong email? Change it</button>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <label className="field">
        <span>Work email</span>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="inp"
          placeholder="you@sourcingo.in"
        />
      </label>
      {typo && (
        <p className="text-sm">
          Did you mean{" "}
          <button type="button" className="link" onClick={() => setEmail(typo)}>{typo}</button>?
        </p>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
      <button type="submit" disabled={state === "sending" || left > 0} className="btn primary w-full">
        {state === "sending" ? "Sending…" : left > 0 ? <>Send again in <span className="num">{clock(left)}</span></> : "Email me a sign-in link"}
      </button>
    </form>
  );
}
