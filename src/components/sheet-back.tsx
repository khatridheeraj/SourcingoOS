"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// On a phone, Back with a sheet open closes the sheet, like in any app. Without this, Back left the page (a factory
// on its panel left the app) with the half-filled sheet, its photos and note lost. Every <dialog> opened with
// showModal() gets one history entry while it is open: Back pops it and closes the sheet, and closing the sheet any
// other way (Close, Escape, saving) takes the entry back off, so the next Back goes where it always did.
let leaving = false;

// Call just before closing a sheet to go to another page, so its history entry is left for the new page to follow
// (taking it off at the same moment would race the navigation).
export function leaveSheet() { leaving = true; }

export function SheetBack() {
  const router = useRouter();
  useEffect(() => {
    let open: HTMLDialogElement | null = null;
    let token = "";
    // A link followed from inside a sheet waits here until the sheet's entry is gone (see click below).
    let follow: URL | null = null;
    let at = { path: "", length: 0 };
    const here = () => window.location.pathname + window.location.search;
    const modal = () => [...document.querySelectorAll("dialog")].find((d) => d.open && d.matches(":modal")) ?? null;
    const sync = () => {
      const d = modal();
      if (d && !open) {
        open = d;
        leaving = false;
        token = Math.random().toString(36).slice(2);
        window.history.pushState({ ...window.history.state, sheet: token }, "");
        at = { path: here(), length: window.history.length };
      } else if (!d && open) {
        open = null;
        // A save inside the sheet refreshes the page, and Next then rewrites the entry without our mark: still ours
        // when nothing was added to the history since and the page is the same.
        const mark = window.history.state?.sheet;
        const ours = mark === token || (mark === undefined && here() === at.path && window.history.length === at.length);
        if (!leaving && ours) window.history.back();
        leaving = false;
      }
    };
    // Back (or a swipe back) while a sheet is open: the entry is already gone, so just close the sheet.
    const pop = () => {
      if (!open) {
        const to = follow;
        follow = null;
        if (!to) return;
        // Same page, another part of it (an order's #details-po): a plain hash change, so the page opens that part.
        if (to.pathname + to.search === here()) window.location.hash = to.hash;
        // After Next has handled this Back itself; pushing within the same event was dropped.
        else setTimeout(() => router.push(to.pathname + to.search + to.hash), 0);
        return;
      }
      const d = open;
      open = null;
      if (d.open) d.close();
    };
    // A link inside a sheet (Help's "Open Brief", an inquiry's "Open the inquiry", "add the buyer's PO"): the sheet's
    // entry is taken off first and the page opened after, so one Back returns to where the sheet was opened. Following
    // the link straight away left the sheet's entry behind it, and the first Back from the new page did nothing.
    const click = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!a || !open?.contains(a) || a.getAttribute("target") === "_blank" || a.hasAttribute("download")) return;
      const to = new URL((a as HTMLAnchorElement).href, window.location.href);
      if (to.origin !== window.location.origin || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (window.history.state?.sheet !== token) { leaving = true; return; }
      e.preventDefault();
      follow = to;
      const d = open;
      if (d.open) d.close();
    };
    const watch = new MutationObserver(sync);
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    window.addEventListener("popstate", pop);
    document.addEventListener("click", click, true);
    sync();
    return () => {
      watch.disconnect();
      window.removeEventListener("popstate", pop);
      document.removeEventListener("click", click, true);
    };
  }, [router]);
  return null;
}
