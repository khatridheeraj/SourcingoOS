"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A tab bar wider than a phone scrolls sideways; this keeps its chosen tab in view, so a list opened on
// its last tab doesn't hide which tab it is. The page streams in after the layout, so tab bars are also
// caught as they appear, each one once per address so a sideways swipe is never undone.
export function SegScroll() {
  const path = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    const done = new WeakSet<HTMLElement>();
    const show = () => document.querySelectorAll<HTMLElement>(".seg").forEach((seg) => {
      if (done.has(seg)) return;
      const on = seg.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
      if (!on || !seg.clientWidth) return;
      done.add(seg);
      if (seg.scrollWidth <= seg.clientWidth) return;
      const box = seg.getBoundingClientRect(), it = on.getBoundingClientRect();
      if (it.right > box.right) seg.scrollLeft += it.right - box.right + 8;
      else if (it.left < box.left) seg.scrollLeft -= box.left - it.left + 8;
    });
    show();
    const watch = new MutationObserver(show);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [path, query]);
  return null;
}
