"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NEXT_COOKIE } from "@/lib/next-path";

// Supabase's own wording for a sign-in it refused, in plain words.
function plain(message: string) {
  const wait = message.match(/after (\d+) seconds?/i);
  if (wait) return `A link was just sent. Wait ${wait[1]} seconds before asking for another.`;
  if (/rate limit/i.test(message)) return "Too many sign-in links in a short time. Use the last one we sent, or try again in an hour.";
  if (/signups not allowed|not allowed for otp/i.test(message)) return "This email isn't on the team yet. Ask the owner to add you.";
  if (/fetch|network/i.test(message)) return "No internet connection. Check it and try again.";
  return message;
}

export function LoginForm({ linkError, next }: { linkError: boolean; next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(linkError ? "That sign-in link has expired. Send a new one." : "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    // Bring them back to the page they opened, if the link is tapped in this browser.
    document.cookie = next === "/today" ? `${NEXT_COOKIE}=; path=/; max-age=0` : `${NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=3600; samesite=lax`;
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      setError(plain(error.message));
      setState("idle");
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-accent-soft p-4 text-sm">
          Check <b>{email}</b> for a sign-in link. You can close this tab.
        </p>
        <button type="button" className="btn w-full" onClick={() => setState("idle")}>Wrong email? Change it</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
      {error && <p className="text-sm text-bad">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="btn primary w-full"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
