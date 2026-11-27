"use client";

import { useTransition } from "react";
import { toast } from "@/components/toast";
import { seeRating } from "./actions";

export function SeenButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn sm" disabled={pending}
      onClick={() => start(async () => { const r = await seeRating(id); if (r.error) toast(r.error, "bad"); })}>
      {pending ? "Marking…" : "Read, done"}
    </button>
  );
}
