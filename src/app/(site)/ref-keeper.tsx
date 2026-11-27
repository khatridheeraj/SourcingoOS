"use client";

import { useEffect, useState } from "react";
import { isRef, REF_KEY } from "@/lib/referral";

// Remembers an invite code from the address (?ref=...) for this visitor, so it reaches the form on a later page.
export function RefKeeper() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (isRef(ref)) window.localStorage.setItem(REF_KEY, ref);
    } catch {
      // Private windows can refuse storage; the form then simply goes without the code.
    }
  }, []);
  return null;
}

// The remembered code, sent with a form.
export function RefField() {
  const [ref, setRef] = useState("");
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("ref");
      const v = isRef(fromUrl) ? fromUrl : window.localStorage.getItem(REF_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the browser after hydration
      if (isRef(v)) setRef(v);
    } catch {}
  }, []);
  return ref ? <input type="hidden" name="ref" value={ref} /> : null;
}
