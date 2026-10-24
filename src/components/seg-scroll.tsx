"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A tab bar wider than a phone scrolls sideways; this keeps its chosen tab in view, so a list opened on
// its last tab doesn't hide which tab it is.
export function SegScroll() {
  const path = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".seg").forEach((seg) => {
      if (seg.scrollWidth <= seg.clientWidth) return;
      const on = seg.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
      if (!on) return;
      const box = seg.getBoundingClientRect(), it = on.getBoundingClientRect();
      if (it.right > box.right) seg.scrollLeft += it.right - box.right + 8;
      else if (it.left < box.left) seg.scrollLeft -= box.left - it.left + 8;
    });
  }, [path, query]);
  return null;
}
