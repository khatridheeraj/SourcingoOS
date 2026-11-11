"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/toast";
import { awardQuote, closeListing } from "../actions";

// Give the style to this factory at its price.
export function AwardButton({ listingId, quoteId, factory, primary }: { listingId: string; quoteId: string; factory: string; primary: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={`btn sm ${primary ? "primary" : ""}`} disabled={pending}
      onClick={() => {
        if (!confirm(`Give this style to ${factory} at its price? The other factories are told it went elsewhere.`)) return;
        start(async () => {
          const res = await awardQuote(listingId, quoteId);
          if (res.error) return toast(res.error, "bad");
          toast(`Given to ${factory}. Ask its TNA from the order.`);
          router.refresh();
        });
      }}>{pending ? "Awarding…" : `Award to ${factory}`}</button>
  );
}

// Take the style back from factories without choosing anyone.
export function CloseListing({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn sm ghost" disabled={pending}
      onClick={() => {
        if (!confirm("Close this style to factories without choosing anyone?")) return;
        start(async () => {
          const res = await closeListing(id);
          if (res.error) return toast(res.error, "bad");
          toast("Closed to factories.");
          router.refresh();
        });
      }}>Close without choosing</button>
  );
}
