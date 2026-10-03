"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ linkError }: { linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(linkError ? "That sign-in link has expired. Send a new one." : "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      setError(error.message);
      setState("idle");
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <p className="rounded-lg bg-accent-soft p-4 text-sm">
        Check <b>{email}</b> for a sign-in link. You can close this tab.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold text-muted">
        Work email
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-base font-normal text-foreground"
        />
      </label>
      {error && <p className="text-sm text-bad">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
