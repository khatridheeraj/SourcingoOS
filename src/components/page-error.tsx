"use client";

import Link from "next/link";
import { useEffect } from "react";

// Shown in place of a page that failed to load, so a phone app (with no back button or address bar) always has a
// way out: try again, or go home.
export function PageError({ error, retry, home, words }: {
  error: Error & { digest?: string };
  retry: () => void;
  home: string;
  words?: { title: string; body: string; retry: string; home: string };
}) {
  useEffect(() => console.error(error), [error]);
  const w = words ?? {
    title: "This page couldn't load",
    body: "Nothing you saved is lost. Try again, and if it keeps happening, tell Dheeraj what you were doing.",
    retry: "Try again",
    home: "Go to Home",
  };
  return (
    <div className="empty" role="alert">
      <b>{w.title}</b>
      {w.body}
      {error.digest && <small className="muted mt-1 block">Code {error.digest}</small>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button type="button" className="btn" onClick={() => retry()}>{w.retry}</button>
        <Link href={home} className="btn ghost">{w.home}</Link>
      </div>
    </div>
  );
}
