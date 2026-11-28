"use client";

import { useEffect } from "react";
import { markSeen } from "./actions";

// Opening the page marks everything on it as seen, once it has been shown.
export function MarkSeen({ fresh }: { fresh: number }) {
  useEffect(() => {
    if (fresh > 0) void markSeen();
  }, [fresh]);
  return null;
}
