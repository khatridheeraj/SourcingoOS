"use client";

import Link from "next/link";
import { useEffect } from "react";
import { isDropped, isSignedOut } from "@/lib/errors";

// Shown in place of a page that failed to load, so a phone app (with no back button or address bar) always has a
// way out: try again, or go home.
export function PageError({ error, retry, home, words, offline, signedOut }: {
  error: Error & { digest?: string };
  retry: () => void;
  home: string;
  words?: { title: string; body: string; retry: string; home: string };
  // Said instead when the page fell over because the connection dropped in the middle of a tap.
  offline?: { title: string; body: string };
  // Said instead when a tap reached the server after the person was signed out.
  signedOut?: { title: string; body: string; signIn: string };
}) {
  useEffect(() => console.error(error), [error]);
  const w = words ?? {
    title: "This page couldn't load",
    body: "Nothing you saved is lost. Try again, and if it keeps happening, tell Dheeraj what you were doing.",
    retry: "Try again",
    home: "Go to Home",
  };
  const dropped = isDropped(error.message ?? "");
  const off = offline ?? {
    title: "The connection dropped",
    body: "What you just tapped may not have saved. When the network is back, tap Try again and check it.",
  };
  if (isSignedOut(error.message ?? "")) {
    const o = signedOut ?? { title: "You were signed out", body: "What you just tapped didn't save. Sign in again to carry on.", signIn: "Sign in again" };
    const back = typeof window === "undefined" ? "" : window.location.pathname + window.location.search;
    return (
      <div className="empty" role="alert">
        <b>{o.title}</b>
        {o.body}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <a href={`/login${back && back !== "/" ? `?next=${encodeURIComponent(back)}` : ""}`} className="btn primary">{o.signIn}</a>
        </div>
      </div>
    );
  }
  return (
    <div className="empty" role="alert">
      <b>{dropped ? off.title : w.title}</b>
      {dropped ? off.body : w.body}
      {error.digest && !dropped && <small className="muted mt-1 block">Code {error.digest}</small>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button type="button" className="btn" onClick={() => retry()}>{w.retry}</button>
        <Link href={home} className="btn ghost">{w.home}</Link>
      </div>
    </div>
  );
}
